package revenue

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/conversationintelligenceartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueevidence"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
)

// MutualActionPlanItem is one evidence-backed, dependency-aware plan step.
type MutualActionPlanItem struct {
	ItemID              string   `json:"itemId"`
	CommitmentID        string   `json:"commitmentId,omitempty"`
	MilestoneRef        string   `json:"milestoneRef,omitempty"`
	Title               string   `json:"title"`
	OwnerParticipantRef string   `json:"ownerParticipantRef"`
	DependencyItemIDs   []string `json:"dependencyItemIds"`
	DueAt               string   `json:"dueAt,omitempty"`
	Status              string   `json:"status"`
	EvidenceRefs        []string `json:"evidenceRefs"`
}

// MutualActionPlanRevision binds an immutable item set to a content hash.
type MutualActionPlanRevision struct {
	RevisionID   string                 `json:"revisionId"`
	PlanID       string                 `json:"planId"`
	Version      int                    `json:"version"`
	RevisionHash string                 `json:"revisionHash"`
	CreatedAt    string                 `json:"createdAt"`
	CreatedBy    string                 `json:"createdBy"`
	Items        []MutualActionPlanItem `json:"items"`
}

// MutualActionPlan is an internally approved, optionally shared plan projection.
type MutualActionPlan struct {
	PlanID                string                   `json:"planId"`
	RelationshipID        string                   `json:"relationshipId"`
	InternalOwnerRef      string                   `json:"internalOwnerRef"`
	CounterpartyRef       string                   `json:"counterpartyRef"`
	Status                string                   `json:"status"`
	CurrentRevision       MutualActionPlanRevision `json:"currentRevision"`
	SharePolicyDecisionID string                   `json:"sharePolicyDecisionId,omitempty"`
	TokenState            string                   `json:"tokenState"`
}

type mutualActionPlanRecord struct {
	MutualActionPlan
	TokenHash      string `json:"tokenHash,omitempty"`
	TokenExpiresAt string `json:"tokenExpiresAt,omitempty"`
}

func appendMutualActionPlanArtifacts(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	inputs ...conversationArtifactInput,
) error {
	tx, err := client.Tx(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	txc := tx.Client()
	txws, err := txc.RevenueWorkspace.Get(ctx, ws.ID)
	if err != nil {
		return err
	}
	txu, err := txc.User.Get(ctx, u.ID)
	if err != nil {
		return err
	}
	txrel, err := txc.Relationship.Get(ctx, rel.ID)
	if err != nil {
		return err
	}
	for _, input := range inputs {
		if _, err := appendConversationArtifact(ctx, txc, txws, txu, txrel, input); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func planRevisionHash(items []MutualActionPlanItem) (string, error) {
	payload, err := json.Marshal(items)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func validatePlanItems(items []MutualActionPlanItem) error {
	if len(items) == 0 {
		return fmt.Errorf("%w: plan requires at least one evidence-backed item", ErrInvalidInput)
	}
	byID := map[string]MutualActionPlanItem{}
	for _, item := range items {
		if strings.TrimSpace(item.ItemID) == "" || strings.TrimSpace(item.Title) == "" ||
			strings.TrimSpace(item.OwnerParticipantRef) == "" || len(item.EvidenceRefs) == 0 {
			return fmt.Errorf("%w: plan items require id, title, owner, and evidence", ErrInvalidInput)
		}
		if byID[item.ItemID].ItemID != "" {
			return fmt.Errorf("%w: duplicate plan item id", ErrInvalidInput)
		}
		byID[item.ItemID] = item
	}
	visiting, visited := map[string]bool{}, map[string]bool{}
	var visit func(string) error
	visit = func(id string) error {
		if visiting[id] {
			return fmt.Errorf("%w: plan dependency cycle", ErrInvalidInput)
		}
		if visited[id] {
			return nil
		}
		visiting[id] = true
		for _, dependency := range byID[id].DependencyItemIDs {
			if byID[dependency].ItemID == "" || dependency == id {
				return fmt.Errorf("%w: invalid plan dependency", ErrInvalidInput)
			}
			if err := visit(dependency); err != nil {
				return err
			}
		}
		visiting[id], visited[id] = false, true
		return nil
	}
	for id := range byID {
		if err := visit(id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) planRecordFor(
	ctx context.Context,
	relationshipID uuid.UUID,
	planID string,
) (*ent.ConversationIntelligenceArtifact, mutualActionPlanRecord, error) {
	row, err := s.client.ConversationIntelligenceArtifact.Query().Where(
		conversationintelligenceartifact.KindEQ("mutual_action_plan"),
		conversationintelligenceartifact.StableIDEQ(planID),
		conversationintelligenceartifact.HasRelationshipWith(relationship.IDEQ(relationshipID)),
	).Order(ent.Desc(conversationintelligenceartifact.FieldVersion)).First(ctx)
	if ent.IsNotFound(err) {
		return nil, mutualActionPlanRecord{}, ErrNotFound
	}
	if err != nil {
		return nil, mutualActionPlanRecord{}, err
	}
	var record mutualActionPlanRecord
	if err := json.Unmarshal([]byte(row.PayloadJSON), &record); err != nil {
		return nil, mutualActionPlanRecord{}, err
	}
	return row, record, nil
}

// CreateMutualActionPlan creates a draft from accepted, evidence-backed commitments.
func (s *Service) CreateMutualActionPlan(
	ctx context.Context,
	u *ent.User,
	relationshipID uuid.UUID,
	commitmentIDs []uuid.UUID,
) (MutualActionPlan, error) {
	if len(commitmentIDs) == 0 {
		return MutualActionPlan{}, fmt.Errorf("%w: accepted commitment ids are required", ErrInvalidInput)
	}
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return MutualActionPlan{}, err
	}
	rel, err := s.GetRelationship(ctx, relationshipID)
	if err != nil {
		return MutualActionPlan{}, err
	}
	rows, err := s.client.Commitment.Query().Where(
		commitment.IDIn(commitmentIDs...), commitment.HasRelationshipWith(relationship.IDEQ(rel.ID)),
		commitment.AcceptanceEQ("accepted"), commitment.StatusEQ("open"),
	).WithEvidences().All(ctx)
	if err != nil {
		return MutualActionPlan{}, err
	}
	if len(rows) != len(commitmentIDs) {
		return MutualActionPlan{}, fmt.Errorf("%w: plans may contain only accepted open commitments", ErrInvalidInput)
	}
	planID := "plan:" + uuid.NewString()
	items := make([]MutualActionPlanItem, 0, len(rows))
	for _, row := range rows {
		refs := []string{}
		for _, evidence := range row.Edges.Evidences {
			refs = append(refs, "revenue-evidence:"+evidence.ID.String())
		}
		item := MutualActionPlanItem{
			ItemID: "item:" + row.ID.String(), CommitmentID: row.ID.String(), Title: row.Text,
			OwnerParticipantRef: row.OwnerParticipantRef, DependencyItemIDs: []string{},
			Status: "open", EvidenceRefs: refs,
		}
		if row.DueAt != nil {
			item.DueAt = row.DueAt.UTC().Format(time.RFC3339)
		}
		items = append(items, item)
	}
	if err := validatePlanItems(items); err != nil {
		return MutualActionPlan{}, err
	}
	hash, _ := planRevisionHash(items)
	now := s.now().UTC()
	revision := MutualActionPlanRevision{
		RevisionID: "revision:" + uuid.NewString(), PlanID: planID, Version: 1,
		RevisionHash: hash, CreatedAt: now.Format(time.RFC3339), CreatedBy: u.ID.String(), Items: items,
	}
	plan := MutualActionPlan{
		PlanID: planID, RelationshipID: rel.ID.String(), InternalOwnerRef: u.ID.String(),
		CounterpartyRef: rows[0].CounterpartyParticipantRef, Status: "draft",
		CurrentRevision: revision, TokenState: "not_issued",
	}
	refs := []string{}
	for _, item := range items {
		refs = append(refs, item.EvidenceRefs...)
	}
	returnPlanRevision := conversationArtifactInput{
		Kind: "mutual_action_plan_revision", StableID: revision.RevisionID, Status: "draft",
		SubjectRef: planID, EffectiveAt: now, EvidenceRefs: refs, Payload: revision,
	}
	returnPlanRecord := conversationArtifactInput{
		Kind: "mutual_action_plan", StableID: planID, Status: "draft",
		SubjectRef: rel.ID.String(), EffectiveAt: now, EvidenceRefs: refs,
		Payload: mutualActionPlanRecord{MutualActionPlan: plan},
	}
	if err := appendMutualActionPlanArtifacts(ctx, s.client, ws, u, rel, returnPlanRevision, returnPlanRecord); err != nil {
		return MutualActionPlan{}, err
	}
	return plan, nil
}

// ReviseMutualActionPlan appends a replacement revision and invalidates prior approval.
func (s *Service) ReviseMutualActionPlan(
	ctx context.Context,
	u *ent.User,
	relationshipID uuid.UUID,
	planID string,
	items []MutualActionPlanItem,
) (MutualActionPlan, error) {
	if err := validatePlanItems(items); err != nil {
		return MutualActionPlan{}, err
	}
	currentRow, record, err := s.planRecordFor(ctx, relationshipID, planID)
	if err != nil {
		return MutualActionPlan{}, err
	}
	if record.Status == "completed" || record.Status == "cancelled" {
		return MutualActionPlan{}, fmt.Errorf("%w: terminal plan cannot be revised", ErrInvalidInput)
	}
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return MutualActionPlan{}, err
	}
	rel, err := s.GetRelationship(ctx, relationshipID)
	if err != nil {
		return MutualActionPlan{}, err
	}
	now := s.now().UTC()
	hash, _ := planRevisionHash(items)
	revision := MutualActionPlanRevision{
		RevisionID: "revision:" + uuid.NewString(), PlanID: planID,
		Version: record.CurrentRevision.Version + 1, RevisionHash: hash,
		CreatedAt: now.Format(time.RFC3339), CreatedBy: u.ID.String(), Items: items,
	}
	record.CurrentRevision = revision
	record.Status = "revised"
	record.TokenState = "not_issued"
	record.TokenHash, record.TokenExpiresAt = "", ""
	refs := []string{}
	for _, item := range items {
		refs = append(refs, item.EvidenceRefs...)
	}
	revisionArtifact := conversationArtifactInput{
		Kind: "mutual_action_plan_revision", StableID: revision.RevisionID,
		Status: "revised", SubjectRef: planID, EffectiveAt: now, EvidenceRefs: refs, Payload: revision,
	}
	planArtifact := conversationArtifactInput{
		Kind: "mutual_action_plan", StableID: planID, Version: currentRow.Version + 1,
		Status: "revised", SubjectRef: relationshipID.String(), EffectiveAt: now,
		EvidenceRefs: refs, Payload: record,
	}
	if err := appendMutualActionPlanArtifacts(ctx, s.client, ws, u, rel, revisionArtifact, planArtifact); err != nil {
		return MutualActionPlan{}, err
	}
	return record.MutualActionPlan, nil
}

// ApproveMutualActionPlan binds internal approval to the exact current revision.
func (s *Service) ApproveMutualActionPlan(
	ctx context.Context,
	u *ent.User,
	relationshipID uuid.UUID,
	planID string,
) (MutualActionPlan, error) {
	currentRow, record, err := s.planRecordFor(ctx, relationshipID, planID)
	if err != nil {
		return MutualActionPlan{}, err
	}
	if record.Status != "draft" && record.Status != "revised" {
		return MutualActionPlan{}, fmt.Errorf("%w: plan is not awaiting internal approval", ErrInvalidInput)
	}
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return MutualActionPlan{}, err
	}
	rel, err := s.GetRelationship(ctx, relationshipID)
	if err != nil {
		return MutualActionPlan{}, err
	}
	record.Status = "internally_approved"
	refs := []string{}
	for _, item := range record.CurrentRevision.Items {
		refs = append(refs, item.EvidenceRefs...)
	}
	_, err = appendConversationArtifact(ctx, s.client, ws, u, rel, conversationArtifactInput{
		Kind: "mutual_action_plan", StableID: planID, Version: currentRow.Version + 1,
		Status: record.Status, SubjectRef: relationshipID.String(), EffectiveAt: s.now(),
		EvidenceRefs: refs, Payload: record,
	})
	return record.MutualActionPlan, err
}

// ShareMutualActionPlan creates a governed scoped token and draft share action.
func (s *Service) ShareMutualActionPlan(
	ctx context.Context,
	u *ent.User,
	relationshipID uuid.UUID,
	planID string,
) (MutualActionPlan, string, error) {
	currentRow, record, err := s.planRecordFor(ctx, relationshipID, planID)
	if err != nil {
		return MutualActionPlan{}, "", err
	}
	if record.Status != "internally_approved" {
		return MutualActionPlan{}, "", fmt.Errorf("%w: approve the exact plan revision before sharing", ErrReviewRequired)
	}
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return MutualActionPlan{}, "", err
	}
	rel, err := s.GetRelationship(ctx, relationshipID)
	if err != nil {
		return MutualActionPlan{}, "", err
	}
	policy, err := s.ResolveConversationPolicy(ctx, u, rel)
	if err != nil {
		return MutualActionPlan{}, "", err
	}
	decision := evaluateGovernanceDecision(
		policy, "external_share", "none", planID+":"+record.CurrentRevision.RevisionHash, s.now(),
	)
	decisionRefs := []string{"mutual-action-plan-revision:" + record.CurrentRevision.RevisionID}
	if _, err := appendConversationArtifact(ctx, s.client, ws, u, rel, conversationArtifactInput{
		Kind: "governance_decision", StableID: decision.DecisionID,
		Status:     map[bool]string{true: "allowed", false: "blocked"}[decision.Allowed],
		SubjectRef: planID, EffectiveAt: s.now(), EvidenceRefs: decisionRefs, Payload: decision,
	}); err != nil {
		return MutualActionPlan{}, "", err
	}
	if !decision.Allowed {
		return MutualActionPlan{}, "", fmt.Errorf("%w: %s", ErrReviewRequired, decision.Reason)
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return MutualActionPlan{}, "", err
	}
	token := hex.EncodeToString(raw)
	tokenHash := sha256.Sum256([]byte(token))
	record.Status, record.TokenState = "shared", "active"
	record.TokenHash = hex.EncodeToString(tokenHash[:])
	record.TokenExpiresAt = s.now().Add(14 * 24 * time.Hour).UTC().Format(time.RFC3339)
	record.SharePolicyDecisionID = decision.DecisionID
	refs, evidenceIDs := []string{}, []uuid.UUID{}
	for _, item := range record.CurrentRevision.Items {
		refs = append(refs, item.EvidenceRefs...)
		if id, parseErr := uuid.Parse(item.CommitmentID); parseErr == nil {
			commitmentRows, queryErr := s.client.Commitment.Query().Where(commitment.IDEQ(id)).WithEvidences().All(ctx)
			if queryErr != nil {
				return MutualActionPlan{}, "", queryErr
			}
			for _, commitmentRow := range commitmentRows {
				for _, evidence := range commitmentRow.Edges.Evidences {
					evidenceIDs = append(evidenceIDs, evidence.ID)
				}
			}
		}
	}
	responseURL := "https://app.oppulence.com/plan-response#" + token
	message := fmt.Sprintf("A mutual action plan is ready for review (revision %d, %s): %s", record.CurrentRevision.Version, record.CurrentRevision.RevisionHash, responseURL)
	actionInput := ActionInput{ActionType: "meeting_follow_up", Channel: "email", RecipientEmail: rel.PrimaryEmail,
		ProposedSubject: "Mutual action plan", ProposedMessage: message, ExecutionMode: ExecModeDraft}
	dedupe := "mutual-action-plan:" + planID + ":" + record.CurrentRevision.RevisionHash
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return MutualActionPlan{}, "", err
	}
	defer func() { _ = tx.Rollback() }()
	txc := tx.Client()
	txws, err := txc.RevenueWorkspace.Get(ctx, ws.ID)
	if err != nil {
		return MutualActionPlan{}, "", err
	}
	txu, err := txc.User.Get(ctx, u.ID)
	if err != nil {
		return MutualActionPlan{}, "", err
	}
	txrel, err := txc.Relationship.Get(ctx, rel.ID)
	if err != nil {
		return MutualActionPlan{}, "", err
	}
	if exists, queryErr := txc.RevenueAction.Query().Where(
		revenueaction.HasWorkspaceWith(revenueworkspace.IDEQ(txws.ID)), revenueaction.DedupeKeyEQ(dedupe),
	).Exist(ctx); queryErr != nil {
		return MutualActionPlan{}, "", queryErr
	} else if !exists {
		evidences, queryErr := txc.RevenueEvidence.Query().Where(revenueevidence.IDIn(evidenceIDs...)).All(ctx)
		if queryErr != nil || len(evidences) == 0 {
			return MutualActionPlan{}, "", fmt.Errorf("%w: plan share requires evidence", ErrInvalidInput)
		}
		action, createErr := txc.RevenueAction.Create().SetWorkspace(txws).SetRelationship(txrel).SetUser(txu).
			SetActionType("meeting_follow_up").SetChannel("email").SetDetector("manual").
			SetDedupeKey(dedupe).SetRevision(1).SetRevisionHash(actionInput.content(u.ID).Hash()).
			SetReason("Share the exact approved mutual action plan revision.").
			SetRecipientEmail(rel.PrimaryEmail).SetProposedSubject(actionInput.ProposedSubject).
			SetProposedMessage(message).SetExecutionMode(ExecModeDraft).SetExecutionOwner(OwnerRowboat).
			SetAssignedUserID(txu.ID).SetPriorityScore(70).AddEvidences(evidences...).Save(ctx)
		if createErr != nil {
			return MutualActionPlan{}, "", createErr
		}
		if err := s.snapshotRevision(ctx, txc, action, txu); err != nil {
			return MutualActionPlan{}, "", err
		}
	}
	if _, err = appendConversationArtifact(ctx, txc, txws, txu, txrel, conversationArtifactInput{
		Kind: "mutual_action_plan", StableID: planID, Version: currentRow.Version + 1,
		Status: record.Status, SubjectRef: relationshipID.String(), EffectiveAt: s.now(),
		EvidenceRefs: refs, Payload: record,
	}); err != nil {
		return MutualActionPlan{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return MutualActionPlan{}, "", err
	}
	return record.MutualActionPlan, token, nil
}

func mutualActionPlansFor(ctx context.Context, client *ent.Client, rel *ent.Relationship) ([]MutualActionPlan, error) {
	rows, err := latestConversationArtifacts(ctx, client, rel.ID.String(), "mutual_action_plan")
	if err != nil {
		return nil, err
	}
	result := make([]MutualActionPlan, 0, len(rows))
	for _, row := range rows {
		var record mutualActionPlanRecord
		if err := json.Unmarshal([]byte(row.PayloadJSON), &record); err != nil {
			return nil, err
		}
		result = append(result, record.MutualActionPlan)
	}
	return result, nil
}

// PublicMutualActionPlanResponse is an untrusted counterparty proposal for review.
type PublicMutualActionPlanResponse struct {
	ResponseID    string `json:"responseId"`
	Kind          string `json:"kind"`
	ItemID        string `json:"itemId,omitempty"`
	ProposedValue string `json:"proposedValue,omitempty"`
	Comment       string `json:"comment,omitempty"`
}

func (s *Service) sharedPlanByToken(
	ctx context.Context,
	token string,
) (*ent.ConversationIntelligenceArtifact, mutualActionPlanRecord, *ent.User, *ent.Relationship, error) {
	if len(token) != 64 {
		return nil, mutualActionPlanRecord{}, nil, nil, ErrNotFound
	}
	sum := sha256.Sum256([]byte(token))
	ictx := auth.WithInternal(ctx)
	rows, err := s.client.ConversationIntelligenceArtifact.Query().Where(
		conversationintelligenceartifact.KindEQ("mutual_action_plan"),
	).WithUser().WithRelationship().Order(
		ent.Desc(conversationintelligenceartifact.FieldVersion),
	).Limit(1000).All(ictx)
	if err != nil {
		return nil, mutualActionPlanRecord{}, nil, nil, err
	}
	seen := map[string]bool{}
	for _, row := range rows {
		if seen[row.StableID] {
			continue
		}
		seen[row.StableID] = true
		var record mutualActionPlanRecord
		if json.Unmarshal([]byte(row.PayloadJSON), &record) != nil || record.TokenState != "active" {
			continue
		}
		if expires, parseErr := time.Parse(time.RFC3339, record.TokenExpiresAt); parseErr != nil || !expires.After(s.now()) {
			continue
		}
		stored, decodeErr := hex.DecodeString(record.TokenHash)
		if decodeErr != nil || !hmac.Equal(stored, sum[:]) {
			continue
		}
		u, userErr := row.Edges.UserOrErr()
		rel, relationshipErr := row.Edges.RelationshipOrErr()
		if userErr != nil || relationshipErr != nil {
			return nil, mutualActionPlanRecord{}, nil, nil, ErrNotFound
		}
		return row, record, u, rel, nil
	}
	return nil, mutualActionPlanRecord{}, nil, nil, ErrNotFound
}

func publicPlan(record mutualActionPlanRecord, policy ResolvedConversationPolicy) MutualActionPlan {
	plan := record.MutualActionPlan
	items := append([]MutualActionPlanItem(nil), plan.CurrentRevision.Items...)
	for index := range items {
		items[index].CommitmentID = ""
		items[index].MilestoneRef = ""
		items[index].EvidenceRefs = nil
		items[index].Title = redactConversationText(items[index].Title, policy.RedactionClasses)
		items[index].OwnerParticipantRef = "plan-participant"
	}
	plan.CurrentRevision.Items = items
	plan.InternalOwnerRef = "internal-owner"
	plan.CounterpartyRef = "counterparty"
	plan.SharePolicyDecisionID = ""
	return plan
}

// PublicMutualActionPlan returns a currently permitted, redacted token-scoped view.
func (s *Service) PublicMutualActionPlan(ctx context.Context, token string) (MutualActionPlan, error) {
	_, record, u, rel, err := s.sharedPlanByToken(ctx, token)
	if err != nil {
		return MutualActionPlan{}, err
	}
	policy, err := s.ResolveConversationPolicy(auth.WithUser(ctx, u), u, rel)
	if err != nil {
		return MutualActionPlan{}, err
	}
	decision := evaluateGovernanceDecision(
		policy, "external_share", "none", record.PlanID+":"+record.CurrentRevision.RevisionHash, s.now(),
	)
	if !decision.Allowed {
		return MutualActionPlan{}, ErrNotFound
	}
	return publicPlan(record, policy), nil
}

// ReceiveMutualActionPlanResponse appends an external observation. It can change the
// plan's response status, but it cannot mutate a commitment or relationship assertion.
func (s *Service) ReceiveMutualActionPlanResponse(
	ctx context.Context,
	token string,
	input PublicMutualActionPlanResponse,
) (string, error) {
	input.ResponseID = strings.TrimSpace(input.ResponseID)
	input.Kind = strings.TrimSpace(input.Kind)
	if input.ResponseID == "" {
		return "", fmt.Errorf("%w: responseId is required", ErrInvalidInput)
	}
	switch input.Kind {
	case "confirm", "correct", "blocked", "completed", "comment":
	default:
		return "", fmt.Errorf("%w: invalid plan response", ErrInvalidInput)
	}
	if len(input.Comment) > 4000 || len(input.ProposedValue) > 4000 {
		return "", fmt.Errorf("%w: plan response is too long", ErrInvalidInput)
	}
	currentRow, record, u, rel, err := s.sharedPlanByToken(ctx, token)
	if err != nil {
		return "", err
	}
	uctx := auth.WithUser(ctx, u)
	policy, err := s.ResolveConversationPolicy(uctx, u, rel)
	if err != nil {
		return "", err
	}
	decision := evaluateGovernanceDecision(
		policy, "external_share", "none", record.PlanID+":"+record.CurrentRevision.RevisionHash, s.now(),
	)
	if !decision.Allowed {
		return "", ErrNotFound
	}
	results, err := s.ingestTrustedRelationshipObservations(uctx, u, []RelationshipObservationInput{{
		RelationshipID: rel.ID, Source: "browser",
		ExternalID: "plan-response:" + input.ResponseID, SourceVersion: "1",
		EventType: "mutual_action_plan_response_received", OccurredAt: s.now(), ReceivedAt: s.now(),
		Summary: "Counterparty responded to a shared mutual action plan.",
		Facts: map[string]any{"mutual_action_plan_response": map[string]any{
			"response_id": input.ResponseID, "plan_id": record.PlanID,
			"revision_id":   record.CurrentRevision.RevisionID,
			"revision_hash": record.CurrentRevision.RevisionHash,
			"kind":          input.Kind, "item_id": input.ItemID,
			"proposed_value": input.ProposedValue, "comment": input.Comment,
		}},
	}})
	if err != nil {
		return "", err
	}
	if results[0].Duplicate {
		return input.ResponseID, nil
	}
	ws, err := s.CurrentWorkspace(uctx, u)
	if err != nil {
		return "", err
	}
	record.Status = "counterparty_responded"
	refs := []string{"relationship-observation:" + results[0].Observation.ID.String()}
	for _, item := range record.CurrentRevision.Items {
		refs = append(refs, item.EvidenceRefs...)
	}
	_, err = appendConversationArtifact(uctx, s.client, ws, u, rel, conversationArtifactInput{
		Kind: "mutual_action_plan", StableID: record.PlanID, Version: currentRow.Version + 1,
		Status: record.Status, SubjectRef: rel.ID.String(), EffectiveAt: s.now(),
		EvidenceRefs: refs, Payload: record,
	})
	return input.ResponseID, err
}
