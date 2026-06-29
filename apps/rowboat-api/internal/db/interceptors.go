package db

import (
	"context"
	"errors"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentapproval"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentdefinition"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsession"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsessionevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agenttoolcall"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agenttoolresultblob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentturn"
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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/meetingminuteusage"
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

	client.MeetingMinuteUsage.Intercept(intercept.TraverseMeetingMinuteUsage(
		func(ctx context.Context, q *ent.MeetingMinuteUsageQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(meetingminuteusage.HasUserWith(user.IDEQ(uid)))
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

	// Durable agent runtime entities (RFC 027). Each carries a required user
	// edge, so the same read-side tenant scoping applies; mutations still follow
	// the scoped-read-first rule documented above.
	client.AgentDefinition.Intercept(intercept.TraverseAgentDefinition(
		func(ctx context.Context, q *ent.AgentDefinitionQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(agentdefinition.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.AgentSession.Intercept(intercept.TraverseAgentSession(
		func(ctx context.Context, q *ent.AgentSessionQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(agentsession.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.AgentTurn.Intercept(intercept.TraverseAgentTurn(
		func(ctx context.Context, q *ent.AgentTurnQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(agentturn.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.AgentSessionEvent.Intercept(intercept.TraverseAgentSessionEvent(
		func(ctx context.Context, q *ent.AgentSessionEventQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(agentsessionevent.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.AgentToolCall.Intercept(intercept.TraverseAgentToolCall(
		func(ctx context.Context, q *ent.AgentToolCallQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(agenttoolcall.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.AgentApproval.Intercept(intercept.TraverseAgentApproval(
		func(ctx context.Context, q *ent.AgentApprovalQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(agentapproval.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.AgentToolResultBlob.Intercept(intercept.TraverseAgentToolResultBlob(
		func(ctx context.Context, q *ent.AgentToolResultBlobQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(agenttoolresultblob.HasUserWith(user.IDEQ(uid)))
			})
		}))
}

// scopeToUser applies a user predicate to the query, or returns ErrNoViewer.
// A user in context always wins, even when the internal-caller flag is also
// set: internal flows (Temporal activities, cloud-event routing) attach the
// owner via auth.WithUser precisely so quota and billing reads stay scoped to
// that tenant. Internal callers without a user bypass scoping with full
// access.
func scopeToUser(ctx context.Context, apply func(uuid.UUID)) error {
	if u, ok := auth.UserFromCtx(ctx); ok {
		apply(u.ID)
		return nil
	}
	if auth.IsInternalCaller(ctx) {
		return nil
	}
	return ErrNoViewer
}
