package agentregistry

import (
	"encoding/json"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
)

// HubSpotSearchCapability searches the session owner's connected CRM.
func HubSpotSearchCapability() Capability {
	return Capability{
		Name:        "connector.read.hubspot_search",
		Description: "Search the user's connected HubSpot CRM for contacts, companies, deals, or tickets. Returns a bounded set of record ids and relevant properties.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"objectType":{"type":"string","enum":["contact","company","deal","ticket"]},"query":{"type":"string"},"limit":{"type":"integer","description":"max records (1-25)"}},"required":["objectType","query"]}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			uid, err := uuid.Parse(d.UserID)
			if err != nil || d.HubSpot == nil {
				return newUnavailableTool("connector.read.hubspot_search", "the HubSpot search tool is not configured on this server")
			}
			return guardOwnerScopedToolInSlack(d, backgroundtaskruntime.NewHubSpotSearchTool(d.HubSpot, uid))
		},
	}
}

// HubSpotNoteCapability creates an associated CRM note after approval.
func HubSpotNoteCapability() Capability {
	return Capability{
		Name:        "connector.write.hubspot_note",
		Description: "Create a note on an explicit HubSpot contact, company, deal, or ticket. Requires human approval.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"objectType":{"type":"string","enum":["contact","company","deal","ticket"]},"objectId":{"type":"string"},"body":{"type":"string"},"timestamp":{"type":"string","description":"optional RFC3339 activity timestamp"}},"required":["objectType","objectId","body"]}`),
		TrustTier:   TierAct,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			uid, err := uuid.Parse(d.UserID)
			if err != nil || d.HubSpot == nil {
				return newUnavailableTool("connector.write.hubspot_note", "the HubSpot note tool is not configured on this server")
			}
			return guardOwnerScopedToolInSlack(d, backgroundtaskruntime.NewHubSpotNoteTool(d.HubSpot, uid))
		},
	}
}

// HubSpotTaskCapability creates an associated CRM task after approval.
func HubSpotTaskCapability() Capability {
	return Capability{
		Name:        "connector.write.hubspot_task",
		Description: "Create a follow-up task on an explicit HubSpot contact, company, deal, or ticket. Requires human approval.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"objectType":{"type":"string","enum":["contact","company","deal","ticket"]},"objectId":{"type":"string"},"subject":{"type":"string"},"body":{"type":"string"},"dueAt":{"type":"string","description":"optional RFC3339 due time"}},"required":["objectType","objectId","body"]}`),
		TrustTier:   TierAct,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			uid, err := uuid.Parse(d.UserID)
			if err != nil || d.HubSpot == nil {
				return newUnavailableTool("connector.write.hubspot_task", "the HubSpot task tool is not configured on this server")
			}
			return guardOwnerScopedToolInSlack(d, backgroundtaskruntime.NewHubSpotTaskTool(d.HubSpot, uid))
		},
	}
}
