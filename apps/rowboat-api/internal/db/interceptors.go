package db

import (
	"context"
	"errors"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskschedulestate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/cloudevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/creditledger"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/googlewatch"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/intercept"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/llmusage"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/subscription"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// ErrNoViewer is returned when a per-user entity is queried with neither an
// authenticated user nor the internal-caller flag in context. It is the
// ORM-layer guarantee that untrusted code cannot read across tenants.
var ErrNoViewer = errors.New("db: query on per-user entity without a viewer in context")

// registerInterceptors installs read-side middleware:
//   - query metrics (count by entity type)
//   - per-user tenant scoping (the privacy policy from the plan, enforced at
//     the client so a READ cannot be bypassed by forgetting a WHERE clause)
//
// IMPORTANT: ent interceptors run only on QUERY execution. Mutations
// (Update/UpdateOne/Delete/DeleteOne and OnConflict upserts) are NOT scoped here
// — they must operate on an id/slug obtained from a prior tenant-scoped read
// (the convention every handler follows: lookupTask/lookupRun/scoped Query →
// mutate by verified id). A mutation that builds its predicate directly from
// request input would bypass tenant isolation; keep the scoped-read-first rule.
func registerInterceptors(client *ent.Client, _ *zap.Logger) {
	client.Intercept(intercept.Func(func(_ context.Context, q intercept.Query) error {
		entQueriesTotal.WithLabelValues(q.Type()).Inc()
		return nil
	}))

	client.CreditLedger.Intercept(intercept.TraverseCreditLedger(
		func(ctx context.Context, q *ent.CreditLedgerQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(creditledger.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.BackgroundTask.Intercept(intercept.TraverseBackgroundTask(
		func(ctx context.Context, q *ent.BackgroundTaskQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(backgroundtask.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.BackgroundTaskArtifact.Intercept(intercept.TraverseBackgroundTaskArtifact(
		func(ctx context.Context, q *ent.BackgroundTaskArtifactQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(backgroundtaskartifact.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.BackgroundTaskRun.Intercept(intercept.TraverseBackgroundTaskRun(
		func(ctx context.Context, q *ent.BackgroundTaskRunQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(backgroundtaskrun.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.BackgroundTaskRunEvent.Intercept(intercept.TraverseBackgroundTaskRunEvent(
		func(ctx context.Context, q *ent.BackgroundTaskRunEventQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(backgroundtaskrunevent.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.BackgroundTaskScheduleState.Intercept(intercept.TraverseBackgroundTaskScheduleState(
		func(ctx context.Context, q *ent.BackgroundTaskScheduleStateQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(backgroundtaskschedulestate.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.CloudEvent.Intercept(intercept.TraverseCloudEvent(
		func(ctx context.Context, q *ent.CloudEventQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(cloudevent.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.GoogleWatch.Intercept(intercept.TraverseGoogleWatch(
		func(ctx context.Context, q *ent.GoogleWatchQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(googlewatch.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.LLMUsage.Intercept(intercept.TraverseLLMUsage(
		func(ctx context.Context, q *ent.LLMUsageQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(llmusage.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.OAuthConnection.Intercept(intercept.TraverseOAuthConnection(
		func(ctx context.Context, q *ent.OAuthConnectionQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(oauthconnection.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.MCPConnection.Intercept(intercept.TraverseMCPConnection(
		func(ctx context.Context, q *ent.MCPConnectionQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(mcpconnection.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.Subscription.Intercept(intercept.TraverseSubscription(
		func(ctx context.Context, q *ent.SubscriptionQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(subscription.HasUserWith(user.IDEQ(uid)))
			})
		}))
}

// scopeToUser applies a user predicate to the query, or returns ErrNoViewer.
// Internal (server-to-server) callers bypass scoping with full access.
func scopeToUser(ctx context.Context, apply func(uuid.UUID)) error {
	if auth.IsInternalCaller(ctx) {
		return nil
	}
	u, ok := auth.UserFromCtx(ctx)
	if !ok {
		return ErrNoViewer
	}
	apply(u.ID)
	return nil
}
