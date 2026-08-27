package db

import (
	"context"
	"errors"
	"time"

	coreent "entgo.io/ent"
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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/captureartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/cloudevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentdependency"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/conversationintelligenceartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/creditledger"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/entity"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/entityidentifier"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/entityresourceref"
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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personattribute"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personidentity"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personinteractionstat"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personmergecandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personsuppression"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/policydecisionsnapshot"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/predicate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipassertion"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipattentionitem"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentity"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentitycandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentitydecision"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshiplineageevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipprojectionjob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipreviewacknowledgement"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipsourcestatus"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipstatesnapshot"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueactionrevision"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueevidence"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueleakscan"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueoutboxevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenuetrustevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspacemember"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/subscription"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/tenantevidencekey"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/voiceapikey"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/voicesyncitem"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/workspacefeaturecontrol"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// tenantUserColumns is the write-side counterpart to the query interceptors
// below. Ent query interceptors do not run for mutations, so registerHooks uses
// this generated entity/foreign-key map to inject the authenticated user's id
// into every update/delete predicate.
var tenantUserColumns = map[string]string{
	ent.TypeActionOutcome:                     actionoutcome.UserColumn,
	ent.TypeActionProposal:                    actionproposal.UserColumn,
	ent.TypeApprovalToken:                     approvaltoken.UserColumn,
	ent.TypeAgentApproval:                     agentapproval.UserColumn,
	ent.TypeAgentDefinition:                   agentdefinition.UserColumn,
	ent.TypeAgentSession:                      agentsession.UserColumn,
	ent.TypeAgentSessionEvent:                 agentsessionevent.UserColumn,
	ent.TypeAgentToolCall:                     agenttoolcall.UserColumn,
	ent.TypeAgentToolResultBlob:               agenttoolresultblob.UserColumn,
	ent.TypeAgentTurn:                         agentturn.UserColumn,
	ent.TypeBackgroundTask:                    backgroundtask.UserColumn,
	ent.TypeBackgroundTaskArtifact:            backgroundtaskartifact.UserColumn,
	ent.TypeBackgroundTaskRun:                 backgroundtaskrun.UserColumn,
	ent.TypeBackgroundTaskRunEvent:            backgroundtaskrunevent.UserColumn,
	ent.TypeBackgroundTaskScheduleState:       backgroundtaskschedulestate.UserColumn,
	ent.TypeCloudEvent:                        cloudevent.UserColumn,
	ent.TypeCaptureArtifact:                   captureartifact.UserColumn,
	ent.TypeCreditLedger:                      creditledger.UserColumn,
	ent.TypeGoogleWatch:                       googlewatch.UserColumn,
	ent.TypeLLMUsage:                          llmusage.UserColumn,
	ent.TypeMCPConnection:                     mcpconnection.UserColumn,
	ent.TypeMeetingMinuteUsage:                meetingminuteusage.UserColumn,
	ent.TypeOAuthConnection:                   oauthconnection.UserColumn,
	ent.TypeSubscription:                      subscription.UserColumn,
	ent.TypeCommitment:                        commitment.UserColumn,
	ent.TypeCommitmentDependency:              commitmentdependency.UserColumn,
	ent.TypeCommitmentEvent:                   commitmentevent.UserColumn,
	ent.TypeConversationIntelligenceArtifact:  conversationintelligenceartifact.UserColumn,
	ent.TypeMailBodyCache:                     mailbodycache.UserColumn,
	ent.TypeMailSignal:                        mailsignal.UserColumn,
	ent.TypeMailMessageMeta:                   mailmessagemeta.UserColumn,
	ent.TypeMailThread:                        mailthread.UserColumn,
	ent.TypePolicyDecisionSnapshot:            policydecisionsnapshot.UserColumn,
	ent.TypeRelationship:                      relationship.UserColumn,
	ent.TypeRelationshipAttentionItem:         relationshipattentionitem.UserColumn,
	ent.TypeRelationshipAssertion:             relationshipassertion.UserColumn,
	ent.TypeRelationshipIdentity:              relationshipidentity.UserColumn,
	ent.TypeRelationshipIdentityCandidate:     relationshipidentitycandidate.UserColumn,
	ent.TypeRelationshipIdentityDecision:      relationshipidentitydecision.UserColumn,
	ent.TypeRelationshipLineageEvent:          relationshiplineageevent.UserColumn,
	ent.TypeRelationshipObservation:           relationshipobservation.UserColumn,
	ent.TypeRelationshipParticipant:           relationshipparticipant.UserColumn,
	ent.TypeRelationshipProjectionJob:         relationshipprojectionjob.UserColumn,
	ent.TypeRelationshipReviewAcknowledgement: relationshipreviewacknowledgement.UserColumn,
	ent.TypeRelationshipSourceStatus:          relationshipsourcestatus.UserColumn,
	ent.TypeRelationshipStateSnapshot:         relationshipstatesnapshot.UserColumn,
	ent.TypeRevenueAction:                     revenueaction.UserColumn,
	ent.TypeRevenueActionRevision:             revenueactionrevision.UserColumn,
	ent.TypeRevenueEvidence:                   revenueevidence.UserColumn,
	ent.TypeRevenueLeakScan:                   revenueleakscan.UserColumn,
	ent.TypeRevenueOutboxEvent:                revenueoutboxevent.UserColumn,
	ent.TypeRevenueWorkspace:                  revenueworkspace.UserColumn,
	ent.TypeRevenueWorkspaceMember:            revenueworkspacemember.UserColumn,
	ent.TypeTenantEvidenceKey:                 tenantevidencekey.UserColumn,
	ent.TypeWorkspaceFeatureControl:           workspacefeaturecontrol.UserColumn,
	ent.TypeVoiceAPIKey:                       voiceapikey.UserColumn,
	ent.TypeVoiceSyncItem:                     voicesyncitem.UserColumn,
	ent.TypeRevenueTrustEvent:                 revenuetrustevent.UserColumn,
	ent.TypePerson:                            person.UserColumn,
	ent.TypePersonIdentity:                    personidentity.UserColumn,
	ent.TypePersonSuppression:                 personsuppression.UserColumn,
	ent.TypePersonAttribute:                   personattribute.UserColumn,
	ent.TypePersonMergeCandidate:              personmergecandidate.UserColumn,
	ent.TypeEntity:                            entity.UserColumn,
	ent.TypeEntityResourceRef:                 entityresourceref.UserColumn,
	ent.TypeEntityIdentifier:                  entityidentifier.UserColumn,
}

// workspaceTenantColumns identifies revenue entities whose authorization is
// inherited from their required workspace edge. The mutation hook uses this
// map instead of the historical creator/user column so active collaborators
// can update shared records while viewers remain read-only.
var workspaceTenantColumns = map[string]string{
	ent.TypeRevenueWorkspaceMember:            revenueworkspacemember.WorkspaceColumn,
	ent.TypeRevenueLeakScan:                   revenueleakscan.WorkspaceColumn,
	ent.TypeRelationship:                      relationship.WorkspaceColumn,
	ent.TypeRelationshipAttentionItem:         relationshipattentionitem.WorkspaceColumn,
	ent.TypeRelationshipParticipant:           relationshipparticipant.WorkspaceColumn,
	ent.TypeRelationshipIdentity:              relationshipidentity.WorkspaceColumn,
	ent.TypeRelationshipIdentityCandidate:     relationshipidentitycandidate.WorkspaceColumn,
	ent.TypeRelationshipIdentityDecision:      relationshipidentitydecision.WorkspaceColumn,
	ent.TypeRelationshipLineageEvent:          relationshiplineageevent.WorkspaceColumn,
	ent.TypeRelationshipObservation:           relationshipobservation.WorkspaceColumn,
	ent.TypeRelationshipAssertion:             relationshipassertion.WorkspaceColumn,
	ent.TypeRelationshipProjectionJob:         relationshipprojectionjob.WorkspaceColumn,
	ent.TypeRelationshipReviewAcknowledgement: relationshipreviewacknowledgement.WorkspaceColumn,
	ent.TypeRelationshipStateSnapshot:         relationshipstatesnapshot.WorkspaceColumn,
	ent.TypeRelationshipSourceStatus:          relationshipsourcestatus.WorkspaceColumn,
	ent.TypeRevenueEvidence:                   revenueevidence.WorkspaceColumn,
	ent.TypeCommitment:                        commitment.WorkspaceColumn,
	ent.TypeCommitmentEvent:                   commitmentevent.WorkspaceColumn,
	ent.TypeCommitmentDependency:              commitmentdependency.WorkspaceColumn,
	ent.TypeConversationIntelligenceArtifact:  conversationintelligenceartifact.WorkspaceColumn,
	ent.TypeRevenueAction:                     revenueaction.WorkspaceColumn,
	ent.TypePolicyDecisionSnapshot:            policydecisionsnapshot.WorkspaceColumn,
	ent.TypeActionOutcome:                     actionoutcome.WorkspaceColumn,
	ent.TypeRevenueOutboxEvent:                revenueoutboxevent.WorkspaceColumn,
	ent.TypeTenantEvidenceKey:                 tenantevidencekey.WorkspaceColumn,
	ent.TypeWorkspaceFeatureControl:           workspacefeaturecontrol.WorkspaceColumn,
	ent.TypeRevenueTrustEvent:                 revenuetrustevent.WorkspaceColumn,
	ent.TypePerson:                            person.WorkspaceColumn,
	ent.TypePersonIdentity:                    personidentity.WorkspaceColumn,
	ent.TypePersonSuppression:                 personsuppression.WorkspaceColumn,
	ent.TypePersonAttribute:                   personattribute.WorkspaceColumn,
	// No user edge: a rollup is derived, owned by the workspace, never authored.
	ent.TypePersonInteractionStat: personinteractionstat.WorkspaceColumn,
	ent.TypePersonMergeCandidate:  personmergecandidate.WorkspaceColumn,
	ent.TypeEntity:                entity.WorkspaceColumn,
	ent.TypeEntityResourceRef:     entityresourceref.WorkspaceColumn,
	ent.TypeEntityIdentifier:      entityidentifier.WorkspaceColumn,
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
func registerInterceptors(client *ent.Client, log *zap.Logger) {
	client.Intercept(coreent.InterceptFunc(func(next coreent.Querier) coreent.Querier {
		return coreent.QuerierFunc(func(ctx context.Context, query coreent.Query) (coreent.Value, error) {
			queryType, operation := "unknown", "unknown"
			if metadata := coreent.QueryFromContext(ctx); metadata != nil {
				queryType, operation = metadata.Type, metadata.Op
			}
			started := time.Now()
			value, err := next.Query(ctx, query)
			duration := time.Since(started)
			entQueriesTotal.WithLabelValues(queryType).Inc()
			entQueryDuration.WithLabelValues(queryType, operation).Observe(duration.Seconds())
			if err != nil {
				entQueryErrorsTotal.WithLabelValues(queryType, operation).Inc()
			}
			if duration >= time.Second {
				log.Warn("slow ent query",
					zap.String("entity", queryType),
					zap.String("operation", operation),
					zap.Duration("duration", duration),
					zap.Error(err),
				)
			}
			return value, err
		})
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

	client.CaptureArtifact.Intercept(intercept.TraverseCaptureArtifact(
		func(ctx context.Context, q *ent.CaptureArtifactQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(captureartifact.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.VoiceAPIKey.Intercept(intercept.TraverseVoiceAPIKey(
		func(ctx context.Context, q *ent.VoiceAPIKeyQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(voiceapikey.HasUserWith(user.IDEQ(uid)))
			})
		}))

	client.VoiceSyncItem.Intercept(intercept.TraverseVoiceSyncItem(
		func(ctx context.Context, q *ent.VoiceSyncItemQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(voicesyncitem.HasUserWith(user.IDEQ(uid)))
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

	// Revenue memory and outbound governance is workspace-scoped. Founding
	// ownership remains a compatibility path for rows created before membership
	// backfill; active member rows are the explicit authorization boundary.
	client.RevenueWorkspace.Intercept(intercept.TraverseRevenueWorkspace(
		func(ctx context.Context, q *ent.RevenueWorkspaceQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenueWorkspaceAccessibleTo(uid))
			})
		}))

	client.RevenueWorkspaceMember.Intercept(intercept.TraverseRevenueWorkspaceMember(
		func(ctx context.Context, q *ent.RevenueWorkspaceMemberQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenueworkspacemember.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RevenueLeakScan.Intercept(intercept.TraverseRevenueLeakScan(
		func(ctx context.Context, q *ent.RevenueLeakScanQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenueleakscan.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
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
				q.Where(relationship.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.Entity.Intercept(intercept.TraverseEntity(
		func(ctx context.Context, q *ent.EntityQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(entity.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.EntityResourceRef.Intercept(intercept.TraverseEntityResourceRef(
		func(ctx context.Context, q *ent.EntityResourceRefQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(entityresourceref.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.EntityIdentifier.Intercept(intercept.TraverseEntityIdentifier(
		func(ctx context.Context, q *ent.EntityIdentifierQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(entityidentifier.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RelationshipParticipant.Intercept(intercept.TraverseRelationshipParticipant(
		func(ctx context.Context, q *ent.RelationshipParticipantQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(relationshipparticipant.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RelationshipIdentity.Intercept(intercept.TraverseRelationshipIdentity(
		func(ctx context.Context, q *ent.RelationshipIdentityQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(relationshipidentity.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	// The canonical person and everything derived from it. Reads and writes are
	// scoped independently because Ent interceptors never run on mutations, so a
	// type registered only in tenantUserColumns would still be readable across
	// tenants.
	client.Person.Intercept(intercept.TraversePerson(
		func(ctx context.Context, q *ent.PersonQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(person.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.PersonIdentity.Intercept(intercept.TraversePersonIdentity(
		func(ctx context.Context, q *ent.PersonIdentityQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(personidentity.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.PersonSuppression.Intercept(intercept.TraversePersonSuppression(
		func(ctx context.Context, q *ent.PersonSuppressionQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(personsuppression.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.PersonAttribute.Intercept(intercept.TraversePersonAttribute(
		func(ctx context.Context, q *ent.PersonAttributeQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(personattribute.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.PersonInteractionStat.Intercept(intercept.TraversePersonInteractionStat(
		func(ctx context.Context, q *ent.PersonInteractionStatQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(personinteractionstat.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.PersonMergeCandidate.Intercept(intercept.TraversePersonMergeCandidate(
		func(ctx context.Context, q *ent.PersonMergeCandidateQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(personmergecandidate.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RelationshipIdentityCandidate.Intercept(intercept.TraverseRelationshipIdentityCandidate(
		func(ctx context.Context, q *ent.RelationshipIdentityCandidateQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(relationshipidentitycandidate.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RelationshipIdentityDecision.Intercept(intercept.TraverseRelationshipIdentityDecision(
		func(ctx context.Context, q *ent.RelationshipIdentityDecisionQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(relationshipidentitydecision.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RelationshipLineageEvent.Intercept(intercept.TraverseRelationshipLineageEvent(
		func(ctx context.Context, q *ent.RelationshipLineageEventQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(relationshiplineageevent.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RelationshipObservation.Intercept(intercept.TraverseRelationshipObservation(
		func(ctx context.Context, q *ent.RelationshipObservationQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(relationshipobservation.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RelationshipAssertion.Intercept(intercept.TraverseRelationshipAssertion(
		func(ctx context.Context, q *ent.RelationshipAssertionQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(relationshipassertion.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RelationshipProjectionJob.Intercept(intercept.TraverseRelationshipProjectionJob(
		func(ctx context.Context, q *ent.RelationshipProjectionJobQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(relationshipprojectionjob.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RelationshipReviewAcknowledgement.Intercept(intercept.TraverseRelationshipReviewAcknowledgement(
		func(ctx context.Context, q *ent.RelationshipReviewAcknowledgementQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(relationshipreviewacknowledgement.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RelationshipAttentionItem.Intercept(intercept.TraverseRelationshipAttentionItem(
		func(ctx context.Context, q *ent.RelationshipAttentionItemQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(relationshipattentionitem.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RelationshipStateSnapshot.Intercept(intercept.TraverseRelationshipStateSnapshot(
		func(ctx context.Context, q *ent.RelationshipStateSnapshotQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(relationshipstatesnapshot.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RelationshipSourceStatus.Intercept(intercept.TraverseRelationshipSourceStatus(
		func(ctx context.Context, q *ent.RelationshipSourceStatusQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(relationshipsourcestatus.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RevenueEvidence.Intercept(intercept.TraverseRevenueEvidence(
		func(ctx context.Context, q *ent.RevenueEvidenceQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenueevidence.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.Commitment.Intercept(intercept.TraverseCommitment(
		func(ctx context.Context, q *ent.CommitmentQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(commitment.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.CommitmentEvent.Intercept(intercept.TraverseCommitmentEvent(
		func(ctx context.Context, q *ent.CommitmentEventQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(commitmentevent.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.CommitmentDependency.Intercept(intercept.TraverseCommitmentDependency(
		func(ctx context.Context, q *ent.CommitmentDependencyQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(commitmentdependency.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.ConversationIntelligenceArtifact.Intercept(intercept.TraverseConversationIntelligenceArtifact(
		func(ctx context.Context, q *ent.ConversationIntelligenceArtifactQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(conversationintelligenceartifact.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RevenueAction.Intercept(intercept.TraverseRevenueAction(
		func(ctx context.Context, q *ent.RevenueActionQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenueaction.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RevenueActionRevision.Intercept(intercept.TraverseRevenueActionRevision(
		func(ctx context.Context, q *ent.RevenueActionRevisionQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenueactionrevision.HasActionWith(
					revenueaction.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)),
				))
			})
		}))

	client.PolicyDecisionSnapshot.Intercept(intercept.TraversePolicyDecisionSnapshot(
		func(ctx context.Context, q *ent.PolicyDecisionSnapshotQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(policydecisionsnapshot.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.ActionOutcome.Intercept(intercept.TraverseActionOutcome(
		func(ctx context.Context, q *ent.ActionOutcomeQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(actionoutcome.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RevenueOutboxEvent.Intercept(intercept.TraverseRevenueOutboxEvent(
		func(ctx context.Context, q *ent.RevenueOutboxEventQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenueoutboxevent.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.TenantEvidenceKey.Intercept(intercept.TraverseTenantEvidenceKey(
		func(ctx context.Context, q *ent.TenantEvidenceKeyQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(tenantevidencekey.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.WorkspaceFeatureControl.Intercept(intercept.TraverseWorkspaceFeatureControl(
		func(ctx context.Context, q *ent.WorkspaceFeatureControlQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(workspacefeaturecontrol.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
			})
		}))

	client.RevenueTrustEvent.Intercept(intercept.TraverseRevenueTrustEvent(
		func(ctx context.Context, q *ent.RevenueTrustEventQuery) error {
			return scopeToUser(ctx, func(uid uuid.UUID) {
				q.Where(revenuetrustevent.HasWorkspaceWith(revenueWorkspaceAccessibleTo(uid)))
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

func revenueWorkspaceAccessibleTo(uid uuid.UUID) predicate.RevenueWorkspace {
	return revenueworkspace.Or(
		revenueworkspace.HasUserWith(user.IDEQ(uid)),
		revenueworkspace.HasMembersWith(
			revenueworkspacemember.StatusEQ("active"),
			revenueworkspacemember.HasUserWith(user.IDEQ(uid)),
		),
	)
}
