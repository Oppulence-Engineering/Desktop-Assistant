package agentregistry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenue"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

var correctablePersonDimensions = map[string]bool{
	"display_name": true, "title": true, "org_name": true, "org_domain": true,
	"department": true, "seniority": true, "location": true, "linkedin_url": true,
	"employment_status": true,
}

// PersonCreateCapability creates the same internal contact as the People UI.
func PersonCreateCapability() Capability {
	tool := &personCreateTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("person.create", "person creation is not configured on this server")
			}
			return &personCreateTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// PersonCorrectCapability records an auditable user correction to a person profile.
func PersonCorrectCapability() Capability {
	tool := &personCorrectTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("person.correct", "person correction is not configured on this server")
			}
			return &personCorrectTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// PersonAttributeRetractCapability withdraws a wrong profile claim while
// preserving it in the provenance ledger.
func PersonAttributeRetractCapability() Capability {
	tool := &personAttributeRetractTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("person.attribute.retract", "person attribute retraction is not configured on this server")
			}
			return &personAttributeRetractTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// PersonIdentityDecideCapability applies one explicit, version-bound decision
// to an internal person identity-review candidate.
func PersonIdentityDecideCapability() Capability {
	tool := &personIdentityDecideTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("person.identity.decide", "person identity decisions are not configured on this server")
			}
			return &personIdentityDecideTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// PersonDeleteCapability permanently removes one internal person merge family
// after approval and keeps its identity anchors suppressed on future syncs.
func PersonDeleteCapability() Capability {
	tool := &personDeleteTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierAct, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("person.delete", "person deletion is not configured on this server")
			}
			return &personDeleteTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

type personCreateTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type personCorrectTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type personAttributeRetractTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type personIdentityDecideTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type personDeleteTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

func (*personCreateTool) Name() string { return "person.create" }
func (*personCreateTool) Description() string {
	return "Create an internal Oppulence person in one exact accessible workspace. It is retry-safe and never contacts the person or changes a provider."
}
func (*personCreateTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"workspaceId":{"type":"string","format":"uuid","description":"Exact workspace ID returned by workspace.read with view workspaces."},"displayName":{"type":"string","minLength":1,"maxLength":500,"description":"Person's full name."},"email":{"type":"string","maxLength":320,"description":"Optional email address."}},"required":["workspaceId","displayName"],"additionalProperties":false}`)
}
func (*personCreateTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "person.create"}
}

func (t *personCreateTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("person creation is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("person creator scope does not match workflow owner")
	}
	var input struct {
		WorkspaceID string `json:"workspaceId"`
		DisplayName string `json:"displayName"`
		Email       string `json:"email"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode person.create input: %w", err)
	}
	workspaceID, err := uuid.Parse(strings.TrimSpace(input.WorkspaceID))
	if err != nil {
		return nil, errors.New("person.create: workspaceId must be a UUID")
	}
	displayName := strings.TrimSpace(input.DisplayName)
	email := strings.ToLower(strings.TrimSpace(input.Email))
	if displayName == "" || len(displayName) > 500 {
		return nil, errors.New("person.create: displayName must be between 1 and 500 bytes")
	}
	if len(email) > 320 {
		return nil, errors.New("person.create: email must be at most 320 bytes")
	}
	key, err := durableToolKey(scope, "person-create")
	if err != nil {
		return nil, fmt.Errorf("person.create: %w", err)
	}
	domain := ""
	if at := strings.LastIndex(email, "@"); at >= 0 && at < len(email)-1 {
		domain = email[at+1:]
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("person.create: resolve owner: %w", err)
	}
	userCtx := auth.WithUser(ctx, owner)
	rel, err := t.service.CreateRelationship(userCtx, owner, revenue.RelationshipInput{
		Kind: "person", DisplayName: displayName, PrimaryEmail: email, AccountDomain: domain,
		WorkspaceID: workspaceID, IdempotencyKey: key + ":relationship",
	})
	if err != nil {
		return nil, fmt.Errorf("person.create: create contact relationship: %w", err)
	}
	results, err := t.service.IngestRelationshipObservationCandidatesInWorkspace(userCtx, owner, workspaceID, []revenue.RelationshipObservationInput{{
		RelationshipID: rel.ID, Source: "user", ExternalID: key + ":observation",
		EventType: "person_added", OccurredAt: time.Now().UTC(), Summary: displayName + " added by the user",
		Participants: []revenue.RelationshipParticipantInput{{DisplayName: displayName, Email: email, Role: "contact"}},
	}})
	if err != nil || len(results) != 1 {
		if err == nil {
			err = errors.New("person observation was not stored")
		}
		return nil, fmt.Errorf("person.create: %w", err)
	}
	participantQuery := t.client.RelationshipParticipant.Query().Where(
		relationshipparticipant.HasRelationshipWith(relationship.IDEQ(rel.ID)),
	).WithPerson().Order(ent.Asc(relationshipparticipant.FieldCreatedAt))
	if email != "" {
		participantQuery.Where(relationshipparticipant.EmailEQ(email))
	} else {
		participantQuery.Where(
			relationshipparticipant.DisplayNameEQ(displayName),
			relationshipparticipant.Or(relationshipparticipant.EmailEQ(""), relationshipparticipant.EmailIsNil()),
		)
	}
	participant, err := participantQuery.First(userCtx)
	if err != nil {
		return nil, fmt.Errorf("person.create: load created participant: %w", err)
	}
	p, err := participant.Edges.PersonOrErr()
	if err != nil {
		return nil, fmt.Errorf("person.create: load created person: %w", err)
	}
	return json.Marshal(map[string]any{
		"personId": p.ID.String(), "relationshipId": rel.ID.String(), "workspaceId": workspaceID.String(),
		"displayName": p.DisplayName, "email": p.PrimaryEmail,
		"note": "Internal Oppulence person is present; nobody was contacted and no provider was changed.",
	})
}

func (*personCorrectTool) Name() string { return "person.correct" }
func (*personCorrectTool) Description() string {
	return "Correct one fact on an existing Oppulence person profile. The correction is auditable, overrides derived data, and never contacts anyone."
}
func (*personCorrectTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"personId":{"type":"string","format":"uuid","description":"Existing person ID returned by relationship.read."},"dimension":{"type":"string","enum":["display_name","title","org_name","org_domain","department","seniority","location","linkedin_url","employment_status"]},"value":{"type":"string","minLength":1,"maxLength":1000},"reason":{"type":"string","maxLength":1000}},"required":["personId","dimension","value"],"additionalProperties":false}`)
}
func (*personCorrectTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "person.correct"}
}

func (*personAttributeRetractTool) Name() string { return "person.attribute.retract" }
func (*personAttributeRetractTool) Description() string {
	return "Retract one wrong fact from an internal Oppulence person profile. The fact remains in the audit trail and no external system is changed."
}
func (*personAttributeRetractTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"personId":{"type":"string","format":"uuid","description":"Existing person ID returned by relationship.read."},"attributeId":{"type":"string","format":"uuid","description":"Active attribute ID returned by relationship.read with view person."},"reason":{"type":"string","minLength":1,"maxLength":1000,"description":"Why this profile fact is wrong."}},"required":["personId","attributeId","reason"],"additionalProperties":false}`)
}
func (*personAttributeRetractTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "person.attribute.retract"}
}

func (t *personAttributeRetractTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("person attribute retraction is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("person attribute retractor scope does not match workflow owner")
	}
	var input struct {
		PersonID    string `json:"personId"`
		AttributeID string `json:"attributeId"`
		Reason      string `json:"reason"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode person.attribute.retract input: %w", err)
	}
	personID, err := uuid.Parse(strings.TrimSpace(input.PersonID))
	if err != nil {
		return nil, errors.New("person.attribute.retract: personId must be a UUID")
	}
	attributeID, err := uuid.Parse(strings.TrimSpace(input.AttributeID))
	if err != nil {
		return nil, errors.New("person.attribute.retract: attributeId must be a UUID")
	}
	reason := strings.TrimSpace(input.Reason)
	if reason == "" || len(reason) > 1000 {
		return nil, errors.New("person.attribute.retract: reason must be between 1 and 1000 bytes")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("person.attribute.retract: resolve owner: %w", err)
	}
	p, err := t.service.RetractPersonAttribute(auth.WithUser(ctx, owner), owner, personID, attributeID, reason)
	if err != nil {
		return nil, fmt.Errorf("person.attribute.retract: %w", err)
	}
	return json.Marshal(map[string]any{
		"personId": p.ID.String(), "attributeId": attributeID.String(), "retracted": true,
		"displayName": p.DisplayName, "title": p.Title, "orgName": p.OrgName,
		"orgDomain": p.OrgDomain, "employmentStatus": p.EmploymentStatus,
		"note": "Internal Oppulence person fact retracted; its audit history was preserved and no external action was taken.",
	})
}

func (*personIdentityDecideTool) Name() string { return "person.identity.decide" }
func (*personIdentityDecideTool) Description() string {
	return "Merge, keep separate, defer, or undo one versioned Oppulence person identity candidate. The internal decision is atomic, retry-safe, and never changes a provider or contacts anyone."
}
func (*personIdentityDecideTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"candidateId":{"type":"string","format":"uuid","description":"Person identity candidate ID returned by relationship.read with view person_identity_reviews."},"decision":{"type":"string","enum":["merge","keep_separate","defer","undo"]},"expectedVersion":{"type":"integer","minimum":1,"description":"Exact candidate version returned by person_identity_reviews."},"reason":{"type":"string","minLength":1,"maxLength":2000,"description":"Why the user chose this identity decision."}},"required":["candidateId","decision","expectedVersion","reason"],"additionalProperties":false}`)
}
func (*personIdentityDecideTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "person.identity.decide"}
}

func (t *personIdentityDecideTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("person identity decisions are not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("person identity decision scope does not match workflow owner")
	}
	var input struct {
		CandidateID     string `json:"candidateId"`
		Decision        string `json:"decision"`
		ExpectedVersion int    `json:"expectedVersion"`
		Reason          string `json:"reason"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode person.identity.decide input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.CandidateID))
	if err != nil {
		return nil, errors.New("person.identity.decide: candidateId must be a UUID")
	}
	decision := strings.ToLower(strings.TrimSpace(input.Decision))
	if decision != "merge" && decision != "keep_separate" && decision != "defer" && decision != "undo" {
		return nil, errors.New("person.identity.decide: unsupported decision")
	}
	reason := strings.TrimSpace(input.Reason)
	if input.ExpectedVersion <= 0 || reason == "" || len(reason) > 2000 {
		return nil, errors.New("person.identity.decide: expectedVersion and a reason of at most 2000 bytes are required")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("person.identity.decide: resolve owner: %w", err)
	}
	idempotencyKey, err := durableToolKey(scope, "person-identity-decision")
	if err != nil {
		return nil, fmt.Errorf("person.identity.decide: %w", err)
	}
	candidate, err := t.service.DecidePersonMergeCandidate(auth.WithUser(ctx, owner), owner, id, revenue.PersonMergeDecisionInput{
		Decision: decision, Reason: reason, ExpectedVersion: input.ExpectedVersion,
		IdempotencyKey: idempotencyKey + ":" + id.String(),
	})
	if err != nil {
		return nil, fmt.Errorf("person.identity.decide: %w", err)
	}
	proposed, proposedErr := candidate.Edges.ProposedPersonOrErr()
	existing, existingErr := candidate.Edges.ExistingPersonOrErr()
	if proposedErr != nil || existingErr != nil {
		return nil, errors.New("person.identity.decide: candidate people are unavailable")
	}
	personView := func(p *ent.Person) map[string]any {
		var mergedInto *string
		if p.MergedIntoPersonID != nil {
			value := p.MergedIntoPersonID.String()
			mergedInto = &value
		}
		return map[string]any{
			"id": p.ID.String(), "displayName": p.DisplayName, "primaryEmail": p.PrimaryEmail,
			"orgName": p.OrgName, "orgDomain": p.OrgDomain, "status": p.Status, "mergedIntoPersonId": mergedInto,
		}
	}
	return json.Marshal(map[string]any{
		"candidateId": candidate.ID.String(), "status": candidate.Status, "version": candidate.Version,
		"decision": candidate.Decision, "reason": candidate.DecisionReason,
		"proposedPerson": personView(proposed), "existingPerson": personView(existing),
		"note": "Internal Oppulence person identity decision recorded; no provider was changed and nobody was contacted.",
	})
}

func (*personDeleteTool) Name() string { return "person.delete" }
func (*personDeleteTool) Description() string {
	return "Permanently remove one Oppulence person and merged duplicates, then suppress their identity anchors so Google sync cannot recreate them. Requires human approval and never deletes provider data."
}
func (*personDeleteTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"personId":{"type":"string","format":"uuid","description":"Person ID returned by relationship.read with view person."},"expectedDisplayName":{"type":"string","minLength":1,"maxLength":500,"description":"Exact display name from the latest person view; prevents deleting a stale or wrong person."},"reason":{"type":"string","enum":["user_action","subject_request"],"description":"Use subject_request only when the person asked to be removed."},"note":{"type":"string","maxLength":1000,"description":"Optional private audit note."}},"required":["personId","expectedDisplayName","reason"],"additionalProperties":false}`)
}
func (*personDeleteTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierAct, Connector: "oppulence", Operation: "person.delete"}
}

func (t *personDeleteTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("person deletion is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("person deleter scope does not match workflow owner")
	}
	if strings.TrimSpace(scope.ApprovalID) == "" {
		return nil, errors.New("person.delete requires human approval")
	}
	var input struct {
		PersonID            string `json:"personId"`
		ExpectedDisplayName string `json:"expectedDisplayName"`
		Reason              string `json:"reason"`
		Note                string `json:"note"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode person.delete input: %w", err)
	}
	personID, err := uuid.Parse(strings.TrimSpace(input.PersonID))
	if err != nil {
		return nil, errors.New("person.delete: personId must be a UUID")
	}
	expectedName := strings.TrimSpace(input.ExpectedDisplayName)
	if expectedName == "" || len(expectedName) > 500 {
		return nil, errors.New("person.delete: expectedDisplayName must be between 1 and 500 bytes")
	}
	reason := strings.TrimSpace(input.Reason)
	if reason != "user_action" && reason != "subject_request" {
		return nil, errors.New("person.delete: reason must be user_action or subject_request")
	}
	note := strings.TrimSpace(input.Note)
	if len(note) > 1000 {
		return nil, errors.New("person.delete: note must be at most 1000 bytes")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("person.delete: resolve owner: %w", err)
	}
	userCtx := auth.WithUser(ctx, owner)
	target, err := t.service.GetPerson(userCtx, owner, personID)
	if err != nil {
		return nil, fmt.Errorf("person.delete: %w", err)
	}
	if target.DisplayName != expectedName {
		return nil, errors.New("person.delete: display name changed; read the person again before deleting")
	}
	workspace, err := t.service.CurrentWorkspace(userCtx, owner)
	if err != nil {
		return nil, fmt.Errorf("person.delete: resolve workspace: %w", err)
	}
	receipt, err := t.service.DeletePerson(userCtx, owner, workspace.ID, target.ID, reason, note)
	if err != nil {
		return nil, fmt.Errorf("person.delete: %w", err)
	}
	return json.Marshal(map[string]any{
		"receiptId": receipt.ReceiptID, "requestedPersonId": personID.String(), "personId": receipt.PersonID,
		"requestedAt": receipt.RequestedAt, "completedAt": receipt.CompletedAt, "reason": receipt.Reason,
		"personsDeleted": receipt.Persons, "attributesDeleted": receipt.Attributes,
		"identitiesDeleted": receipt.Identities, "interactionStatsDeleted": receipt.Interactions,
		"mergeCandidatesDeleted": receipt.Candidates, "suppressedIdentities": receipt.Suppressed,
		"note": "Internal Oppulence person data removed and future re-creation suppressed; no provider data was changed.",
	})
}

func (t *personCorrectTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("person correction is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("person corrector scope does not match workflow owner")
	}
	var input struct {
		PersonID  string `json:"personId"`
		Dimension string `json:"dimension"`
		Value     string `json:"value"`
		Reason    string `json:"reason"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode person.correct input: %w", err)
	}
	personID, err := uuid.Parse(strings.TrimSpace(input.PersonID))
	if err != nil {
		return nil, errors.New("person.correct: personId must be a UUID")
	}
	dimension := strings.TrimSpace(input.Dimension)
	value := strings.TrimSpace(input.Value)
	if !correctablePersonDimensions[dimension] {
		return nil, errors.New("person.correct: dimension is not correctable")
	}
	if value == "" || len(value) > 1000 {
		return nil, errors.New("person.correct: value must be between 1 and 1000 bytes")
	}
	if len(input.Reason) > 1000 {
		return nil, errors.New("person.correct: reason must be at most 1000 bytes")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("person.correct: resolve owner: %w", err)
	}
	idempotencyKey, err := durableToolKey(scope, "person-correct")
	if err != nil {
		return nil, fmt.Errorf("person.correct: %w", err)
	}
	p, err := t.service.CorrectPerson(auth.WithUser(ctx, owner), owner, personID, revenue.PersonCorrectionInput{
		Dimension: dimension, Value: value, Reason: strings.TrimSpace(input.Reason), IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		return nil, fmt.Errorf("person.correct: %w", err)
	}
	return json.Marshal(map[string]any{
		"personId": p.ID.String(), "dimension": dimension, "value": value,
		"displayName": p.DisplayName, "title": p.Title, "orgName": p.OrgName,
		"orgDomain": p.OrgDomain, "employmentStatus": p.EmploymentStatus,
		"note": "Internal Oppulence person corrected; no external action was taken.",
	})
}
