package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/hubspotapi"
)

// NewHubSpotSearchTool builds connector.read.hubspot_search. The private-app
// token is resolved inside the SDK client from the run owner's user id.
func NewHubSpotSearchTool(client *hubspotapi.Client, userID uuid.UUID) Tool {
	return &hubSpotSearchTool{client: client, userID: userID}
}

type hubSpotSearchTool struct {
	client *hubspotapi.Client
	userID uuid.UUID
}

func (t *hubSpotSearchTool) Name() string { return "connector.read.hubspot_search" }
func (t *hubSpotSearchTool) AuditInfo(args json.RawMessage) ToolAudit {
	var in struct {
		ObjectType string `json:"objectType"`
	}
	_ = json.Unmarshal(args, &in)
	kind, _ := hubspotapi.NormalizeObjectType(in.ObjectType)
	return ToolAudit{
		TrustTier: TierRead, Connector: "hubspot", Operation: "hubspot.crm.search",
		RequiredScopes: hubSpotScopes(kind, "read"),
	}
}
func (t *hubSpotSearchTool) Description() string {
	return "Search the connected HubSpot CRM for contacts, companies, deals, or tickets. Returns a bounded set of record ids and relevant properties."
}
func (t *hubSpotSearchTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"objectType":{"type":"string","enum":["contact","company","deal","ticket"]},"query":{"type":"string","description":"HubSpot free-text search query."},"limit":{"type":"integer","description":"Max records (1-25)."}},"required":["objectType","query"]}`)
}
func (t *hubSpotSearchTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		ObjectType string `json:"objectType"`
		Query      string `json:"query"`
		Limit      int    `json:"limit"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid HubSpot search arguments: %w", err)
	}
	if t.client == nil {
		return nil, &RuntimeError{Code: CodeConnectorUnavailable, Message: "HubSpot is not configured on this server"}
	}
	result, err := t.client.Search(ctx, t.userID, in.ObjectType, in.Query, in.Limit)
	if err != nil {
		return nil, classifyHubSpotToolError("search", err)
	}
	return json.Marshal(result)
}

// NewHubSpotNoteTool builds connector.write.hubspot_note. The runtime gates
// this outward-facing CRM mutation behind human approval.
func NewHubSpotNoteTool(client *hubspotapi.Client, userID uuid.UUID) Tool {
	return &hubSpotNoteTool{client: client, userID: userID}
}

type hubSpotNoteTool struct {
	client *hubspotapi.Client
	userID uuid.UUID
}

func (t *hubSpotNoteTool) Name() string { return "connector.write.hubspot_note" }
func (t *hubSpotNoteTool) AuditInfo(args json.RawMessage) ToolAudit {
	return hubSpotWriteAudit(args, "hubspot.note.create")
}
func (t *hubSpotNoteTool) Description() string {
	return "Create a note on an explicit HubSpot contact, company, deal, or ticket. Requires human approval."
}
func (t *hubSpotNoteTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"objectType":{"type":"string","enum":["contact","company","deal","ticket"]},"objectId":{"type":"string","description":"HubSpot record id."},"body":{"type":"string"},"timestamp":{"type":"string","description":"Optional RFC3339 activity timestamp."}},"required":["objectType","objectId","body"]}`)
}
func (t *hubSpotNoteTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		ObjectType string `json:"objectType"`
		ObjectID   string `json:"objectId"`
		Body       string `json:"body"`
		Timestamp  string `json:"timestamp"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid HubSpot note arguments: %w", err)
	}
	if t.client == nil {
		return nil, &RuntimeError{Code: CodeConnectorUnavailable, Message: "HubSpot is not configured on this server"}
	}
	when := time.Now().UTC()
	if strings.TrimSpace(in.Timestamp) != "" {
		parsed, err := time.Parse(time.RFC3339, in.Timestamp)
		if err != nil {
			return nil, fmt.Errorf("timestamp must be RFC3339: %w", err)
		}
		when = parsed
	}
	result, err := t.client.CreateNote(ctx, t.userID,
		hubspotapi.AssociationTarget{ObjectType: in.ObjectType, ObjectID: in.ObjectID}, in.Body, when)
	if err != nil {
		return nil, classifyHubSpotToolError("create note", err)
	}
	if result == nil || result.ID == "" {
		return nil, fmt.Errorf("hubspot create note returned no object id")
	}
	return json.Marshal(map[string]any{"objectId": result.ID, "status": "created"})
}

// NewHubSpotTaskTool builds connector.write.hubspot_task. The runtime gates
// this outward-facing CRM mutation behind human approval.
func NewHubSpotTaskTool(client *hubspotapi.Client, userID uuid.UUID) Tool {
	return &hubSpotTaskTool{client: client, userID: userID}
}

type hubSpotTaskTool struct {
	client *hubspotapi.Client
	userID uuid.UUID
}

func (t *hubSpotTaskTool) Name() string { return "connector.write.hubspot_task" }
func (t *hubSpotTaskTool) AuditInfo(args json.RawMessage) ToolAudit {
	return hubSpotWriteAudit(args, "hubspot.task.create")
}
func (t *hubSpotTaskTool) Description() string {
	return "Create a follow-up task on an explicit HubSpot contact, company, deal, or ticket. Requires human approval."
}
func (t *hubSpotTaskTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"objectType":{"type":"string","enum":["contact","company","deal","ticket"]},"objectId":{"type":"string","description":"HubSpot record id."},"subject":{"type":"string"},"body":{"type":"string"},"dueAt":{"type":"string","description":"Optional RFC3339 due time."}},"required":["objectType","objectId","body"]}`)
}
func (t *hubSpotTaskTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		ObjectType string `json:"objectType"`
		ObjectID   string `json:"objectId"`
		Subject    string `json:"subject"`
		Body       string `json:"body"`
		DueAt      string `json:"dueAt"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid HubSpot task arguments: %w", err)
	}
	if t.client == nil {
		return nil, &RuntimeError{Code: CodeConnectorUnavailable, Message: "HubSpot is not configured on this server"}
	}
	due := time.Now().UTC()
	if strings.TrimSpace(in.DueAt) != "" {
		parsed, err := time.Parse(time.RFC3339, in.DueAt)
		if err != nil {
			return nil, fmt.Errorf("dueAt must be RFC3339: %w", err)
		}
		due = parsed
	}
	result, err := t.client.CreateTask(ctx, t.userID,
		hubspotapi.AssociationTarget{ObjectType: in.ObjectType, ObjectID: in.ObjectID}, in.Subject, in.Body, due)
	if err != nil {
		return nil, classifyHubSpotToolError("create task", err)
	}
	if result == nil || result.ID == "" {
		return nil, fmt.Errorf("hubspot create task returned no object id")
	}
	return json.Marshal(map[string]any{"objectId": result.ID, "status": "created"})
}

func hubSpotWriteAudit(args json.RawMessage, operation string) ToolAudit {
	var in struct {
		ObjectType string `json:"objectType"`
	}
	_ = json.Unmarshal(args, &in)
	kind, _ := hubspotapi.NormalizeObjectType(in.ObjectType)
	resource := "notes"
	if operation == "hubspot.task.create" {
		resource = "tasks"
	}
	return ToolAudit{
		TrustTier: TierAct, Connector: "hubspot", Operation: operation,
		RequiredScopes: hubSpotWriteScopes(kind, resource),
	}
}

func hubSpotScopes(kind, access string) []string {
	if kind == "" {
		return nil
	}
	return []string{"crm.objects." + kind + "s." + access}
}

func hubSpotWriteScopes(targetKind, engagementKind string) []string {
	if targetKind == "" {
		return []string{"crm.objects." + engagementKind + ".write"}
	}
	return []string{
		"crm.objects." + engagementKind + ".write",
		"crm.objects." + targetKind + "s.read",
	}
}

func classifyHubSpotToolError(operation string, err error) error {
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "not connected") || strings.Contains(message, "reconnect hubspot") || strings.Contains(message, "not configured") {
		return &RuntimeError{Code: CodeConnectorUnavailable, Message: "HubSpot is not connected for this user", Cause: err}
	}
	return fmt.Errorf("hubspot %s: %w", operation, err)
}

var _ Tool = (*hubSpotSearchTool)(nil)
var _ Tool = (*hubSpotNoteTool)(nil)
var _ Tool = (*hubSpotTaskTool)(nil)
