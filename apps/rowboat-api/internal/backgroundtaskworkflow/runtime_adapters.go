package backgroundtaskworkflow

// Adapters binding the cloud agent runtime (RFC 004) to this package's
// durable primitives: the artifact upsert, the run-event stream, run-row
// progress + Temporal heartbeats, and the per-run scoped tool registry. The
// activity stays thin; the runtime owns the loop.

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
	"github.com/google/uuid"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

var cloudTaskToolCatalog = agentregistry.DefaultCatalog()

// artifactStore wraps upsertArtifact as the runtime's ArtifactStore. The
// runtime calls Write at most once per successful run.
type artifactStore struct {
	a     *Activities
	task  *ent.BackgroundTask
	runID string
}

func (s *artifactStore) Read(ctx context.Context) (body, contentType string, revision int, err error) {
	artifact, err := s.a.Client.BackgroundTaskArtifact.Query().
		Where(backgroundtaskartifact.HasTaskWith(backgroundtask.IDEQ(s.task.ID))).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return "", "text/markdown", 0, nil
		}
		return "", "", 0, err
	}
	return artifact.Body, artifact.ContentType, artifact.Revision, nil
}

func (s *artifactStore) Write(ctx context.Context, body, contentType string) (int, error) {
	if contentType == "" {
		contentType = "text/markdown"
	}
	if err := s.a.upsertArtifact(ctx, s.task, s.runID, body, contentType); err != nil {
		backgroundtaskmetrics.ArtifactSyncFailures.Inc()
		return 0, taggedError(ErrCodeArtifactWriteFailed, "write artifact", err)
	}
	artifact, err := s.a.Client.BackgroundTaskArtifact.Query().
		Where(backgroundtaskartifact.HasTaskWith(backgroundtask.IDEQ(s.task.ID))).
		Only(ctx)
	if err != nil {
		return 0, nil //nolint:nilerr // Write succeeded; revision read-back is best-effort.
	}
	return artifact.Revision, nil
}

// eventSink wraps run-row progress + appendEvent + Temporal heartbeats.
type eventSink struct {
	a      *Activities
	in     StartInput
	taskID uuid.UUID
}

func (s *eventSink) Progress(ctx context.Context, percent int, message string) error {
	return s.ProgressEvent(ctx, EventProgress, percent, message, nil)
}

func (s *eventSink) ProgressEvent(ctx context.Context, eventType string, percent int, message string, extra map[string]any) error {
	// Heartbeat first: Temporal liveness must not depend on the DB round trip.
	// Guarded so unit tests (no activity environment) can drive the sink.
	if activity.IsActivity(ctx) {
		activity.RecordHeartbeat(ctx, map[string]any{"percent": percent, "message": message})
	}
	if _, err := s.a.Client.BackgroundTaskRun.Update().
		Where(backgroundtaskrun.RunIDEQ(s.in.RunID), backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(s.taskID))).
		SetLastHeartbeatAt(time.Now().UTC()).
		SetProgressPercent(percent).
		SetProgressMessage(message).
		AddRevision(1).
		Save(ctx); err != nil {
		return taggedError(ErrCodeDBError, "update run progress", err)
	}
	payload := map[string]any{"type": eventType, "message": message, "progress": percent}
	for k, v := range extra {
		payload[k] = v
	}
	if err := s.a.appendEvent(ctx, s.in, eventType, payload); err != nil {
		return taggedError(ErrCodeDBError, "append progress event", err)
	}
	return nil
}

func (s *eventSink) Emit(ctx context.Context, eventType string, payload map[string]any) error {
	withType := make(map[string]any, len(payload))
	withType["type"] = eventType
	for k, v := range payload {
		withType[k] = v
	}
	if err := s.a.appendEvent(ctx, s.in, eventType, withType); err != nil {
		return taggedError(ErrCodeDBError, "append runtime event", err)
	}
	return nil
}

// toolRegistry builds the per-run scoped allowlist: run_history.read always;
// event.read only for event-triggered runs; connector reads only when the
// owner's Google connection carries the matching scope; service-backed read
// tools only when configured. (artifact.* tools are runtime-owned — they share
// the staged write.)
func (a *Activities) toolRegistry(ctx context.Context, task *ent.BackgroundTask, run *ent.BackgroundTaskRun) backgroundtaskruntime.ToolRegistry {
	tools := []backgroundtaskruntime.Tool{
		backgroundtaskruntime.NewRunHistoryTool(a.Client, task.ID, run.RunID),
	}
	if a.Sandbox != nil {
		cfg := a.SandboxTool
		cfg.Heartbeat = func(ctx context.Context, hb backgroundtaskruntime.SandboxHeartbeat) {
			if activity.IsActivity(ctx) {
				activity.RecordHeartbeat(ctx, map[string]any{
					"tool":    "sandbox.run",
					"jobName": hb.JobName,
					"phase":   hb.Phase,
					"message": hb.Message,
				})
			}
		}
		tools = append(tools, backgroundtaskruntime.NewSandboxRunTool(a.Sandbox, cfg))
	}
	if run.CloudEventID != nil && a.Sealer != nil {
		tools = append(tools, backgroundtaskruntime.NewEventReadTool(a.Client, a.Sealer, *run.CloudEventID))
	}
	owner := task.Edges.User
	if owner != nil {
		tools = append(tools, backgroundtaskruntime.NewRelationshipReadTool(a.Client, owner.ID))
	}
	if owner != nil && a.Slack != nil && a.SlackTokens != nil {
		defaults := backgroundtaskruntime.SlackThreadDefaults{}
		if run.CloudEventID != nil && a.Sealer != nil {
			defaults = a.slackThreadDefaults(ctx, *run.CloudEventID)
		}
		tools = append(tools,
			backgroundtaskruntime.NewSlackReadThreadTool(a.SlackTokens, a.Slack, defaults),
			backgroundtaskruntime.NewSlackReplyTool(a.SlackTokens, a.Slack, defaults),
		)
	}
	if owner != nil && a.MCPResolver != nil && a.MCP != nil {
		tools = append(tools,
			backgroundtaskruntime.NewMCPListToolsTool(a.MCPResolver, a.MCP, a.MCPConnectors, a.MCPPolicies...),
			backgroundtaskruntime.NewMCPCallTool(a.MCPResolver, a.MCP, a.MCPConnectors, a.MCPPolicies...),
		)
	}
	if owner != nil && a.Google != nil && a.Sealer != nil && a.Secrets != nil {
		conn, err := a.Client.OAuthConnection.Query().
			Where(
				oauthconnection.ProviderEQ("google"),
				oauthconnection.HasUserWith(user.IDEQ(owner.ID)),
			).
			Only(ctx)
		if err == nil {
			if slices.Contains(conn.Scopes, backgroundtaskruntime.ScopeGmailReadonly) {
				tools = append(tools, backgroundtaskruntime.NewGmailReadTool(a.Client, a.Sealer, a.Secrets, a.Google, owner.ID))
			}
			if slices.Contains(conn.Scopes, backgroundtaskruntime.ScopeGmailCompose) {
				tools = append(tools, backgroundtaskruntime.NewGmailDraftTool(a.Client, a.Sealer, a.Secrets, a.Google, owner.ID))
			}
			if slices.Contains(conn.Scopes, backgroundtaskruntime.ScopeGmailSend) {
				tools = append(tools, backgroundtaskruntime.NewGmailSendTool(a.Client, a.Sealer, a.Secrets, a.Google, owner.ID))
			}
			if slices.Contains(conn.Scopes, backgroundtaskruntime.ScopeCalendarReadonly) {
				tools = append(tools, backgroundtaskruntime.NewCalendarReadTool(a.Client, a.Sealer, a.Secrets, a.Google, owner.ID))
			}
			if slices.Contains(conn.Scopes, backgroundtaskruntime.ScopeCalendarEvents) {
				tools = append(tools,
					backgroundtaskruntime.NewCalendarCreateTool(a.Client, a.Sealer, a.Secrets, a.Google, owner.ID),
					backgroundtaskruntime.NewCalendarUpdateTool(a.Client, a.Sealer, a.Secrets, a.Google, owner.ID),
				)
			}
			if slices.Contains(conn.Scopes, backgroundtaskruntime.ScopeDriveReadonly) {
				tools = append(tools, backgroundtaskruntime.NewDriveReadTool(a.Client, a.Sealer, a.Secrets, a.Google, owner.ID))
			}
			if slices.Contains(conn.Scopes, backgroundtaskruntime.ScopeDriveFile) {
				tools = append(tools, backgroundtaskruntime.NewDriveUpdateTool(a.Client, a.Sealer, a.Secrets, a.Google, owner.ID))
			}
		}
	}
	if owner != nil && a.HubSpot != nil {
		_, err := a.Client.MCPConnection.Query().Where(
			mcpconnection.ConnectorEQ("hubspot"),
			mcpconnection.StatusEQ("active"),
			mcpconnection.OrganizationIDEQ(connectors.OrganizationIDForUser(owner)),
			mcpconnection.HasUserWith(user.IDEQ(owner.ID)),
		).Only(auth.WithInternal(ctx))
		if err == nil {
			tools = append(tools,
				backgroundtaskruntime.NewHubSpotSearchTool(a.HubSpot, owner.ID),
				backgroundtaskruntime.NewHubSpotNoteTool(a.HubSpot, owner.ID),
				backgroundtaskruntime.NewHubSpotTaskTool(a.HubSpot, owner.ID),
			)
		}
	}
	if owner != nil && a.ActionProposer != nil {
		// RFC 023 propose-only tool: the model can record a pending finance
		// action for human approval, never execute one.
		tools = append(tools, backgroundtaskruntime.NewProposeActionTool(a.ActionProposer))
	}
	if owner != nil {
		deps := agentregistry.ToolDeps{
			Client:  a.Client,
			Web:     a.Web,
			Conduit: a.Conduit,
			Eigen:   a.Eigen,
			UserID:  owner.ID.String(),
		}
		if a.Web != nil {
			tools = appendCloudTaskCatalogTool(tools, "web.search", deps)
		}
		if a.Conduit != nil {
			tools = appendCloudTaskCatalogTool(tools, "conduit.read", deps)
		}
		if a.Eigen != nil {
			tools = appendCloudTaskCatalogTool(tools, "eigen.simulate", deps)
		}
	}
	return backgroundtaskruntime.NewRegistry(tools)
}

func (a *Activities) slackThreadDefaults(ctx context.Context, eventID uuid.UUID) backgroundtaskruntime.SlackThreadDefaults {
	ev, err := a.Client.CloudEvent.Get(ctx, eventID)
	if err != nil || ev.Source != "slack" {
		return backgroundtaskruntime.SlackThreadDefaults{}
	}
	if len(ev.PayloadCiphertext) == 0 || a.Sealer == nil {
		return backgroundtaskruntime.SlackThreadDefaults{TeamID: ev.SourceAccountID}
	}
	payload, err := a.Sealer.Open(ev.PayloadCiphertext)
	if err != nil {
		return backgroundtaskruntime.SlackThreadDefaults{TeamID: ev.SourceAccountID}
	}
	return backgroundtaskruntime.SlackThreadDefaultsFromEventPayload(ev.SourceAccountID, payload)
}

func appendCloudTaskCatalogTool(tools []backgroundtaskruntime.Tool, name string, deps agentregistry.ToolDeps) []backgroundtaskruntime.Tool {
	capability, ok := cloudTaskToolCatalog.Get(name)
	if !ok || capability.Kind != agentregistry.KindTool || capability.Build == nil || agentregistry.RequiresApproval(capability.TrustTier) {
		return tools
	}
	return append(tools, capability.Build(deps))
}

// mapRuntimeError converts runtime failures for Temporal: classified
// RuntimeErrors become NON-retryable ApplicationErrors carrying their code
// (deliberately not via taggedError, whose retryable-default policy covers
// the transient legacy classes); adapter errors that already carry a tagged
// classification pass through; cancellation propagates untouched.
func mapRuntimeError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return err
	}
	if re, ok := backgroundtaskruntime.AsRuntimeError(err); ok {
		return temporal.NewNonRetryableApplicationError(re.Error(), re.Code, re.Cause)
	}
	var appErr *temporal.ApplicationError
	if errors.As(err, &appErr) {
		return err
	}
	return taggedError(ErrCodeInternal, "runtime execution failed", err)
}
