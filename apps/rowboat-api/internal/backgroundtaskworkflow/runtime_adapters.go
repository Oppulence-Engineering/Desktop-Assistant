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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/google/uuid"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

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
		return 0, nil // write succeeded; revision read-back is best-effort
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
	withType := make(map[string]any, len(payload)+1)
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
// owner's Google connection carries the matching scope. (artifact.* tools are
// runtime-owned — they share the staged write.)
func (a *Activities) toolRegistry(ctx context.Context, task *ent.BackgroundTask, run *ent.BackgroundTaskRun) backgroundtaskruntime.ToolRegistry {
	tools := []backgroundtaskruntime.Tool{
		backgroundtaskruntime.NewRunHistoryTool(a.Client, task.ID, run.RunID),
	}
	if run.CloudEventID != nil && a.Sealer != nil {
		tools = append(tools, backgroundtaskruntime.NewEventReadTool(a.Client, a.Sealer, *run.CloudEventID))
	}
	owner := task.Edges.User
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
			if slices.Contains(conn.Scopes, backgroundtaskruntime.ScopeCalendarReadonly) {
				tools = append(tools, backgroundtaskruntime.NewCalendarReadTool(a.Client, a.Sealer, a.Secrets, a.Google, owner.ID))
			}
		}
	}
	return backgroundtaskruntime.NewRegistry(tools)
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
