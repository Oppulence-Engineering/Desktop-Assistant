package db

import (
	"context"
	"errors"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/actionoutcome"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/actionproposal"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentapproval"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentdefinition"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsession"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsessionevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agenttoolcall"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agenttoolresultblob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentturn"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/approvaltoken"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskschedulestate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/cloudevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/creditledger"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/googlewatch"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/intercept"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/llmusage"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailbodycache"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailmessagemeta"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailsignal"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailthread"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/meetingminuteusage"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/policydecisionsnapshot"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueactionrevision"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueevidence"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueleakscan"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueoutboxevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspacemember"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/subscription"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// tenantUserColumns is the write-side counterpart to the query interceptors
// below. Ent query interceptors do not run for mutations, so registerHooks uses
// this generated entity/foreign-key map to inject the authenticated user's id
// into every update/delete predicate.
var tenantUserColumns = map[string]string{
	ent.TypeActionOutcome:               actionoutcome.UserColumn,
	ent.TypeActionProposal:              actionproposal.UserColumn,
	ent.TypeApprovalToken:               approvaltoken.UserColumn,
	ent.TypeAgentApproval:               agentapproval.UserColumn,
	ent.TypeAgentDefinition:             agentdefinition.UserColumn,
	ent.TypeAgentSession:                agentsession.UserColumn,
	ent.TypeAgentSessionEvent:           agentsessionevent.UserColumn,
	ent.TypeAgentToolCall:               agenttoolcall.UserColumn,
	ent.TypeAgentToolResultBlob:         agenttoolresultblob.UserColumn,
	ent.TypeAgentTurn:                   agentturn.UserColumn,
	ent.TypeBackgroundTask:              backgroundtask.UserColumn,
	ent.TypeBackgroundTaskArtifact:      backgroundtaskartifact.UserColumn,
	ent.TypeBackgroundTaskRun:           backgroundtaskrun.UserColumn,
	ent.TypeBackgroundTaskRunEvent:      backgroundtaskrunevent.UserColumn,
	ent.TypeBackgroundTaskScheduleState: backgroundtaskschedulestate.UserColumn,
	ent.TypeCloudEvent:                  cloudevent.UserColumn,
	ent.TypeCreditLedger:                creditledger.UserColumn,
	ent.TypeGoogleWatch:                 googlewatch.UserColumn,
	ent.TypeLLMUsage:                    llmusage.UserColumn,
	ent.TypeMCPConnection:               mcpconnection.UserColumn,
	ent.TypeMeetingMinuteUsage:          meetingminuteusage.UserColumn,
	ent.TypeOAuthConnection:             oauthconnection.UserColumn,
	ent.TypeSubscription:                subscription.UserColumn,
	ent.TypeCommitment:                  commitment.UserColumn,
	ent.TypeMailBodyCache:               mailbodycache.UserColumn,
	ent.TypeMailSignal:                  mailsignal.UserColumn,
	ent.TypeMailMessageMeta:             mailmessagemeta.UserColumn,
	ent.TypeMailThread:                  mailthread.UserColumn,
	ent.TypePolicyDecisionSnapshot:      policydecisionsnapshot.UserColumn,
	ent.TypeRelationship:                relationship.UserColumn,
	ent.TypeRevenueAction:               revenueaction.UserColumn,
	ent.TypeRevenueActionRevision:       revenueactionrevision.UserColumn,
	ent.TypeRevenueEvidence:             revenueevidence.UserColumn,
	ent.TypeRevenueLeakScan:             revenueleakscan.UserColumn,
	ent.TypeRevenueOutboxEvent:          revenueoutboxevent.UserColumn,
	ent.TypeRevenueWorkspace:            revenueworkspace.UserColumn,
	ent.TypeRevenueWorkspaceMember:      revenueworkspacemember.UserColumn,
}

// ErrNoViewer is returned when a per-user entity is queried with neither an
// authenticated user nor the internal-caller flag in context. It is the
// ORM-layer guarantee that untrusted code cannot read across tenants.
var ErrNoViewer = errors.New("db: query on per-user entity without a viewer in context")

// registerInterceptors installs read-side middleware:
//   - query metrics (count by entity type)
//   - per-user tenant scoping (the privacy policy from the plan, enforced at
//     the client so a READ cannot be bypassed by forgetting a WHERE clause)
//
// Mutations are independently scoped by tenantMutationHook in hooks.go. The
// read and write controls are deliberately separate because Ent interceptors
// never run on mutation execution.
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

	// Revenue memory and outbound governance (RFC 030). MVP tenancy is
	// founder-mode user scoping; the workspace edges exist for the WP6
	// member-scoped upgrade, at which point these interceptors move to
	// RevenueWorkspaceMember-driven predicates.
	client.RevenueWorkspace.Intercept(intercept.TraverseRevenueWorkspace(
		func(ctx context.Context, q *ent.RevenueWorkspaceQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenueworkspace.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.RevenueWorkspaceMember.Intercept(intercept.TraverseRevenueWorkspaceMember(
		func(ctx context.Context, q *ent.RevenueWorkspaceMemberQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenueworkspacemember.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.RevenueLeakScan.Intercept(intercept.TraverseRevenueLeakScan(
		func(ctx context.Context, q *ent.RevenueLeakScanQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenueleakscan.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.MailThread.Intercept(intercept.TraverseMailThread(
		func(ctx context.Context, q *ent.MailThreadQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(mailthread.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.MailMessageMeta.Intercept(intercept.TraverseMailMessageMeta(
		func(ctx context.Context, q *ent.MailMessageMetaQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(mailmessagemeta.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.MailBodyCache.Intercept(intercept.TraverseMailBodyCache(
		func(ctx context.Context, q *ent.MailBodyCacheQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(mailbodycache.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.MailSignal.Intercept(intercept.TraverseMailSignal(
		func(ctx context.Context, q *ent.MailSignalQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(mailsignal.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.Relationship.Intercept(intercept.TraverseRelationship(
		func(ctx context.Context, q *ent.RelationshipQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(relationship.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.RevenueEvidence.Intercept(intercept.TraverseRevenueEvidence(
		func(ctx context.Context, q *ent.RevenueEvidenceQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenueevidence.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.Commitment.Intercept(intercept.TraverseCommitment(
		func(ctx context.Context, q *ent.CommitmentQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(commitment.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.RevenueAction.Intercept(intercept.TraverseRevenueAction(
		func(ctx context.Context, q *ent.RevenueActionQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenueaction.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.RevenueActionRevision.Intercept(intercept.TraverseRevenueActionRevision(
		func(ctx context.Context, q *ent.RevenueActionRevisionQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenueactionrevision.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.PolicyDecisionSnapshot.Intercept(intercept.TraversePolicyDecisionSnapshot(
		func(ctx context.Context, q *ent.PolicyDecisionSnapshotQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(policydecisionsnapshot.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.ActionOutcome.Intercept(intercept.TraverseActionOutcome(
		func(ctx context.Context, q *ent.ActionOutcomeQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(actionoutcome.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.RevenueOutboxEvent.Intercept(intercept.TraverseRevenueOutboxEvent(
		func(ctx context.Context, q *ent.RevenueOutboxEventQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenueoutboxevent.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.ActionProposal.Intercept(intercept.TraverseActionProposal(
		func(ctx context.Context, q *ent.ActionProposalQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(actionproposal.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.ApprovalToken.Intercept(intercept.TraverseApprovalToken(
		func(ctx context.Context, q *ent.ApprovalTokenQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(approvaltoken.HasUserWith(user.IDEQ(uid)))
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
