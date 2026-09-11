package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailthread"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipassertion"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipattentionitem"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueleakscan"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenue"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const relationshipReadMax = 100

// NewRelationshipReadTool exposes a bounded, tenant-scoped, read-only view of
// Oppulence relationship memory. It returns references and projected state,
// never raw encrypted evidence bodies or provider credentials.
func NewRelationshipReadTool(client *ent.Client, ownerID uuid.UUID) Tool {
	return &relationshipReadTool{
		client: client, ownerID: ownerID,
		revenue: revenue.NewService(client, nil, nil, zap.NewNop()),
	}
}

type relationshipReadTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	revenue *revenue.Service
}

func (t *relationshipReadTool) Name() string { return "relationship.read" }
func (t *relationshipReadTool) Description() string {
	return "Read tenant-scoped relationship state, mission control, the relationship graph, timelines, assertions, relationship or person identity reviews, people and person evidence, conversations, notes, tasks, commitments, open-promise reports, attention, recommendations, impact, audits, or connector-source health with evidence references."
}
func (t *relationshipReadTool) AuditInfo(json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierRead, Operation: "relationship.memory.read"}
}
func (t *relationshipReadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"view":{"type":"string","enum":["portfolio","mission_control","graph","timeline","assertions","identity_reviews","person_identity_reviews","people","person","conversations","notes","tasks","commitments","open_promises","attention","recommendations","impact","audits","sources"]},"query":{"type":"string","description":"Optional name, email, organization, domain, subject, note, task, commitment, or recommendation search."},"relationshipId":{"type":"string","format":"uuid","description":"Relationship ID returned by the portfolio view; required by mission_control, timeline, and assertions, optional for identity_reviews, and required for a relationship-scoped graph."},"graphScope":{"type":"string","enum":["portfolio","relationship"],"description":"For graph only; defaults to portfolio, or relationship when relationshipId is supplied."},"depth":{"type":"integer","minimum":1,"maximum":3,"description":"For graph only; defaults to 2."},"asOf":{"type":"string","format":"date-time","description":"Optional RFC3339 historical boundary for graph."},"personId":{"type":"string","format":"uuid","description":"Person ID returned by the people view; required by the person view."},"scanId":{"type":"string","format":"uuid","description":"Completed audit ID required by the open_promises view."},"status":{"type":"string","enum":["pending","deferred","resolving","resolved","undone","all"],"description":"For identity_reviews and person_identity_reviews; defaults to pending."},"source":{"type":"string","maxLength":100,"description":"Optional provider filter for identity_reviews."},"includeDraft":{"type":"boolean","description":"For recommendations only, include the existing stored recipient, subject, and message without creating or sending anything."},"limit":{"type":"integer","minimum":1,"maximum":100}},"required":["view"],"additionalProperties":false}`)
}

func (t *relationshipReadTool) Invoke(ctx context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("relationship reader is not configured")
	}
	if scope.UserID != "" && scope.UserID != t.ownerID.String() {
		return nil, errors.New("relationship reader scope does not match workflow owner")
	}
	var input struct {
		View           string `json:"view"`
		Query          string `json:"query"`
		RelationshipID string `json:"relationshipId"`
		GraphScope     string `json:"graphScope"`
		Depth          int    `json:"depth"`
		AsOf           string `json:"asOf"`
		PersonID       string `json:"personId"`
		ScanID         string `json:"scanId"`
		Status         string `json:"status"`
		Source         string `json:"source"`
		IncludeDraft   bool   `json:"includeDraft"`
		Limit          int    `json:"limit"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode relationship read input: %w", err)
	}
	input.View = strings.ToLower(strings.TrimSpace(input.View))
	if input.Limit <= 0 || input.Limit > relationshipReadMax {
		input.Limit = 50
	}
	reviewStatus := strings.ToLower(strings.TrimSpace(input.Status))
	if input.View == "identity_reviews" || input.View == "person_identity_reviews" {
		if reviewStatus == "" {
			reviewStatus = "pending"
		}
		switch reviewStatus {
		case "pending", "deferred", "resolving", "resolved", "undone", "all":
		default:
			return nil, errors.New("status must be pending, deferred, resolving, resolved, undone, or all for an identity review view")
		}
	}
	internal := auth.WithInternal(ctx)
	if input.View == "tasks" || input.View == "recommendations" {
		owner, err := t.client.User.Get(internal, t.ownerID)
		if err != nil {
			return nil, fmt.Errorf("load relationship reader owner: %w", err)
		}
		if err := t.revenue.ReopenDueSnoozes(auth.WithUser(ctx, owner), owner); err != nil {
			return nil, fmt.Errorf("reopen due task snoozes: %w", err)
		}
	}
	var payload any
	var err error
	switch input.View {
	case "portfolio":
		payload, err = t.portfolio(internal, input.Query, input.Limit)
	case "mission_control":
		relationshipID, parseErr := uuid.Parse(strings.TrimSpace(input.RelationshipID))
		if parseErr != nil {
			return nil, errors.New("relationshipId must be a valid relationship ID for the mission_control view")
		}
		owner, loadErr := t.client.User.Get(internal, t.ownerID)
		if loadErr != nil {
			return nil, fmt.Errorf("load relationship reader owner: %w", loadErr)
		}
		payload, err = t.revenue.MissionControl(auth.WithUser(ctx, owner), owner, relationshipID)
	case "graph":
		filter := revenue.RelationshipGraphFilter{
			Scope: strings.ToLower(strings.TrimSpace(input.GraphScope)), Depth: input.Depth,
		}
		if rawID := strings.TrimSpace(input.RelationshipID); rawID != "" {
			relationshipID, parseErr := uuid.Parse(rawID)
			if parseErr != nil {
				return nil, errors.New("relationshipId must be a valid relationship ID for the graph view")
			}
			filter.RelationshipID = &relationshipID
			if filter.Scope == "" {
				filter.Scope = "relationship"
			}
		}
		if filter.Scope == "" {
			filter.Scope = "portfolio"
		}
		if filter.Scope != "portfolio" && filter.Scope != "relationship" {
			return nil, errors.New("graphScope must be portfolio or relationship for the graph view")
		}
		if filter.Scope == "relationship" && filter.RelationshipID == nil {
			return nil, errors.New("relationshipId is required for a relationship-scoped graph")
		}
		if rawAsOf := strings.TrimSpace(input.AsOf); rawAsOf != "" {
			asOf, parseErr := time.Parse(time.RFC3339, rawAsOf)
			if parseErr != nil {
				return nil, errors.New("asOf must be RFC3339 for the graph view")
			}
			filter.AsOf = asOf
		}
		owner, loadErr := t.client.User.Get(internal, t.ownerID)
		if loadErr != nil {
			return nil, fmt.Errorf("load relationship reader owner: %w", loadErr)
		}
		payload, err = t.revenue.RelationshipGraphPayload(auth.WithUser(ctx, owner), owner, filter)
	case "timeline":
		relationshipID, parseErr := uuid.Parse(strings.TrimSpace(input.RelationshipID))
		if parseErr != nil {
			return nil, errors.New("relationshipId must be a valid relationship ID for the timeline view")
		}
		payload, err = t.timeline(internal, relationshipID, input.Limit)
	case "assertions":
		relationshipID, parseErr := uuid.Parse(strings.TrimSpace(input.RelationshipID))
		if parseErr != nil {
			return nil, errors.New("relationshipId must be a valid relationship ID for the assertions view")
		}
		payload, err = t.assertions(internal, relationshipID, input.Limit)
	case "identity_reviews":
		var relationshipID uuid.UUID
		if raw := strings.TrimSpace(input.RelationshipID); raw != "" {
			var parseErr error
			relationshipID, parseErr = uuid.Parse(raw)
			if parseErr != nil {
				return nil, errors.New("relationshipId must be a valid relationship ID for the identity_reviews view")
			}
		}
		owner, loadErr := t.client.User.Get(internal, t.ownerID)
		if loadErr != nil {
			return nil, fmt.Errorf("load relationship reader owner: %w", loadErr)
		}
		payload, err = t.identityReviews(auth.WithUser(ctx, owner), owner, revenue.IdentityCandidateFilter{
			Status: reviewStatus, Source: strings.TrimSpace(input.Source), RelationshipID: relationshipID, Limit: input.Limit,
		})
	case "person_identity_reviews":
		owner, loadErr := t.client.User.Get(internal, t.ownerID)
		if loadErr != nil {
			return nil, fmt.Errorf("load relationship reader owner: %w", loadErr)
		}
		payload, err = t.personIdentityReviews(auth.WithUser(ctx, owner), owner, reviewStatus, input.Query, input.Limit)
	case "people":
		payload, err = t.people(internal, input.Query, input.Limit)
	case "person":
		personID, parseErr := uuid.Parse(strings.TrimSpace(input.PersonID))
		if parseErr != nil {
			return nil, errors.New("personId must be a valid person ID for the person view")
		}
		owner, loadErr := t.client.User.Get(internal, t.ownerID)
		if loadErr != nil {
			return nil, fmt.Errorf("load relationship reader owner: %w", loadErr)
		}
		payload, err = t.person(auth.WithUser(ctx, owner), owner, personID)
	case "conversations":
		payload, err = t.conversations(internal, input.Query, input.Limit)
	case "notes":
		payload, err = t.notes(internal, input.Query, input.Limit)
	case "tasks":
		payload, err = t.tasks(internal, input.Query, input.Limit)
	case "commitments":
		payload, err = t.commitments(internal, input.Query, input.Limit)
	case "open_promises":
		scanID, parseErr := uuid.Parse(strings.TrimSpace(input.ScanID))
		if parseErr != nil {
			return nil, errors.New("scanId must be a valid completed audit ID for the open_promises view")
		}
		owner, loadErr := t.client.User.Get(internal, t.ownerID)
		if loadErr != nil {
			return nil, fmt.Errorf("load relationship reader owner: %w", loadErr)
		}
		payload, err = t.revenue.OpenPromisesReport(auth.WithUser(ctx, owner), owner, scanID)
	case "attention":
		payload, err = t.attention(internal, input.Query, input.Limit)
	case "recommendations":
		payload, err = t.recommendations(internal, input.Query, input.IncludeDraft, input.Limit)
	case "impact":
		owner, loadErr := t.client.User.Get(internal, t.ownerID)
		if loadErr != nil {
			return nil, fmt.Errorf("load relationship reader owner: %w", loadErr)
		}
		payload, err = t.revenue.Impact(auth.WithUser(ctx, owner), owner)
	case "audits":
		payload, err = t.audits(internal, input.Limit)
	case "sources":
		payload, err = t.sources(internal, input.Limit)
	default:
		return nil, errors.New("view must be portfolio, mission_control, graph, timeline, assertions, identity_reviews, person_identity_reviews, people, person, conversations, notes, tasks, commitments, open_promises, attention, recommendations, impact, audits, or sources")
	}
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{
		"view": input.View, "asOf": time.Now().UTC().Format(time.RFC3339), "data": payload,
	})
}

type relationshipToolTimelineItem struct {
	ID              string         `json:"id"`
	Source          string         `json:"source"`
	SourceAccountID string         `json:"sourceAccountId,omitempty"`
	ExternalID      string         `json:"externalId"`
	SourceVersion   string         `json:"sourceVersion"`
	EventType       string         `json:"eventType"`
	OccurredAt      string         `json:"occurredAt"`
	ReceivedAt      string         `json:"receivedAt"`
	Summary         string         `json:"summary,omitempty"`
	NormalizedFacts map[string]any `json:"normalizedFacts"`
	ContentHash     string         `json:"contentHash"`
	EvidenceRefs    []string       `json:"evidenceRefs"`
}

func (t *relationshipReadTool) timeline(ctx context.Context, id uuid.UUID, limit int) ([]relationshipToolTimelineItem, error) {
	if _, err := t.client.Relationship.Query().Where(
		relationship.IDEQ(id), relationship.HasUserWith(user.IDEQ(t.ownerID)),
	).Only(ctx); ent.IsNotFound(err) {
		return nil, errors.New("relationship timeline not found")
	} else if err != nil {
		return nil, fmt.Errorf("query relationship timeline: %w", err)
	}
	rows, err := t.revenue.RelationshipTimeline(ctx, id, limit)
	if err != nil {
		return nil, err
	}
	items := make([]relationshipToolTimelineItem, 0, len(rows))
	for _, row := range rows {
		facts := map[string]any{}
		_ = json.Unmarshal([]byte(row.NormalizedFactsJSON), &facts)
		items = append(items, relationshipToolTimelineItem{
			ID: row.ID.String(), Source: row.Source, SourceAccountID: row.SourceAccountID,
			ExternalID: row.ExternalID, SourceVersion: row.SourceVersion, EventType: row.EventType,
			OccurredAt: row.OccurredAt.UTC().Format(time.RFC3339), ReceivedAt: row.ReceivedAt.UTC().Format(time.RFC3339),
			Summary: row.Summary, NormalizedFacts: facts, ContentHash: row.ContentHash,
			EvidenceRefs: []string{"relationship-observation:" + row.ID.String()},
		})
	}
	return items, nil
}

type relationshipToolAssertion struct {
	ID                       string   `json:"id"`
	Dimension                string   `json:"dimension"`
	Value                    string   `json:"value"`
	SourceType               string   `json:"sourceType"`
	Status                   string   `json:"status"`
	Confidence               float64  `json:"confidence"`
	Reason                   string   `json:"reason,omitempty"`
	ValidFrom                string   `json:"validFrom"`
	ValidTo                  *string  `json:"validTo,omitempty"`
	RetractionReason         string   `json:"retractionReason,omitempty"`
	SupportingObservationIDs []string `json:"supportingObservationIds"`
	EvidenceRefs             []string `json:"evidenceRefs"`
}

func (t *relationshipReadTool) assertions(ctx context.Context, id uuid.UUID, limit int) ([]relationshipToolAssertion, error) {
	rows, err := t.client.RelationshipAssertion.Query().Where(
		relationshipassertion.HasUserWith(user.IDEQ(t.ownerID)),
		relationshipassertion.HasRelationshipWith(relationship.IDEQ(id)),
	).Order(ent.Desc(relationshipassertion.FieldValidFrom)).Limit(limit).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query relationship assertions: %w", err)
	}
	if len(rows) == 0 {
		if _, err := t.client.Relationship.Query().Where(
			relationship.IDEQ(id), relationship.HasUserWith(user.IDEQ(t.ownerID)),
		).Only(ctx); ent.IsNotFound(err) {
			return nil, errors.New("relationship assertions not found")
		} else if err != nil {
			return nil, fmt.Errorf("query relationship assertions owner: %w", err)
		}
	}
	items := make([]relationshipToolAssertion, 0, len(rows))
	for _, row := range rows {
		refs := []string{"relationship-assertion:" + row.ID.String()}
		for _, observationID := range row.SupportingObservationIds {
			refs = append(refs, "relationship-observation:"+observationID)
		}
		items = append(items, relationshipToolAssertion{
			ID: row.ID.String(), Dimension: row.Dimension, Value: row.Value,
			SourceType: row.SourceType, Status: row.Status, Confidence: row.Confidence,
			Reason: row.Reason, ValidFrom: row.ValidFrom.UTC().Format(time.RFC3339),
			ValidTo: optionalRelationshipTime(row.ValidTo), RetractionReason: row.RetractionReason,
			SupportingObservationIDs: row.SupportingObservationIds, EvidenceRefs: refs,
		})
	}
	return items, nil
}

type relationshipToolIdentityRelationship struct {
	ID            string `json:"id"`
	Kind          string `json:"kind"`
	DisplayName   string `json:"displayName"`
	PrimaryEmail  string `json:"primaryEmail,omitempty"`
	AccountDomain string `json:"accountDomain,omitempty"`
	Status        string `json:"status"`
}

type relationshipToolIdentityReview struct {
	ID                       string                               `json:"id"`
	Status                   string                               `json:"status"`
	CandidateType            string                               `json:"candidateType"`
	Version                  int                                  `json:"version"`
	ProposedRelationship     relationshipToolIdentityRelationship `json:"proposedRelationship"`
	ExistingRelationship     relationshipToolIdentityRelationship `json:"existingRelationship"`
	AnchorKind               string                               `json:"anchorKind"`
	AnchorProvider           string                               `json:"anchorProvider,omitempty"`
	AnchorPreview            string                               `json:"anchorPreview,omitempty"`
	MatchingAnchors          []string                             `json:"matchingAnchors"`
	ConflictingAnchors       []string                             `json:"conflictingAnchors"`
	EvidenceRefs             []string                             `json:"evidenceRefs"`
	EvidenceCount            int                                  `json:"evidenceCount"`
	EvidenceFrom             *string                              `json:"evidenceFrom,omitempty"`
	EvidenceTo               *string                              `json:"evidenceTo,omitempty"`
	Impact                   map[string]any                       `json:"impact"`
	RecommendedDecision      string                               `json:"recommendedDecision"`
	RecommendationConfidence float64                              `json:"recommendationConfidence"`
	Decision                 string                               `json:"decision,omitempty"`
	DecisionReason           string                               `json:"decisionReason,omitempty"`
	DecidedAt                *string                              `json:"decidedAt,omitempty"`
}

func (t *relationshipReadTool) identityReviews(ctx context.Context, owner *ent.User, filter revenue.IdentityCandidateFilter) ([]relationshipToolIdentityReview, error) {
	rows, err := t.revenue.ListIdentityCandidates(ctx, owner, filter)
	if err != nil {
		return nil, fmt.Errorf("query relationship identity reviews: %w", err)
	}
	items := make([]relationshipToolIdentityReview, 0, len(rows))
	for _, row := range rows {
		proposed, proposedErr := row.Edges.ProposedRelationshipOrErr()
		existing, existingErr := row.Edges.ExistingRelationshipOrErr()
		if proposedErr != nil || existingErr != nil {
			continue
		}
		impact := map[string]any{}
		_ = json.Unmarshal([]byte(row.ImpactJSON), &impact)
		items = append(items, relationshipToolIdentityReview{
			ID: row.ID.String(), Status: row.Status, CandidateType: row.CandidateType, Version: row.Version,
			ProposedRelationship: relationshipToolIdentityRelationship{
				ID: proposed.ID.String(), Kind: proposed.Kind, DisplayName: proposed.DisplayName,
				PrimaryEmail: proposed.PrimaryEmail, AccountDomain: proposed.AccountDomain, Status: proposed.Status,
			},
			ExistingRelationship: relationshipToolIdentityRelationship{
				ID: existing.ID.String(), Kind: existing.Kind, DisplayName: existing.DisplayName,
				PrimaryEmail: existing.PrimaryEmail, AccountDomain: existing.AccountDomain, Status: existing.Status,
			},
			AnchorKind: row.AnchorKind, AnchorProvider: row.AnchorProvider, AnchorPreview: row.AnchorPreview,
			MatchingAnchors: row.MatchingAnchors, ConflictingAnchors: row.ConflictingAnchors,
			EvidenceRefs: row.EvidenceRefs, EvidenceCount: row.EvidenceCount,
			EvidenceFrom: optionalRelationshipTime(row.EvidenceFrom), EvidenceTo: optionalRelationshipTime(row.EvidenceTo),
			Impact: impact, RecommendedDecision: row.RecommendedDecision, RecommendationConfidence: row.Confidence,
			Decision: row.Decision, DecisionReason: row.DecisionReason, DecidedAt: optionalRelationshipTime(row.DecidedAt),
		})
	}
	return items, nil
}

type relationshipToolPersonIdentityPerson struct {
	ID               string `json:"id"`
	DisplayName      string `json:"displayName"`
	PrimaryEmail     string `json:"primaryEmail,omitempty"`
	Title            string `json:"title,omitempty"`
	OrgName          string `json:"orgName,omitempty"`
	OrgDomain        string `json:"orgDomain,omitempty"`
	EmploymentStatus string `json:"employmentStatus"`
	Status           string `json:"status"`
}

type relationshipToolPersonIdentityReview struct {
	ID                  string                               `json:"id"`
	Status              string                               `json:"status"`
	CandidateType       string                               `json:"candidateType"`
	Version             int                                  `json:"version"`
	ProposedPerson      relationshipToolPersonIdentityPerson `json:"proposedPerson"`
	ExistingPerson      relationshipToolPersonIdentityPerson `json:"existingPerson"`
	AnchorKind          string                               `json:"anchorKind"`
	AnchorProvider      string                               `json:"anchorProvider,omitempty"`
	AnchorPreview       string                               `json:"anchorPreview,omitempty"`
	MatchingAnchors     []string                             `json:"matchingAnchors"`
	ConflictingAnchors  []string                             `json:"conflictingAnchors"`
	RecommendedDecision string                               `json:"recommendedDecision"`
	Confidence          float64                              `json:"confidence"`
	Decision            string                               `json:"decision,omitempty"`
	DecisionReason      string                               `json:"decisionReason,omitempty"`
	DecidedAt           *string                              `json:"decidedAt,omitempty"`
	CreatedAt           string                               `json:"createdAt"`
}

func (t *relationshipReadTool) personIdentityReviews(ctx context.Context, owner *ent.User, status, query string, limit int) ([]relationshipToolPersonIdentityReview, error) {
	rows, err := t.revenue.ListPersonMergeCandidates(ctx, owner, status)
	if err != nil {
		return nil, fmt.Errorf("query person identity reviews: %w", err)
	}
	term := strings.ToLower(strings.TrimSpace(query))
	items := make([]relationshipToolPersonIdentityReview, 0, min(len(rows), limit))
	for _, row := range rows {
		proposed, proposedErr := row.Edges.ProposedPersonOrErr()
		existing, existingErr := row.Edges.ExistingPersonOrErr()
		if proposedErr != nil || existingErr != nil {
			continue
		}
		if term != "" && !strings.Contains(strings.ToLower(strings.Join([]string{
			proposed.DisplayName, proposed.PrimaryEmail, proposed.OrgName, proposed.OrgDomain,
			existing.DisplayName, existing.PrimaryEmail, existing.OrgName, existing.OrgDomain,
			row.AnchorKind, row.AnchorProvider, row.AnchorPreview,
		}, "\n")), term) {
			continue
		}
		items = append(items, relationshipToolPersonIdentityReview{
			ID: row.ID.String(), Status: row.Status, CandidateType: row.CandidateType, Version: row.Version,
			ProposedPerson: relationshipToolPersonIdentityPerson{
				ID: proposed.ID.String(), DisplayName: proposed.DisplayName, PrimaryEmail: proposed.PrimaryEmail,
				Title: proposed.Title, OrgName: proposed.OrgName, OrgDomain: proposed.OrgDomain,
				EmploymentStatus: proposed.EmploymentStatus, Status: proposed.Status,
			},
			ExistingPerson: relationshipToolPersonIdentityPerson{
				ID: existing.ID.String(), DisplayName: existing.DisplayName, PrimaryEmail: existing.PrimaryEmail,
				Title: existing.Title, OrgName: existing.OrgName, OrgDomain: existing.OrgDomain,
				EmploymentStatus: existing.EmploymentStatus, Status: existing.Status,
			},
			AnchorKind: row.AnchorKind, AnchorProvider: row.AnchorProvider, AnchorPreview: row.AnchorPreview,
			MatchingAnchors: row.MatchingAnchors, ConflictingAnchors: row.ConflictingAnchors,
			RecommendedDecision: row.RecommendedDecision, Confidence: row.Confidence,
			Decision: row.Decision, DecisionReason: row.DecisionReason,
			DecidedAt: optionalRelationshipTime(row.DecidedAt), CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339),
		})
		if len(items) == limit {
			break
		}
	}
	return items, nil
}

type relationshipToolConversation struct {
	ID                string   `json:"id"`
	Provider          string   `json:"provider"`
	ProviderThreadID  string   `json:"providerThreadId"`
	Subject           string   `json:"subject,omitempty"`
	CounterpartyEmail string   `json:"counterpartyEmail,omitempty"`
	AccountDomain     string   `json:"accountDomain,omitempty"`
	ReplyState        string   `json:"replyState"`
	LastDirection     string   `json:"lastDirection,omitempty"`
	LastActivityAt    *string  `json:"lastActivityAt,omitempty"`
	MessageCount      int      `json:"messageCount"`
	InboundCount      int      `json:"inboundCount"`
	OutboundCount     int      `json:"outboundCount"`
	RelationshipID    string   `json:"relationshipId,omitempty"`
	RelationshipName  string   `json:"relationshipName,omitempty"`
	EvidenceRefs      []string `json:"evidenceRefs"`
}

func (t *relationshipReadTool) conversations(ctx context.Context, query string, limit int) ([]relationshipToolConversation, error) {
	q := t.client.MailThread.Query().Where(mailthread.HasUserWith(user.IDEQ(t.ownerID)))
	if term := strings.TrimSpace(query); term != "" {
		q = q.Where(mailthread.Or(
			mailthread.SubjectContainsFold(term),
			mailthread.CounterpartyEmailContainsFold(term),
			mailthread.AccountDomainContainsFold(term),
			mailthread.HasRelationshipWith(relationship.Or(
				relationship.DisplayNameContainsFold(term),
				relationship.AccountDomainContainsFold(term),
				relationship.PrimaryEmailContainsFold(term),
			)),
		))
	}
	rows, err := q.WithRelationship().
		Order(mailthread.ByLastActivityAt(sql.OrderDesc(), sql.OrderNullsLast())).
		Limit(limit).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query relationship conversations: %w", err)
	}
	views := make([]relationshipToolConversation, 0, len(rows))
	for _, row := range rows {
		view := relationshipToolConversation{
			ID: row.ID.String(), Provider: row.Provider, ProviderThreadID: row.ProviderThreadID,
			Subject: row.Subject, CounterpartyEmail: row.CounterpartyEmail, AccountDomain: row.AccountDomain,
			ReplyState: row.ReplyState, LastDirection: row.LastDirection,
			LastActivityAt: optionalRelationshipTime(row.LastActivityAt), MessageCount: row.MessageCount,
			InboundCount: row.InboundCount, OutboundCount: row.OutboundCount,
			EvidenceRefs: []string{row.Provider + ":thread:" + row.ProviderThreadID},
		}
		if rel, err := row.Edges.RelationshipOrErr(); err == nil {
			view.RelationshipID = rel.ID.String()
			view.RelationshipName = rel.DisplayName
		}
		views = append(views, view)
	}
	return views, nil
}

type relationshipToolNote struct {
	NoteID           string   `json:"noteId"`
	Title            string   `json:"title"`
	Body             string   `json:"body,omitempty"`
	RelationshipID   string   `json:"relationshipId"`
	RelationshipName string   `json:"relationshipName"`
	OccurredAt       string   `json:"occurredAt"`
	MeetingLinked    bool     `json:"meetingLinked"`
	LiveLinked       bool     `json:"liveLinked"`
	EvidenceRefs     []string `json:"evidenceRefs"`
}

func (t *relationshipReadTool) notes(ctx context.Context, query string, limit int) ([]relationshipToolNote, error) {
	rows, err := t.client.RelationshipObservation.Query().
		Where(
			relationshipobservation.HasUserWith(user.IDEQ(t.ownerID)),
			relationshipobservation.SourceEQ("desktop_note"),
			relationshipobservation.EventTypeIn("note", "note_deleted"),
		).
		WithRelationship().
		Order(ent.Desc(relationshipobservation.FieldOccurredAt), ent.Desc(relationshipobservation.FieldReceivedAt)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query relationship notes: %w", err)
	}
	term := strings.ToLower(strings.TrimSpace(query))
	seen := make(map[string]struct{}, len(rows))
	views := make([]relationshipToolNote, 0, min(limit, len(rows)))
	for _, row := range rows {
		facts := map[string]any{}
		_ = json.Unmarshal([]byte(row.NormalizedFactsJSON), &facts)
		noteID, _ := facts["noteId"].(string)
		if noteID == "" {
			noteID = row.ExternalID
		}
		if _, ok := seen[noteID]; ok {
			continue
		}
		seen[noteID] = struct{}{}
		if row.EventType == "note_deleted" {
			continue
		}
		rel, err := row.Edges.RelationshipOrErr()
		if err != nil {
			continue
		}
		title, _ := facts["title"].(string)
		if title == "" {
			title = row.Summary
		}
		body, _ := facts["body"].(string)
		if term != "" && !strings.Contains(strings.ToLower(title+"\n"+body+"\n"+rel.DisplayName), term) {
			continue
		}
		meetingLinked, _ := facts["meetingLinked"].(bool)
		liveLinked, _ := facts["liveLinked"].(bool)
		views = append(views, relationshipToolNote{
			NoteID: noteID, Title: title, Body: body,
			RelationshipID: rel.ID.String(), RelationshipName: rel.DisplayName,
			OccurredAt:    row.OccurredAt.UTC().Format(time.RFC3339),
			MeetingLinked: meetingLinked, LiveLinked: liveLinked,
			EvidenceRefs: []string{"relationship-observation:" + row.ID.String()},
		})
		if len(views) == limit {
			break
		}
	}
	return views, nil
}

type relationshipToolTask struct {
	ID               string  `json:"id"`
	Title            string  `json:"title"`
	RelationshipID   string  `json:"relationshipId"`
	RelationshipName string  `json:"relationshipName"`
	DueAt            *string `json:"dueAt,omitempty"`
	Priority         int     `json:"priority"`
}

func (t *relationshipReadTool) tasks(ctx context.Context, query string, limit int) ([]relationshipToolTask, error) {
	q := t.client.RevenueAction.Query().Where(
		revenueaction.HasUserWith(user.IDEQ(t.ownerID)),
		revenueaction.ActionTypeEQ("follow_up_task"),
		revenueaction.ChannelEQ("task"),
		revenueaction.QueueStatusEQ("open"),
	)
	if term := strings.TrimSpace(query); term != "" {
		q = q.Where(revenueaction.Or(
			revenueaction.ReasonContainsFold(term),
			revenueaction.HasRelationshipWith(relationship.DisplayNameContainsFold(term)),
		))
	}
	rows, err := q.WithRelationship().
		Order(revenueaction.ByDueAt(sql.OrderAsc(), sql.OrderNullsLast()), ent.Desc(revenueaction.FieldPriorityScore)).
		Limit(limit).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query relationship tasks: %w", err)
	}
	views := make([]relationshipToolTask, 0, len(rows))
	for _, row := range rows {
		rel, err := row.Edges.RelationshipOrErr()
		if err != nil {
			continue
		}
		views = append(views, relationshipToolTask{
			ID: row.ID.String(), Title: row.Reason,
			RelationshipID: rel.ID.String(), RelationshipName: rel.DisplayName,
			DueAt: optionalRelationshipTime(row.DueAt), Priority: row.PriorityScore,
		})
	}
	return views, nil
}

type relationshipToolPersonAccount struct {
	RelationshipID   string `json:"relationshipId"`
	RelationshipName string `json:"relationshipName"`
	Role             string `json:"role"`
	Title            string `json:"title,omitempty"`
	Active           bool   `json:"active"`
}

type relationshipToolPerson struct {
	ID                string                          `json:"id"`
	DisplayName       string                          `json:"displayName"`
	Aliases           []string                        `json:"aliases"`
	PrimaryEmail      string                          `json:"primaryEmail,omitempty"`
	Title             string                          `json:"title,omitempty"`
	OrgName           string                          `json:"orgName,omitempty"`
	OrgDomain         string                          `json:"orgDomain,omitempty"`
	Department        string                          `json:"department,omitempty"`
	Seniority         string                          `json:"seniority,omitempty"`
	Location          string                          `json:"location,omitempty"`
	LinkedInURL       string                          `json:"linkedinUrl,omitempty"`
	EmploymentStatus  string                          `json:"employmentStatus"`
	RelationshipCount int                             `json:"relationshipCount"`
	LastInteractionAt *string                         `json:"lastInteractionAt,omitempty"`
	Accounts          []relationshipToolPersonAccount `json:"accounts"`
}

func (t *relationshipReadTool) people(ctx context.Context, query string, limit int) ([]relationshipToolPerson, error) {
	q := t.client.Person.Query().
		Where(person.HasUserWith(user.IDEQ(t.ownerID)), person.StatusEQ("active"))
	if term := strings.TrimSpace(query); term != "" {
		q = q.Where(person.Or(
			person.DisplayNameContainsFold(term),
			person.PrimaryEmailContainsFold(term),
			person.OrgNameContainsFold(term),
			person.OrgDomainContainsFold(term),
		))
	}
	rows, err := q.WithParticipants(func(q *ent.RelationshipParticipantQuery) { q.WithRelationship() }).
		Order(person.ByLastInteractionAt(sql.OrderDesc(), sql.OrderNullsLast()), person.ByDisplayName()).
		Limit(limit).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query relationship people: %w", err)
	}
	views := make([]relationshipToolPerson, 0, len(rows))
	for _, row := range rows {
		views = append(views, relationshipPersonView(row))
	}
	return views, nil
}

func relationshipPersonView(row *ent.Person) relationshipToolPerson {
	view := relationshipToolPerson{
		ID: row.ID.String(), DisplayName: row.DisplayName, Aliases: row.Aliases, PrimaryEmail: row.PrimaryEmail,
		Title: row.Title, OrgName: row.OrgName, OrgDomain: row.OrgDomain, Department: row.Department,
		Seniority: row.Seniority, Location: row.Location, LinkedInURL: row.LinkedinURL,
		EmploymentStatus: row.EmploymentStatus, RelationshipCount: row.RelationshipCount,
		LastInteractionAt: optionalRelationshipTime(row.LastInteractionAt),
		Accounts:          make([]relationshipToolPersonAccount, 0, len(row.Edges.Participants)),
	}
	for _, participant := range row.Edges.Participants {
		rel, err := participant.Edges.RelationshipOrErr()
		if err != nil || rel.Status == "archived" {
			continue
		}
		view.Accounts = append(view.Accounts, relationshipToolPersonAccount{
			RelationshipID: rel.ID.String(), RelationshipName: rel.DisplayName,
			Role: participant.Role, Title: participant.Title, Active: participant.Active,
		})
	}
	return view
}

type relationshipToolPersonAttribute struct {
	ID           string          `json:"id"`
	Dimension    string          `json:"dimension"`
	Value        string          `json:"value"`
	SourceType   string          `json:"sourceType"`
	Source       string          `json:"source"`
	Extractor    string          `json:"extractor"`
	Status       string          `json:"status"`
	Confidence   float64         `json:"confidence"`
	Reason       string          `json:"reason,omitempty"`
	ObservedAt   string          `json:"observedAt"`
	Citations    json.RawMessage `json:"citations,omitempty"`
	EvidenceRefs []string        `json:"evidenceRefs"`
}

type relationshipToolPersonInteraction struct {
	RelationshipID   string         `json:"relationshipId"`
	RelationshipName string         `json:"relationshipName"`
	FirstAt          string         `json:"firstAt"`
	LastAt           string         `json:"lastAt"`
	Count            int            `json:"count"`
	InboundCount     int            `json:"inboundCount"`
	OutboundCount    int            `json:"outboundCount"`
	MeetingCount     int            `json:"meetingCount"`
	ChannelCounts    map[string]int `json:"channelCounts"`
	LastChannel      string         `json:"lastChannel,omitempty"`
	LastDirection    string         `json:"lastDirection,omitempty"`
}

type relationshipToolPersonDetail struct {
	Person       relationshipToolPerson              `json:"person"`
	Attributes   []relationshipToolPersonAttribute   `json:"attributes"`
	Interactions []relationshipToolPersonInteraction `json:"interactions"`
}

func (t *relationshipReadTool) person(ctx context.Context, owner *ent.User, id uuid.UUID) (relationshipToolPersonDetail, error) {
	p, err := t.revenue.GetPerson(ctx, owner, id)
	if err != nil {
		return relationshipToolPersonDetail{}, err
	}
	p, err = t.client.Person.Query().Where(person.IDEQ(p.ID), person.HasUserWith(user.IDEQ(t.ownerID))).
		WithParticipants(func(q *ent.RelationshipParticipantQuery) { q.WithRelationship() }).Only(ctx)
	if err != nil {
		return relationshipToolPersonDetail{}, fmt.Errorf("query relationship person: %w", err)
	}
	attributes, err := t.revenue.PersonAttributes(ctx, owner, p.ID)
	if err != nil {
		return relationshipToolPersonDetail{}, err
	}
	interactions, err := t.revenue.PersonInteractions(ctx, owner, p.ID)
	if err != nil {
		return relationshipToolPersonDetail{}, err
	}
	detail := relationshipToolPersonDetail{
		Person: relationshipPersonView(p), Attributes: make([]relationshipToolPersonAttribute, 0, len(attributes)),
		Interactions: make([]relationshipToolPersonInteraction, 0, len(interactions)),
	}
	for _, attribute := range attributes {
		refs := []string{"person-attribute:" + attribute.ID.String()}
		for _, observationID := range attribute.SupportingObservationIds {
			refs = append(refs, "relationship-observation:"+observationID)
		}
		view := relationshipToolPersonAttribute{
			ID: attribute.ID.String(), Dimension: attribute.Dimension, Value: attribute.Value,
			SourceType: attribute.SourceType, Source: attribute.Source, Extractor: attribute.Extractor,
			Status: attribute.Status, Confidence: attribute.Confidence, Reason: attribute.Reason,
			ObservedAt: attribute.ObservedAt.UTC().Format(time.RFC3339), EvidenceRefs: refs,
		}
		if json.Valid([]byte(attribute.CitationsJSON)) {
			view.Citations = json.RawMessage(attribute.CitationsJSON)
		}
		detail.Attributes = append(detail.Attributes, view)
	}
	for _, interaction := range interactions {
		rel, edgeErr := interaction.Edges.RelationshipOrErr()
		if edgeErr != nil {
			continue
		}
		detail.Interactions = append(detail.Interactions, relationshipToolPersonInteraction{
			RelationshipID: rel.ID.String(), RelationshipName: rel.DisplayName,
			FirstAt: interaction.FirstInteractionAt.UTC().Format(time.RFC3339),
			LastAt:  interaction.LastInteractionAt.UTC().Format(time.RFC3339),
			Count:   interaction.InteractionCount, InboundCount: interaction.InboundCount,
			OutboundCount: interaction.OutboundCount, MeetingCount: interaction.MeetingCount,
			ChannelCounts: interaction.ChannelCounts, LastChannel: interaction.LastChannel,
			LastDirection: interaction.LastDirection,
		})
	}
	return detail, nil
}

type relationshipToolParticipant struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email,omitempty"`
	Role        string `json:"role"`
	Title       string `json:"title,omitempty"`
}

type relationshipToolCommitment struct {
	ID           string   `json:"id"`
	Text         string   `json:"text"`
	Direction    string   `json:"direction"`
	Status       string   `json:"status"`
	Owner        string   `json:"owner,omitempty"`
	Counterparty string   `json:"counterparty,omitempty"`
	DueAt        *string  `json:"dueAt,omitempty"`
	Confidence   float64  `json:"confidence"`
	Confirmed    bool     `json:"confirmed"`
	Acceptance   string   `json:"acceptance"`
	EvidenceRefs []string `json:"evidenceRefs"`
}

type relationshipToolAction struct {
	ID              string  `json:"id"`
	ActionType      string  `json:"actionType"`
	Channel         string  `json:"channel"`
	Detector        string  `json:"detector"`
	Reason          string  `json:"reason"`
	Priority        int     `json:"priority"`
	QueueStatus     string  `json:"queueStatus"`
	PolicyStatus    string  `json:"policyStatus"`
	ApprovalStatus  string  `json:"approvalStatus"`
	ExecutionStatus string  `json:"executionStatus"`
	DraftReady      bool    `json:"draftReady"`
	RecipientEmail  string  `json:"recipientEmail,omitempty"`
	ProposedSubject string  `json:"proposedSubject,omitempty"`
	ProposedMessage string  `json:"proposedMessage,omitempty"`
	Revision        int     `json:"revision"`
	DueAt           *string `json:"dueAt,omitempty"`
}

type relationshipToolAttention struct {
	ID                    string   `json:"id"`
	Version               int      `json:"version"`
	ReasonCode            string   `json:"reasonCode"`
	Explanation           string   `json:"explanation"`
	TriggeringObjectRef   string   `json:"triggeringObjectRef"`
	EvidenceRefs          []string `json:"evidenceRefs"`
	Urgency               string   `json:"urgency"`
	RankScore             int      `json:"rankScore"`
	Status                string   `json:"status"`
	StateReason           string   `json:"stateReason,omitempty"`
	SnoozedUntil          *string  `json:"snoozedUntil,omitempty"`
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

func (t *relationshipReadTool) portfolio(ctx context.Context, query string, limit int) ([]relationshipToolView, error) {
	q := t.client.Relationship.Query().
		Where(relationship.HasUserWith(user.IDEQ(t.ownerID)), relationship.StatusNEQ("archived"))
	if term := strings.TrimSpace(query); term != "" {
		q = q.Where(relationship.Or(
			relationship.DisplayNameContainsFold(term),
			relationship.AccountDomainContainsFold(term),
			relationship.PrimaryEmailContainsFold(term),
		))
	}
	rows, err := q.
		WithParticipants().WithCommitments(func(q *ent.CommitmentQuery) { q.WithEvidences() }).WithActions().WithAttentionItems().
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
			view.Commitments = append(view.Commitments, relationshipCommitmentView(commitment))
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

type relationshipCommitmentListView struct {
	RelationshipID   string                     `json:"relationshipId"`
	RelationshipName string                     `json:"relationshipName"`
	Commitment       relationshipToolCommitment `json:"commitment"`
}

func (t *relationshipReadTool) commitments(ctx context.Context, query string, limit int) ([]relationshipCommitmentListView, error) {
	q := t.client.Commitment.Query().
		Where(
			commitment.HasUserWith(user.IDEQ(t.ownerID)),
			commitment.AcceptanceNEQ("candidate"),
			commitment.HasRelationshipWith(relationship.StatusNEQ("archived")),
		)
	if term := strings.TrimSpace(query); term != "" {
		q = q.Where(commitment.Or(
			commitment.TextContainsFold(term),
			commitment.OwnerParticipantRefContainsFold(term),
			commitment.CounterpartyParticipantRefContainsFold(term),
			commitment.HasRelationshipWith(relationship.Or(
				relationship.DisplayNameContainsFold(term),
				relationship.AccountDomainContainsFold(term),
				relationship.PrimaryEmailContainsFold(term),
			)),
		))
	}
	rows, err := q.
		WithRelationship().WithEvidences().
		Order(ent.Asc(commitment.FieldDueAt), ent.Desc(commitment.FieldCreatedAt)).
		Limit(limit).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query relationship commitments: %w", err)
	}
	views := make([]relationshipCommitmentListView, 0, len(rows))
	for _, row := range rows {
		rel, err := row.Edges.RelationshipOrErr()
		if err != nil {
			continue
		}
		views = append(views, relationshipCommitmentListView{
			RelationshipID: rel.ID.String(), RelationshipName: rel.DisplayName,
			Commitment: relationshipCommitmentView(row),
		})
	}
	return views, nil
}

func relationshipCommitmentView(row *ent.Commitment) relationshipToolCommitment {
	evidenceRefs := make([]string, 0, len(row.Edges.Evidences))
	for _, evidence := range row.Edges.Evidences {
		evidenceRefs = append(evidenceRefs, "revenue-evidence:"+evidence.ID.String())
	}
	return relationshipToolCommitment{
		ID: row.ID.String(), Text: row.Text, Direction: row.Direction, Status: row.Status,
		Owner: row.OwnerParticipantRef, Counterparty: row.CounterpartyParticipantRef,
		DueAt: optionalRelationshipTime(row.DueAt), Confidence: row.Confidence,
		Confirmed: row.UserConfirmed, Acceptance: row.Acceptance, EvidenceRefs: evidenceRefs,
	}
}

type relationshipAttentionListView struct {
	RelationshipID   string                    `json:"relationshipId"`
	RelationshipName string                    `json:"relationshipName"`
	Item             relationshipToolAttention `json:"item"`
}

func (t *relationshipReadTool) attention(ctx context.Context, query string, limit int) ([]relationshipAttentionListView, error) {
	q := t.client.RelationshipAttentionItem.Query().
		Where(
			relationshipattentionitem.HasUserWith(user.IDEQ(t.ownerID)),
			relationshipattentionitem.StatusIn("open", "snoozed", "acknowledged"),
		)
	if term := strings.TrimSpace(query); term != "" {
		q = q.Where(relationshipattentionitem.Or(
			relationshipattentionitem.ExplanationContainsFold(term),
			relationshipattentionitem.ReasonCodeContainsFold(term),
			relationshipattentionitem.HasRelationshipWith(relationship.Or(
				relationship.DisplayNameContainsFold(term),
				relationship.AccountDomainContainsFold(term),
				relationship.PrimaryEmailContainsFold(term),
			)),
		))
	}
	rows, err := q.
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

func (t *relationshipReadTool) recommendations(ctx context.Context, query string, includeDraft bool, limit int) ([]relationshipRecommendationListView, error) {
	q := t.client.RevenueAction.Query().
		Where(revenueaction.HasUserWith(user.IDEQ(t.ownerID)), revenueaction.QueueStatusEQ("open"))
	if term := strings.TrimSpace(query); term != "" {
		q = q.Where(revenueaction.Or(
			revenueaction.ReasonContainsFold(term),
			revenueaction.ActionTypeContainsFold(term),
			revenueaction.HasRelationshipWith(relationship.Or(
				relationship.DisplayNameContainsFold(term),
				relationship.AccountDomainContainsFold(term),
				relationship.PrimaryEmailContainsFold(term),
			)),
		))
	}
	rows, err := q.
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
		recommendation := relationshipActionView(action)
		if includeDraft {
			recommendation.RecipientEmail = action.RecipientEmail
			recommendation.ProposedSubject = action.ProposedSubject
			recommendation.ProposedMessage = action.ProposedMessage
		}
		views = append(views, relationshipRecommendationListView{
			RelationshipID: rel.ID.String(), RelationshipName: rel.DisplayName, Recommendation: recommendation,
		})
	}
	return views, nil
}

type relationshipAuditView struct {
	ID                   string  `json:"id"`
	Status               string  `json:"status"`
	Mode                 string  `json:"mode"`
	LookbackDays         int     `json:"lookbackDays"`
	ThreadsSeen          int     `json:"threadsSeen"`
	CandidatesSeen       int     `json:"candidatesSeen"`
	RelationshipsCreated int     `json:"relationshipsCreated"`
	EvidencesCreated     int     `json:"evidencesCreated"`
	ActionsCreated       int     `json:"actionsCreated"`
	CommitmentsCreated   int     `json:"commitmentsCreated"`
	Error                string  `json:"error,omitempty"`
	StartedAt            *string `json:"startedAt,omitempty"`
	CompletedAt          *string `json:"completedAt,omitempty"`
	SourceFreshnessAt    *string `json:"sourceFreshnessAt,omitempty"`
}

func (t *relationshipReadTool) audits(ctx context.Context, limit int) ([]relationshipAuditView, error) {
	rows, err := t.client.RevenueLeakScan.Query().
		Where(revenueleakscan.HasUserWith(user.IDEQ(t.ownerID))).
		Order(ent.Desc(revenueleakscan.FieldCreatedAt)).Limit(limit).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query relationship audits: %w", err)
	}
	views := make([]relationshipAuditView, 0, len(rows))
	for _, row := range rows {
		views = append(views, relationshipAuditView{
			ID: row.ID.String(), Status: row.Status, Mode: row.Mode, LookbackDays: row.LookbackDays,
			ThreadsSeen: row.ThreadsSeen, CandidatesSeen: row.CandidatesSeen,
			RelationshipsCreated: row.RelationshipsCreated, EvidencesCreated: row.EvidencesCreated,
			ActionsCreated: row.ActionsCreated, CommitmentsCreated: row.CommitmentsCreated, Error: revenue.UserSafeScanError(row.Error),
			StartedAt: optionalRelationshipTime(row.StartedAt), CompletedAt: optionalRelationshipTime(row.CompletedAt),
			SourceFreshnessAt: optionalRelationshipTime(row.SourceFreshnessAt),
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
	owner, err := t.client.User.Get(ctx, t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("load relationship reader owner: %w", err)
	}
	rows, err := t.revenue.RelationshipSourceStatuses(auth.WithUser(ctx, owner), owner)
	if err != nil {
		return nil, fmt.Errorf("query relationship sources: %w", err)
	}
	if len(rows) > limit {
		rows = rows[:limit]
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
		ID: action.ID.String(), ActionType: action.ActionType, Channel: action.Channel, Detector: action.Detector,
		Reason: action.Reason, Priority: action.PriorityScore,
		QueueStatus: action.QueueStatus, PolicyStatus: action.PolicyStatus, ApprovalStatus: action.ApprovalStatus,
		ExecutionStatus: action.ExecutionStatus,
		DraftReady:      strings.TrimSpace(action.RecipientEmail) != "" && strings.TrimSpace(action.ProposedSubject) != "" && strings.TrimSpace(action.ProposedMessage) != "",
		Revision:        action.Revision, DueAt: optionalRelationshipTime(action.DueAt),
	}
}

func relationshipAttentionView(item *ent.RelationshipAttentionItem) relationshipToolAttention {
	var recommendationID *string
	if item.RecommendationID != nil {
		value := item.RecommendationID.String()
		recommendationID = &value
	}
	return relationshipToolAttention{
		ID: item.ID.String(), Version: item.Version, ReasonCode: item.ReasonCode, Explanation: item.Explanation,
		TriggeringObjectRef: item.TriggeringObjectRef, EvidenceRefs: item.EvidenceRefs,
		Urgency: item.UrgencyBand, RankScore: item.RankScore, Status: item.Status,
		StateReason: item.StateReason, SnoozedUntil: optionalRelationshipTime(item.SnoozedUntil),
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
