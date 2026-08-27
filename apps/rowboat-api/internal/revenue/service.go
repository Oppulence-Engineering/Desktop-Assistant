package revenue

import (
	"context"
	stdsha256 "crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/policydecisionsnapshot"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspacemember"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/embeddings"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenuemetrics"
)

// Lifecycle errors. Handlers map these onto HTTP statuses; each one is a hard
// invariant from RFC 030, not a soft validation.
var (
	// ErrNotFound is returned for a missing (or other-tenant) row.
	ErrNotFound = errors.New("revenue: not found")
	// ErrBlocked enforces invariant 1: a blocked action cannot be approved
	// or executed.
	ErrBlocked = errors.New("revenue: action is blocked by policy")
	// ErrNoDecision means a send-mode action has no policy decision for its
	// current revision (invariant 4).
	ErrNoDecision = errors.New("revenue: no policy decision for the current revision")
	// ErrDecisionExpired enforces invariant 5: an expired decision must be
	// re-evaluated before approval or execution.
	ErrDecisionExpired = errors.New("revenue: policy decision expired; re-evaluate")
	// ErrReviewRequired means the decision needs an explicit human risk
	// acceptance before approval (invariant 4).
	ErrReviewRequired = errors.New("revenue: decision requires human review")
	// ErrNotApproved means execute was requested without a valid bound
	// approval (invariant 2).
	ErrNotApproved = errors.New("revenue: action is not approved for its current revision")
	// ErrNotEditable means execution has already begun for this revision.
	ErrNotEditable = errors.New("revenue: action is no longer editable")
	// ErrWorkspaceNotLinked means a send was requested in local mode; only
	// draft execution works without an OutboundConsole link.
	ErrWorkspaceNotLinked = errors.New("revenue: workspace is not linked; sends are disabled")
	// ErrConflict means a concurrent transition won; the caller should
	// reload and retry deliberately.
	ErrConflict = errors.New("revenue: conflicting concurrent transition")
	// ErrInvalidInput is a bounded validation failure.
	ErrInvalidInput = errors.New("revenue: invalid input")
	// ErrForbidden means the authenticated user is in the workspace but their
	// explicit role does not grant the requested capability.
	ErrForbidden = errors.New("revenue: workspace role forbids this operation")
	// ErrIdentityUnresolved prevents any approval or execution whose
	// destination is attached to an ambiguous canonical relationship.
	ErrIdentityUnresolved = errors.New("revenue: action destination depends on unresolved identity")
	// ErrSourceIncomplete prevents beta recommendations and external writes
	// from treating partial, stale, or rebuilding source state as complete.
	ErrSourceIncomplete = errors.New("revenue: required source evidence is incomplete")
)

// ErrAmbiguous is returned by an Executor when the provider may have accepted
// the submission but the result was lost (invariant 8). The action is marked
// ambiguous and is never automatically resent; reconciliation checks provider
// state by message ID first.
var ErrAmbiguous = errors.New("revenue: execution result ambiguous")

// Enum values shared with the ent schemas.
const (
	ModeLocal  = "local"
	ModeLinked = "linked"

	QueueOpen      = "open"
	QueueSnoozed   = "snoozed"
	QueueDismissed = "dismissed"
	QueueHandled   = "handled"

	PolicyPending        = "pending"
	PolicyPassed         = "passed"
	PolicyReviewRequired = "review_required"
	PolicyBlocked        = "blocked"
	PolicyStale          = "stale"

	ApprovalPending  = "pending"
	ApprovalApproved = "approved"
	ApprovalRejected = "rejected"

	ExecPending   = "pending"
	ExecRequested = "requested"
	ExecSent      = "sent"
	ExecFailed    = "failed"
	ExecAmbiguous = "ambiguous"
	ExecCancelled = "cancelled"

	ExecModeDraft = "draft"
	ExecModeSend  = "send"

	OwnerRowboat = "rowboat"

	DetectorManual = "manual"
)

// ExecRequest is what an Executor needs to perform one action revision.
type ExecRequest struct {
	Action    *ent.RevenueAction
	Workspace *ent.RevenueWorkspace
	// UserID is the assigned executing user, verified by the service against
	// invariant 11 before the executor runs; the executor resolves the sender
	// credential for exactly this user.
	UserID         uuid.UUID
	Mode           string // draft | send
	IdempotencyKey string
}

// ExecResult reports a completed execution.
type ExecResult struct {
	ProviderMessageID string
	ProviderThreadID  string
}

// Executor performs the provider call (Gmail draft/send in the first release).
// Implementations must honor the idempotency key and return ErrAmbiguous when
// a submission may have been accepted but the result was lost.
type Executor interface {
	Execute(ctx context.Context, req ExecRequest) (*ExecResult, error)
}

// Reconciler performs a read-only provider lookup for a write whose response
// was lost. found=false never authorizes a resend; the service schedules a
// later lookup and eventually leaves the action for manual review.
type Reconciler interface {
	Reconcile(ctx context.Context, req ExecRequest) (result *ExecResult, found bool, err error)
}

// notConfiguredExecutor is the default until the Gmail executor is wired: it
// fails every execution deterministically (never ambiguous — nothing was
// submitted).
type notConfiguredExecutor struct{}

func (notConfiguredExecutor) Execute(context.Context, ExecRequest) (*ExecResult, error) {
	return nil, errors.New("revenue: no execution backend configured")
}

// Service implements the RFC 030 action-queue lifecycle. Every method runs
// with the caller's authenticated context, so ent interceptors and mutation
// hooks scope all reads and writes to the tenant.
type Service struct {
	client       *ent.Client
	facade       FacadeClient
	executor     Executor
	sweeper      ThreadSweeper
	entitlements Entitlements
	bodyFetcher  MailBodyFetcher
	sealer       *crypto.Sealer
	evidenceKeys *TenantEvidenceKeyManager
	mailBodyTTL  time.Duration
	embedder     embeddings.Embedder
	mailSyncer   MailSyncer
	research     ResearchConfig
	log          *zap.Logger
	now          func() time.Time
}

// NewService builds the lifecycle service. A nil facade falls back to the
// fail-closed disabled facade; a nil executor fails executions until WP4
// wires Gmail.
func NewService(client *ent.Client, facade FacadeClient, executor Executor, log *zap.Logger) *Service {
	if facade == nil {
		facade = NewDisabledFacade()
	}
	if executor == nil {
		executor = notConfiguredExecutor{}
	}
	if log == nil {
		log = zap.NewNop()
	}
	return &Service{
		client:   client,
		facade:   facade,
		executor: executor,
		log:      log,
		now:      func() time.Time { return time.Now().UTC() },
	}
}

// --- workspace ---------------------------------------------------------------

// CurrentWorkspace returns the caller's active revenue workspace. Explicit
// membership is authoritative; the founding-owner edge remains a migration
// fallback and is backfilled into an owner membership on access.
func (s *Service) CurrentWorkspace(ctx context.Context, u *ent.User) (*ent.RevenueWorkspace, error) {
	member, err := s.client.RevenueWorkspaceMember.Query().
		Where(
			revenueworkspacemember.StatusEQ("active"),
			revenueworkspacemember.HasUserWith(user.IDEQ(u.ID)),
		).
		WithWorkspace().
		Order(ent.Asc(revenueworkspacemember.FieldCreatedAt)).
		First(ctx)
	if err == nil {
		ws, workspaceErr := member.Edges.WorkspaceOrErr()
		if workspaceErr != nil {
			return nil, workspaceErr
		}
		auth.GrantRevenueWorkspace(ctx, ws.ID, member.Role)
		return ws, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}

	ws, err := s.client.RevenueWorkspace.Query().
		Where(revenueworkspace.HasUserWith(user.IDEQ(u.ID))).
		First(ctx)
	if err == nil {
		auth.GrantRevenueWorkspace(ctx, ws.ID, "owner")
		if _, memberErr := s.client.RevenueWorkspaceMember.Create().
			SetWorkspace(ws).
			SetUser(u).
			SetRole("owner").
			SetStatus("active").
			Save(ctx); memberErr != nil && !ent.IsConstraintError(memberErr) {
			return nil, memberErr
		}
		return ws, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	create := s.client.RevenueWorkspace.Create().SetUser(u)
	if u.WorkosOrgID != "" {
		create.SetWorkosOrgID(u.WorkosOrgID)
	}
	ws, err = create.Save(ctx)
	if err != nil {
		if ent.IsConstraintError(err) {
			// Concurrent first touch: the peer's row wins.
			ws, queryErr := s.client.RevenueWorkspace.Query().
				Where(revenueworkspace.HasUserWith(user.IDEQ(u.ID))).
				First(ctx)
			if queryErr == nil {
				auth.GrantRevenueWorkspace(ctx, ws.ID, "owner")
			}
			return ws, queryErr
		}
		return nil, err
	}
	auth.GrantRevenueWorkspace(ctx, ws.ID, "owner")
	if _, err := s.client.RevenueWorkspaceMember.Create().
		SetWorkspace(ws).
		SetUser(u).
		SetRole("owner").
		SetStatus("active").
		Save(ctx); err != nil {
		return nil, err
	}
	return ws, nil
}

// CurrentWorkspaceForOrg resolves an existing active workspace membership for
// the exact organization asserted by the current verified token. Unlike
// CurrentWorkspace, this authorization helper is read-only: it never creates a
// workspace or backfills membership while deciding access.
func (s *Service) CurrentWorkspaceForOrg(ctx context.Context, u *ent.User, workosOrgID string) (*ent.RevenueWorkspace, error) {
	workosOrgID = strings.TrimSpace(workosOrgID)
	if u == nil || workosOrgID == "" {
		return s.client.RevenueWorkspace.Query().
			Where(revenueworkspace.IDEQ(uuid.Nil)).
			First(ctx)
	}
	member, err := s.client.RevenueWorkspaceMember.Query().
		Where(
			revenueworkspacemember.StatusEQ("active"),
			revenueworkspacemember.HasUserWith(user.IDEQ(u.ID)),
			revenueworkspacemember.HasWorkspaceWith(revenueworkspace.WorkosOrgIDEQ(workosOrgID)),
		).
		WithWorkspace().
		Order(ent.Asc(revenueworkspacemember.FieldCreatedAt)).
		First(ctx)
	if err == nil {
		workspace, workspaceErr := member.Edges.WorkspaceOrErr()
		if workspaceErr != nil {
			return nil, workspaceErr
		}
		auth.GrantRevenueWorkspace(ctx, workspace.ID, member.Role)
		return workspace, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}

	workspace, err := s.client.RevenueWorkspace.Query().
		Where(
			revenueworkspace.WorkosOrgIDEQ(workosOrgID),
			revenueworkspace.HasUserWith(user.IDEQ(u.ID)),
		).
		First(ctx)
	if err != nil {
		return nil, err
	}
	auth.GrantRevenueWorkspace(ctx, workspace.ID, "owner")
	return workspace, nil
}

// WorkspaceCapability names one server-enforced workspace permission.
type WorkspaceCapability string

// Workspace capability constants define the operations granted by each role.
const (
	WorkspaceView          WorkspaceCapability = "view"
	WorkspaceContribute    WorkspaceCapability = "contribute"
	WorkspaceExecute       WorkspaceCapability = "execute"
	WorkspaceManageSources WorkspaceCapability = "manage_sources"
	WorkspaceManageMembers WorkspaceCapability = "manage_members"
)

var workspaceRoleCapabilities = map[string]map[WorkspaceCapability]bool{
	"owner": {
		WorkspaceView: true, WorkspaceContribute: true, WorkspaceExecute: true,
		WorkspaceManageSources: true, WorkspaceManageMembers: true,
	},
	"admin": {
		WorkspaceView: true, WorkspaceContribute: true, WorkspaceExecute: true,
		WorkspaceManageSources: true, WorkspaceManageMembers: true,
	},
	"member": {
		WorkspaceView: true, WorkspaceContribute: true, WorkspaceExecute: true,
	},
	"viewer": {WorkspaceView: true},
}

// WorkspaceRole returns the caller's active explicit role. The founding edge
// is accepted as owner only for pre-membership migration compatibility.
func (s *Service) WorkspaceRole(
	ctx context.Context,
	u *ent.User,
	ws *ent.RevenueWorkspace,
) (string, error) {
	member, err := s.client.RevenueWorkspaceMember.Query().
		Where(
			revenueworkspacemember.StatusEQ("active"),
			revenueworkspacemember.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			revenueworkspacemember.HasUserWith(user.IDEQ(u.ID)),
		).
		Only(ctx)
	if err == nil {
		return member.Role, nil
	}
	if !ent.IsNotFound(err) {
		return "", err
	}
	isFounder, err := ws.QueryUser().Where(user.IDEQ(u.ID)).Exist(ctx)
	if err != nil {
		return "", err
	}
	if isFounder {
		return "owner", nil
	}
	return "", ErrForbidden
}

// RequireWorkspaceCapability authorizes an operation against an exact tenant
// and returns the caller's active role.
func (s *Service) RequireWorkspaceCapability(
	ctx context.Context,
	u *ent.User,
	ws *ent.RevenueWorkspace,
	capability WorkspaceCapability,
) (string, error) {
	role, err := s.WorkspaceRole(ctx, u, ws)
	if err != nil {
		return "", err
	}
	if !workspaceRoleCapabilities[role][capability] {
		return role, ErrForbidden
	}
	return role, nil
}

func (s *Service) currentWorkspaceWithCapability(
	ctx context.Context,
	u *ent.User,
	capability WorkspaceCapability,
) (*ent.RevenueWorkspace, error) {
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return nil, err
	}
	if _, err := s.RequireWorkspaceCapability(ctx, u, ws, capability); err != nil {
		return nil, err
	}
	return ws, nil
}

// ListWorkspaceMembers returns the active and removed membership audit rows.
func (s *Service) ListWorkspaceMembers(ctx context.Context, u *ent.User) ([]*ent.RevenueWorkspaceMember, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	return s.client.RevenueWorkspaceMember.Query().
		Where(revenueworkspacemember.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).
		WithUser().
		Order(ent.Asc(revenueworkspacemember.FieldCreatedAt)).
		All(ctx)
}

// UpsertWorkspaceMember grants a pre-existing authenticated user a role. User
// provisioning remains the identity provider's responsibility.
func (s *Service) UpsertWorkspaceMember(
	ctx context.Context,
	actor *ent.User,
	targetUserID uuid.UUID,
	role string,
) (*ent.RevenueWorkspaceMember, error) {
	role = strings.ToLower(strings.TrimSpace(role))
	if role != "admin" && role != "member" && role != "viewer" {
		return nil, fmt.Errorf("%w: role must be admin, member, or viewer", ErrInvalidInput)
	}
	ws, err := s.CurrentWorkspace(ctx, actor)
	if err != nil {
		return nil, err
	}
	actorRole, err := s.RequireWorkspaceCapability(ctx, actor, ws, WorkspaceManageMembers)
	if err != nil {
		return nil, err
	}
	if role == "admin" && actorRole != "owner" {
		return nil, ErrForbidden
	}
	target, err := s.client.User.Get(ctx, targetUserID)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	existing, err := s.client.RevenueWorkspaceMember.Query().
		Where(
			revenueworkspacemember.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			revenueworkspacemember.HasUserWith(user.IDEQ(targetUserID)),
		).
		Only(ctx)
	if err == nil {
		if existing.Role == "owner" {
			return nil, ErrForbidden
		}
		return existing.Update().SetRole(role).SetStatus("active").Save(ctx)
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	return s.client.RevenueWorkspaceMember.Create().
		SetWorkspace(ws).SetUser(target).SetRole(role).SetStatus("active").Save(ctx)
}

// RemoveWorkspaceMember deactivates a tenant membership while preventing the
// protected owner membership from being removed through this path.
func (s *Service) RemoveWorkspaceMember(
	ctx context.Context,
	actor *ent.User,
	membershipID uuid.UUID,
) (*ent.RevenueWorkspaceMember, error) {
	ws, err := s.CurrentWorkspace(ctx, actor)
	if err != nil {
		return nil, err
	}
	actorRole, err := s.RequireWorkspaceCapability(ctx, actor, ws, WorkspaceManageMembers)
	if err != nil {
		return nil, err
	}
	member, err := s.client.RevenueWorkspaceMember.Query().
		Where(
			revenueworkspacemember.IDEQ(membershipID),
			revenueworkspacemember.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).
		Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if member.Role == "owner" || (member.Role == "admin" && actorRole != "owner") {
		return nil, ErrForbidden
	}
	return member.Update().SetStatus("removed").Save(ctx)
}

// LinkInput carries the OutboundConsole identifiers for a workspace link.
type LinkInput struct {
	OutboundOrganizationID string
	OutboundWorkspaceID    string
}

// LinkWorkspace completes the OutboundConsole workspace link. It requires a
// configured facade: linking is the act of turning preflight on, and there is
// nothing to link against when the facade is absent (fail closed).
//
// TODO(WP0.6): replace the trusted-identifier link with the server-verified
// WorkOS ↔ OutboundConsole handshake before multi-tenant rollout.
func (s *Service) LinkWorkspace(ctx context.Context, u *ent.User, in LinkInput) (*ent.RevenueWorkspace, error) {
	if strings.TrimSpace(in.OutboundWorkspaceID) == "" {
		return nil, fmt.Errorf("%w: outboundWorkspaceId is required", ErrInvalidInput)
	}
	if _, ok := s.facade.(disabledFacade); ok {
		return nil, ErrFacadeUnavailable
	}
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceManageSources)
	if err != nil {
		return nil, err
	}
	return ws.Update().
		SetOutboundOrganizationID(strings.TrimSpace(in.OutboundOrganizationID)).
		SetOutboundWorkspaceID(strings.TrimSpace(in.OutboundWorkspaceID)).
		SetMode(ModeLinked).
		SetStatus("active").
		SetLastVerifiedAt(s.now()).
		Save(ctx)
}

// --- relationships -----------------------------------------------------------

// RelationshipInput creates a revenue-memory relationship.
type RelationshipInput struct {
	Kind          string
	DisplayName   string
	PrimaryEmail  string
	AccountDomain string
	Summary       string
	ResourceRefs  []string
}

// CreateRelationship records a relationship in the caller's workspace.
func (s *Service) CreateRelationship(ctx context.Context, u *ent.User, in RelationshipInput) (*ent.Relationship, error) {
	if strings.TrimSpace(in.DisplayName) == "" {
		return nil, fmt.Errorf("%w: displayName is required", ErrInvalidInput)
	}
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute)
	if err != nil {
		return nil, err
	}
	create := s.client.Relationship.Create().
		SetWorkspace(ws).
		SetUser(u).
		SetKind(in.Kind).
		SetDisplayName(strings.TrimSpace(in.DisplayName))
	if in.PrimaryEmail != "" {
		create.SetPrimaryEmail(strings.ToLower(strings.TrimSpace(in.PrimaryEmail)))
	}
	if in.AccountDomain != "" {
		create.SetAccountDomain(strings.ToLower(strings.TrimSpace(in.AccountDomain)))
	}
	if in.Summary != "" {
		create.SetSummary(in.Summary)
	}
	refs, err := normalizeResourceRefs(in.ResourceRefs)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidInput, err)
	}
	if len(refs) > 0 {
		create.SetResourceRefs(refs)
	}
	rel, err := create.Save(ctx)
	if err != nil {
		if isValidationError(err) {
			return nil, fmt.Errorf("%w: %w", ErrInvalidInput, err)
		}
		return nil, err
	}
	// Bind anchors here too. A hand-created relationship that skipped this stayed
	// invisible to the identity engine, so the next observation for the same address
	// resolved to nothing and forked a second relationship for the same account.
	// A collision surfaces as a reviewable candidate, exactly as it does on ingest.
	if err := bindRelationshipIdentities(
		ctx, s.client, ws, u, rel, relationshipIdentitySignals(rel), "user", rel.CreatedAt,
	); err != nil {
		return nil, err
	}
	return rel, nil
}

// relationshipListLimit bounds the relationships listing (the queue, not the
// CRM, is the product; a client that needs more should filter). Exposed so the
// handler can document it.
const relationshipListLimit = 200

// ListRelationships returns the workspace's relationships, newest touch first,
// each with its open queue actions eager-loaded so the caller can report
// open-loop counts.
func (s *Service) ListRelationships(ctx context.Context, u *ent.User) ([]*ent.Relationship, error) {
	return s.ListRelationshipsFiltered(ctx, u, RelationshipListFilter{})
}

// RelationshipListFilter controls relationship list search, paging, and state filters.
type RelationshipListFilter struct {
	Query      string
	Lifecycle  string
	Health     string
	Engagement string
}

// ListRelationshipsFiltered returns account mission-control rows with
// explainable-state filters shared by web and desktop.
func (s *Service) ListRelationshipsFiltered(
	ctx context.Context,
	u *ent.User,
	filter RelationshipListFilter,
) ([]*ent.Relationship, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	q := s.client.Relationship.Query().
		Where(relationship.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)))
	if value := strings.TrimSpace(filter.Lifecycle); value != "" {
		q.Where(relationship.LifecycleEQ(value))
	}
	if value := strings.TrimSpace(filter.Health); value != "" {
		q.Where(relationship.HealthEQ(value))
	}
	if value := strings.TrimSpace(filter.Engagement); value != "" {
		q.Where(relationship.EngagementEQ(value))
	}
	if value := strings.ToLower(strings.TrimSpace(filter.Query)); value != "" {
		q.Where(relationship.Or(
			relationship.DisplayNameContainsFold(value),
			relationship.AccountDomainContainsFold(value),
			relationship.PrimaryEmailContainsFold(value),
		))
	}
	return q.
		WithActions(func(q *ent.RevenueActionQuery) {
			q.Where(revenueaction.QueueStatusEQ(QueueOpen))
		}).
		Order(ent.Desc(relationship.FieldUpdatedAt)).
		Limit(relationshipListLimit).
		All(ctx)
}

// GetRelationship returns one relationship with its actions and commitments.
func (s *Service) GetRelationship(ctx context.Context, id uuid.UUID) (*ent.Relationship, error) {
	rel, err := s.client.Relationship.Query().
		Where(relationship.IDEQ(id)).
		WithCommitments().
		// The canonical person travels with the participant so the detail view can
		// show one enriched human rather than a bare name and address.
		WithParticipants(func(q *ent.RelationshipParticipantQuery) {
			q.WithPerson()
		}).
		WithActions(func(q *ent.RevenueActionQuery) {
			q.WithEvidences().Order(
				ent.Desc(revenueaction.FieldPriorityScore),
				ent.Asc(revenueaction.FieldID),
			)
		}).
		Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return rel, err
}

// --- action creation ---------------------------------------------------------

// ActionInput creates a queue action. Detector defaults to "manual"; scan
// detectors (WP3) pass their own detector and dedupe key.
type ActionInput struct {
	RelationshipID   uuid.UUID
	ActionType       string
	Channel          string
	Detector         string
	DedupeKey        string
	Reason           string
	RecipientEmail   string
	ProposedSubject  string
	ProposedMessage  string
	SenderAccountRef string
	ExecutionMode    string // draft (default) | send
	PriorityScore    int
	PriorityParts    map[string]int
	DueAt            *time.Time
}

// content returns the revision-hash content for the input as revision 1.
func (in ActionInput) content(assigned uuid.UUID) RevisionContent {
	return RevisionContent{
		ActionType:       in.ActionType,
		Channel:          in.Channel,
		RecipientEmail:   in.RecipientEmail,
		ProposedSubject:  in.ProposedSubject,
		ProposedMessage:  in.ProposedMessage,
		SenderAccountRef: in.SenderAccountRef,
		AssignedUserID:   assigned.String(),
		ExecutionMode:    in.ExecutionMode,
	}
}

// CreateAction proposes a new queue action with revision 1 and an immutable
// revision snapshot. The dedupe key keeps detector reruns from duplicating
// queue items; a duplicate returns the existing action.
func (s *Service) CreateAction(ctx context.Context, u *ent.User, in ActionInput) (*ent.RevenueAction, error) {
	if strings.TrimSpace(in.Reason) == "" {
		return nil, fmt.Errorf("%w: reason is required", ErrInvalidInput)
	}
	if in.Detector == "" {
		in.Detector = DetectorManual
	}
	if in.ExecutionMode == "" {
		in.ExecutionMode = ExecModeDraft
	}
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute)
	if err != nil {
		return nil, err
	}
	rel, err := s.client.Relationship.Query().
		Where(relationship.IDEQ(in.RelationshipID)).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, fmt.Errorf("%w: relationship", ErrNotFound)
		}
		return nil, err
	}
	if unresolved, checkErr := s.relationshipHasUnresolvedIdentity(ctx, rel.ID); checkErr != nil {
		return nil, checkErr
	} else if unresolved {
		return nil, ErrIdentityUnresolved
	}
	if in.Detector != DetectorManual {
		if err := s.ensureRelationshipActionCompleteness(ctx, u, ws, rel.ID); err != nil {
			return nil, err
		}
	}
	if in.DedupeKey == "" {
		in.DedupeKey = fmt.Sprintf("%s:%s:%s:%s", in.Detector, in.ActionType, in.Channel, rel.ID)
	}
	if in.PriorityScore < 0 {
		in.PriorityScore = 0
	}
	if in.PriorityScore > 100 {
		in.PriorityScore = 100
	}
	hash := in.content(u.ID).Hash()

	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	txc := tx.Client()

	create := txc.RevenueAction.Create().
		SetWorkspace(ws).
		SetRelationship(rel).
		SetUser(u).
		SetActionType(in.ActionType).
		SetChannel(in.Channel).
		SetDetector(in.Detector).
		SetDedupeKey(in.DedupeKey).
		SetRevision(1).
		SetRevisionHash(hash).
		SetReason(in.Reason).
		SetExecutionMode(in.ExecutionMode).
		SetExecutionOwner(OwnerRowboat).
		SetAssignedUserID(u.ID).
		SetPriorityScore(in.PriorityScore)
	if in.RecipientEmail != "" {
		create.SetRecipientEmail(strings.ToLower(strings.TrimSpace(in.RecipientEmail)))
	}
	if in.ProposedSubject != "" {
		create.SetProposedSubject(in.ProposedSubject)
	}
	if in.ProposedMessage != "" {
		create.SetProposedMessage(in.ProposedMessage)
	}
	if in.SenderAccountRef != "" {
		create.SetSenderAccountRef(in.SenderAccountRef)
	}
	if len(in.PriorityParts) > 0 {
		raw, merr := json.Marshal(in.PriorityParts)
		if merr != nil {
			_ = tx.Rollback()
			return nil, merr
		}
		create.SetPriorityComponentsJSON(string(raw))
	}
	if in.DueAt != nil {
		create.SetDueAt(*in.DueAt)
	}
	action, err := create.Save(ctx)
	if err != nil {
		_ = tx.Rollback()
		if ent.IsConstraintError(err) {
			// Duplicate dedupe key: detector rerun. Return the existing item.
			revenuemetrics.DuplicatesPrevented.WithLabelValues("create").Inc()
			return s.client.RevenueAction.Query().
				Where(revenueaction.DedupeKeyEQ(in.DedupeKey)).
				First(ctx)
		}
		if isValidationError(err) {
			return nil, fmt.Errorf("%w: %w", ErrInvalidInput, err)
		}
		return nil, err
	}
	if err := s.snapshotRevision(ctx, txc, action, u); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	revenuemetrics.Actions.WithLabelValues(action.ActionType, action.QueueStatus).Inc()
	_ = s.RefreshRelationshipAttention(ctx, u)
	return action.Unwrap(), nil
}

// snapshotRevision writes the immutable revision row for the action's current
// content (part of every create/edit transaction).
func (s *Service) snapshotRevision(ctx context.Context, txc *ent.Client, action *ent.RevenueAction, u *ent.User) error {
	create := txc.RevenueActionRevision.Create().
		SetAction(action).
		SetUser(u).
		SetRevision(action.Revision).
		SetRevisionHash(action.RevisionHash).
		SetActionType(action.ActionType).
		SetChannel(action.Channel).
		SetReason(action.Reason).
		SetCreatedBy(u.ID)
	if action.RecipientEmail != "" {
		create.SetRecipientEmail(action.RecipientEmail)
	}
	if action.ProposedSubject != "" {
		create.SetProposedSubject(action.ProposedSubject)
	}
	if action.ProposedMessage != "" {
		create.SetProposedMessage(action.ProposedMessage)
	}
	if action.SenderAccountRef != "" {
		create.SetSenderAccountRef(action.SenderAccountRef)
	}
	if action.AssignedUserID != nil {
		create.SetAssignedUserID(*action.AssignedUserID)
	}
	return create.Exec(ctx)
}

// --- queue reads -------------------------------------------------------------

// ListFilter bounds the queue listing.
type ListFilter struct {
	QueueStatus string
	Limit       int
}

// ListActions returns the caller's queue ordered by priority. The default
// page is the RFC's top-ten open actions, not every possible reminder.
func (s *Service) ListActions(ctx context.Context, u *ent.User, f ListFilter) ([]*ent.RevenueAction, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	q := s.client.RevenueAction.Query().
		Where(revenueaction.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)))
	status := f.QueueStatus
	if status == "" {
		status = QueueOpen
	}
	if status != "all" {
		q = q.Where(revenueaction.QueueStatusEQ(status))
	}
	return q.Order(ent.Desc(revenueaction.FieldPriorityScore), ent.Asc(revenueaction.FieldCreatedAt)).
		Limit(limit).
		All(ctx)
}

// GetAction returns one action with relationship context.
func (s *Service) GetAction(ctx context.Context, id uuid.UUID) (*ent.RevenueAction, error) {
	action, err := s.client.RevenueAction.Query().
		Where(revenueaction.IDEQ(id)).
		WithRelationship().
		Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return action, err
}

// Audit returns the full observe → decision → approval → execution → outcome
// chain for one action.
func (s *Service) Audit(ctx context.Context, id uuid.UUID) (*ent.RevenueAction, error) {
	action, err := s.client.RevenueAction.Query().
		Where(revenueaction.IDEQ(id)).
		WithRelationship().
		WithRevisions(func(q *ent.RevenueActionRevisionQuery) {
			q.Order(ent.Asc("revision"))
		}).
		WithDecisions(func(q *ent.PolicyDecisionSnapshotQuery) {
			q.Order(ent.Asc(policydecisionsnapshot.FieldEvaluatedAt))
		}).
		WithOutcomes().
		Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return action, err
}

// --- edit (invariant 3) ------------------------------------------------------

// EditInput carries the revision-bearing fields of an edit. Nil pointers keep
// the current value.
type EditInput struct {
	Reason           *string
	RecipientEmail   *string
	ProposedSubject  *string
	ProposedMessage  *string
	SenderAccountRef *string
	Channel          *string
	ActionType       *string
	ExecutionMode    *string
}

// EditAction creates a new revision and invalidates the previous policy
// decision and approval (invariant 3). Editing is refused once execution has
// begun for the current revision.
func (s *Service) EditAction(ctx context.Context, u *ent.User, id uuid.UUID, in EditInput) (*ent.RevenueAction, error) {
	if _, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute); err != nil {
		return nil, err
	}
	action, err := s.GetAction(ctx, id)
	if err != nil {
		return nil, err
	}
	if action.ExecutionStatus != ExecPending {
		return nil, ErrNotEditable
	}

	apply := func(cur string, next *string) string {
		if next == nil {
			return cur
		}
		return *next
	}
	next := RevisionContent{
		ActionType:       apply(action.ActionType, in.ActionType),
		Channel:          apply(action.Channel, in.Channel),
		RecipientEmail:   strings.ToLower(strings.TrimSpace(apply(action.RecipientEmail, in.RecipientEmail))),
		ProposedSubject:  apply(action.ProposedSubject, in.ProposedSubject),
		ProposedMessage:  apply(action.ProposedMessage, in.ProposedMessage),
		SenderAccountRef: apply(action.SenderAccountRef, in.SenderAccountRef),
		ExecutionMode:    apply(action.ExecutionMode, in.ExecutionMode),
	}
	if action.AssignedUserID != nil {
		next.AssignedUserID = action.AssignedUserID.String()
	}
	hash := next.Hash()
	if hash == action.RevisionHash {
		// No revision-bearing change: nothing to invalidate.
		return action, nil
	}

	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	txc := tx.Client()

	// Conditional bump: the WHERE on the old revision makes concurrent edits
	// serialize instead of both writing revision N+1.
	upd := txc.RevenueAction.Update().
		Where(
			revenueaction.IDEQ(action.ID),
			revenueaction.RevisionEQ(action.Revision),
			revenueaction.ExecutionStatusEQ(ExecPending),
		).
		SetRevision(action.Revision + 1).
		SetRevisionHash(hash).
		SetActionType(next.ActionType).
		SetChannel(next.Channel).
		SetRecipientEmail(next.RecipientEmail).
		SetProposedSubject(next.ProposedSubject).
		SetProposedMessage(next.ProposedMessage).
		SetSenderAccountRef(next.SenderAccountRef).
		SetExecutionMode(next.ExecutionMode).
		// Invalidate policy and approval (invariant 3).
		SetPolicyStatus(PolicyPending).
		SetApprovalStatus(ApprovalPending).
		ClearApprovedRevision().
		ClearApprovedDecisionID().
		ClearApprovedBy().
		ClearApprovedAt()
	if in.Reason != nil {
		upd.SetReason(*in.Reason)
	}
	n, err := upd.Save(ctx)
	if err != nil {
		_ = tx.Rollback()
		if isValidationError(err) {
			return nil, fmt.Errorf("%w: %w", ErrInvalidInput, err)
		}
		return nil, err
	}
	if n == 0 {
		_ = tx.Rollback()
		return nil, ErrConflict
	}
	updated, err := txc.RevenueAction.Query().Where(revenueaction.IDEQ(action.ID)).Only(ctx)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := s.snapshotRevision(ctx, txc, updated, u); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	_ = s.RefreshRelationshipAttention(ctx, u)
	return updated.Unwrap(), nil
}

// --- preflight (facade) ------------------------------------------------------

// Evaluate requests an OutboundConsole preflight for the action's current
// revision and stores the immutable decision snapshot. A fresh unexpired
// snapshot for the same revision is returned as-is (duplicate evaluate is
// free). Facade unavailability leaves policy_status=pending (fail closed).
func (s *Service) Evaluate(ctx context.Context, u *ent.User, id uuid.UUID) (*ent.PolicyDecisionSnapshot, error) {
	if _, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceExecute); err != nil {
		return nil, err
	}
	action, err := s.GetAction(ctx, id)
	if err != nil {
		return nil, err
	}
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return nil, err
	}
	now := s.now()

	// Idempotency: an unexpired snapshot for this exact revision answers the
	// duplicate without provider cost.
	existing, err := s.client.PolicyDecisionSnapshot.Query().
		Where(
			policydecisionsnapshot.HasActionWith(revenueaction.IDEQ(action.ID)),
			policydecisionsnapshot.ActionRevisionEQ(action.Revision),
			policydecisionsnapshot.RevisionHashEQ(action.RevisionHash),
			policydecisionsnapshot.ExpiresAtGT(now),
		).
		Order(ent.Desc(policydecisionsnapshot.FieldEvaluatedAt)).
		First(ctx)
	if err == nil {
		revenuemetrics.DuplicatesPrevented.WithLabelValues("evaluate").Inc()
		return existing, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}

	rel, err := action.QueryRelationship().Only(ctx)
	if err != nil {
		return nil, err
	}

	req := EvaluateRequest{
		SchemaVersion:          SchemaVersion,
		RequestID:              uuid.NewString(),
		IdempotencyKey:         ExecutionIdempotencyKey(action.ID.String(), action.Revision),
		CorrelationID:          action.ID.String(),
		OutboundOrganizationID: ws.OutboundOrganizationID,
		Actor:                  EvaluateActor{WorkOSUserID: u.WorkosUserID},
		Action: EvaluateAction{
			ActionID:     action.ID.String(),
			Revision:     action.Revision,
			RevisionHash: action.RevisionHash,
			ActionType:   action.ActionType,
			Channel:      action.Channel,
			Recipient: EvaluateRecipient{
				OutboundLeadID: rel.OutboundLeadID,
				Email:          action.RecipientEmail,
				AccountDomain:  rel.AccountDomain,
			},
			RelationshipSignals: RelationshipSignals{
				LastContactAt: rel.LastTouchAt,
				ReasonCode:    action.Detector,
			},
		},
	}
	if ws.OutboundWorkspaceID != nil {
		req.OutboundWorkspaceID = *ws.OutboundWorkspaceID
	}

	if err := s.appendOutbox(ctx, s.client, ws, u, "revenue.action.preflight_requested.v1", action.ID,
		fmt.Sprintf("preflight_requested:%s:%d", action.ID, action.Revision),
		map[string]any{"revision": action.Revision}, now); err != nil {
		return nil, err
	}

	start := s.now()
	decision, err := s.facade.EvaluateRevenueAction(ctx, req)
	elapsed := s.now().Sub(start).Seconds()
	if err != nil {
		revenuemetrics.PreflightRequests.WithLabelValues("unavailable", "facade_error").Inc()
		revenuemetrics.PreflightDuration.WithLabelValues("unavailable").Observe(elapsed)
		// Fail closed: policy stays pending, nothing can be approved or sent.
		return nil, err
	}
	statusLabel := boundedStatus(decision.Status)
	revenuemetrics.PreflightRequests.WithLabelValues(statusLabel, reasonGroup(decision.ReasonCodes)).Inc()
	revenuemetrics.PreflightDuration.WithLabelValues(statusLabel).Observe(elapsed)

	// The decision must be about the exact revision we asked about.
	if decision.Revision != action.Revision || decision.RevisionHash != action.RevisionHash {
		return nil, fmt.Errorf("%w: decision revision mismatch", ErrFacadeUnavailable)
	}

	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	txc := tx.Client()

	snapCreate := txc.PolicyDecisionSnapshot.Create().
		SetWorkspace(ws).
		SetAction(action).
		SetUser(u).
		SetActionRevision(decision.Revision).
		SetRevisionHash(decision.RevisionHash).
		SetStatus(decision.Status).
		SetReasonCodes(decision.ReasonCodes).
		SetEvaluatedAt(decision.EvaluatedAt).
		SetExpiresAt(decision.ExpiresAt).
		SetResponseHash(decision.ResponseHash)
	if decision.OutboundLead != "" {
		snapCreate.SetOutboundLeadID(decision.OutboundLead)
	}
	if len(decision.Verification) > 0 {
		snapCreate.SetVerificationJSON(string(decision.Verification))
	}
	if len(decision.Suppression) > 0 {
		snapCreate.SetSuppressionJSON(string(decision.Suppression))
	}
	if len(decision.Research) > 0 {
		snapCreate.SetResearchJSON(string(decision.Research))
	}
	if len(decision.CRM) > 0 {
		snapCreate.SetCrmJSON(string(decision.CRM))
	}
	snap, err := snapCreate.Save(ctx)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}

	// Apply the decision to the action's policy dimension, but only for the
	// same revision — a concurrent edit invalidates this evaluation. A fresh
	// evaluation also invalidates any prior approval: the operator approved a
	// specific decision, and this is a new one, so they must approve again
	// (this closes the "re-evaluate to review_required after approval, then
	// send" bypass). The idempotent short-circuit above already returns an
	// unchanged unexpired decision without reaching here, so a genuine
	// no-op re-evaluate never needlessly drops an approval.
	upd := txc.RevenueAction.Update().
		Where(
			revenueaction.IDEQ(action.ID),
			revenueaction.RevisionEQ(action.Revision),
		).
		SetPolicyStatus(decision.Status)
	if action.ApprovalStatus == ApprovalApproved {
		upd.SetApprovalStatus(ApprovalPending).
			ClearApprovedRevision().
			ClearApprovedDecisionID().
			ClearApprovedBy().
			ClearApprovedAt()
	}
	n, err := upd.Save(ctx)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if n == 0 {
		_ = tx.Rollback()
		return nil, ErrConflict
	}
	if err := s.appendOutboxTx(ctx, txc, ws, u, "revenue.action.preflight_completed.v1", action.ID,
		fmt.Sprintf("preflight_completed:%s:%d:%s", action.ID, action.Revision, decision.DecisionID),
		map[string]any{"revision": action.Revision, "status": decision.Status, "decisionId": decision.DecisionID}, now); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return snap, nil
}

// boundedStatus clamps a facade-supplied decision status to the known enum so
// a misbehaving or hostile facade cannot explode Prometheus label cardinality
// (RFC 030: never let unbounded provider strings become metric labels).
func boundedStatus(status string) string {
	switch status {
	case PolicyPassed, PolicyReviewRequired, PolicyBlocked:
		return status
	default:
		return "other"
	}
}

// knownReasonGroups is the allowlist of facade reason-code prefixes that may
// appear as a metric label. Anything else collapses to "other".
var knownReasonGroups = map[string]bool{
	"suppression": true, "verification": true, "research": true,
	"crm": true, "ownership": true, "policy": true, "workspace": true,
}

// reasonGroup collapses facade reason codes into a bounded metric label.
func reasonGroup(codes []string) string {
	if len(codes) == 0 {
		return "none"
	}
	// The first code's prefix (e.g. "suppression", "verification") is the
	// group; never the full code list, and only from a fixed allowlist so a
	// facade-controlled string can never become an unbounded/PII label.
	code := codes[0]
	if i := strings.IndexAny(code, "._:"); i > 0 {
		code = code[:i]
	}
	if knownReasonGroups[code] {
		return code
	}
	return "other"
}

// --- approve / reject (invariants 1, 2, 4, 5) --------------------------------

// Approve approves the action's current revision. Send-mode actions require a
// passed (or explicitly risk-accepted review_required) unexpired decision for
// the exact revision and hash; draft-mode actions require only that the
// action is not blocked — a draft lands in the operator's own mailbox and
// nothing leaves the boundary.
func (s *Service) Approve(ctx context.Context, u *ent.User, id uuid.UUID, acceptRisk bool) (*ent.RevenueAction, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceExecute)
	if err != nil {
		return nil, err
	}
	if err := s.requireEntitled(ctx, u); err != nil {
		return nil, err
	}
	action, err := s.GetAction(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := s.ensureActionIdentityResolved(ctx, action); err != nil {
		return nil, err
	}
	if err := s.ensureRelationshipActionCompleteness(ctx, u, ws, actionRelationshipID(action)); err != nil {
		return nil, err
	}
	if action.PolicyStatus == PolicyBlocked {
		return nil, ErrBlocked // invariant 1
	}
	if action.QueueStatus != QueueOpen {
		return nil, fmt.Errorf("%w: queue status %q", ErrConflict, action.QueueStatus)
	}

	var decisionID *uuid.UUID
	if action.ExecutionMode == ExecModeSend {
		snap, err := s.currentDecision(ctx, action)
		if err != nil {
			return nil, err
		}
		switch snap.Status {
		case PolicyPassed:
		case PolicyReviewRequired:
			if !acceptRisk {
				return nil, ErrReviewRequired // invariant 4
			}
		default:
			return nil, ErrBlocked
		}
		decisionID = &snap.ID
	}

	now := s.now()
	upd := s.client.RevenueAction.Update().
		Where(
			revenueaction.IDEQ(action.ID),
			revenueaction.RevisionEQ(action.Revision),
			revenueaction.ApprovalStatusEQ(ApprovalPending),
			revenueaction.PolicyStatusNEQ(PolicyBlocked),
		).
		SetApprovalStatus(ApprovalApproved).
		SetApprovedRevision(action.Revision). // invariant 2: bind to revision
		SetApprovedBy(u.ID).
		SetApprovedAt(now)
	if decisionID != nil {
		upd.SetApprovedDecisionID(*decisionID) // invariant 2: bind to decision
	}
	n, err := upd.Save(ctx)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		// Reload: an identical approval is idempotent, anything else conflicts.
		cur, gerr := s.GetAction(ctx, id)
		if gerr != nil {
			return nil, gerr
		}
		if cur.ApprovalStatus == ApprovalApproved &&
			cur.ApprovedRevision != 0 && cur.ApprovedRevision == cur.Revision {
			revenuemetrics.DuplicatesPrevented.WithLabelValues("approve").Inc()
			return cur, nil
		}
		return nil, ErrConflict
	}
	revenuemetrics.Decisions.WithLabelValues("approved").Inc()

	payload := map[string]any{"revision": action.Revision}
	if decisionID != nil {
		payload["decisionId"] = decisionID.String()
	}
	_ = s.appendOutbox(ctx, s.client, ws, u, "revenue.action.approved.v1", action.ID,
		fmt.Sprintf("approved:%s:%d", action.ID, action.Revision), payload, now)
	_ = appendTrustEvent(ctx, s.client, ws, u, TrustEventInput{
		Name: "recommendation_decided", Outcome: "accepted", ReasonCode: "approved",
		CorrelationID: correlationID("action", action.ID), OccurredAt: now, Action: action,
	})
	return s.actionResultWithAttention(ctx, u, id)
}

// currentDecision loads the freshest decision snapshot for the action's exact
// current revision and hash, enforcing invariant 5 (expiry). Used by Approve
// to pick the decision to bind.
func (s *Service) currentDecision(ctx context.Context, action *ent.RevenueAction) (*ent.PolicyDecisionSnapshot, error) {
	snap, err := s.client.PolicyDecisionSnapshot.Query().
		Where(
			policydecisionsnapshot.HasActionWith(revenueaction.IDEQ(action.ID)),
			policydecisionsnapshot.ActionRevisionEQ(action.Revision),
			policydecisionsnapshot.RevisionHashEQ(action.RevisionHash),
		).
		Order(ent.Desc(policydecisionsnapshot.FieldEvaluatedAt)).
		First(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, ErrNoDecision
		}
		return nil, err
	}
	if !snap.ExpiresAt.After(s.now()) {
		return nil, ErrDecisionExpired // invariant 5
	}
	return snap, nil
}

// boundDecision loads the EXACT decision the approval was bound to
// (invariant 2), re-checks it against the current revision/hash, verifies it
// has not expired (invariants 5, 9), and that its status still permits a send.
// It deliberately does not fall back to the newest snapshot: a re-evaluation
// after approval must go back through Approve, never be silently consumed at
// execution time.
func (s *Service) boundDecision(ctx context.Context, action *ent.RevenueAction) (*ent.PolicyDecisionSnapshot, error) {
	if action.ApprovedDecisionID == nil {
		return nil, ErrNotApproved
	}
	snap, err := s.client.PolicyDecisionSnapshot.Query().
		Where(policydecisionsnapshot.IDEQ(*action.ApprovedDecisionID)).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, ErrNotApproved
		}
		return nil, err
	}
	// The bound decision must be for the revision we are about to send.
	if snap.ActionRevision != action.Revision || snap.RevisionHash != action.RevisionHash {
		return nil, ErrNotApproved
	}
	// review_required is acceptable only because Approve already required an
	// explicit risk acceptance to bind it; blocked can never be bound. Guard
	// anyway so a status is never trusted implicitly.
	if snap.Status != PolicyPassed && snap.Status != PolicyReviewRequired {
		return nil, ErrBlocked
	}
	if !snap.ExpiresAt.After(s.now()) {
		return nil, ErrDecisionExpired // invariant 5
	}
	return snap, nil
}

// Reject records a rejected approval for the current revision.
func (s *Service) Reject(ctx context.Context, u *ent.User, id uuid.UUID, reason string) (*ent.RevenueAction, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceExecute)
	if err != nil {
		return nil, err
	}
	action, err := s.GetAction(ctx, id)
	if err != nil {
		return nil, err
	}
	n, err := s.client.RevenueAction.Update().
		Where(
			revenueaction.IDEQ(action.ID),
			revenueaction.RevisionEQ(action.Revision),
			revenueaction.ApprovalStatusEQ(ApprovalPending),
		).
		SetApprovalStatus(ApprovalRejected).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrConflict
	}
	revenuemetrics.Decisions.WithLabelValues("rejected").Inc()
	_ = s.appendOutbox(ctx, s.client, ws, u, "revenue.action.rejected.v1", action.ID,
		fmt.Sprintf("rejected:%s:%d", action.ID, action.Revision),
		map[string]any{"revision": action.Revision, "reason": reason}, s.now())
	_ = appendTrustEvent(ctx, s.client, ws, u, TrustEventInput{
		Name: "recommendation_decided", Outcome: "rejected", ReasonCode: "rejected",
		CorrelationID: correlationID("action", action.ID), OccurredAt: s.now(), Action: action,
	})
	return s.actionResultWithAttention(ctx, u, id)
}

// --- triage ------------------------------------------------------------------

// maxSnooze bounds snooze timestamps (RFC: "snooze until a bounded timestamp").
const maxSnooze = 90 * 24 * time.Hour

// Snooze parks the action until a bounded future timestamp.
func (s *Service) Snooze(ctx context.Context, u *ent.User, id uuid.UUID, until time.Time) (*ent.RevenueAction, error) {
	if _, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceExecute); err != nil {
		return nil, err
	}
	now := s.now()
	if !until.After(now) || until.After(now.Add(maxSnooze)) {
		return nil, fmt.Errorf("%w: snooze must be in the future and within %s", ErrInvalidInput, maxSnooze)
	}
	n, err := s.client.RevenueAction.Update().
		Where(revenueaction.IDEQ(id), revenueaction.QueueStatusEQ(QueueOpen)).
		SetQueueStatus(QueueSnoozed).
		SetSnoozedUntil(until.UTC()).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrConflict
	}
	revenuemetrics.Decisions.WithLabelValues("snoozed").Inc()
	return s.actionResultWithAttention(ctx, u, id)
}

// Dismiss removes the action from the queue with a reason label and records
// the dismissed outcome.
func (s *Service) Dismiss(ctx context.Context, u *ent.User, id uuid.UUID, reason string) (*ent.RevenueAction, error) {
	if _, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceExecute); err != nil {
		return nil, err
	}
	action, err := s.GetAction(ctx, id)
	if err != nil {
		return nil, err
	}
	n, err := s.client.RevenueAction.Update().
		Where(revenueaction.IDEQ(id), revenueaction.QueueStatusIn(QueueOpen, QueueSnoozed)).
		SetQueueStatus(QueueDismissed).
		SetDismissReason(reason).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrConflict
	}
	revenuemetrics.Decisions.WithLabelValues("dismissed").Inc()
	_, _ = s.AppendOutcome(ctx, u, action.ID, OutcomeInput{
		Kind:          "dismissed",
		Source:        "user",
		SourceEventID: fmt.Sprintf("dismiss:%d", action.Revision),
		OccurredAt:    s.now(),
	})
	return s.actionResultWithAttention(ctx, u, id)
}

// --- execute (invariants 6, 7, 8, 11) ----------------------------------------

// Execute performs the approved action exactly once through the assigned
// execution owner. Draft mode works in any workspace mode; send mode requires
// a linked workspace and a still-unexpired decision.
func (s *Service) Execute(ctx context.Context, u *ent.User, id uuid.UUID) (*ent.RevenueAction, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceExecute)
	if err != nil {
		return nil, err
	}
	if err := s.requireEntitled(ctx, u); err != nil {
		return nil, err
	}
	action, err := s.GetAction(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := s.ensureActionIdentityResolved(ctx, action); err != nil {
		return nil, err
	}
	if capability := actionCapability(action.Channel); capability != "" {
		if err := s.requireWorkspaceFeature(ctx, ws, capability); err != nil {
			return nil, err
		}
	}
	if err := s.requireBetaActionReadiness(ctx, ws, action); err != nil {
		return nil, err
	}
	if err := s.ensureRelationshipActionCompleteness(ctx, u, ws, actionRelationshipID(action)); err != nil {
		return nil, err
	}
	if action.PolicyStatus == PolicyBlocked {
		return nil, ErrBlocked // invariant 1
	}
	if action.ApprovalStatus != ApprovalApproved ||
		action.ApprovedRevision == 0 || action.ApprovedRevision != action.Revision {
		return nil, ErrNotApproved // invariant 2
	}
	// Invariant 11: the sender must be the assigned user. Founder-mode
	// tenancy already scopes rows to the caller; the explicit check guards
	// the WP6 member-scoped upgrade.
	if action.AssignedUserID != nil && *action.AssignedUserID != u.ID {
		return nil, fmt.Errorf("%w: action is assigned to another member", ErrNotApproved)
	}
	if action.ExecutionMode == ExecModeSend {
		if ws.Mode != ModeLinked {
			return nil, ErrWorkspaceNotLinked
		}
		// Invariants 2, 4, 5, 9: the exact APPROVAL-BOUND decision — not
		// merely the newest snapshot — must still be valid and permissive at
		// execution time. A re-evaluation after approval invalidates the
		// approval (see Evaluate), so this cannot silently consume a decision
		// the operator never approved.
		if _, err := s.boundDecision(ctx, action); err != nil {
			return nil, err
		}
	}
	if strings.HasPrefix(action.DedupeKey, "mutual-action-plan:") {
		rel, err := action.Edges.RelationshipOrErr()
		if err != nil {
			return nil, err
		}
		policy, err := s.ResolveConversationPolicy(ctx, u, rel)
		if err != nil {
			return nil, err
		}
		decisionTime := s.now().UTC()
		decision := evaluateGovernanceDecision(
			policy, "external_share", "none",
			action.ID.String()+":"+action.RevisionHash+":"+decisionTime.Format(time.RFC3339Nano), decisionTime,
		)
		if _, err := appendConversationArtifact(ctx, s.client, ws, u, rel, conversationArtifactInput{
			Kind: "governance_decision", StableID: decision.DecisionID,
			Status:     map[bool]string{true: "allowed", false: "blocked"}[decision.Allowed],
			SubjectRef: action.ID.String(), EffectiveAt: decisionTime,
			EvidenceRefs: []string{"revenue-action-revision:" + action.RevisionHash}, Payload: decision,
		}); err != nil {
			return nil, err
		}
		if !decision.Allowed {
			return nil, fmt.Errorf("%w: %s", ErrBlocked, decision.Reason)
		}
	}

	// Idempotent short-circuit (invariant 7): duplicate execute returns the
	// existing result, never sends twice.
	if action.ExecutionStatus == ExecSent || action.ExecutionStatus == ExecRequested ||
		action.ExecutionStatus == ExecAmbiguous {
		revenuemetrics.DuplicatesPrevented.WithLabelValues("execute").Inc()
		return action, nil
	}

	// Invariant: an action removed from the active queue (dismissed/snoozed)
	// must not execute, even if it still carries a stale approval. A
	// successfully-sent action is queue_status=handled and is caught by the
	// idempotent short-circuit above, so here the queue must be open.
	if action.QueueStatus != QueueOpen {
		return nil, fmt.Errorf("%w: queue status %q", ErrConflict, action.QueueStatus)
	}

	idem := ExecutionIdempotencyKey(action.ID.String(), action.Revision)
	now := s.now()

	// Atomic consumption of the approval: exactly one caller flips
	// pending → requested for this revision (invariants 6 and 7).
	n, err := s.client.RevenueAction.Update().
		Where(
			revenueaction.IDEQ(action.ID),
			revenueaction.RevisionEQ(action.Revision),
			revenueaction.ExecutionStatusEQ(ExecPending),
			revenueaction.ApprovalStatusEQ(ApprovalApproved),
			revenueaction.QueueStatusEQ(QueueOpen),
		).
		SetExecutionStatus(ExecRequested).
		SetExecutionIdempotencyKey(idem).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		revenuemetrics.DuplicatesPrevented.WithLabelValues("execute").Inc()
		return s.GetAction(ctx, id)
	}
	_ = s.appendOutbox(ctx, s.client, ws, u, "revenue.action.execution_requested.v1", action.ID,
		"execution_requested:"+idem, map[string]any{"revision": action.Revision, "mode": action.ExecutionMode}, now)

	result, execErr := s.executor.Execute(ctx, ExecRequest{
		Action:         action,
		Workspace:      ws,
		UserID:         u.ID,
		Mode:           action.ExecutionMode,
		IdempotencyKey: idem,
	})

	switch {
	case execErr == nil:
		upd := s.client.RevenueAction.Update().
			Where(revenueaction.IDEQ(action.ID)).
			SetExecutionStatus(ExecSent).
			SetExecutedAt(s.now()).
			SetQueueStatus(QueueHandled).
			SetHandledAt(s.now())
		if result != nil && result.ProviderMessageID != "" {
			upd.SetProviderMessageID(result.ProviderMessageID)
		}
		if result != nil && result.ProviderThreadID != "" {
			upd.SetProviderThreadID(result.ProviderThreadID)
		}
		if _, err := upd.Save(ctx); err != nil {
			return nil, err
		}
		revenuemetrics.Executions.WithLabelValues(action.ExecutionOwner, ExecSent, action.Channel).Inc()
		_ = s.appendOutbox(ctx, s.client, ws, u, "revenue.action.sent.v1", action.ID,
			"sent:"+idem, map[string]any{"revision": action.Revision}, s.now())
		_ = appendTrustEvent(ctx, s.client, ws, u, TrustEventInput{
			Name: "action_executed", Outcome: "succeeded", ReasonCode: "provider_receipt",
			CorrelationID: idem, Channel: action.Channel, OccurredAt: s.now(), Action: action,
		})
	case errors.Is(execErr, ErrAmbiguous):
		// Invariant 8: a lost result after submission is ambiguous, never an
		// automatic resend. Reconciliation checks provider state first.
		if _, err := s.client.RevenueAction.Update().
			Where(revenueaction.IDEQ(action.ID)).
			SetExecutionStatus(ExecAmbiguous).
			SetExecutionError(execErr.Error()).
			SetReconciliationStatus("pending").
			SetReconciliationAttempts(0).
			SetReconciliationNextAt(s.now().UTC()).
			ClearReconciliationCheckedAt().
			ClearReconciliationError().
			Save(ctx); err != nil {
			return nil, err
		}
		revenuemetrics.Executions.WithLabelValues(action.ExecutionOwner, ExecAmbiguous, action.Channel).Inc()
		_ = appendTrustEvent(ctx, s.client, ws, u, TrustEventInput{
			Name: "action_executed", Outcome: "uncertain", ReasonCode: "provider_timeout",
			CorrelationID: idem, Channel: action.Channel, OccurredAt: s.now(), Action: action,
		})
	default:
		// A definite failure (nothing reached the provider — 4xx, missing
		// scope, dead token) returns the action to pending so the operator
		// can fix the cause and retry, or edit it. Only ErrAmbiguous (above)
		// is a terminal, non-retryable state, because there a message may
		// have been sent. The error string is retained for the UI.
		if _, err := s.client.RevenueAction.Update().
			Where(revenueaction.IDEQ(action.ID), revenueaction.ExecutionStatusEQ(ExecRequested)).
			SetExecutionStatus(ExecPending).
			SetExecutionError(execErr.Error()).
			Save(ctx); err != nil {
			return nil, err
		}
		revenuemetrics.Executions.WithLabelValues(action.ExecutionOwner, ExecFailed, action.Channel).Inc()
		_ = s.appendOutbox(ctx, s.client, ws, u, "revenue.action.failed.v1", action.ID,
			"failed:"+idem+":"+s.now().Format(time.RFC3339Nano), map[string]any{"revision": action.Revision}, s.now())
		_ = appendTrustEvent(ctx, s.client, ws, u, TrustEventInput{
			Name: "action_executed", Outcome: "failed", ReasonCode: "provider_rejected",
			CorrelationID: idem, Channel: action.Channel, OccurredAt: s.now(), Action: action,
		})
	}
	return s.actionResultWithAttention(ctx, u, id)
}

// --- outcomes (invariant 10) -------------------------------------------------

// OutcomeInput records one observed action outcome.
type OutcomeInput struct {
	Kind          string
	Source        string
	SourceEventID string
	OccurredAt    time.Time
	Metadata      map[string]any
}

// AppendOutcome appends an outcome idempotently on (action, source,
// source_event_id). The duplicate returns the stored row.
func (s *Service) AppendOutcome(ctx context.Context, u *ent.User, actionID uuid.UUID, in OutcomeInput) (*ent.ActionOutcome, error) {
	action, err := s.GetAction(ctx, actionID)
	if err != nil {
		return nil, err
	}
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return nil, err
	}
	if in.OccurredAt.IsZero() {
		in.OccurredAt = s.now()
	}
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	txc := tx.Client()
	create := txc.ActionOutcome.Create().
		SetWorkspace(ws).
		SetAction(action).
		SetUser(u).
		SetKind(in.Kind).
		SetSource(in.Source).
		SetSourceEventID(in.SourceEventID).
		SetOccurredAt(in.OccurredAt.UTC())
	if len(in.Metadata) > 0 {
		raw, merr := json.Marshal(in.Metadata)
		if merr != nil {
			return nil, merr
		}
		create.SetMetadataJSON(string(raw))
	}
	outcome, err := create.Save(ctx)
	if err != nil {
		_ = tx.Rollback()
		if ent.IsConstraintError(err) {
			revenuemetrics.DuplicatesPrevented.WithLabelValues("outcome").Inc()
			return s.client.ActionOutcome.Query().
				Where(
					actionOutcomeForAction(action.ID),
					actionOutcomeSourceEvent(in.Source, in.SourceEventID),
				).
				First(ctx)
		}
		if isValidationError(err) {
			return nil, fmt.Errorf("%w: %w", ErrInvalidInput, err)
		}
		return nil, err
	}
	rel, err := action.Edges.RelationshipOrErr()
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := appendOutcomeObservation(ctx, txc, ws, u, rel, action, in); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	revenuemetrics.Outcomes.WithLabelValues(in.Kind).Inc()
	_ = appendTrustEvent(ctx, s.client, ws, u, TrustEventInput{
		Name: "outcome_observed", Outcome: "succeeded",
		CorrelationID: correlationID("outcome", outcome.ID), Source: in.Source,
		OccurredAt: in.OccurredAt, Action: action,
	})
	_ = s.appendOutbox(ctx, s.client, ws, u, "revenue.action.outcome.v1", action.ID,
		fmt.Sprintf("outcome:%s:%s:%s", action.ID, in.Source, in.SourceEventID),
		map[string]any{"kind": in.Kind, "source": in.Source}, s.now())
	_ = s.RefreshRelationshipAttention(ctx, u)
	return outcome.Unwrap(), nil
}

func (s *Service) actionResultWithAttention(ctx context.Context, u *ent.User, id uuid.UUID) (*ent.RevenueAction, error) {
	_ = s.RefreshRelationshipAttention(ctx, u)
	return s.GetAction(ctx, id)
}

// appendOutcomeObservation publishes the categorical provider/user result into
// the same immutable relationship history used by email, meetings, Slack, and
// CRM evidence. Arbitrary outcome metadata stays out of this client-visible
// projection.
func appendOutcomeObservation(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	action *ent.RevenueAction,
	in OutcomeInput,
) error {
	source := strings.ToLower(strings.TrimSpace(in.Source))
	switch source {
	case "gmail", "calendar", "slack", "meeting", "crm", "hubspot", "user":
	case "outbound", "task":
		source = "user"
	default:
		source = "user"
	}
	facts := map[string]any{
		"outcome_kind": in.Kind, "provider_source": in.Source,
		"action_id": action.ID.String(), "recommendation_revision": action.Revision,
		"channel": action.Channel,
	}
	rawFacts, err := json.Marshal(facts)
	if err != nil {
		return err
	}
	externalID := fmt.Sprintf("action-outcome:%s:%s:%s", action.ID, in.Source, in.SourceEventID)
	digest := stdsha256.Sum256([]byte(externalID + "\x00" + in.Kind))
	_, err = client.RelationshipObservation.Create().
		SetWorkspace(ws).SetRelationship(rel).SetUser(u).
		SetSource(source).SetSourceAccountID("outcome").SetExternalID(externalID).
		SetSourceVersion(fmt.Sprintf("action-revision-%d", action.Revision)).
		SetEventType("action.outcome." + in.Kind).SetOccurredAt(in.OccurredAt.UTC()).SetReceivedAt(in.OccurredAt.UTC()).
		SetSummary("Action outcome observed: " + strings.ReplaceAll(in.Kind, "_", " ") + ".").
		SetNormalizedFactsJSON(string(rawFacts)).SetContentHash(fmt.Sprintf("%x", digest[:])).
		Save(ctx)
	return err
}

// isValidationError reports whether err is an ent field validation error
// (bad enum value, range, etc.) rather than an infrastructure failure.
func isValidationError(err error) bool {
	var ve *ent.ValidationError
	return errors.As(err, &ve)
}
