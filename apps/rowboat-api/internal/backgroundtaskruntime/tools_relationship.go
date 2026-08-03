package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipattentionitem"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipsourcestatus"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
)

const relationshipReadMax = 100

// NewRelationshipReadTool exposes a bounded, tenant-scoped, read-only view of
// Oppulence relationship memory. It returns references and projected state,
// never raw encrypted evidence bodies or provider credentials.
func NewRelationshipReadTool(client *ent.Client, ownerID uuid.UUID) Tool {
	return &relationshipReadTool{client: client, ownerID: ownerID}
}

type relationshipReadTool struct {
	client  *ent.Client
	ownerID uuid.UUID
}

func (t *relationshipReadTool) Name() string { return "relationship.read" }
func (t *relationshipReadTool) Description() string {
	return "Read tenant-scoped relationship state, attention, recommendations, or connector-source health with evidence references."
}
func (t *relationshipReadTool) AuditInfo(json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierRead, Operation: "relationship.memory.read"}
}
func (t *relationshipReadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"view":{"type":"string","enum":["portfolio","attention","recommendations","sources"]},"limit":{"type":"integer","minimum":1,"maximum":100}},"required":["view"],"additionalProperties":false}`)
}

func (t *relationshipReadTool) Invoke(ctx context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("relationship reader is not configured")
	}
	if scope.UserID != "" && scope.UserID != t.ownerID.String() {
		return nil, errors.New("relationship reader scope does not match workflow owner")
	}
	var input struct {
		View  string `json:"view"`
		Limit int    `json:"limit"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode relationship read input: %w", err)
	}
	input.View = strings.ToLower(strings.TrimSpace(input.View))
	if input.Limit <= 0 || input.Limit > relationshipReadMax {
		input.Limit = 50
	}
	internal := auth.WithInternal(ctx)
	var payload any
	var err error
	switch input.View {
	case "portfolio":
		payload, err = t.portfolio(internal, input.Limit)
	case "attention":
		payload, err = t.attention(internal, input.Limit)
	case "recommendations":
		payload, err = t.recommendations(internal, input.Limit)
	case "sources":
		payload, err = t.sources(internal, input.Limit)
	default:
		return nil, errors.New("view must be portfolio, attention, recommendations, or sources")
	}
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{
		"view": input.View, "asOf": time.Now().UTC().Format(time.RFC3339), "data": payload,
	})
}

type relationshipToolParticipant struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email,omitempty"`
	Role        string `json:"role"`
	Title       string `json:"title,omitempty"`
}

type relationshipToolCommitment struct {
	ID         string  `json:"id"`
	Text       string  `json:"text"`
	Direction  string  `json:"direction"`
	Status     string  `json:"status"`
	DueAt      *string `json:"dueAt,omitempty"`
	Confidence float64 `json:"confidence"`
	Confirmed  bool    `json:"confirmed"`
	Acceptance string  `json:"acceptance"`
}

type relationshipToolAction struct {
	ID              string  `json:"id"`
	ActionType      string  `json:"actionType"`
	Reason          string  `json:"reason"`
	Priority        int     `json:"priority"`
	QueueStatus     string  `json:"queueStatus"`
	PolicyStatus    string  `json:"policyStatus"`
	ApprovalStatus  string  `json:"approvalStatus"`
	ExecutionStatus string  `json:"executionStatus"`
	Revision        int     `json:"revision"`
	DueAt           *string `json:"dueAt,omitempty"`
}

type relationshipToolAttention struct {
	ID                    string   `json:"id"`
	ReasonCode            string   `json:"reasonCode"`
	Explanation           string   `json:"explanation"`
	TriggeringObjectRef   string   `json:"triggeringObjectRef"`
	EvidenceRefs          []string `json:"evidenceRefs"`
	Urgency               string   `json:"urgency"`
	RankScore             int      `json:"rankScore"`
	Status                string   `json:"status"`
	RecommendationID      *string  `json:"recommendationId,omitempty"`
	RecommendationVersion int      `json:"recommendationRevision,omitempty"`
}

type relationshipToolView struct {
	ID            string                        `json:"id"`
	Kind          string                        `json:"kind"`
	DisplayName   string                        `json:"displayName"`
	AccountDomain string                        `json:"accountDomain,omitempty"`
	Summary       string                        `json:"summary,omitempty"`
	Status        string                        `json:"status"`
	Lifecycle     string                        `json:"lifecycle"`
	Engagement    string                        `json:"engagement"`
	Sentiment     string                        `json:"sentiment"`
	Health        string                        `json:"health"`
	StateReason   string                        `json:"stateReason,omitempty"`
	StateVersion  int                           `json:"stateVersion"`
	StateHash     string                        `json:"stateHash,omitempty"`
	Risks         []string                      `json:"risks"`
	Milestones    []string                      `json:"milestones"`
	NextAction    string                        `json:"nextAction,omitempty"`
	LastTouchAt   *string                       `json:"lastTouchAt,omitempty"`
	LastChangedAt *string                       `json:"lastChangedAt,omitempty"`
	Participants  []relationshipToolParticipant `json:"participants"`
	Commitments   []relationshipToolCommitment  `json:"commitments"`
	Actions       []relationshipToolAction      `json:"recommendations"`
	Attention     []relationshipToolAttention   `json:"attention"`
}

func (t *relationshipReadTool) portfolio(ctx context.Context, limit int) ([]relationshipToolView, error) {
	rows, err := t.client.Relationship.Query().
		Where(relationship.HasUserWith(user.IDEQ(t.ownerID)), relationship.StatusNEQ("archived")).
		WithParticipants().WithCommitments().WithActions().WithAttentionItems().
		Order(ent.Desc(relationship.FieldUpdatedAt)).Limit(limit).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query relationship portfolio: %w", err)
	}
	views := make([]relationshipToolView, 0, len(rows))
	for _, row := range rows {
		view := relationshipToolView{
			ID: row.ID.String(), Kind: row.Kind, DisplayName: row.DisplayName, AccountDomain: row.AccountDomain,
			Summary: row.Summary, Status: row.Status, Lifecycle: row.Lifecycle, Engagement: row.Engagement,
			Sentiment: row.Sentiment, Health: row.Health, StateReason: row.StateReason, StateVersion: row.StateVersion,
			StateHash: row.StateHash, Risks: row.Risks, Milestones: row.Milestones, NextAction: row.NextAction,
			LastTouchAt: optionalRelationshipTime(row.LastTouchAt), LastChangedAt: optionalRelationshipTime(row.LastChangedAt),
			Participants: make([]relationshipToolParticipant, 0, len(row.Edges.Participants)),
			Commitments:  make([]relationshipToolCommitment, 0, len(row.Edges.Commitments)),
			Actions:      make([]relationshipToolAction, 0, len(row.Edges.Actions)),
			Attention:    make([]relationshipToolAttention, 0, len(row.Edges.AttentionItems)),
		}
		for _, participant := range row.Edges.Participants {
			view.Participants = append(view.Participants, relationshipToolParticipant{
				ID: participant.ID.String(), DisplayName: participant.DisplayName, Email: participant.Email,
				Role: participant.Role, Title: participant.Title,
			})
		}
		for _, commitment := range row.Edges.Commitments {
			view.Commitments = append(view.Commitments, relationshipToolCommitment{
				ID: commitment.ID.String(), Text: commitment.Text, Direction: commitment.Direction, Status: commitment.Status,
				DueAt: optionalRelationshipTime(commitment.DueAt), Confidence: commitment.Confidence,
				Confirmed: commitment.UserConfirmed, Acceptance: commitment.Acceptance,
			})
		}
		for _, action := range row.Edges.Actions {
			view.Actions = append(view.Actions, relationshipActionView(action))
		}
		for _, item := range row.Edges.AttentionItems {
			view.Attention = append(view.Attention, relationshipAttentionView(item))
		}
		views = append(views, view)
	}
	return views, nil
}

type relationshipAttentionListView struct {
	RelationshipID   string                    `json:"relationshipId"`
	RelationshipName string                    `json:"relationshipName"`
	Item             relationshipToolAttention `json:"item"`
}

func (t *relationshipReadTool) attention(ctx context.Context, limit int) ([]relationshipAttentionListView, error) {
	rows, err := t.client.RelationshipAttentionItem.Query().
		Where(
			relationshipattentionitem.HasUserWith(user.IDEQ(t.ownerID)),
			relationshipattentionitem.StatusIn("open", "snoozed", "acknowledged"),
		).
		WithRelationship().
		Order(ent.Desc(relationshipattentionitem.FieldRankScore), ent.Desc(relationshipattentionitem.FieldUpdatedAt)).
		Limit(limit).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query relationship attention: %w", err)
	}
	views := make([]relationshipAttentionListView, 0, len(rows))
	for _, item := range rows {
		rel, err := item.Edges.RelationshipOrErr()
		if err != nil {
			continue
		}
		views = append(views, relationshipAttentionListView{
			RelationshipID: rel.ID.String(), RelationshipName: rel.DisplayName, Item: relationshipAttentionView(item),
		})
	}
	return views, nil
}

type relationshipRecommendationListView struct {
	RelationshipID   string                 `json:"relationshipId"`
	RelationshipName string                 `json:"relationshipName"`
	Recommendation   relationshipToolAction `json:"recommendation"`
}

func (t *relationshipReadTool) recommendations(ctx context.Context, limit int) ([]relationshipRecommendationListView, error) {
	rows, err := t.client.RevenueAction.Query().
		Where(revenueaction.HasUserWith(user.IDEQ(t.ownerID)), revenueaction.QueueStatusEQ("open")).
		WithRelationship().Order(ent.Desc(revenueaction.FieldPriorityScore), ent.Desc(revenueaction.FieldUpdatedAt)).
		Limit(limit).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query relationship recommendations: %w", err)
	}
	views := make([]relationshipRecommendationListView, 0, len(rows))
	for _, action := range rows {
		rel, err := action.Edges.RelationshipOrErr()
		if err != nil {
			continue
		}
		views = append(views, relationshipRecommendationListView{
			RelationshipID: rel.ID.String(), RelationshipName: rel.DisplayName, Recommendation: relationshipActionView(action),
		})
	}
	return views, nil
}

type relationshipSourceView struct {
	ID                  string   `json:"id"`
	Source              string   `json:"source"`
	SourceAccountID     string   `json:"sourceAccountId"`
	Status              string   `json:"status"`
	BackfillPhase       string   `json:"backfillPhase"`
	BackfillCompleted   int      `json:"backfillCompleted"`
	BackfillTotal       int      `json:"backfillTotal"`
	Completeness        string   `json:"completeness"`
	LagSeconds          int64    `json:"lagSeconds"`
	MissingScopes       []string `json:"missingScopes"`
	ErrorCode           string   `json:"errorCode,omitempty"`
	RetryCount          int      `json:"retryCount"`
	NextRetryAt         *string  `json:"nextRetryAt,omitempty"`
	LastSuccessAt       *string  `json:"lastSuccessAt,omitempty"`
	LastProviderEventAt *string  `json:"lastProviderEventAt,omitempty"`
}

func (t *relationshipReadTool) sources(ctx context.Context, limit int) ([]relationshipSourceView, error) {
	rows, err := t.client.RelationshipSourceStatus.Query().
		Where(relationshipsourcestatus.HasUserWith(user.IDEQ(t.ownerID))).
		Order(ent.Asc(relationshipsourcestatus.FieldSource), ent.Asc(relationshipsourcestatus.FieldSourceAccountID)).
		Limit(limit).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query relationship sources: %w", err)
	}
	views := make([]relationshipSourceView, 0, len(rows))
	for _, row := range rows {
		views = append(views, relationshipSourceView{
			ID: row.ID.String(), Source: row.Source, SourceAccountID: row.SourceAccountID, Status: row.Status,
			BackfillPhase: row.BackfillPhase, BackfillCompleted: row.BackfillCompleted, BackfillTotal: row.BackfillTotal,
			Completeness: row.Completeness, LagSeconds: row.LagSeconds, MissingScopes: row.MissingScopes,
			ErrorCode: row.ErrorCode, RetryCount: row.RetryCount, NextRetryAt: optionalRelationshipTime(row.NextRetryAt),
			LastSuccessAt: optionalRelationshipTime(row.LastSuccessAt), LastProviderEventAt: optionalRelationshipTime(row.LastProviderEventAt),
		})
	}
	return views, nil
}

func relationshipActionView(action *ent.RevenueAction) relationshipToolAction {
	return relationshipToolAction{
		ID: action.ID.String(), ActionType: action.ActionType, Reason: action.Reason, Priority: action.PriorityScore,
		QueueStatus: action.QueueStatus, PolicyStatus: action.PolicyStatus, ApprovalStatus: action.ApprovalStatus,
		ExecutionStatus: action.ExecutionStatus, Revision: action.Revision, DueAt: optionalRelationshipTime(action.DueAt),
	}
}

func relationshipAttentionView(item *ent.RelationshipAttentionItem) relationshipToolAttention {
	var recommendationID *string
	if item.RecommendationID != nil {
		value := item.RecommendationID.String()
		recommendationID = &value
	}
	return relationshipToolAttention{
		ID: item.ID.String(), ReasonCode: item.ReasonCode, Explanation: item.Explanation,
		TriggeringObjectRef: item.TriggeringObjectRef, EvidenceRefs: item.EvidenceRefs,
		Urgency: item.UrgencyBand, RankScore: item.RankScore, Status: item.Status,
		RecommendationID: recommendationID, RecommendationVersion: item.RecommendationRevision,
	}
}

func optionalRelationshipTime(value *time.Time) *string {
	if value == nil || value.IsZero() {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}
