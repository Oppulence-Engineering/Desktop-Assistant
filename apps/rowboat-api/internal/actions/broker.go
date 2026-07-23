// Package actions implements the RFC 023 closed-loop action broker: the
// propose → approve → execute → watch machinery and the single-use, scoped,
// params-bound approval token that stands between the agent runtime and any
// money-moving product action.
//
// The security invariant is enforced here, not by convention: the model never
// holds an execute capability. It reaches only an allowlisted propose-only tool
// that records a pending ActionProposal. Execution requires a broker-issued
// token that is signed (unforgeable), params-bound (an edit invalidates it),
// expiring (short TTL), and single-use (a DB-backed consume ledger). No token,
// no execution — proven by the verify+consume path in Execute.
package actions

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/actionproposal"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/approvaltoken"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/actionmetrics"
)

// Proposal lifecycle statuses (the state machine).
const (
	StatusPending             = "pending"
	StatusApproved            = "approved"
	StatusRejected            = "rejected"
	StatusExecuted            = "executed"
	StatusFailed              = "failed"
	StatusExecutedUnconfirmed = "executed_unconfirmed"
	StatusExpired             = "expired"
)

// Broker errors, mapped to HTTP status by the handler.
var (
	// ErrInvalidInput is a malformed propose/approve request.
	ErrInvalidInput = errors.New("actions: invalid input")
	// ErrNotPending means approve/reject hit a proposal past the pending state.
	ErrNotPending = errors.New("actions: proposal is not pending")
	// ErrNotApproved means execute hit a proposal that is not approved.
	ErrNotApproved = errors.New("actions: proposal is not approved")
	// ErrAlreadyExecuted means a second execute raced the first.
	ErrAlreadyExecuted = errors.New("actions: proposal already executed")
	// ErrStepUpRequired means a financial approval lacked the required step-up.
	ErrStepUpRequired = errors.New("actions: step-up authentication required")
	// ErrTokenInvalid means the token failed verification or did not match the
	// proposal (forged, wrong proposal, or params mismatch).
	ErrTokenInvalid = errors.New("actions: approval token is invalid")
	// ErrTokenReused means the (valid) token was already consumed.
	ErrTokenReused = errors.New("actions: approval token already used")
	// ErrExecutionUnavailable means no Act-seam executor is configured; the
	// proposal stays approved and no token is consumed (fail closed).
	ErrExecutionUnavailable = errors.New("actions: execution backend is not configured")
)

// Config tunes the broker. Zero values fall back to safe defaults.
type Config struct {
	// TokenTTL is the approval token lifetime (RFC 023 approval.tokenTtl, 5m).
	TokenTTL time.Duration
	// WatchTimeout bounds how long an executed proposal waits for its return
	// event before it is marked executed_unconfirmed (RFC 023 approval.watchTimeout).
	WatchTimeout time.Duration
	// RequireStepUpForFinancial forces step-up before money-moving approvals.
	RequireStepUpForFinancial bool
}

// Broker owns the proposal state machine and the token contract.
type Broker struct {
	client *ent.Client
	signer *Signer
	exec   Executor
	cfg    Config
	now    func() time.Time
	log    *zap.Logger
}

// NewBroker builds the broker. exec may be nil (execution disabled / fail
// closed) until a product Act seam is wired.
func NewBroker(client *ent.Client, signer *Signer, exec Executor, cfg Config, log *zap.Logger) *Broker {
	if cfg.TokenTTL <= 0 {
		cfg.TokenTTL = 5 * time.Minute
	}
	if cfg.WatchTimeout <= 0 {
		cfg.WatchTimeout = 24 * time.Hour
	}
	return &Broker{
		client: client,
		signer: signer,
		exec:   exec,
		cfg:    cfg,
		now:    time.Now,
		log:    log,
	}
}

// ProposeInput is one typed action the runtime proposes.
type ProposeInput struct {
	Target        string
	Kind          string
	ParamsJSON    string
	Financial     bool
	Rationale     string
	EntityID      string
	OriginRunID   string
	CorrelationID string
}

// Propose records a pending ActionProposal. This is the only write the agent
// runtime's propose-only tool performs; it never executes.
func (b *Broker) Propose(ctx context.Context, user *ent.User, in ProposeInput) (*ent.ActionProposal, error) {
	target := strings.TrimSpace(in.Target)
	kind := strings.TrimSpace(in.Kind)
	if target == "" || kind == "" {
		return nil, fmt.Errorf("%w: target and kind are required", ErrInvalidInput)
	}
	// Validate params early so a bad proposal fails at propose, not approve.
	if _, err := ParamsHash(in.ParamsJSON); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	correlation := strings.TrimSpace(in.CorrelationID)
	if correlation == "" {
		correlation = uuid.NewString()
	}
	create := b.client.ActionProposal.Create().
		SetUser(user).
		SetTarget(target).
		SetKind(kind).
		SetFinancial(in.Financial).
		SetCorrelationID(correlation).
		SetStatus(StatusPending)
	if p := strings.TrimSpace(in.ParamsJSON); p != "" {
		create.SetParamsJSON(p)
	}
	if r := strings.TrimSpace(in.Rationale); r != "" {
		create.SetRationale(r)
	}
	if e := strings.TrimSpace(in.EntityID); e != "" {
		create.SetEntityID(e)
	}
	if run := strings.TrimSpace(in.OriginRunID); run != "" {
		create.SetOriginRunID(run)
	}
	p, err := create.Save(ctx)
	if err != nil {
		return nil, fmt.Errorf("actions: create proposal: %w", err)
	}
	actionmetrics.Proposals.WithLabelValues(kind, StatusPending).Inc()
	return p, nil
}

// ListPending returns the operator's pending proposals, newest first.
func (b *Broker) ListPending(ctx context.Context) ([]*ent.ActionProposal, error) {
	return b.client.ActionProposal.Query().
		Where(actionproposal.StatusEQ(StatusPending)).
		Order(ent.Desc(actionproposal.FieldCreatedAt)).
		All(ctx)
}

// Get loads one proposal (tenant-scoped by the read interceptor).
func (b *Broker) Get(ctx context.Context, id uuid.UUID) (*ent.ActionProposal, error) {
	return b.client.ActionProposal.Get(ctx, id)
}

// ApproveResult carries the one-time token back to the caller.
type ApproveResult struct {
	Proposal  *ent.ActionProposal
	Token     string // returned exactly once; only its hash is stored
	ExpiresAt time.Time
}

// Approve issues a single-use, scoped, params-bound token for a pending
// proposal and moves it to approved. stepUpSatisfied reports whether the actor
// met the step-up bar; a financial action without it is rejected.
func (b *Broker) Approve(ctx context.Context, user *ent.User, id uuid.UUID, stepUpSatisfied bool) (*ApproveResult, error) {
	p, err := b.client.ActionProposal.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if p.Status != StatusPending {
		return nil, ErrNotPending
	}
	if p.Financial && b.cfg.RequireStepUpForFinancial && !stepUpSatisfied {
		return nil, ErrStepUpRequired
	}
	paramsHash, err := ParamsHash(p.ParamsJSON)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	now := b.now()
	token, exp, err := b.signer.Mint(Claims{
		ProposalID: p.ID.String(),
		Target:     p.Target,
		Kind:       p.Kind,
		ParamsHash: paramsHash,
		UserID:     user.ID.String(),
		StepUp:     stepUpSatisfied,
	}, now, b.cfg.TokenTTL)
	if err != nil {
		return nil, err
	}

	// Persist the token ledger row and the proposal transition atomically.
	tx, err := b.client.Tx(ctx)
	if err != nil {
		return nil, fmt.Errorf("actions: begin tx: %w", err)
	}
	if _, err := tx.ApprovalToken.Create().
		SetUser(user).
		SetTokenHash(Hash(token)).
		SetProposalID(p.ID.String()).
		SetParamsHash(paramsHash).
		SetOperatorUserID(user.ID.String()).
		SetStepUp(stepUpSatisfied).
		SetExpiresAt(exp).
		SetConsumed(false).
		Save(ctx); err != nil {
		_ = tx.Rollback()
		return nil, fmt.Errorf("actions: store token: %w", err)
	}
	updated, err := tx.ActionProposal.UpdateOneID(p.ID).
		SetStatus(StatusApproved).
		SetApprovedAt(now).
		Save(ctx)
	if err != nil {
		_ = tx.Rollback()
		return nil, fmt.Errorf("actions: approve proposal: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("actions: commit approval: %w", err)
	}

	actionmetrics.TokensIssued.WithLabelValues(boolLabel(p.Financial)).Inc()
	actionmetrics.Proposals.WithLabelValues(p.Kind, StatusApproved).Inc()
	return &ApproveResult{Proposal: updated, Token: token, ExpiresAt: exp}, nil
}

// Reject moves a pending proposal to rejected with a reason.
func (b *Broker) Reject(ctx context.Context, id uuid.UUID, reason string) (*ent.ActionProposal, error) {
	p, err := b.client.ActionProposal.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if p.Status != StatusPending {
		return nil, ErrNotPending
	}
	updated, err := b.client.ActionProposal.UpdateOneID(id).
		SetStatus(StatusRejected).
		SetReason(strings.TrimSpace(reason)).
		Save(ctx)
	if err != nil {
		return nil, fmt.Errorf("actions: reject proposal: %w", err)
	}
	actionmetrics.Proposals.WithLabelValues(p.Kind, StatusRejected).Inc()
	return updated, nil
}

// Execute verifies and consumes the approval token, then runs the action
// against the product Act seam. The token is checked for signature, expiry,
// exact params binding, and single use; only then is it consumed and the
// executor called. A consumed-but-failed action stays failed — retry is a
// fresh proposal, so money never moves twice from one approval.
func (b *Broker) Execute(ctx context.Context, user *ent.User, id uuid.UUID, token string) (*ent.ActionProposal, error) {
	p, err := b.client.ActionProposal.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	switch p.Status {
	case StatusApproved:
		// ok
	case StatusExecuted, StatusExecutedUnconfirmed:
		return nil, ErrAlreadyExecuted
	default:
		return nil, ErrNotApproved
	}

	claims, err := b.signer.Verify(token, b.now())
	if err != nil {
		actionmetrics.TokensRejected.WithLabelValues(verifyReason(err)).Inc()
		if errors.Is(err, ErrTokenExpired) {
			return nil, ErrTokenExpired
		}
		return nil, ErrTokenInvalid
	}
	// The token must be for exactly this proposal, operator, target, and kind.
	if claims.ProposalID != p.ID.String() ||
		claims.Target != p.Target ||
		claims.Kind != p.Kind ||
		claims.UserID != user.ID.String() {
		actionmetrics.TokensRejected.WithLabelValues("scope_mismatch").Inc()
		return nil, ErrTokenInvalid
	}
	// Re-hash the CURRENT params: an edit after approval invalidates the token.
	currentHash, err := ParamsHash(p.ParamsJSON)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	if currentHash != claims.ParamsHash {
		actionmetrics.TokensRejected.WithLabelValues("params_mismatch").Inc()
		return nil, ErrTokenInvalid
	}

	// Locate the single-use ledger row.
	row, err := b.client.ApprovalToken.Query().
		Where(approvaltoken.TokenHash(Hash(token))).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			actionmetrics.TokensRejected.WithLabelValues("unknown").Inc()
			return nil, ErrTokenInvalid
		}
		return nil, fmt.Errorf("actions: load token: %w", err)
	}
	if row.ProposalID != p.ID.String() {
		actionmetrics.TokensRejected.WithLabelValues("scope_mismatch").Inc()
		return nil, ErrTokenInvalid
	}
	if !b.now().Before(row.ExpiresAt) {
		actionmetrics.TokensRejected.WithLabelValues("expired").Inc()
		return nil, ErrTokenExpired
	}

	// Fail closed BEFORE consuming if there is no execution backend, so the
	// operator can retry once one is configured without re-approving.
	if b.exec == nil {
		return nil, ErrExecutionUnavailable
	}

	// Atomically consume: the conditional predicate (consumed = false) makes
	// this the single-use gate. A replayed token finds 0 rows and is rejected.
	affected, err := b.client.ApprovalToken.Update().
		Where(approvaltoken.IDEQ(row.ID), approvaltoken.Consumed(false)).
		SetConsumed(true).
		SetConsumedAt(b.now()).
		Save(ctx)
	if err != nil {
		return nil, fmt.Errorf("actions: consume token: %w", err)
	}
	if affected == 0 {
		actionmetrics.TokensRejected.WithLabelValues("reused").Inc()
		return nil, ErrTokenReused
	}

	// Call the product Act seam. The token is already consumed; a failure here
	// leaves the proposal failed (retry = new proposal).
	res, execErr := b.exec.Execute(ctx, ExecRequest{
		UserID:        user.ID,
		Kind:          p.Kind,
		Target:        p.Target,
		ParamsJSON:    p.ParamsJSON,
		CorrelationID: p.CorrelationID,
	})
	now := b.now()
	if execErr != nil {
		reason := execErr.Error()
		if _, uerr := b.client.ActionProposal.UpdateOneID(p.ID).
			SetStatus(StatusFailed).
			SetReason(reason).
			SetExecutedAt(now).
			Save(ctx); uerr != nil {
			b.log.Warn("actions: mark failed after exec error", zap.Error(uerr))
		}
		actionmetrics.Proposals.WithLabelValues(p.Kind, StatusFailed).Inc()
		return nil, fmt.Errorf("actions: execute action: %w", execErr)
	}

	upd := b.client.ActionProposal.UpdateOneID(p.ID).
		SetStatus(StatusExecuted).
		SetExecutedAt(now)
	if res != nil && strings.TrimSpace(res.ResultRef) != "" {
		upd.SetResultRef(res.ResultRef)
	}
	updated, err := upd.Save(ctx)
	if err != nil {
		return nil, fmt.Errorf("actions: mark executed: %w", err)
	}
	actionmetrics.Proposals.WithLabelValues(p.Kind, StatusExecuted).Inc()
	return updated, nil
}

// TokenView is a redacted token record for the audit chain: never the token,
// only its lifecycle.
type TokenView struct {
	HashPrefix string     `json:"hashPrefix"`
	ParamsHash string     `json:"paramsHash"`
	StepUp     bool       `json:"stepUp"`
	ExpiresAt  time.Time  `json:"expiresAt"`
	Consumed   bool       `json:"consumed"`
	ConsumedAt *time.Time `json:"consumedAt,omitempty"`
	IssuedAt   time.Time  `json:"issuedAt"`
}

// AuditEntry is one proposal plus every token issued for it.
type AuditEntry struct {
	Proposal *ent.ActionProposal `json:"proposal"`
	Tokens   []TokenView         `json:"tokens"`
}

// Audit returns the full proposal → token → execution chain for one object
// (resourceRef), newest proposal first.
func (b *Broker) Audit(ctx context.Context, resourceRef string) ([]AuditEntry, error) {
	ref := strings.TrimSpace(resourceRef)
	if ref == "" {
		return nil, fmt.Errorf("%w: resourceRef is required", ErrInvalidInput)
	}
	proposals, err := b.client.ActionProposal.Query().
		Where(actionproposal.TargetEQ(ref)).
		Order(ent.Desc(actionproposal.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("actions: load audit proposals: %w", err)
	}
	out := make([]AuditEntry, 0, len(proposals))
	for _, p := range proposals {
		tokens, err := b.client.ApprovalToken.Query().
			Where(approvaltoken.ProposalID(p.ID.String())).
			Order(ent.Asc(approvaltoken.FieldCreatedAt)).
			All(ctx)
		if err != nil {
			return nil, fmt.Errorf("actions: load audit tokens: %w", err)
		}
		views := make([]TokenView, 0, len(tokens))
		for _, t := range tokens {
			views = append(views, TokenView{
				HashPrefix: safePrefix(t.TokenHash),
				ParamsHash: t.ParamsHash,
				StepUp:     t.StepUp,
				ExpiresAt:  t.ExpiresAt,
				Consumed:   t.Consumed,
				ConsumedAt: t.ConsumedAt,
				IssuedAt:   t.CreatedAt,
			})
		}
		out = append(out, AuditEntry{Proposal: p, Tokens: views})
	}
	return out, nil
}

// boolLabel maps a bool to a stable low-cardinality metric label.
func boolLabel(v bool) string {
	if v {
		return "true"
	}
	return "false"
}

// verifyReason maps a token verification error to a bounded rejection reason.
func verifyReason(err error) string {
	switch {
	case errors.Is(err, ErrTokenExpired):
		return "expired"
	case errors.Is(err, ErrTokenSignature):
		return "signature"
	case errors.Is(err, ErrTokenKind):
		return "kind"
	default:
		return "malformed"
	}
}

// safePrefix returns a short, non-reversible prefix of a token hash for audit
// display (the full hash is a preimage guard, but a prefix is friendlier).
func safePrefix(hash string) string {
	if len(hash) <= 12 {
		return hash
	}
	return hash[:12]
}
