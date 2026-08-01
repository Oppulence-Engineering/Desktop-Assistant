package openapidoc

import (
	"encoding/json"
	"os"
	"testing"
)

func TestEnrichDocumentsMountedRuntimeAPI(t *testing.T) {
	spec := obj{
		"openapi": "3.0.3",
		"info":    obj{"title": "Solomon AI API"},
		"paths": obj{
			"/credit-ledgers": obj{"get": obj{"summary": "generated but not mounted"}},
		},
		"components": obj{
			"schemas": obj{
				"CreditLedger": obj{"type": "object", "properties": obj{"delta": obj{"type": "integer"}}},
				"User":         obj{"type": "object", "properties": obj{"workos_user_id": obj{"type": "string"}}},
			},
		},
	}

	Enrich(spec)

	paths := asObj(spec["paths"])
	for _, path := range []string{
		"/healthz",
		"/readyz",
		"/openapi.json",
		"/v1/config",
		"/v1/auth/workos/login-url",
		"/v1/auth/workos/exchange",
		"/v1/auth/workos/refresh",
		"/v1/me",
		"/v1/background-task-templates",
		"/v1/background-task-templates/{templateSlug}",
		"/v1/background-task-templates/{templateSlug}/instantiate",
		"/v1/background-tasks",
		"/v1/background-tasks/{slug}",
		"/v1/background-tasks/{slug}/artifact",
		"/v1/background-tasks/{slug}/runs",
		"/v1/background-tasks/{slug}/runs/{runId}",
		"/v1/background-tasks/{slug}/runs/{runId}/events",
		"/v1/background-tasks/{slug}/runs/{runId}/events/stream",
		"/v1/background-tasks/{slug}/trigger",
		"/v1/llm/models",
		"/v1/llm/chat/completions",
		"/v1/llm/completions",
		"/v1/llm/embeddings",
		"/v1/voice/text-to-speech/{voiceId}",
		"/v1/search/exa",
		"/v1/google-oauth/start",
		"/oauth/google/callback",
		"/v1/google-oauth/claim",
		"/v1/google-oauth/refresh",
		"/v1/slack-oauth/start",
		"/oauth/slack/callback",
		"/v1/slack-oauth/claim",
		"/v1/slack-oauth/workspaces",
		"/v1/slack-oauth/workspaces/{teamId}",
		"/v1/slack-oauth/thread/read",
		"/v1/slack-oauth/thread/post",
		"/v1/connectors",
		"/v1/connections/{name}/start",
		"/v1/connections/{name}/callback",
		"/v1/connections/{name}/claim",
		"/v1/connections/{name}/api-key",
		"/v1/connections/{name}/mcp-token",
		"/v1/connections/{name}",
		"/v1/events",
		"/v1/events/{eventId}",
		"/v1/events/{eventId}/runs",
		"/v1/webhooks/google",
		"/v1/webhooks/slack",
		"/v1/webhooks/events",
		"/v1/internal/events",
		"/v1/relationships/{relationshipId}/timeline",
		"/v1/relationships/{relationshipId}/changes",
		"/v1/relationships/{relationshipId}/evidence/{evidenceId}",
		"/v1/relationships/{relationshipId}/corrections",
		"/v1/relationships/{relationshipId}/conversation-corrections",
		"/v1/relationship-observations/batch",
		"/v1/relationship-sources/status",
		"/v1/relationship-recommendations/{actionId}/approve",
		"/v1/relationship-recommendations/{actionId}/reject",
		"/oauth-hooks/pre-consent",
		"/v1/internal/connections/invalidate",
		"/graphql",
	} {
		if paths[path] == nil {
			t.Fatalf("missing path %s", path)
		}
	}
	if paths["/credit-ledgers"] != nil {
		t.Fatal("unmounted generated entity CRUD path should not be documented")
	}
}

func TestEnrichAddsSecuritySchemasAndEntityDetail(t *testing.T) {
	spec := obj{
		"components": obj{
			"schemas": obj{
				"CreditLedger": obj{"type": "object", "properties": obj{"delta": obj{"type": "integer"}, "reason": obj{"type": "string"}}},
				"User":         obj{"type": "object", "properties": obj{"workos_user_id": obj{"type": "string"}}},
			},
		},
	}

	Enrich(spec)

	components := asObj(spec["components"])
	schemes := asObj(components["securitySchemes"])
	for _, name := range []string{"BearerAuth", "HookHMAC", "WebhookHMAC", "InternalSecret"} {
		if schemes[name] == nil {
			t.Fatalf("missing security scheme %s", name)
		}
	}

	schemas := asObj(components["schemas"])
	for _, name := range []string{"MeResponse", "BackgroundTask", "BackgroundTaskTemplate", "BackgroundTaskTemplatesResponse", "BackgroundTaskRun", "BackgroundTaskRunEventsAppendRequest", "RevisionConflictEnvelope", "LLMChatCompletionsRequest", "Connector", "IntegrationTemplateBlock", "ConnectionAPIKeyRequest", "ConnectionClaimRequest", "SlackWorkspace", "SlackWorkspacesResponse", "SlackThreadReadRequest", "SlackThreadReadResponse", "SlackThreadPostRequest", "SlackThreadPostResponse", "GraphQLRequest"} {
		if schemas[name] == nil {
			t.Fatalf("missing runtime schema %s", name)
		}
	}
	creditLedger := asObj(schemas["CreditLedger"])
	delta := asObj(asObj(creditLedger["properties"])["delta"])
	if delta["description"] == nil || delta["example"] == nil {
		t.Fatal("CreditLedger.delta should have a detailed description and example")
	}
}

func TestCheckedInOpenAPIJSONIsEnriched(t *testing.T) {
	raw, err := os.ReadFile("../../api/openapi.json")
	if err != nil {
		t.Fatalf("read checked-in openapi json: %v", err)
	}
	var spec obj
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("parse checked-in openapi json: %v", err)
	}
	paths := asObj(spec["paths"])
	if paths["/v1/me"] == nil || paths["/v1/background-task-templates"] == nil || paths["/v1/background-tasks"] == nil || paths["/v1/background-tasks/{slug}/runs/{runId}/events"] == nil || paths["/v1/background-tasks/{slug}/runs/{runId}/events/stream"] == nil || paths["/v1/llm/chat/completions"] == nil || paths["/v1/connectors"] == nil || paths["/v1/connections/{name}/api-key"] == nil || paths["/v1/slack-oauth/workspaces"] == nil || paths["/v1/slack-oauth/thread/read"] == nil {
		t.Fatal("checked-in openapi json is missing mounted runtime API paths")
	}
	if paths["/credit-ledgers"] != nil {
		t.Fatal("checked-in openapi json still contains unmounted ent CRUD paths")
	}
	schemas := asObj(asObj(spec["components"])["schemas"])
	if schemas["LLMChatCompletionsRequest"] == nil || schemas["MeResponse"] == nil || schemas["BackgroundTask"] == nil || schemas["BackgroundTaskTemplate"] == nil || schemas["RevisionConflictEnvelope"] == nil || schemas["IntegrationTemplateBlock"] == nil || schemas["SlackWorkspacesResponse"] == nil || schemas["SlackThreadReadResponse"] == nil {
		t.Fatal("checked-in openapi json is missing enriched runtime schemas")
	}
}
