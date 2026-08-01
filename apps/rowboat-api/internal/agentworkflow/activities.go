package agentworkflow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentapproval"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsession"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agenttoolcall"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentturn"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agenttoken"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/faculties"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/hubspotapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slackclient"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/websearch"
	"github.com/google/uuid"
	"go.temporal.io/sdk/activity"
	"go.uber.org/zap"
)

// agentLLMMaxTokens bounds each loop completion (mirrors the RFC 004 runtime).
const agentLLMMaxTokens = 4096

// Activities is the IO / non-deterministic boundary for the durable agent
// runtime (RFC 027). Every method runs inside a Temporal activity; the workflow
// only ever sees their durable results.
type Activities struct {
	Client    *ent.Client
	LLM       *llm.Handler
	Catalog   *agentregistry.Catalog
	Loader    *agentregistry.Loader // resolves agent/subagent specs (P4); nil disables subagents
	Publisher EventPublisher        // nil → durable-only (no live fan-out)
	Log       *zap.Logger

	// ApprovalSigner verifies money-moving approval tokens (RFC 012). nil fails
	// closed: a recognizable token prefix is never proof of authorization.
	ApprovalSigner *agenttoken.Signer
	// RequireMFA gates money-moving grants on an MFA step-up claim in the token.
	RequireMFA bool

	// Sealer decrypts connector credentials (e.g. the Slack bot token) for
	// channel-reply delivery. nil disables outbound channel delivery.
	Sealer *crypto.Sealer
	// Slack posts agent replies back to the originating Slack thread (RFC 027
	// channels — the CloudTag round-trip) and backs the Slack-native tools. nil
	// disables Slack delivery and Slack tools.
	Slack *slackclient.Client
	// Creds resolves a session owner's connector credentials for tools that act
	// on the user's behalf (Slack, Gmail, …). nil disables credential-bearing
	// tools (they report the capability as unavailable rather than failing hard).
	Creds agentregistry.CredResolver
	// SlackTokens resolves Slack bot credentials and refreshes rotating Slack
	// access tokens for Slack channel delivery and Slack-native tools.
	SlackTokens agentregistry.SlackTokenResolver
	// Secrets + Google back the Google read tools (Gmail/Calendar), which reuse
	// the RFC 004 connector tools. nil makes those tools report "unavailable".
	Secrets *secrets.Store
	Google  *googleapi.Client
	HubSpot *hubspotapi.Client
	// Web backs the web.search tool. nil makes it report "unavailable".
	Web *websearch.Client
	// Conduit + Eigen back the portfolio faculty tools (RFC 008). nil makes the
	// corresponding tool report "unavailable".
	Conduit *faculties.Client
	Eigen   *faculties.Client
}

// LLMComplete advances the conversation one turn through the billing gateway
// (RFC 027 ActivityLLMComplete). It binds the billing identity (the session
// owner) and a deterministic per-(session,turn,call,attempt) idempotency anchor
// so a Temporal retry reserves fresh while a duplicate submission within one
// attempt replays the reservation — never double-bills.
func (a *Activities) LLMComplete(ctx context.Context, in LLMCompleteInput) (LLMCompleteResult, error) {
	if a.LLM == nil {
		return LLMCompleteResult{}, errors.New("agentworkflow: LLM handler not configured")
	}
	owner, err := a.loadUser(ctx, in.UserID)
	if err != nil {
		return LLMCompleteResult{}, err
	}
	billCtx := auth.WithUser(ctx, owner)

	tools := make([]llm.ToolDef, 0, len(in.ToolNames))
	for _, name := range in.ToolNames {
		capability, ok := a.Catalog.Get(name)
		if !ok {
			continue
		}
		tools = append(tools, llm.ToolDef{Name: capability.Name, Description: capability.Description, Parameters: capability.Parameters})
	}

	msgs := make([]llm.ChatMessage, 0, len(in.Messages))
	for _, m := range in.Messages {
		cm := llm.ChatMessage{Role: m.Role, Content: m.Content, ToolCallID: m.ToolCallID}
		for _, tc := range m.ToolCalls {
			cm.ToolCalls = append(cm.ToolCalls, llm.ToolCall{ID: tc.ID, Name: tc.Name, Arguments: tc.Arguments})
		}
		msgs = append(msgs, cm)
	}

	attempt := 1
	if activity.IsActivity(ctx) {
		attempt = int(activity.GetInfo(ctx).Attempt)
	}
	res, err := a.LLM.ChatComplete(billCtx, llm.ChatRequest{
		Model:      in.Model,
		Messages:   msgs,
		Tools:      tools,
		MaxTokens:  agentLLMMaxTokens,
		Op:         "agent_llm",
		UseCase:    "durable_agent",
		SubUseCase: "session",
		AgentName:  in.AgentSlug,
		RequestID:  sessionRequestID(in.SessionID, in.TurnSeq, in.CallIndex, attempt),
	})
	if err != nil {
		// A replay surfacing the idempotency-state errors here is terminal (the
		// transcript cannot resume); with attempt-seeded ids a normal retry never
		// hits it. All other gateway errors are retryable.
		return LLMCompleteResult{}, fmt.Errorf("agent llm call: %w", err)
	}

	out := LLMCompleteResult{
		Provider:     res.Provider,
		Model:        in.Model,
		InputTokens:  res.InputTokens,
		OutputTokens: res.OutputTokens,
		// CostUnits is a token-based governor proxy for the per-session ceiling;
		// the authoritative credit guard is quota.Gate inside ChatComplete.
		CostUnits: res.InputTokens + res.OutputTokens,
	}
	out.Message = backgroundtaskruntime.Message{Role: "assistant", Content: res.Message.Content}
	for _, tc := range res.Message.ToolCalls {
		out.Message.ToolCalls = append(out.Message.ToolCalls, backgroundtaskruntime.ToolCallRequest{ID: tc.ID, Name: tc.Name, Arguments: tc.Arguments})
	}
	return out, nil
}

// ToolInvoke looks up the tool in a per-session deny-by-default registry built
// from the allowlist and invokes it (RFC 027 ActivityToolInvoke). An unknown or
// non-allowlisted name (model hallucination, "shell", etc.) resolves to
// ErrToolNotAllowed → Denied; the loop appends a denial observation. Credentials
// are resolved INSIDE the tool from its scope, never from model text.
func (a *Activities) ToolInvoke(ctx context.Context, in ToolInvokeInput) (ToolInvokeResult, error) {
	ctx = auth.WithInternal(ctx)
	registry := a.buildToolRegistry(in.AllowedTools, in.UserID)
	tool, err := registry.Lookup(in.ToolName)
	if err != nil {
		return ToolInvokeResult{
			Denied:     true,
			ErrorCode:  backgroundtaskruntime.CodeToolNotAllowed,
			ResultJSON: fmt.Sprintf(`{"error":"tool %q is not available"}`, in.ToolName),
		}, nil
	}
	scope := backgroundtaskruntime.ToolScope{UserID: in.UserID, RunID: in.SessionID}
	result, ierr := tool.Invoke(ctx, scope, in.Args)
	if ierr != nil {
		code := backgroundtaskruntime.CodeToolInvokeFailed
		if re, ok := backgroundtaskruntime.AsRuntimeError(ierr); ok {
			code = re.Code
		}
		return ToolInvokeResult{
			Failed:     true,
			ErrorCode:  code,
			ResultJSON: fmt.Sprintf(`{"error":%q}`, backgroundtaskruntime.Truncate(ierr.Error(), 300)),
		}, nil
	}
	// Claim-check (RFC 027 Risks): an oversized result is spilled to the blob
	// store and only a reference + preview re-enters the transcript / Temporal
	// history, keeping the workflow well under the per-payload + per-history
	// limits. The model reads more via tool_result.read.
	if len(result) > backgroundtaskruntime.DefaultToolResultCap {
		if envelope, ok := a.claimCheck(ctx, in, result); ok {
			return ToolInvokeResult{ResultJSON: envelope, ResultBytes: len(result)}, nil
		}
		// Store failed: fall back to truncation so the turn still progresses.
	}
	truncated := backgroundtaskruntime.TruncateToolResult(result, backgroundtaskruntime.DefaultToolResultCap)
	return ToolInvokeResult{ResultJSON: truncated, ResultBytes: len(result)}, nil
}

// claimCheck stores an oversized tool result and returns the reference envelope
// the model sees in the transcript.
func (a *Activities) claimCheck(ctx context.Context, in ToolInvokeInput, result []byte) (string, bool) {
	owner, err := a.loadUser(ctx, in.UserID)
	if err != nil {
		return "", false
	}
	ref := agentregistry.BlobRef(in.SessionID, in.TurnSeq, in.CallIndex)
	err = a.Client.AgentToolResultBlob.Create().
		SetUser(owner).
		SetSessionID(in.SessionID).
		SetTurnSeq(in.TurnSeq).
		SetCallIndex(in.CallIndex).
		SetToolName(in.ToolName).
		SetContent(string(result)).
		SetTotalBytes(len(result)).
		Exec(ctx)
	if err != nil && !ent.IsConstraintError(err) {
		if a.Log != nil {
			a.Log.Warn("claim-check store failed", zap.String("ref", ref), zap.Error(err))
		}
		return "", false
	}
	preview := backgroundtaskruntime.Truncate(string(result), 2<<10)
	envelope, merr := json.Marshal(map[string]any{
		"truncated":  true,
		"blobRef":    ref,
		"totalBytes": len(result),
		"preview":    preview,
		"note":       "result stored by reference; call tool_result.read with this blobRef (and an offset) to read more",
	})
	if merr != nil {
		return "", false
	}
	return string(envelope), true
}

// buildToolRegistry constructs the deny-by-default registry over exactly the
// allowlisted, buildable tools (subagent pseudo-tools are excluded — those are
// dispatched to child workflows, never invoked here). Tools receive the client
// for the claim-check reader.
func (a *Activities) buildToolRegistry(allowed []string, userID string) backgroundtaskruntime.ToolRegistry {
	tools := make([]backgroundtaskruntime.Tool, 0, len(allowed))
	for _, name := range allowed {
		capability, ok := a.Catalog.Get(name)
		if !ok || capability.Kind == agentregistry.KindSubagent || capability.Build == nil {
			continue
		}
		tools = append(tools, capability.Build(agentregistry.ToolDeps{
			Client: a.Client, Creds: a.Creds, SlackTokens: a.SlackTokens, Slack: a.Slack,
			Sealer: a.Sealer, Secrets: a.Secrets, Google: a.Google, HubSpot: a.HubSpot, Web: a.Web,
			Conduit: a.Conduit, Eigen: a.Eigen, UserID: userID,
		}))
	}
	return backgroundtaskruntime.NewRegistry(tools)
}

// AppendSessionEvent writes one durable session event at the workflow-owned seq
// and tees it to the live bus (RFC 027 ActivityAppendSessionEvent). The unique
// (session, seq) index makes the at-least-once append idempotent: a retry that
// re-inserts the same seq is a no-op (constraint collision → success).
func (a *Activities) AppendSessionEvent(ctx context.Context, in AppendEventInput) error {
	ctx = auth.WithInternal(ctx)
	sess, owner, err := a.loadSessionAndUser(ctx, in.UserID, in.SessionID)
	if err != nil {
		return err
	}
	create := a.Client.AgentSessionEvent.Create().
		SetUser(owner).
		SetSession(sess).
		SetSeq(in.Seq).
		SetEventType(in.EventType).
		SetEventJSON(in.EventJSON)
	if in.TurnSeq != nil {
		create = create.SetTurnSeq(*in.TurnSeq)
	}
	err = create.Exec(ctx)
	if err != nil && !ent.IsConstraintError(err) {
		return err
	}
	// Tee to the live bus regardless (a retry republishing is harmless — SSE
	// clients dedupe by seq).
	if a.Publisher != nil {
		ev := StreamEvent{Seq: in.Seq, Type: in.EventType, TurnSeq: in.TurnSeq, Data: json.RawMessage(in.EventJSON)}
		if payload, merr := json.Marshal(ev); merr == nil {
			if perr := a.Publisher.PublishSessionEvent(ctx, in.SessionID, payload); perr != nil && a.Log != nil {
				a.Log.Warn("publish session event", zap.String("sessionId", in.SessionID), zap.Error(perr))
			}
		}
	}
	return nil
}

// PersistSession applies a patch to the AgentSession projection.
func (a *Activities) PersistSession(ctx context.Context, in SessionPatch) error {
	ctx = auth.WithInternal(ctx)
	sess, _, err := a.loadSessionAndUser(ctx, in.UserID, in.SessionID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	upd := a.Client.AgentSession.UpdateOneID(sess.ID).AddRevision(1)
	if in.Status != "" {
		upd = upd.SetStatus(in.Status)
	}
	if in.TemporalWorkflowID != "" {
		upd = upd.SetTemporalWorkflowID(in.TemporalWorkflowID)
	}
	if in.TemporalRunID != "" {
		upd = upd.SetTemporalRunID(in.TemporalRunID)
	}
	if in.MarkStarted && sess.StartedAt == nil {
		upd = upd.SetStartedAt(now)
	}
	if in.SetCounters {
		upd = upd.SetTurnCount(in.TurnCount).
			SetLlmCallCount(in.LLMCallCount).
			SetToolCallCount(in.ToolCallCount).
			SetCostUnits(in.CostUnits)
	}
	if in.TouchActivity {
		upd = upd.SetLastActivityAt(now)
	}
	if in.Terminal {
		upd = upd.SetCompletedAt(now)
	}
	if in.Error != "" {
		upd = upd.SetError(in.Error)
	}
	if in.ErrorCode != "" {
		upd = upd.SetErrorCode(in.ErrorCode)
	}
	return upd.Exec(ctx)
}

// PersistTurn upserts the AgentTurn projection by (session, seq).
func (a *Activities) PersistTurn(ctx context.Context, in TurnPatch) error {
	ctx = auth.WithInternal(ctx)
	sess, owner, err := a.loadSessionAndUser(ctx, in.UserID, in.SessionID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	existing, err := a.Client.AgentTurn.Query().
		Where(agentturn.SeqEQ(in.Seq), agentturn.HasSessionWith(agentsession.IDEQ(sess.ID))).
		Only(ctx)
	if ent.IsNotFound(err) {
		c := a.Client.AgentTurn.Create().SetUser(owner).SetSession(sess).SetSeq(in.Seq)
		if in.Input != "" {
			c = c.SetInput(in.Input)
		}
		if in.Status != "" {
			c = c.SetStatus(in.Status)
		}
		if in.Summary != "" {
			c = c.SetSummary(in.Summary)
		}
		if in.FinishReason != "" {
			c = c.SetFinishReason(in.FinishReason)
		}
		if in.Start {
			c = c.SetStartedAt(now)
		}
		if in.Finish {
			c = c.SetCompletedAt(now)
		}
		c = c.SetLlmCallCount(in.LLMCalls).SetToolCallCount(in.ToolCalls).SetCostUnits(in.CostUnits)
		err = c.Exec(ctx)
		if err != nil && ent.IsConstraintError(err) {
			return nil // concurrent create at same seq → idempotent
		}
		return err
	}
	if err != nil {
		return err
	}
	upd := a.Client.AgentTurn.UpdateOneID(existing.ID)
	if in.Status != "" {
		upd = upd.SetStatus(in.Status)
	}
	if in.Summary != "" {
		upd = upd.SetSummary(in.Summary)
	}
	if in.FinishReason != "" {
		upd = upd.SetFinishReason(in.FinishReason)
	}
	if in.LLMCalls > 0 {
		upd = upd.SetLlmCallCount(in.LLMCalls)
	}
	if in.ToolCalls > 0 {
		upd = upd.SetToolCallCount(in.ToolCalls)
	}
	if in.CostUnits > 0 {
		upd = upd.SetCostUnits(in.CostUnits)
	}
	if in.Finish {
		upd = upd.SetCompletedAt(now)
	}
	return upd.Exec(ctx)
}

// PersistToolCall records one AgentToolCall audit row (redacted args).
func (a *Activities) PersistToolCall(ctx context.Context, in ToolCallAuditInput) error {
	ctx = auth.WithInternal(ctx)
	sess, owner, err := a.loadSessionAndUser(ctx, in.UserID, in.SessionID)
	if err != nil {
		return err
	}
	turn, err := a.Client.AgentTurn.Query().
		Where(agentturn.SeqEQ(in.TurnSeq), agentturn.HasSessionWith(agentsession.IDEQ(sess.ID))).
		Only(ctx)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	existing, err := a.Client.AgentToolCall.Query().
		Where(agenttoolcall.CallIndexEQ(in.CallIndex), agenttoolcall.HasTurnWith(agentturn.IDEQ(turn.ID))).
		Only(ctx)
	if ent.IsNotFound(err) {
		c := a.Client.AgentToolCall.Create().
			SetUser(owner).
			SetTurn(turn).
			SetCallIndex(in.CallIndex).
			SetToolName(in.ToolName).
			SetStatus(in.Status).
			SetResultBytes(in.ResultBytes).
			SetStartedAt(now)
		if in.ArgsJSON != "" {
			c = c.SetArgsJSON(in.ArgsJSON)
		}
		if in.TrustTier != "" {
			c = c.SetTrustTier(in.TrustTier)
		}
		if in.ErrorCode != "" {
			c = c.SetErrorCode(in.ErrorCode)
		}
		if isTerminalToolStatus(in.Status) {
			c = c.SetCompletedAt(now)
		}
		err = c.Exec(ctx)
		if err != nil && ent.IsConstraintError(err) {
			return nil
		}
		return err
	}
	if err != nil {
		return err
	}
	upd := a.Client.AgentToolCall.UpdateOneID(existing.ID).SetStatus(in.Status).SetResultBytes(in.ResultBytes)
	if in.ErrorCode != "" {
		upd = upd.SetErrorCode(in.ErrorCode)
	}
	if isTerminalToolStatus(in.Status) {
		upd = upd.SetCompletedAt(now)
	}
	return upd.Exec(ctx)
}

func isTerminalToolStatus(s string) bool {
	switch s {
	case "completed", "failed", "denied":
		return true
	default:
		return false
	}
}

// PersistApproval creates a pending AgentApproval row (HITL).
func (a *Activities) PersistApproval(ctx context.Context, in ApprovalInput) error {
	ctx = auth.WithInternal(ctx)
	sess, owner, err := a.loadSessionAndUser(ctx, in.UserID, in.SessionID)
	if err != nil {
		return err
	}
	c := a.Client.AgentApproval.Create().
		SetUser(owner).
		SetSession(sess).
		SetApprovalID(in.ApprovalID).
		SetTurnSeq(in.TurnSeq).
		SetToolCallIndex(in.ToolCallIndex).
		SetToolName(in.ToolName).
		SetStatus("pending")
	if in.TrustTier != "" {
		c = c.SetTrustTier(in.TrustTier)
	}
	if in.ArgsRedacted != "" {
		c = c.SetArgsRedactedJSON(in.ArgsRedacted)
	}
	err = c.Exec(ctx)
	if err != nil && ent.IsConstraintError(err) {
		return nil // idempotent re-emit
	}
	return err
}

// ResolveApproval records the terminal approval state.
func (a *Activities) ResolveApproval(ctx context.Context, in ApprovalResolveInput) error {
	ctx = auth.WithInternal(ctx)
	sess, _, err := a.loadSessionAndUser(ctx, in.UserID, in.SessionID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	upd := a.Client.AgentApproval.Update().
		Where(
			agentapproval.ApprovalIDEQ(in.ApprovalID),
			agentapproval.HasSessionWith(agentsession.IDEQ(sess.ID)),
			agentapproval.StatusEQ("pending"),
		).
		SetStatus(in.Status).
		SetResolvedAt(now)
	if in.ApprovalToken != "" {
		upd = upd.SetApprovalTokenRef(in.ApprovalToken)
	}
	if in.ResolvedBy != "" {
		upd = upd.SetResolvedBy(in.ResolvedBy)
	}
	_, err = upd.Save(ctx)
	return err
}

// ValidateApproval performs the RFC 012 token / MFA step-up check. act-tier
// grants need no token (the human grant suffices); money-moving grants require a
// per-invocation HMAC-signed approval token (agenttoken) bound to THIS approval,
// user, and session, carrying an MFA step-up assertion. A forged, expired,
// cross-bound, or non-MFA token is rejected.
func (a *Activities) ValidateApproval(_ context.Context, in ValidateApprovalInput) error {
	if in.TrustTier != agentregistry.TierMoneyMoving {
		return nil
	}
	token := strings.TrimSpace(in.ApprovalToken)
	if token == "" {
		return errors.New("money-moving approval requires an X-Approval-Token")
	}
	if a.ApprovalSigner == nil {
		return errors.New("approval token verification is unavailable")
	}
	claims, err := a.ApprovalSigner.VerifyApproval(token, time.Now())
	if err != nil {
		return fmt.Errorf("invalid approval token: %w", err)
	}
	if claims.ApprovalID != in.ApprovalID || claims.UserID != in.UserID || claims.SessionID != in.SessionID {
		return errors.New("approval token is not bound to this approval")
	}
	if claims.TrustTier != agentregistry.TierMoneyMoving {
		return errors.New("approval token tier mismatch")
	}
	if a.RequireMFA && !claims.MFA {
		return errors.New("money-moving approval requires an MFA step-up")
	}
	return nil
}

// EnsureSession upserts the AgentSession projection row (idempotent by session
// id) and binds the Temporal ids. The root row is normally pre-created by the
// HTTP starter; subagent child workflows have no starter, so they create theirs
// here.
func (a *Activities) EnsureSession(ctx context.Context, in EnsureSessionInput) error {
	ctx = auth.WithInternal(ctx)
	owner, err := a.loadUser(ctx, in.Start.UserID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	existing, err := a.Client.AgentSession.Query().
		Where(agentsession.SessionIDEQ(in.Start.SessionID), agentsession.HasUserWith(user.IDEQ(owner.ID))).
		Only(ctx)
	if ent.IsNotFound(err) {
		c := a.Client.AgentSession.Create().
			SetUser(owner).
			SetSessionID(in.Start.SessionID).
			SetAgentSlug(in.Start.AgentSlug).
			SetAgentSource(in.Start.AgentSource).
			SetAgentRevision(in.Start.AgentRevision).
			SetChannel(in.Start.Channel).
			SetStatus("active").
			SetStartedAt(now)
		if in.TemporalWorkflowID != "" {
			c = c.SetTemporalWorkflowID(in.TemporalWorkflowID)
		}
		if in.TemporalRunID != "" {
			c = c.SetTemporalRunID(in.TemporalRunID)
		}
		err = c.Exec(ctx)
		if err != nil && ent.IsConstraintError(err) {
			return nil
		}
		return err
	}
	if err != nil {
		return err
	}
	upd := a.Client.AgentSession.UpdateOneID(existing.ID).AddRevision(1)
	if existing.StartedAt == nil {
		upd = upd.SetStartedAt(now)
	}
	if in.TemporalWorkflowID != "" {
		upd = upd.SetTemporalWorkflowID(in.TemporalWorkflowID)
	}
	if in.TemporalRunID != "" {
		upd = upd.SetTemporalRunID(in.TemporalRunID)
	}
	return upd.Exec(ctx)
}

// ResolveSubagent resolves a child agent within the parent's tenant scope and
// narrows it (RFC 018): the child must be listed in the parent's subagent_refs,
// and its tool allowlist is intersected with the parent's so a subagent can
// never exceed the delegating agent's capabilities.
func (a *Activities) ResolveSubagent(ctx context.Context, in ResolveSubagentInput) (SubagentSpec, error) {
	if a.Loader == nil {
		return SubagentSpec{}, errors.New("subagents not configured")
	}
	owner, err := a.loadUser(ctx, in.UserID)
	if err != nil {
		return SubagentSpec{}, err
	}
	scoped := auth.WithUser(ctx, owner)

	parent, err := a.Loader.Resolve(scoped, in.ParentSlug)
	if err != nil {
		return SubagentSpec{}, fmt.Errorf("resolve parent agent: %w", err)
	}
	if !contains(parent.SubagentRefs, in.ChildSlug) {
		return SubagentSpec{}, fmt.Errorf("agent %q may not delegate to %q", in.ParentSlug, in.ChildSlug)
	}
	child, err := a.Loader.Resolve(scoped, in.ChildSlug)
	if err != nil {
		return SubagentSpec{}, fmt.Errorf("resolve subagent: %w", err)
	}
	// Narrow: child tools ∩ parent tools.
	narrowed := intersect(child.EnabledTools, parent.EnabledTools)
	if verr := a.Catalog.Validate(narrowed); verr != nil {
		return SubagentSpec{}, verr
	}
	return SubagentSpec{
		Slug:         child.Slug,
		AgentSource:  child.Source,
		Instructions: child.Instructions,
		Model:        child.Model,
		Provider:     child.Provider,
		Tools:        toolMetas(a.Catalog, narrowed),
		SubagentRefs: child.SubagentRefs,
	}, nil
}

// --- helpers -----------------------------------------------------------------

func (a *Activities) loadUser(ctx context.Context, userID string) (*ent.User, error) {
	uid, err := uuid.Parse(userID)
	if err != nil {
		return nil, fmt.Errorf("invalid user id: %w", err)
	}
	return a.Client.User.Query().Where(user.IDEQ(uid)).Only(auth.WithInternal(ctx))
}

func (a *Activities) loadSessionAndUser(ctx context.Context, userID, sessionID string) (*ent.AgentSession, *ent.User, error) {
	uid, err := uuid.Parse(userID)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid user id: %w", err)
	}
	owner, err := a.Client.User.Query().Where(user.IDEQ(uid)).Only(ctx)
	if err != nil {
		return nil, nil, err
	}
	sess, err := a.Client.AgentSession.Query().
		Where(agentsession.SessionIDEQ(sessionID), agentsession.HasUserWith(user.IDEQ(uid))).
		Only(ctx)
	if err != nil {
		return nil, nil, err
	}
	return sess, owner, nil
}

// ToolMetasFromCatalog builds the deterministic ToolMeta list for an allowlist.
// Subagent pseudo-tools are dropped when subagents are disabled (so they are
// neither advertised nor invocable). Used by the session starter to populate
// SessionStart.Tools.
func ToolMetasFromCatalog(catalog *agentregistry.Catalog, names []string, subagentsEnabled bool) []ToolMeta {
	out := make([]ToolMeta, 0, len(names))
	for _, n := range names {
		capability, ok := catalog.Get(n)
		if !ok {
			continue
		}
		if capability.Kind == agentregistry.KindSubagent && !subagentsEnabled {
			continue
		}
		out = append(out, ToolMeta{Name: capability.Name, TrustTier: capability.TrustTier, Kind: capability.Kind})
	}
	return out
}

// toolMetas is the all-kinds variant used for subagent narrowing (the child
// workflow filters by its own subagentsEnabled when building SessionStart).
func toolMetas(catalog *agentregistry.Catalog, names []string) []ToolMeta {
	return ToolMetasFromCatalog(catalog, names, true)
}

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}

func intersect(a, b []string) []string {
	out := make([]string, 0, len(a))
	for _, s := range a {
		if contains(b, s) {
			out = append(out, s)
		}
	}
	return out
}

// sessionRequestID derives the deterministic per-(session, turn, call, attempt)
// billing idempotency anchor — the GatewayLLM.runtimeRequestID pattern, anchored
// to agent-session/{sessionID}/turn/{turnSeq}/llm/{callIndex} plus the activity
// attempt so Temporal retries reserve fresh while a within-attempt duplicate
// replays the reservation.
func sessionRequestID(sessionID string, turnSeq, callIndex, attempt int) uuid.UUID {
	if attempt < 1 {
		attempt = 1
	}
	anchor := "agent-session/" + sessionID +
		"/turn/" + strconv.Itoa(turnSeq) +
		"/llm/" + strconv.Itoa(callIndex) +
		"/attempt/" + strconv.Itoa(attempt)
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte(anchor))
}
