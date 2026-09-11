package agentregistry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenue"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// NoteCreateCapability creates an internal Oppulence note through the same
// append-only relationship observation pipeline used by the Notes UI.
func NoteCreateCapability() Capability {
	tool := &noteCreateTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("note.create", "note creation is not configured on this server")
			}
			return &noteCreateTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// NoteUpdateCapability edits an internal Oppulence note by appending the same
// immutable observation revision produced by the Notes UI.
func NoteUpdateCapability() Capability {
	tool := &noteUpdateTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("note.update", "note editing is not configured on this server")
			}
			return &noteUpdateTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// NoteDeleteCapability deletes an internal Oppulence note by appending the
// same tombstone observation produced by the Notes UI.
func NoteDeleteCapability() Capability {
	tool := &noteDeleteTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("note.delete", "note deletion is not configured on this server")
			}
			return &noteDeleteTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

type noteCreateTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type noteUpdateTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type noteDeleteTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

func (t *noteCreateTool) Name() string { return "note.create" }

func (t *noteUpdateTool) Name() string { return "note.update" }

func (t *noteDeleteTool) Name() string { return "note.delete" }

func (t *noteCreateTool) Description() string {
	return "Create an internal Oppulence note linked to an existing relationship. This never sends a message or creates an external event."
}

func (t *noteUpdateTool) Description() string {
	return "Edit an existing internal Oppulence note. Unspecified fields stay unchanged, and nothing is sent externally."
}

func (t *noteDeleteTool) Description() string {
	return "Delete an existing internal Oppulence note by adding a history-preserving tombstone. Nothing is sent externally."
}

func (t *noteCreateTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"relationshipId":{"type":"string","description":"Existing Oppulence relationship ID."},"title":{"type":"string","maxLength":1000,"description":"Optional title; defaults to Untitled note."},"body":{"type":"string","minLength":1,"maxLength":1048576},"meetingLinked":{"type":"boolean","default":false},"liveLinked":{"type":"boolean","default":true}},"required":["relationshipId","body"],"additionalProperties":false}`)
}

func (t *noteUpdateTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"noteId":{"type":"string","minLength":1,"maxLength":512},"title":{"type":"string","maxLength":1000},"body":{"type":"string","maxLength":1048576},"meetingLinked":{"type":"boolean"},"liveLinked":{"type":"boolean"}},"required":["noteId"],"additionalProperties":false}`)
}

func (t *noteDeleteTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"noteId":{"type":"string","minLength":1,"maxLength":512}},"required":["noteId"],"additionalProperties":false}`)
}

func (t *noteCreateTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "note.create"}
}

func (t *noteUpdateTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "note.update"}
}

func (t *noteDeleteTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "note.delete"}
}

func (t *noteCreateTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("note creation is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("note creator scope does not match workflow owner")
	}
	var input struct {
		RelationshipID string `json:"relationshipId"`
		Title          string `json:"title"`
		Body           string `json:"body"`
		MeetingLinked  bool   `json:"meetingLinked"`
		LiveLinked     *bool  `json:"liveLinked"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode note.create input: %w", err)
	}
	title := strings.TrimSpace(input.Title)
	if len(title) > 1000 {
		return nil, errors.New("note.create: title must be at most 1000 bytes")
	}
	if title == "" {
		title = "Untitled note"
	}
	if strings.TrimSpace(input.Body) == "" || len(input.Body) > 1<<20 {
		return nil, errors.New("note.create: body must be between 1 and 1048576 bytes")
	}
	relationshipID, err := uuid.Parse(input.RelationshipID)
	if err != nil {
		return nil, errors.New("note.create: relationshipId must be a UUID")
	}
	externalID, err := durableToolKey(scope, "note")
	if err != nil {
		return nil, fmt.Errorf("note.create: %w", err)
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("note.create: resolve owner: %w", err)
	}
	liveLinked := true
	if input.LiveLinked != nil {
		liveLinked = *input.LiveLinked
	}
	noteID := uuid.NewSHA1(uuid.NameSpaceOID, []byte(externalID)).String()
	results, err := t.service.IngestRelationshipObservationCandidates(auth.WithUser(ctx, owner), owner, []revenue.RelationshipObservationInput{{
		RelationshipID: relationshipID,
		Source:         "desktop_note",
		ExternalID:     externalID,
		SourceVersion:  "1",
		EventType:      "note",
		Summary:        title,
		Facts: map[string]any{
			"noteId": noteID, "title": title, "body": input.Body,
			"meetingLinked": input.MeetingLinked, "liveLinked": liveLinked,
		},
	}})
	if err != nil {
		return nil, fmt.Errorf("note.create: %w", err)
	}
	result := results[0]
	return json.Marshal(map[string]any{
		"noteId": noteID, "relationshipId": result.Relationship.ID.String(),
		"relationshipName": result.Relationship.DisplayName, "title": title,
		"occurredAt": result.Observation.OccurredAt.UTC(), "duplicate": result.Duplicate,
		"projectionStatus": result.ProjectionStatus,
		"evidenceRefs":     []string{"relationship-observation:" + result.Observation.ID.String()},
		"note":             "Internal Oppulence note created; no external action was taken.",
	})
}

func (t *noteUpdateTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("note editing is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("note editor scope does not match workflow owner")
	}
	var input struct {
		NoteID        string  `json:"noteId"`
		Title         *string `json:"title"`
		Body          *string `json:"body"`
		MeetingLinked *bool   `json:"meetingLinked"`
		LiveLinked    *bool   `json:"liveLinked"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode note.update input: %w", err)
	}
	noteID := strings.TrimSpace(input.NoteID)
	if noteID == "" || len(noteID) > 512 {
		return nil, errors.New("note.update: noteId must be between 1 and 512 bytes")
	}
	if input.Title == nil && input.Body == nil && input.MeetingLinked == nil && input.LiveLinked == nil {
		return nil, errors.New("note.update: at least one field must change")
	}
	if input.Title != nil && len(strings.TrimSpace(*input.Title)) > 1000 {
		return nil, errors.New("note.update: title must be at most 1000 bytes")
	}
	if input.Body != nil && len(*input.Body) > 1<<20 {
		return nil, errors.New("note.update: body must be at most 1048576 bytes")
	}
	externalID, err := durableToolKey(scope, "note-update")
	if err != nil {
		return nil, fmt.Errorf("note.update: %w", err)
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("note.update: resolve owner: %w", err)
	}
	userCtx := auth.WithUser(ctx, owner)
	current, facts, err := currentNote(userCtx, t.client, t.ownerID, noteID)
	if err != nil {
		return nil, fmt.Errorf("note.update: find note: %w", err)
	}
	if current == nil {
		return nil, errors.New("note.update: note not found")
	}
	if current.EventType == "note_deleted" {
		return nil, errors.New("note.update: note is deleted")
	}
	relationship, err := current.Edges.RelationshipOrErr()
	if err != nil {
		return nil, fmt.Errorf("note.update: resolve relationship: %w", err)
	}
	title, _ := facts["title"].(string)
	if title == "" {
		title = current.Summary
	}
	if title == "" {
		title = "Untitled note"
	}
	if input.Title != nil {
		title = strings.TrimSpace(*input.Title)
		if title == "" {
			title = "Untitled note"
		}
	}
	facts["title"] = title
	if input.Body != nil {
		facts["body"] = *input.Body
		delete(facts, "content")
	}
	if input.MeetingLinked != nil {
		facts["meetingLinked"] = *input.MeetingLinked
	}
	if input.LiveLinked != nil {
		facts["liveLinked"] = *input.LiveLinked
	}
	facts["noteId"] = noteID
	results, err := t.service.IngestRelationshipObservationCandidates(userCtx, owner, []revenue.RelationshipObservationInput{{
		RelationshipID: relationship.ID,
		Source:         "desktop_note",
		ExternalID:     externalID,
		SourceVersion:  "1",
		EventType:      "note",
		Summary:        title,
		Facts:          facts,
	}})
	if err != nil {
		return nil, fmt.Errorf("note.update: %w", err)
	}
	result := results[0]
	return json.Marshal(map[string]any{
		"noteId": noteID, "relationshipId": relationship.ID.String(),
		"relationshipName": relationship.DisplayName, "title": title,
		"occurredAt": result.Observation.OccurredAt.UTC(), "duplicate": result.Duplicate,
		"projectionStatus": result.ProjectionStatus,
		"evidenceRefs":     []string{"relationship-observation:" + result.Observation.ID.String()},
		"note":             "Internal Oppulence note updated; no external action was taken.",
	})
}

func (t *noteDeleteTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("note deletion is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("note deleter scope does not match workflow owner")
	}
	var input struct {
		NoteID string `json:"noteId"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode note.delete input: %w", err)
	}
	noteID := strings.TrimSpace(input.NoteID)
	if noteID == "" || len(noteID) > 512 {
		return nil, errors.New("note.delete: noteId must be between 1 and 512 bytes")
	}
	externalID, err := durableToolKey(scope, "note-delete")
	if err != nil {
		return nil, fmt.Errorf("note.delete: %w", err)
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("note.delete: resolve owner: %w", err)
	}
	userCtx := auth.WithUser(ctx, owner)
	current, facts, err := currentNote(userCtx, t.client, t.ownerID, noteID)
	if err != nil {
		return nil, fmt.Errorf("note.delete: find note: %w", err)
	}
	if current == nil {
		return nil, errors.New("note.delete: note not found")
	}
	relationship, err := current.Edges.RelationshipOrErr()
	if err != nil {
		return nil, fmt.Errorf("note.delete: resolve relationship: %w", err)
	}
	title, _ := facts["title"].(string)
	if title == "" {
		title = current.Summary
	}
	if current.EventType == "note_deleted" {
		return noteDeleteResult(current, relationship, noteID, title, current.ExternalID == externalID, true, "duplicate")
	}
	results, err := t.service.IngestRelationshipObservationCandidates(userCtx, owner, []revenue.RelationshipObservationInput{{
		RelationshipID: relationship.ID,
		Source:         "desktop_note",
		ExternalID:     externalID,
		SourceVersion:  "1",
		EventType:      "note_deleted",
		Summary:        title,
		Facts:          map[string]any{"noteId": noteID},
	}})
	if err != nil {
		return nil, fmt.Errorf("note.delete: %w", err)
	}
	result := results[0]
	return noteDeleteResult(result.Observation, relationship, noteID, title, result.Duplicate, false, result.ProjectionStatus)
}

func noteDeleteResult(observation *ent.RelationshipObservation, relationship *ent.Relationship, noteID, title string, duplicate, alreadyDeleted bool, projectionStatus string) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"noteId": noteID, "relationshipId": relationship.ID.String(),
		"relationshipName": relationship.DisplayName, "title": title, "status": "deleted",
		"occurredAt": observation.OccurredAt.UTC(), "duplicate": duplicate, "alreadyDeleted": alreadyDeleted,
		"projectionStatus": projectionStatus,
		"evidenceRefs":     []string{"relationship-observation:" + observation.ID.String()},
		"note":             "Internal Oppulence note deleted; no external action was taken.",
	})
}

func currentNote(ctx context.Context, client *ent.Client, ownerID uuid.UUID, noteID string) (*ent.RelationshipObservation, map[string]any, error) {
	rows, err := client.RelationshipObservation.Query().
		Where(
			relationshipobservation.HasUserWith(user.IDEQ(ownerID)),
			relationshipobservation.SourceEQ("desktop_note"),
			relationshipobservation.EventTypeIn("note", "note_deleted"),
			relationshipobservation.Or(
				relationshipobservation.ExternalIDEQ(noteID),
				relationshipobservation.NormalizedFactsJSONContains(noteID),
			),
		).
		WithRelationship().
		Order(ent.Desc(relationshipobservation.FieldOccurredAt), ent.Desc(relationshipobservation.FieldReceivedAt)).
		All(ctx)
	if err != nil {
		return nil, nil, err
	}
	for _, row := range rows {
		facts := map[string]any{}
		_ = json.Unmarshal([]byte(row.NormalizedFactsJSON), &facts)
		candidateID, _ := facts["noteId"].(string)
		if candidateID == "" {
			candidateID = row.ExternalID
		}
		if candidateID == noteID {
			return row, facts, nil
		}
	}
	return nil, nil, nil
}
