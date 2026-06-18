// Package agentsessions owns the single canonical way a durable agent session
// is created and driven (RFC 027) — the analogue of internal/backgroundtaskruns.
// The HTTP API, channel adapters (P5), and Temporal Schedules (P5) all create
// and append sessions through this one path, so the AgentSession projection, the
// continuation token, the temporal_workflow_id index, and every agent_* metric
// series share one set of assumptions.
//
// It deliberately does NOT import internal/agents (the HTTP handler package):
// the Starter takes the resolved user + agent slug and has no request/response
// concerns, so background callers can reuse it without HTTP coupling.
package agentsessions

import (
	"context"
	"errors"
	"fmt"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsession"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// ErrTemporalNotConfigured is returned when no Temporal controller is wired. The
// HTTP handler maps it to 503.
var ErrTemporalNotConfigured = errors.New("temporal is not configured")

// InvalidParamsError indicates the session could not be created from the input
// (unknown agent, bad tool allowlist). The HTTP handler maps it to 400.
type InvalidParamsError struct{ Message string }

func (e *InvalidParamsError) Error() string { return e.Message }

// Starter resolves agents and creates/drives durable agent sessions.
type Starter struct {
	Client   *ent.Client
	Loader   *agentregistry.Loader
	Temporal agentworkflow.Controller
	Cfg      appconfig.Config
	Log      *zap.Logger
}

// New builds a Starter. Temporal may be nil; CreateSession then returns
// ErrTemporalNotConfigured.
func New(client *ent.Client, loader *agentregistry.Loader, temporal agentworkflow.Controller, cfg appconfig.Config, log *zap.Logger) *Starter {
	if log == nil {
		log = zap.NewNop()
	}
	return &Starter{Client: client, Loader: loader, Temporal: temporal, Cfg: cfg, Log: log}
}

// CreateParams is the input to CreateSession.
type CreateParams struct {
	User       *ent.User
	AgentSlug  string
	Channel    string // defaults to "http"
	ChannelKey string // threads an external conversation to one session (P5)
	Title      string
	FirstInput string // optional: seeds the first turn so create→run is one call
}

// Session is the created session plus its Temporal binding.
type Session struct {
	Row        *ent.AgentSession
	WorkflowID string
	RunID      string
}

// CreateSession resolves the agent, validates its tool allowlist against the
// capability registry (deny-by-default), creates the AgentSession projection
// with a precomputed workflow id, and starts the session workflow — seeding the
// first turn when one is provided.
func (s *Starter) CreateSession(ctx context.Context, p CreateParams) (*Session, error) {
	if s.Temporal == nil {
		return nil, ErrTemporalNotConfigured
	}
	if p.User == nil {
		return nil, &InvalidParamsError{Message: "user is required"}
	}
	spec, err := s.Loader.Resolve(ctx, p.AgentSlug)
	if err != nil {
		if errors.Is(err, agentregistry.ErrAgentNotFound) {
			return nil, &InvalidParamsError{Message: fmt.Sprintf("unknown agent %q", p.AgentSlug)}
		}
		return nil, err
	}
	if verr := s.Loader.Catalog().Validate(spec.EnabledTools); verr != nil {
		return nil, &InvalidParamsError{Message: verr.Error()}
	}

	channel := p.Channel
	if channel == "" {
		channel = "http"
	}
	sessionID := uuid.NewString()
	workflowID := agentworkflow.WorkflowID(p.User.ID.String(), sessionID)

	start := s.buildStart(p.User, spec, sessionID, channel)
	state := agentworkflow.SessionState{Start: start}
	if p.FirstInput != "" {
		state.EnqueuedTurns = 1
		state.Pending = []agentworkflow.TurnInput{{Seq: 0, Input: p.FirstInput}}
	}

	row, err := s.createRow(ctx, p, sessionID, workflowID, spec, channel)
	if err != nil {
		return nil, err
	}

	res, err := s.Temporal.StartSession(ctx, state)
	if err != nil {
		s.markStartFailed(ctx, row, err)
		return &Session{Row: row, WorkflowID: workflowID}, fmt.Errorf("start agent session workflow: %w", err)
	}

	updated, perr := s.Client.AgentSession.UpdateOneID(row.ID).
		SetTemporalWorkflowID(res.WorkflowID).
		SetTemporalRunID(res.RunID).
		AddRevision(1).
		Save(auth.WithInternal(ctx))
	if perr != nil {
		s.Log.Warn("persist agent session temporal ids", zap.String("sessionId", sessionID), zap.Error(perr))
		updated = row
	}
	s.Log.Info("agent session started",
		zap.String("sessionId", sessionID), zap.String("agent", spec.Slug),
		zap.String("workflowId", res.WorkflowID), zap.String("userId", p.User.ID.String()))
	return &Session{Row: updated, WorkflowID: res.WorkflowID, RunID: res.RunID}, nil
}

// SubmitTurn delivers a turn to a running session via the submitTurn Update.
func (s *Starter) SubmitTurn(ctx context.Context, userID, sessionID, input string) (agentworkflow.TurnAck, error) {
	if s.Temporal == nil {
		return agentworkflow.TurnAck{}, ErrTemporalNotConfigured
	}
	return s.Temporal.SubmitTurn(ctx, agentworkflow.WorkflowID(userID, sessionID), agentworkflow.TurnInput{Input: input})
}

// Approve resolves a pending HITL approval via the approveAction Update.
func (s *Starter) Approve(ctx context.Context, userID, sessionID string, in agentworkflow.ApproveAction) (agentworkflow.TurnAck, error) {
	if s.Temporal == nil {
		return agentworkflow.TurnAck{}, ErrTemporalNotConfigured
	}
	return s.Temporal.ApproveAction(ctx, agentworkflow.WorkflowID(userID, sessionID), in)
}

// Cancel requests a graceful session cancel.
func (s *Starter) Cancel(ctx context.Context, userID, sessionID string) error {
	if s.Temporal == nil {
		return ErrTemporalNotConfigured
	}
	return s.Temporal.CancelSession(ctx, agentworkflow.WorkflowID(userID, sessionID))
}

// StartScheduledSession is the Temporal-Schedule fire entry point (RFC 027 P5):
// the scheduler context carries no user, so it loads the owner by id and creates
// a fresh session through the canonical path. Implements
// agentworkflow.ScheduledSessionStarter.
func (s *Starter) StartScheduledSession(ctx context.Context, in agentworkflow.ScheduledSessionInput) (string, error) {
	uid, err := uuid.Parse(in.UserID)
	if err != nil {
		return "", &InvalidParamsError{Message: "invalid user id"}
	}
	owner, err := s.Client.User.Get(auth.WithInternal(ctx), uid)
	if err != nil {
		return "", err
	}
	channel := in.Channel
	if channel == "" {
		channel = "schedule"
	}
	sess, err := s.CreateSession(auth.WithUser(ctx, owner), CreateParams{
		User: owner, AgentSlug: in.AgentSlug, Channel: channel, FirstInput: in.Input,
	})
	if err != nil {
		return "", err
	}
	return sess.Row.SessionID, nil
}

// buildStart assembles the immutable SessionStart from the resolved spec +
// runtime config (model fallback, effective limits, feature flags, ToolMetas).
func (s *Starter) buildStart(u *ent.User, spec *agentregistry.Spec, sessionID, channel string) agentworkflow.SessionStart {
	model := spec.Model
	if model == "" {
		model = s.Cfg.AgentRuntimeModel
	}
	return agentworkflow.SessionStart{
		UserID:           u.ID.String(),
		SessionID:        sessionID,
		AgentSlug:        spec.Slug,
		AgentSource:      spec.Source,
		AgentRevision:    spec.Revision,
		Channel:          channel,
		Instructions:     spec.Instructions,
		Model:            model,
		Provider:         spec.Provider,
		Tools:            applyApprovalOverrides(agentworkflow.ToolMetasFromCatalog(s.Loader.Catalog(), spec.EnabledTools, s.Cfg.AgentSubagentsEnabled), spec.ToolApprovalOverrides()),
		SubagentRefs:     spec.SubagentRefs,
		Limits:           s.effectiveLimits(spec.Limits),
		HITLEnabled:      s.Cfg.AgentHITLEnabled,
		SubagentsEnabled: s.Cfg.AgentSubagentsEnabled,
		StreamingEnabled: s.Cfg.AgentStreamingEnabled,
	}
}

// effectiveLimits starts from the runtime config and lets a per-agent override
// only TIGHTEN a cap (a set field caps below the default; it can never loosen).
func (s *Starter) effectiveLimits(o agentregistry.SpecLimits) agentworkflow.Limits {
	c := s.Cfg
	return agentworkflow.Limits{
		MaxLLMCallsPerTurn:      capInt(c.AgentMaxLLMCallsPerTurn, o.MaxLLMCallsPerTurn),
		MaxToolCallsPerTurn:     capInt(c.AgentMaxToolCallsPerTurn, o.MaxToolCallsPerTurn),
		MaxWallclockPerTurn:     c.AgentMaxWallclockPerTurn,
		MaxTurnsPerSession:      capInt(c.AgentMaxTurnsPerSession, o.MaxTurnsPerSession),
		MaxLLMCallsPerSession:   capInt(c.AgentMaxLLMCallsPerSession, o.MaxLLMCallsPerSession),
		MaxCostUnitsPerSession:  capInt(c.AgentMaxCostUnitsPerSession, o.MaxCostUnitsPerSession),
		IdleTimeout:             c.AgentSessionIdleTimeout,
		ContinueAsNewEveryTurns: c.AgentContinueAsNewEveryTurns,
		MaxSubagentDepth:        c.AgentMaxSubagentDepth,
		MaxSubagentFanout:       c.AgentMaxSubagentFanout,
	}
}

// applyApprovalOverrides bumps a tool's effective trust tier to act when the
// agent's YAML marked it requiresApproval (RFC 028 per-tool HITL override), so
// the runtime pauses for approval on a tool that would otherwise auto-execute.
func applyApprovalOverrides(metas []agentworkflow.ToolMeta, overrides map[string]bool) []agentworkflow.ToolMeta {
	if len(overrides) == 0 {
		return metas
	}
	for i := range metas {
		if overrides[metas[i].Name] && !agentregistry.RequiresApproval(metas[i].TrustTier) {
			metas[i].TrustTier = agentregistry.TierAct
		}
	}
	return metas
}

// capInt returns the override when it is set and tighter than the base.
func capInt(base, override int) int {
	if override > 0 && override < base {
		return override
	}
	return base
}

func (s *Starter) createRow(ctx context.Context, p CreateParams, sessionID, workflowID string, spec *agentregistry.Spec, channel string) (*ent.AgentSession, error) {
	c := s.Client.AgentSession.Create().
		SetUser(p.User).
		SetSessionID(sessionID).
		SetAgentSlug(spec.Slug).
		SetAgentSource(spec.Source).
		SetAgentRevision(spec.Revision).
		SetChannel(channel).
		SetStatus("active").
		SetTemporalWorkflowID(workflowID)
	if p.Title != "" {
		c = c.SetTitle(p.Title)
	}
	if p.ChannelKey != "" {
		c = c.SetChannelKey(p.ChannelKey)
	}
	return c.Save(ctx)
}

// ContinueParams is the input to CreateOrContinue (channel dispatch).
type ContinueParams struct {
	User       *ent.User
	AgentSlug  string
	Channel    string
	ChannelKey string
	Input      string
	Title      string
}

// CreateOrContinue threads a channel conversation to a single session: it finds
// the live session for (user, channel, channelKey) and submits the input as a
// new turn, or — if none exists or the prior one has closed — creates a fresh
// session seeded with the input. Returns the session and whether it was newly
// created. This is the entry point channel adapters and (indirectly) schedules
// share, all funneling through the one canonical creation path.
func (s *Starter) CreateOrContinue(ctx context.Context, p ContinueParams) (*Session, bool, error) {
	if s.Temporal == nil {
		return nil, false, ErrTemporalNotConfigured
	}
	if p.User == nil {
		return nil, false, &InvalidParamsError{Message: "user is required"}
	}
	if p.ChannelKey != "" {
		existing, err := s.Client.AgentSession.Query().
			Where(
				agentsession.ChannelEQ(p.Channel),
				agentsession.ChannelKeyEQ(p.ChannelKey),
				agentsession.StatusIn("active", "paused"),
				agentsession.HasUserWith(user.IDEQ(p.User.ID)),
			).
			Order(ent.Desc(agentsession.FieldCreatedAt)).
			First(ctx)
		switch {
		case err == nil:
			if _, terr := s.SubmitTurn(ctx, p.User.ID.String(), existing.SessionID, p.Input); terr == nil {
				return &Session{Row: existing, WorkflowID: existing.TemporalWorkflowID}, false, nil
			}
			// The prior session's workflow has closed underneath the thread;
			// fall through to start a fresh session for the same channel key.
		case ent.IsNotFound(err):
			// fall through to create
		default:
			return nil, false, err
		}
	}
	sess, err := s.CreateSession(ctx, CreateParams{
		User: p.User, AgentSlug: p.AgentSlug, Channel: p.Channel, ChannelKey: p.ChannelKey,
		Title: p.Title, FirstInput: p.Input,
	})
	if err != nil {
		return sess, false, err
	}
	return sess, true, nil
}

func (s *Starter) markStartFailed(ctx context.Context, row *ent.AgentSession, startErr error) {
	_, err := s.Client.AgentSession.UpdateOneID(row.ID).
		SetStatus("failed").
		SetError(startErr.Error()).
		SetErrorCode("temporal_start_failed").
		AddRevision(1).
		Save(auth.WithInternal(ctx))
	if err != nil {
		s.Log.Error("mark agent session start-failed", zap.String("sessionId", row.SessionID), zap.Error(err))
	}
}
