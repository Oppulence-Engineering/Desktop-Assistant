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
		"/v1/background-tasks/first-party/ensure",
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
		"/v1/entities",
		"/v1/entities/{id}",
		"/v1/entities/merge",
		"/oauth-hooks/pre-consent",
		"/v1/internal/connections/invalidate",
		"/v1/internal/connections/status",
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

func TestEnrichRejectsInternalCredentialCustodyFromPublicSchemas(t *testing.T) {
	spec := obj{"components": obj{"schemas": obj{
		"ConnectorRevocationJob":        obj{"type": "object"},
		"ConnectorCredentialCleanupJob": obj{"type": "object"},
		"ConnectorCredentialRecovery":   obj{"type": "object"},
		"MCPConnection": obj{
			"type":       "object",
			"properties": obj{"connector": obj{"type": "string"}, "refresh_token_encrypted": obj{"type": "string"}, "api_key_encrypted": obj{"type": "string"}},
			"required":   []any{"connector", "refresh_token_encrypted", "api_key_encrypted"},
		},
	}}}

	Enrich(spec)
	schemas := asObj(asObj(spec["components"])["schemas"])
	for _, internal := range []string{"ConnectorRevocationJob", "ConnectorCredentialCleanupJob", "ConnectorCredentialRecovery"} {
		if schemas[internal] != nil {
			t.Fatalf("internal custody schema %s leaked into public OpenAPI", internal)
		}
	}
	connection := asObj(schemas["MCPConnection"])
	properties := asObj(connection["properties"])
	for _, secret := range []string{"refresh_token_encrypted", "api_key_encrypted"} {
		if properties[secret] != nil {
			t.Fatalf("encrypted credential field %s leaked into public OpenAPI", secret)
		}
	}
	for _, field := range connection["required"].([]any) {
		if field == "refresh_token_encrypted" || field == "api_key_encrypted" {
			t.Fatalf("encrypted credential field %s remained required", field)
		}
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
	taskProperties := asObj(asObj(schemas["BackgroundTask"])["properties"])
	for _, field := range []string{"templateSlug", "templateVersion", "systemManaged", "scheduleSyncState"} {
		if taskProperties[field] == nil {
			t.Fatalf("BackgroundTask is missing %s", field)
		}
	}
	creditLedger := asObj(schemas["CreditLedger"])
	delta := asObj(asObj(creditLedger["properties"])["delta"])
	if delta["description"] == nil || delta["example"] == nil {
		t.Fatal("CreditLedger.delta should have a detailed description and example")
	}

	missionControlEvidence := asObj(schemas["MissionControlDimensionEvidence"])
	evidenceProperties := asObj(missionControlEvidence["properties"])
	reason := asObj(evidenceProperties["reason"])
	if reason["type"] != "string" || reason["description"] != "Evidence-backed explanation." || reason["enum"] != nil {
		t.Fatalf("MissionControlDimensionEvidence.reason was corrupted by generic entity metadata: %#v", reason)
	}
	status := asObj(evidenceProperties["status"])
	if status["type"] != "string" || status["description"] != "Assertion lifecycle state." || status["example"] != "accepted" {
		t.Fatalf("MissionControlDimensionEvidence.status was corrupted by generic entity metadata: %#v", status)
	}
	value := asObj(evidenceProperties["value"])
	oneOf, ok := value["oneOf"].([]any)
	if !ok || len(oneOf) != 2 || value["nullable"] != true || asObj(oneOf[0])["type"] != "string" || asObj(oneOf[1])["type"] != "array" {
		t.Fatalf("MissionControlDimensionEvidence.value must allow scalar and list values: %#v", value)
	}
	relationshipProperties := asObj(asObj(schemas["RevenueRelationship"])["properties"])
	if relationshipProperties["resourceRefs"] == nil {
		t.Fatal("RevenueRelationship is missing runtime resourceRefs")
	}

	observationBatch := asObj(asObj(asObj(asObj(spec["paths"])["/v1/relationship-observations/batch"])["post"])["requestBody"])
	content := asObj(observationBatch["content"])
	bodySchema := asObj(asObj(content["application/json"])["schema"])
	observations := asObj(asObj(bodySchema["properties"])["observations"])
	observationInput := asObj(observations["items"])
	observationProperties := asObj(observationInput["properties"])
	for _, field := range []string{"relationshipId", "resourceRefs", "receivedAt", "participants", "assertions", "channel", "direction"} {
		if observationProperties[field] == nil {
			t.Fatalf("observation request is missing %s", field)
		}
	}
	assertionItems := asObj(asObj(observationProperties["assertions"])["items"])
	assertionProperties := asObj(assertionItems["properties"])
	for _, field := range []string{"valueSchemaVersion", "sourceType", "confidence", "reason", "validFrom", "validTo", "extractorVersion", "projectorCompatVersion", "userConfirmed"} {
		if assertionProperties[field] == nil {
			t.Fatalf("observation assertion request is missing %s", field)
		}
	}
	confidence := asObj(assertionProperties["confidence"])
	if confidence["minimum"] != 0 || confidence["maximum"] != 1 {
		t.Fatalf("observation assertion confidence bounds are invalid: %#v", confidence)
	}
	entityProjection := asObj(schemas["EntityProjection"])
	entityProperties := asObj(entityProjection["properties"])
	identifierItems := asObj(asObj(asObj(entityProperties["identifiers"])["additionalProperties"])["items"])
	if identifierItems["pattern"] != "^sha256:v1:[0-9a-f]{64}$" {
		t.Fatalf("entity identifier contract must reject raw PII: %#v", identifierItems)
	}
	resourceRefItems := asObj(asObj(entityProperties["resourceRefs"])["items"])
	if resourceRefItems["pattern"] == nil || asObj(entityProperties["resourceRefs"])["maxItems"] != 100 {
		t.Fatalf("entity resourceRef contract is unbounded: %#v", entityProperties["resourceRefs"])
	}
	entityID := asObj(entityProperties["id"])
	if entityID["description"] != "Optional body copy of the path ULID." || entityID["example"] != "01J9Z8Q5K3R7V2C4M6N8P0T1S3" {
		t.Fatalf("entity projection ULID metadata was overwritten: %#v", entityID)
	}
	entityStatus := asObj(asObj(asObj(schemas["EntitySpine"])["properties"])["status"])
	if entityStatus["description"] != "Lifecycle status." {
		t.Fatalf("entity lifecycle metadata was overwritten: %#v", entityStatus)
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
	if paths["/v1/me"] == nil || paths["/v1/background-task-templates"] == nil || paths["/v1/background-tasks"] == nil || paths["/v1/background-tasks/first-party/ensure"] == nil || paths["/v1/background-tasks/{slug}/runs/{runId}/events"] == nil || paths["/v1/background-tasks/{slug}/runs/{runId}/events/stream"] == nil || paths["/v1/llm/chat/completions"] == nil || paths["/v1/connectors"] == nil || paths["/v1/connections/{name}/api-key"] == nil || paths["/v1/slack-oauth/workspaces"] == nil || paths["/v1/slack-oauth/thread/read"] == nil || paths["/v1/entities"] == nil || paths["/v1/entities/{id}"] == nil || paths["/v1/entities/merge"] == nil {
		t.Fatal("checked-in openapi json is missing mounted runtime API paths")
	}
	if paths["/credit-ledgers"] != nil {
		t.Fatal("checked-in openapi json still contains unmounted ent CRUD paths")
	}
	schemas := asObj(asObj(spec["components"])["schemas"])
	if schemas["LLMChatCompletionsRequest"] == nil || schemas["MeResponse"] == nil || schemas["BackgroundTask"] == nil || schemas["BackgroundTaskTemplate"] == nil || schemas["RevisionConflictEnvelope"] == nil || schemas["IntegrationTemplateBlock"] == nil || schemas["SlackWorkspacesResponse"] == nil || schemas["SlackThreadReadResponse"] == nil || schemas["EntityProjection"] == nil || schemas["EntitySpine"] == nil {
		t.Fatal("checked-in openapi json is missing enriched runtime schemas")
	}
	if schemas["ConnectorCredentialCleanupJob"] != nil || schemas["ConnectorCredentialRecovery"] != nil {
		t.Fatal("checked-in openapi json exposes internal credential cleanup or recovery state")
	}
	evidenceProperties := asObj(asObj(schemas["MissionControlDimensionEvidence"])["properties"])
	if reason := asObj(evidenceProperties["reason"]); reason["type"] != "string" || reason["enum"] != nil {
		t.Fatalf("checked-in MissionControlDimensionEvidence.reason is invalid: %#v", reason)
	}
	if value := asObj(evidenceProperties["value"]); value["oneOf"] == nil {
		t.Fatalf("checked-in MissionControlDimensionEvidence.value is invalid: %#v", value)
	}
	entityProperties := asObj(asObj(schemas["EntityProjection"])["properties"])
	if id := asObj(entityProperties["id"]); id["description"] != "Optional body copy of the path ULID." || id["example"] != "01J9Z8Q5K3R7V2C4M6N8P0T1S3" {
		t.Fatalf("checked-in entity projection ULID metadata is invalid: %#v", id)
	}
}

func TestConnectorContractsDocumentLifecycleAndRateLimitResponses(t *testing.T) {
	spec := obj{"components": obj{"schemas": obj{}}}
	Enrich(spec)
	paths := asObj(spec["paths"])
	for _, path := range []string{"/v1/connections/{name}/start", "/v1/connectors/{name}/start", "/v1/connections/{name}/callback", "/v1/connectors/{name}/callback", "/v1/connections/{name}/mcp-token", "/v1/connectors/{name}/resource-token", "/v1/connections/{name}", "/v1/connectors/{name}/connections/{connectionID}"} {
		item := asObj(paths[path])
		var operation obj
		for _, method := range []string{"get", "post", "delete"} {
			if candidate := asObj(item[method]); candidate != nil {
				operation = candidate
				break
			}
		}
		responses := asObj(operation["responses"])
		if responses["429"] == nil {
			t.Fatalf("%s does not document 429", path)
		}
	}
	token := asObj(asObj(paths["/v1/connections/{name}/mcp-token"])["post"])
	if required, ok := asObj(token["requestBody"])["required"].(bool); !ok || required {
		t.Fatalf("MCP token body must be optional: %#v", token["requestBody"])
	}
	for _, status := range []string{"403", "409", "410", "429"} {
		if asObj(token["responses"])[status] == nil {
			t.Fatalf("MCP token missing %s", status)
		}
	}
}
