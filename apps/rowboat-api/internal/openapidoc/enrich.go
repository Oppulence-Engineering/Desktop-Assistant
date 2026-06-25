// Package openapidoc enriches the ent-generated OpenAPI base document with
// runtime routes, examples, response contracts, and security metadata.
package openapidoc

import (
	"encoding/json"
	"fmt"
	"os"
)

type obj = map[string]any

// EnrichFile loads, enriches, and rewrites an OpenAPI JSON document.
func EnrichFile(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read openapi file: %w", err)
	}
	var spec obj
	if err := json.Unmarshal(raw, &spec); err != nil {
		return fmt.Errorf("parse openapi file: %w", err)
	}
	Enrich(spec)
	out, err := json.MarshalIndent(spec, "", "  ")
	if err != nil {
		return fmt.Errorf("encode openapi file: %w", err)
	}
	out = append(out, '\n')
	if err := os.WriteFile(path, out, 0o644); err != nil {
		return fmt.Errorf("write openapi file: %w", err)
	}
	return nil
}

// Enrich turns the entoas document into the mounted Solomon AI API document.
func Enrich(spec obj) {
	spec["openapi"] = "3.0.3"
	spec["info"] = obj{
		"title":   "Solomon AI API",
		"version": "0.1.0",
		"description": "Solomon AI's desktop API. The API brokers WorkOS sign-in, billing and credit state, " +
			"OpenAI-compatible LLM calls, vendor proxies, Google OAuth handoff, connector OAuth, " +
			"Composio proxying, internal webhooks, and admin GraphQL. The ent-generated entity models " +
			"remain in components as schema references; the documented paths below are the routes mounted by cmd/server/wire.go.",
	}
	spec["externalDocs"] = obj{
		"description": "Local kind deployment workflow",
		"url":         "https://github.com/Oppulence-Engineering/rowboat/blob/main/docs/LOCAL_KIND_ROWBOAT_API.md",
	}
	spec["servers"] = []any{
		obj{"url": "/", "description": "Current Solomon AI API origin"},
		obj{"url": "http://localhost:18080", "description": "Local kind API"},
	}
	spec["tags"] = []any{
		obj{"name": "System", "description": "Health, readiness, and generated documentation endpoints."},
		obj{"name": "Auth", "description": "WorkOS AuthKit broker endpoints used by the desktop before it has a bearer token."},
		obj{"name": "Billing", "description": "Authenticated viewer identity, plan, and credit usage."},
		obj{"name": "Background Tasks", "description": "Authenticated cloud mirror for desktop background task specs, artifacts, run state, JSONL events, and remote trigger queueing."},
		obj{"name": "LLM", "description": "Credit-gated OpenAI-compatible text, chat, embedding, model-list, and streaming endpoints."},
		obj{"name": "Voice", "description": "Credit-gated ElevenLabs text-to-speech proxy."},
		obj{"name": "Search", "description": "Credit-gated Exa search proxy."},
		obj{"name": "Google OAuth", "description": "Browser and desktop handoff endpoints for Google OAuth tokens."},
		obj{"name": "Connectors", "description": "Connector registry, OAuth start/callback, MCP token minting, and disconnect flows."},
		obj{"name": "Composio", "description": "Authenticated reverse proxy to the Composio v3 API."},
		obj{"name": "Webhooks", "description": "Shared-secret webhooks from OAuth infrastructure."},
		obj{"name": "Internal", "description": "Server-to-server APIs guarded by X-Internal-Secret."},
		obj{"name": "GraphQL", "description": "Internal admin GraphQL over the ent graph."},
	}

	components := ensureObj(spec, "components")
	schemas := ensureObj(components, "schemas")
	responses := ensureObj(components, "responses")
	addSecuritySchemes(ensureObj(components, "securitySchemes"))
	addCommonResponses(responses)
	addRuntimeSchemas(schemas)
	enrichEntitySchemas(schemas)
	hideInternalEntitySchemas(schemas)

	paths := obj{}
	addRuntimePaths(paths)
	spec["paths"] = paths
}

func addSecuritySchemes(schemes obj) {
	schemes["BearerAuth"] = obj{
		"type":         "http",
		"scheme":       "bearer",
		"bearerFormat": "JWT",
		"description":  "WorkOS/OIDC access token. Authenticated desktop calls send this as Authorization: Bearer <token>.",
	}
	schemes["HookHMAC"] = obj{
		"type":        "apiKey",
		"in":          "header",
		"name":        "X-Hook-Signature",
		"description": "HMAC-SHA256 over the raw request body, formatted as sha256=<hex>.",
	}
	schemes["InternalSecret"] = obj{
		"type":        "apiKey",
		"in":          "header",
		"name":        "X-Internal-Secret",
		"description": "Static shared secret for server-to-server internal APIs.",
	}
}

func hideInternalEntitySchemas(schemas obj) {
	delete(schemas, "ComposioAccount")
	userSchema, ok := schemas["User"].(obj)
	if !ok {
		return
	}
	props, ok := userSchema["properties"].(obj)
	if !ok {
		return
	}
	delete(props, "composio_accounts")
	removeRequiredField(userSchema, "composio_accounts")
}

func removeRequiredField(schema obj, field string) {
	required, ok := schema["required"].([]any)
	if !ok {
		return
	}
	next := required[:0]
	for _, item := range required {
		if name, ok := item.(string); ok && name == field {
			continue
		}
		next = append(next, item)
	}
	schema["required"] = next
}

func addRuntimeSchemas(schemas obj) {
	schemas["ErrorEnvelope"] = objectSchema("RFC 9457 problem details returned by Solomon AI API handlers. code, requestId, and traceId are extension members.", obj{
		"type":      stringSchema("Problem type URI.", "https://api.rowboat.dev/problems/unauthorized"),
		"title":     stringSchema("Short HTTP-status summary.", "Unauthorized"),
		"status":    intSchema("HTTP status code.", 401),
		"detail":    stringSchema("Human-readable error detail.", "missing bearer token"),
		"instance":  stringSchema("Optional occurrence URI.", "/v1/me", nullable()),
		"code":      stringSchema("Stable machine-readable error code.", "unauthorized"),
		"requestId": stringSchema("Request id emitted by the API middleware.", "req-abc123", nullable()),
		"traceId":   stringSchema("OpenTelemetry trace id when tracing is active.", "4bf92f3577b34da6a3ce929d0e0e4736", nullable()),
	}, "type", "title", "status", "code")
	schemas["ReconnectErrorEnvelope"] = objectSchema("Problem details used when an upstream refresh token is invalid and the desktop must reconnect.", obj{
		"type":              stringSchema("Problem type URI.", "https://api.rowboat.dev/problems/reconnect_required"),
		"title":             stringSchema("Short HTTP-status summary.", "Conflict"),
		"status":            intSchema("HTTP status code.", 409),
		"detail":            stringSchema("Human-readable error detail.", "Google reports invalid_grant; user must reconnect."),
		"code":              stringEnum("Stable machine-readable error code.", "reconnect_required", "reconnect_required"),
		"requestId":         stringSchema("Request id emitted by the API middleware.", "req-abc123", nullable()),
		"traceId":           stringSchema("OpenTelemetry trace id when tracing is active.", "4bf92f3577b34da6a3ce929d0e0e4736", nullable()),
		"reconnectRequired": boolSchema("Whether the desktop should force the user through a new OAuth connection flow.", true),
	}, "type", "title", "status", "code", "reconnectRequired")
	schemas["HealthResponse"] = objectSchema("Liveness probe response.", obj{
		"status": stringEnum("Liveness status.", "ok", "ok"),
	}, "status")
	schemas["ReadyResponse"] = objectSchema("Readiness probe response.", obj{
		"status": stringEnum("Readiness status.", "ready", "ready", "not_ready"),
		"failed": stringSchema("Name of the failed readiness check when status is not_ready.", "database", nullable()),
	}, "status")
	schemas["ConfigResponse"] = objectSchema("Public bootstrap values consumed by the desktop before sign-in.", obj{
		"appUrl":          stringSchema("Browser-facing application origin.", "http://localhost:18080"),
		"oidcIssuerUrl":   stringSchema("OIDC issuer the desktop signs into.", "http://localhost:18090"),
		"supabaseUrl":     stringSchema("Compatibility alias for oidcIssuerUrl used by older desktop builds.", "http://localhost:18090"),
		"websocketApiUrl": stringSchema("Optional WebSocket API origin. Empty when not configured.", ""),
		"oauthClientId":   stringSchema("Pre-registered OAuth/OIDC client id. Empty means the desktop may fall back to dynamic registration.", "solomon-desktop-kind"),
	}, "appUrl", "oidcIssuerUrl", "supabaseUrl", "websocketApiUrl", "oauthClientId")
	schemas["WorkOSLoginURLResponse"] = objectSchema("AuthKit authorize URL for the desktop to open in a browser.", obj{
		"url": stringSchema("Fully-qualified WorkOS AuthKit authorize URL with PKCE and state query parameters.", "http://localhost:18090/user_management/authorize?client_id=solomon-desktop-kind&response_type=code&state=abc"),
	}, "url")
	schemas["WorkOSExchangeRequest"] = objectSchema("Authorization-code exchange request sent by the desktop after AuthKit redirects back.", obj{
		"code":         stringSchema("Authorization code returned by WorkOS AuthKit.", "auth_code_123"),
		"codeVerifier": stringSchema("PKCE verifier matching the original code challenge. Optional when PKCE was not used.", "pkce-verifier", nullable()),
	}, "code")
	schemas["WorkOSRefreshRequest"] = objectSchema("Refresh request for a WorkOS AuthKit token bundle.", obj{
		"refreshToken": stringSchema("Refresh token previously returned by the WorkOS broker.", "refresh_token_123"),
	}, "refreshToken")
	schemas["WorkOSTokenBundle"] = objectSchema("Desktop-facing token bundle normalized from WorkOS authenticate responses.", obj{
		"access_token":  stringSchema("JWT access token used as Authorization: Bearer for authenticated Solomon AI API calls.", "eyJhbGciOiJSUzI1NiIs..."),
		"refresh_token": stringSchema("Refresh token for obtaining a new WorkOS access token.", "refresh_token_123", nullable()),
		"expires_at":    int64Schema("Unix timestamp in seconds when the access token expires.", 1790784000),
		"token_type":    stringEnum("Token type.", "Bearer", "Bearer"),
		"user_id":       stringSchema("WorkOS user id when available.", "user_01HABCDEF", nullable()),
		"email":         stringSchema("Primary user email when available.", "user@example.com", nullable()),
	}, "access_token", "expires_at", "token_type")

	addBillingSchemas(schemas)
	addBackgroundTaskSchemas(schemas)
	addLLMSchemas(schemas)
	addVendorProxySchemas(schemas)
	addOAuthSchemas(schemas)
	addConnectorSchemas(schemas)
	addSlackOAuthSchemas(schemas)
	addCloudEventSchemas(schemas)
	addInternalSchemas(schemas)
}

func addBillingSchemas(schemas obj) {
	schemas["CurrentUser"] = objectSchema("Authenticated Solomon AI user resolved from the bearer token.", obj{
		"id":    uuidSchema("Local Solomon AI user id.", "a8dfa9b6-a7b2-46ea-982c-622a914c00e5"),
		"email": stringSchema("Best-known user email from WorkOS enrichment.", "kind@solomon-ai.co"),
	}, "id", "email")
	schemas["CreditUsageBucket"] = objectSchema("Credit bucket totals. One credit is currently modeled as $0.0001 of usage.", obj{
		"sanctionedCredits": intSchema("Credits granted to the user for this bucket.", 10000),
		"usedCredits":       intSchema("Credits consumed in this bucket.", 125),
		"availableCredits":  intSchema("Credits remaining in this bucket.", 9875),
	}, "sanctionedCredits", "usedCredits", "availableCredits")
	schemas["DailyCreditUsageBucket"] = objectSchema("Daily credit bucket. The day is UTC.", obj{
		"sanctionedCredits": intSchema("Credits granted to the user.", 10000),
		"usedCredits":       intSchema("Credits consumed since UTC midnight.", 25),
		"availableCredits":  intSchema("Credits remaining after today's usage.", 9975),
		"usageDay":          stringSchema("UTC day for the daily bucket, formatted YYYY-MM-DD.", "2026-06-04"),
	}, "sanctionedCredits", "usedCredits", "availableCredits", "usageDay")
	schemas["BillingUsage"] = objectSchema("Credit usage shape parsed by the desktop billing package.", obj{
		"sanctionedCredits": intSchema("Total credits granted by the subscription.", 10000),
		"usedCredits":       intSchema("Total credits consumed against the subscription.", 125),
		"availableCredits":  intSchema("Credits remaining.", 9875),
		"monthly":           ref("CreditUsageBucket"),
		"daily":             ref("DailyCreditUsageBucket"),
	}, "sanctionedCredits", "usedCredits", "availableCredits", "monthly", "daily")
	schemas["BillingState"] = objectSchema("Current plan, status, trial, and usage for the authenticated user.", obj{
		"plan":           stringSchema("Plan slug.", "free", obj{"enum": []any{"free", "starter", "pro"}}, nullable()),
		"status":         stringSchema("Billing status.", "active", obj{"enum": []any{"active", "trialing", "past_due", "canceled"}}, nullable()),
		"trialExpiresAt": stringSchema("Trial expiry as RFC3339 when trialing; null otherwise.", "2026-07-01T00:00:00.000Z", nullable()),
		"usage":          ref("BillingUsage"),
	}, "plan", "status", "trialExpiresAt", "usage")
	schemas["MeResponse"] = objectSchema("Response for GET /v1/me.", obj{
		"user":    ref("CurrentUser"),
		"billing": ref("BillingState"),
	}, "user", "billing")
}

func addBackgroundTaskSchemas(schemas obj) {
	triggerJSON := obj{
		"description": "Task trigger configuration mirrored from the desktop task.yaml. Common shapes include cron schedules, window schedules, or event subscriptions. Null clears the mirrored trigger config on PATCH.",
		"nullable":    true,
		"example":     obj{"cronExpr": "0 9 * * *", "timezone": "America/New_York"},
	}
	schemas["RevisionConflictEnvelope"] = objectSchema("Revision conflict returned when the caller edits a stale task, artifact, or run revision. Clients should refetch, merge, and retry with currentRevision.", obj{
		"type":            stringSchema("Problem type URI.", "https://api.rowboat.dev/problems/conflict"),
		"title":           stringSchema("Short HTTP-status summary.", "Conflict"),
		"status":          intSchema("HTTP status code.", 409),
		"detail":          stringEnum("Human-readable conflict detail.", "revision conflict", "revision conflict"),
		"code":            stringEnum("Stable machine-readable conflict code.", "conflict", "conflict"),
		"requestId":       stringSchema("Request id emitted by the API middleware.", "req-abc123", nullable()),
		"traceId":         stringSchema("OpenTelemetry trace id when tracing is active.", "4bf92f3577b34da6a3ce929d0e0e4736", nullable()),
		"currentRevision": intSchema("Current server revision for the resource that rejected the write.", 3),
	}, "type", "title", "status", "code", "currentRevision")
	schemas["BackgroundTask"] = objectSchema("Server-readable mirror of one background task. The API is the control plane; executionTarget=desktop runs locally in the desktop and executionTarget=api runs through the API Temporal worker.", obj{
		"id":              uuidSchema("Stable server id for this mirrored task.", "a8dfa9b6-a7b2-46ea-982c-622a914c00e5"),
		"slug":            stringSchema("Stable task slug matching the desktop bg-tasks/<slug> directory.", "daily-summary"),
		"name":            stringSchema("Human-readable task name from task.yaml.", "Daily Account Summary"),
		"instructions":    stringSchema("Task instructions from task.yaml. This is stored server-side so the API can audit, inspect, and eventually orchestrate task lifecycle actions.", "Summarize important account changes and draft follow-up notes."),
		"active":          boolSchema("Whether the task is enabled for local scheduling and remote trigger pickup.", true),
		"triggers":        triggerJSON,
		"model":           stringSchema("Preferred desktop-facing model id for runs of this task.", "openai/gpt-4.1-mini", nullable()),
		"provider":        stringSchema("Preferred provider slug for the model or execution backend.", "openai", nullable()),
		"executionTarget": stringEnum("Where this task executes. desktop preserves the local-first path; api dispatches to the Temporal-backed API worker.", "desktop", "desktop", "api"),
		"createdAt":       stringSchema("Original desktop task creation timestamp when known; otherwise the server row creation time.", "2026-06-04T20:38:00Z", obj{"format": "date-time"}),
		"updatedAt":       stringSchema("Server timestamp for the last mirrored task update.", "2026-06-04T20:39:00Z", obj{"format": "date-time"}),
		"lastAttemptAt":   stringSchema("Last time the desktop attempted to run this task.", "2026-06-04T21:00:00Z", obj{"format": "date-time"}, nullable()),
		"lastRunId":       stringSchema("Last desktop or remote-trigger run id mirrored for this task.", "run-20260604-210000", nullable()),
		"lastRunAt":       stringSchema("Last time the desktop completed or recorded a run for this task.", "2026-06-04T21:02:00Z", obj{"format": "date-time"}, nullable()),
		"lastRunSummary":  stringSchema("Short summary from the latest run.", "No high-priority account changes.", nullable()),
		"lastRunError":    stringSchema("Latest run error, empty when the latest run did not fail.", "", nullable()),
		"revision":        intSchema("Optimistic-lock revision. PATCH and DELETE must send the current value.", 2),
	}, "id", "slug", "name", "instructions", "active", "executionTarget", "createdAt", "updatedAt", "revision")
	schemas["BackgroundTaskListResponse"] = objectSchema("Task list for the authenticated user, ordered by slug.", obj{
		"tasks": arraySchema("Mirrored background tasks visible to this user.", ref("BackgroundTask")),
	}, "tasks")
	schemas["BackgroundTaskCreateRequest"] = objectSchema("Creates or first-syncs a desktop background task into the cloud mirror.", obj{
		"slug":            stringSchema("Optional stable slug. If omitted, rowboat-api slugifies name.", "daily-summary", nullable()),
		"name":            stringSchema("Human-readable task name.", "Daily Account Summary"),
		"instructions":    stringSchema("Task instructions mirrored from task.yaml.", "Summarize important account changes and draft follow-up notes."),
		"active":          boolSchema("Whether this task is active. Defaults to true.", true),
		"triggers":        triggerJSON,
		"model":           stringSchema("Preferred model id for new runs.", "openai/gpt-4.1-mini", nullable()),
		"provider":        stringSchema("Preferred provider slug.", "openai", nullable()),
		"executionTarget": stringEnum("Where this task should execute. Defaults to desktop.", "desktop", "desktop", "api"),
		"createdAt":       stringSchema("Original desktop task creation timestamp.", "2026-06-04T20:38:00Z", obj{"format": "date-time"}, nullable()),
		"lastAttemptAt":   stringSchema("Last attempt timestamp from local state.", "2026-06-04T21:00:00Z", obj{"format": "date-time"}, nullable()),
		"lastRunId":       stringSchema("Last local run id from the desktop.", "run-20260604-210000", nullable()),
		"lastRunAt":       stringSchema("Last local run timestamp.", "2026-06-04T21:02:00Z", obj{"format": "date-time"}, nullable()),
		"lastRunSummary":  stringSchema("Latest local run summary.", "No high-priority account changes.", nullable()),
		"lastRunError":    stringSchema("Latest local run error.", "", nullable()),
	}, "name", "instructions")
	schemas["BackgroundTaskPatchRequest"] = objectSchema("Revision-checked partial update for the task mirror. Omitted fields are left unchanged; triggers:null clears the trigger JSON.", obj{
		"revision":        intSchema("Current task revision returned by the last GET/list/PATCH response.", 2),
		"name":            stringSchema("New task name.", "Daily Account Summary", nullable()),
		"instructions":    stringSchema("New task instructions.", "Summarize important account changes and draft follow-up notes.", nullable()),
		"active":          boolSchema("Enable or disable local scheduling/remote pickup.", true),
		"triggers":        triggerJSON,
		"model":           stringSchema("Preferred model id for new runs.", "openai/gpt-4.1-mini", nullable()),
		"provider":        stringSchema("Preferred provider slug.", "openai", nullable()),
		"executionTarget": stringEnum("Where this task should execute.", "api", "desktop", "api"),
		"createdAt":       stringSchema("Original desktop task creation timestamp.", "2026-06-04T20:38:00Z", obj{"format": "date-time"}, nullable()),
		"lastAttemptAt":   stringSchema("Latest local attempt timestamp.", "2026-06-04T21:00:00Z", obj{"format": "date-time"}, nullable()),
		"lastRunId":       stringSchema("Latest local run id.", "run-20260604-210000", nullable()),
		"lastRunAt":       stringSchema("Latest local run timestamp.", "2026-06-04T21:02:00Z", obj{"format": "date-time"}, nullable()),
		"lastRunSummary":  stringSchema("Latest local run summary.", "No high-priority account changes.", nullable()),
		"lastRunError":    stringSchema("Latest local run error.", "", nullable()),
	}, "revision")
	schemas["BackgroundTaskArtifact"] = objectSchema("Markdown artifact body mirrored from bg-tasks/<slug>/index.md.", obj{
		"slug":      stringSchema("Task slug this artifact belongs to.", "daily-summary"),
		"body":      stringSchema("Full markdown body for the task artifact.", "# Daily Account Summary\n\nUse this context when summarizing account changes."),
		"revision":  intSchema("Optimistic-lock revision for artifact writes. Empty artifacts that do not exist yet return revision 0.", 2),
		"updatedAt": stringSchema("Server timestamp for the last artifact update.", "2026-06-04T20:39:00Z", obj{"format": "date-time"}),
	}, "slug", "body", "revision", "updatedAt")
	schemas["BackgroundTaskArtifactPutRequest"] = objectSchema("Creates or revision-checks an artifact mirror update. Omit revision or send 0 when creating a missing artifact.", obj{
		"revision": intSchema("Current artifact revision. Required for updates to an existing artifact.", 2),
		"body":     stringSchema("Full markdown body to store.", "# Daily Account Summary\n\nUpdated context."),
	}, "body")
	schemas["BackgroundTaskRun"] = objectSchema("One mirrored desktop execution, queued remote trigger, or API-worker Temporal execution for a background task.", obj{
		"id":                 uuidSchema("Stable server id for this run mirror.", "77f5e632-a841-4557-a8e4-9b8f0d207ff4"),
		"runId":              stringSchema("Cloud-visible run id. Desktop-created runs can use local ids; remote triggers use remote-trigger-<uuid> until claimed.", "run-20260604-210000"),
		"previousRunId":      stringSchema("Previous run id when this run was created by retry.", "run-20260604-210000", nullable()),
		"localRunId":         stringSchema("Actual desktop run id once a queued remote trigger has been claimed and executed locally.", "local-run-42", nullable()),
		"slug":               stringSchema("Task slug this run belongs to.", "daily-summary"),
		"trigger":            stringEnum("Trigger source for this run.", "manual", "manual", "cron", "window", "event"),
		"status":             stringEnum("Run lifecycle state.", "running", "queued", "running", "succeeded", "failed", "stopped"),
		"executor":           stringEnum("Execution backend that owns this run.", "desktop", "desktop", "api"),
		"model":              stringSchema("Model id used by this run.", "openai/gpt-4.1-mini", nullable()),
		"provider":           stringSchema("Provider used by this run.", "openai", nullable()),
		"useCase":            stringSchema("High-level usage label for cost attribution.", "background-task", nullable()),
		"subUseCase":         stringSchema("Task-specific usage label for cost attribution.", "daily-summary", nullable()),
		"requestedContext":   stringSchema("Optional context supplied when a user remotely triggered the task.", "Run this now and focus on high-risk accounts.", nullable()),
		"summary":            stringSchema("Short run summary from the desktop.", "No high-priority account changes.", nullable()),
		"error":              stringSchema("Run error when status is failed or stopped unexpectedly.", "", nullable()),
		"temporalWorkflowId": stringSchema("Temporal workflow id for API-worker runs.", "background-task/user/daily-summary/api-trigger-123", nullable()),
		"temporalRunId":      stringSchema("Temporal run id for the current workflow execution.", "01971cf4-3c7d-7aa0-9ac8-ef73bc506e16", nullable()),
		"temporalStatus":     stringSchema("Last mirrored Temporal status, separate from the product status.", "Running", nullable()),
		"temporalStartedAt":  stringSchema("Timestamp when Temporal execution started.", "2026-06-04T21:01:00Z", obj{"format": "date-time"}, nullable()),
		"temporalClosedAt":   stringSchema("Timestamp when Temporal execution closed.", "2026-06-04T21:02:00Z", obj{"format": "date-time"}, nullable()),
		"progressPercent":    intSchema("Best-known run progress for polling clients, 0-100.", 50, nullable()),
		"progressMessage":    stringSchema("Human-readable progress message for polling clients.", "Building API-native task artifact.", nullable()),
		"lastHeartbeatAt":    stringSchema("Latest worker heartbeat/progress timestamp.", "2026-06-04T21:01:30Z", obj{"format": "date-time"}, nullable()),
		"startedAt":          stringSchema("Desktop run start timestamp.", "2026-06-04T21:01:00Z", obj{"format": "date-time"}, nullable()),
		"completedAt":        stringSchema("Desktop run completion timestamp.", "2026-06-04T21:02:00Z", obj{"format": "date-time"}, nullable()),
		"createdAt":          stringSchema("Server row creation timestamp.", "2026-06-04T21:00:30Z", obj{"format": "date-time"}),
		"updatedAt":          stringSchema("Server row update timestamp.", "2026-06-04T21:02:05Z", obj{"format": "date-time"}),
		"revision":           intSchema("Optimistic-lock revision for run PATCH writes.", 2),
	}, "id", "runId", "slug", "trigger", "status", "executor", "createdAt", "updatedAt", "revision")
	schemas["BackgroundTaskRunsResponse"] = objectSchema("Run list for one task or the authenticated account.", obj{
		"runs":       arraySchema("Runs ordered by server creation time.", ref("BackgroundTaskRun")),
		"nextCursor": stringSchema("RFC3339 cursor for the next page when more runs are available.", "2026-06-04T21:00:30Z", nullable()),
	}, "runs")
	schemas["BackgroundTaskRunStatusResponse"] = objectSchema("Compact polling response for one run.", obj{
		"runId":              stringSchema("Cloud-visible run id.", "api-trigger-4a31958c-3a0a-4cb2-9361-ea563cd0477b"),
		"slug":               stringSchema("Task slug.", "daily-summary"),
		"status":             stringEnum("Product run status.", "running", "queued", "running", "succeeded", "failed", "stopped"),
		"executor":           stringEnum("Execution backend.", "api", "desktop", "api"),
		"temporalWorkflowId": stringSchema("Temporal workflow id for API-worker runs.", "background-task/user/daily-summary/api-trigger-123", nullable()),
		"temporalRunId":      stringSchema("Temporal run id for API-worker runs.", "01971cf4-3c7d-7aa0-9ac8-ef73bc506e16", nullable()),
		"temporalStatus":     stringSchema("Last mirrored Temporal status.", "Running", nullable()),
		"progressPercent":    intSchema("Best-known progress for polling clients.", 50, nullable()),
		"progressMessage":    stringSchema("Progress message.", "Building API-native task artifact.", nullable()),
		"lastHeartbeatAt":    stringSchema("Latest worker heartbeat/progress timestamp.", "2026-06-04T21:01:30Z", obj{"format": "date-time"}, nullable()),
		"startedAt":          stringSchema("Run start timestamp.", "2026-06-04T21:01:00Z", obj{"format": "date-time"}, nullable()),
		"completedAt":        stringSchema("Run completion timestamp.", "2026-06-04T21:02:00Z", obj{"format": "date-time"}, nullable()),
		"error":              stringSchema("Terminal error, when present.", "", nullable()),
		"revision":           intSchema("Current run revision.", 2),
	}, "runId", "slug", "status", "executor", "revision")
	schemas["BackgroundTaskRunCreateRequest"] = objectSchema("Creates a run mirror for a desktop execution. Remote/manual queue creation usually uses POST /trigger instead.", obj{
		"runId":              stringSchema("Cloud-visible run id from the desktop.", "run-20260604-210000"),
		"previousRunId":      stringSchema("Previous run id when this is a retry.", "run-20260604-205000", nullable()),
		"localRunId":         stringSchema("Desktop-local run id if different from runId.", "local-run-42", nullable()),
		"trigger":            stringEnum("Trigger source. Defaults to manual.", "manual", "manual", "cron", "window", "event"),
		"status":             stringEnum("Initial status. Defaults to running.", "running", "queued", "running", "succeeded", "failed", "stopped"),
		"executor":           stringEnum("Execution backend. Defaults from task.executionTarget.", "desktop", "desktop", "api"),
		"model":              stringSchema("Model id used by this run.", "openai/gpt-4.1-mini", nullable()),
		"provider":           stringSchema("Provider used by this run.", "openai", nullable()),
		"useCase":            stringSchema("High-level usage label.", "background-task", nullable()),
		"subUseCase":         stringSchema("Task-specific usage label.", "daily-summary", nullable()),
		"requestedContext":   stringSchema("Remote trigger context if this run was queued by the API.", "Run this now.", nullable()),
		"summary":            stringSchema("Initial run summary.", "started", nullable()),
		"error":              stringSchema("Initial run error.", "", nullable()),
		"temporalWorkflowId": stringSchema("Temporal workflow id for API-worker runs.", "background-task/user/daily-summary/api-trigger-123", nullable()),
		"temporalRunId":      stringSchema("Temporal run id.", "01971cf4-3c7d-7aa0-9ac8-ef73bc506e16", nullable()),
		"temporalStatus":     stringSchema("Last mirrored Temporal status.", "Started", nullable()),
		"progressPercent":    intSchema("Initial progress for polling clients.", 0, nullable()),
		"progressMessage":    stringSchema("Initial progress message.", "Queued for API worker.", nullable()),
		"lastHeartbeatAt":    stringSchema("Latest heartbeat timestamp.", "2026-06-04T21:01:30Z", obj{"format": "date-time"}, nullable()),
		"startedAt":          stringSchema("Run start timestamp.", "2026-06-04T21:01:00Z", obj{"format": "date-time"}, nullable()),
		"completedAt":        stringSchema("Run completion timestamp.", "2026-06-04T21:02:00Z", obj{"format": "date-time"}, nullable()),
	}, "runId")
	schemas["BackgroundTaskRunPatchRequest"] = objectSchema("Revision-checked update for mirrored run state.", obj{
		"revision":           intSchema("Current run revision.", 1),
		"previousRunId":      stringSchema("Previous run id when this is a retry.", "run-20260604-205000", nullable()),
		"localRunId":         stringSchema("Desktop-local run id after a queued trigger is claimed.", "local-run-42", nullable()),
		"trigger":            stringEnum("Trigger source.", "manual", "manual", "cron", "window", "event"),
		"status":             stringEnum("Run lifecycle state.", "succeeded", "queued", "running", "succeeded", "failed", "stopped"),
		"executor":           stringEnum("Execution backend.", "api", "desktop", "api"),
		"model":              stringSchema("Model id used by this run.", "openai/gpt-4.1-mini", nullable()),
		"provider":           stringSchema("Provider used by this run.", "openai", nullable()),
		"useCase":            stringSchema("High-level usage label.", "background-task", nullable()),
		"subUseCase":         stringSchema("Task-specific usage label.", "daily-summary", nullable()),
		"requestedContext":   stringSchema("Remote trigger context.", "Run this now.", nullable()),
		"summary":            stringSchema("Latest run summary.", "No high-priority account changes.", nullable()),
		"error":              stringSchema("Latest run error.", "", nullable()),
		"temporalWorkflowId": stringSchema("Temporal workflow id for API-worker runs.", "background-task/user/daily-summary/api-trigger-123", nullable()),
		"temporalRunId":      stringSchema("Temporal run id.", "01971cf4-3c7d-7aa0-9ac8-ef73bc506e16", nullable()),
		"temporalStatus":     stringSchema("Last mirrored Temporal status.", "Running", nullable()),
		"temporalStartedAt":  stringSchema("Temporal start timestamp.", "2026-06-04T21:01:00Z", obj{"format": "date-time"}, nullable()),
		"temporalClosedAt":   stringSchema("Temporal close timestamp.", "2026-06-04T21:02:00Z", obj{"format": "date-time"}, nullable()),
		"progressPercent":    intSchema("Progress for polling clients, 0-100.", 50, nullable()),
		"progressMessage":    stringSchema("Progress message.", "Building API-native task artifact.", nullable()),
		"lastHeartbeatAt":    stringSchema("Latest heartbeat timestamp.", "2026-06-04T21:01:30Z", obj{"format": "date-time"}, nullable()),
		"startedAt":          stringSchema("Run start timestamp.", "2026-06-04T21:01:00Z", obj{"format": "date-time"}, nullable()),
		"completedAt":        stringSchema("Run completion timestamp.", "2026-06-04T21:02:00Z", obj{"format": "date-time"}, nullable()),
	}, "revision")
	schemas["BackgroundTaskRunEvent"] = objectSchema("One JSONL event mirrored from a desktop run log.", obj{
		"id":         uuidSchema("Stable server id for the event row.", "06227adb-924f-46f1-b324-1b10d080a660"),
		"seq":        intSchema("Zero-based sequence number within the run log. Duplicate seq values for a run are ignored on append.", 1),
		"type":       stringSchema("Event type, either supplied explicitly or copied from event.type.", "completed", nullable()),
		"event":      freeFormSchema("Original JSON event object from the desktop run log."),
		"receivedAt": stringSchema("Server timestamp when the event was stored.", "2026-06-04T21:02:05Z", obj{"format": "date-time"}),
	}, "id", "seq", "event", "receivedAt")
	schemas["BackgroundTaskRunEventsResponse"] = objectSchema("Ordered event list for a run.", obj{
		"events": arraySchema("Run events ordered by seq.", ref("BackgroundTaskRunEvent")),
	}, "events")
	schemas["BackgroundTaskRunEventInput"] = objectSchema("One event to append to a run log mirror.", obj{
		"seq":   intSchema("Zero-based sequence number within the run log.", 1),
		"type":  stringSchema("Optional event type. If omitted, rowboat-api reads event.type when present.", "completed", nullable()),
		"event": freeFormSchema("Original JSON event object from the desktop run log."),
	}, "seq", "event")
	schemas["BackgroundTaskRunEventsAppendRequest"] = objectSchema("Batch append for JSONL run events. Existing seq values are skipped to make retries idempotent.", obj{
		"events": arraySchema("Events to append.", ref("BackgroundTaskRunEventInput")),
	}, "events")
	schemas["BackgroundTaskRunEventsAppendResponse"] = objectSchema("Append result counts.", obj{
		"stored":  intSchema("Number of events inserted.", 2),
		"skipped": intSchema("Number of duplicate seq events ignored.", 1),
	}, "stored", "skipped")
	schemas["BackgroundTaskTriggerRequest"] = objectSchema("Queues a remote run request. The desktop sync loop claims queued runs and executes them locally.", obj{
		"trigger": stringEnum("Trigger source for the queued run. Defaults to manual.", "manual", "manual", "cron", "window", "event"),
		"context": stringSchema("Optional user-supplied execution context passed to the desktop when it claims the queued run.", "Run this now and focus on high-risk accounts.", nullable()),
	})
	schemas["BackgroundTaskSignalRequest"] = objectSchema("Control signal sent to a Temporal-backed API-worker run.", obj{
		"signal":  stringEnum("Supported control signal.", "pause", "pause", "resume", "update_context"),
		"payload": freeFormSchema("Optional signal payload. update_context can carry replacement context."),
	}, "signal")
}

func addLLMSchemas(schemas obj) {
	message := objectSchema("OpenAI-compatible chat message. Additional OpenAI fields are passed through.", obj{
		"role":    stringEnum("Message role.", "user", "system", "user", "assistant", "tool"),
		"content": obj{"description": "Text, multimodal content array, or provider-specific content payload."},
		"name":    stringSchema("Optional participant name.", "analyst", nullable()),
	}, "role", "content")
	message["additionalProperties"] = true
	schemas["LLMChatMessage"] = message

	chat := objectSchema("OpenAI-compatible chat completions request. rowboat-api requires model, gates credits, rewrites routable model ids, and passes through other fields.", obj{
		"model":           stringSchema("Desktop-facing model id. See GET /v1/llm/models for routable ids.", "openai/gpt-4.1-mini"),
		"messages":        arraySchema("Conversation messages.", ref("LLMChatMessage")),
		"stream":          boolSchema("When true, rowboat-api streams server-sent events and asks the upstream to include usage.", true),
		"max_tokens":      intSchema("Maximum output tokens to reserve and request from the upstream.", 1024),
		"temperature":     numberSchema("Sampling temperature forwarded to the upstream.", 0.2),
		"tools":           arraySchema("OpenAI-compatible tool definitions forwarded untouched.", freeFormSchema("Tool definition.")),
		"tool_choice":     obj{"description": "OpenAI-compatible tool choice. String or object values are forwarded untouched.", "example": "auto"},
		"response_format": freeFormSchema("OpenAI-compatible response_format object forwarded untouched."),
	}, "model", "messages")
	chat["additionalProperties"] = true
	schemas["LLMChatCompletionsRequest"] = chat

	completion := objectSchema("OpenAI-compatible legacy completions request.", obj{
		"model":       stringSchema("Desktop-facing model id.", "openai/gpt-4.1-mini"),
		"prompt":      obj{"description": "Prompt string or prompt array forwarded to the upstream.", "example": "Summarize this account."},
		"stream":      boolSchema("When true, stream upstream completion events.", false),
		"max_tokens":  intSchema("Maximum output tokens to reserve and request.", 512),
		"temperature": numberSchema("Sampling temperature forwarded to the upstream.", 0.2),
	}, "model", "prompt")
	completion["additionalProperties"] = true
	schemas["LLMCompletionsRequest"] = completion

	embeddings := objectSchema("OpenAI-compatible embeddings request.", obj{
		"model":           stringSchema("Desktop-facing embedding model id.", "openai/text-embedding-3-small"),
		"input":           obj{"description": "Input string or array of strings.", "example": []any{"customer invoice", "payment risk"}},
		"encoding_format": stringSchema("Embedding encoding format forwarded to the upstream.", "float", nullable()),
		"dimensions":      intSchema("Optional embedding dimensions for models that support it.", 1536),
	}, "model", "input")
	embeddings["additionalProperties"] = true
	schemas["LLMEmbeddingsRequest"] = embeddings

	schemas["LLMGatewayResponse"] = freeFormSchema("OpenAI-compatible upstream response. For streaming calls, the same endpoint returns text/event-stream chunks.")
	schemas["LLMModel"] = objectSchema("Routable model id exposed to the desktop.", obj{
		"id": stringSchema("Provider/model slug accepted by the LLM gateway.", "openai/gpt-4.1-mini"),
	}, "id")
	schemas["LLMModelsResponse"] = objectSchema("Catalog of priced and routable model ids.", obj{
		"data": arraySchema("Available models sorted by id.", ref("LLMModel")),
	}, "data")
}

func addVendorProxySchemas(schemas obj) {
	schemas["VoiceTextToSpeechRequest"] = objectSchema("ElevenLabs text-to-speech request body. Solomon AI API reads text for credit charging and forwards the full JSON body unchanged.", obj{
		"text":     stringSchema("Text to synthesize. Charged per Unicode character.", "Hello from Solomon AI."),
		"model_id": stringSchema("Optional ElevenLabs model id.", "eleven_multilingual_v2", nullable()),
		"voice_settings": objectSchema("Optional ElevenLabs voice settings forwarded unchanged.", obj{
			"stability":         numberSchema("Voice stability.", 0.5),
			"similarity_boost":  numberSchema("Voice similarity boost.", 0.75),
			"style":             numberSchema("Style exaggeration.", 0),
			"use_speaker_boost": boolSchema("Speaker boost toggle.", true),
		}),
	}, "text")
	schemas["ExaSearchRequest"] = objectSchema("Exa search request body. Solomon AI API applies a flat credit charge and forwards the JSON body unchanged to Exa /search.", obj{
		"query":          stringSchema("Natural-language or keyword search query.", "recent fintech accounts receivable trends"),
		"numResults":     intSchema("Maximum result count requested from Exa.", 5),
		"type":           stringSchema("Exa search type, for example neural or keyword.", "neural"),
		"includeDomains": arraySchema("Optional domain allow-list.", stringSchema("Domain.", "example.com")),
		"excludeDomains": arraySchema("Optional domain deny-list.", stringSchema("Domain.", "spam.example")),
		"contents":       freeFormSchema("Optional Exa contents selector."),
	}, "query")
	schemas["ExaSearchRequest"].(obj)["additionalProperties"] = true
	schemas["ExaSearchResponse"] = freeFormSchema("Exa /search JSON response, proxied unchanged.")
	schemas["ComposioProxyResponse"] = freeFormSchema("Composio v3 response body. Connected-account list responses are filtered to the caller's mapped accounts.")
}

func addOAuthSchemas(schemas obj) {
	schemas["OAuthTokenBundle"] = objectSchema("OAuth token bundle returned to the desktop.", obj{
		"access_token":  stringSchema("Provider access token.", "ya29.a0AfH6S..."),
		"refresh_token": stringSchema("Provider refresh token, present on claim when the provider issues one.", "1//refresh", nullable()),
		"expires_at":    int64Schema("Unix timestamp in seconds when the access token expires.", 1790784000),
		"scope":         stringSchema("Space-delimited OAuth scopes.", "openid email profile https://www.googleapis.com/auth/gmail.readonly", nullable()),
		"token_type":    stringSchema("OAuth token type.", "Bearer", nullable()),
	}, "access_token", "expires_at")
	schemas["GoogleClaimRequest"] = objectSchema("Redeems a one-time Google OAuth handoff ticket parked by /oauth/google/callback.", obj{
		"session": stringSchema("Opaque state/session ticket returned to the desktop deep link.", "state_abc123"),
	}, "session")
	schemas["GoogleRefreshRequest"] = objectSchema("Refreshes a Google access token with the server-held OAuth client secret.", obj{
		"refreshToken": stringSchema("Google refresh token from a prior claim.", "1//refresh"),
	}, "refreshToken")
}

func addConnectorSchemas(schemas obj) {
	schemas["Connector"] = objectSchema("Connector entry shown by the desktop connector picker.", obj{
		"name":        stringSchema("Stable connector slug.", "canvas"),
		"displayName": stringSchema("Human-readable connector name.", "Canvas"),
		"description": stringSchema("Short product capability description.", "Banking, invoicing, dunning, transactions"),
		"mcpUrl":      stringSchema("MCP endpoint the desktop should call after obtaining an MCP token.", "https://api.canvas.solomon-ai.co/v1/mcp"),
		"authType":    stringEnum("Connector credential flow.", "oauth", "oauth", "api_key"),
		"scopes":      arraySchema("OAuth scopes requested for this connector.", stringSchema("Scope.", "invoices:read")),
		"iconUrl":     stringSchema("Optional icon URL for UI display.", "https://example.com/icon.png", nullable()),
		"connected":   boolSchema("Whether the authenticated user has an active connection.", true),
		"connectedAt": stringSchema("RFC3339 connection timestamp when connected.", "2026-06-04T20:38:00Z", nullable()),
	}, "name", "displayName", "description", "mcpUrl", "authType", "connected")
	schemas["ConnectorsResponse"] = objectSchema("Connector registry plus per-user connection state.", obj{
		"connectors": arraySchema("Available connectors in configured order.", ref("Connector")),
	}, "connectors")
	schemas["ConnectionStartResponse"] = objectSchema("OAuth authorize URL for a connector.", obj{
		"authorize_url": stringSchema("Browser URL the desktop opens to start the connector OAuth flow.", "https://oauth.solomon-ai.co/oauth2/auth?client_id=rowboat-api&state=..."),
	}, "authorize_url")
	schemas["MCPTokenResponse"] = objectSchema("Short-lived credential and target URL for calling a connector MCP endpoint.", obj{
		"access_token": stringSchema("Bearer token or API key for the connector's MCP endpoint.", "mcp_access_token"),
		"token_type":   stringSchema("Token type, usually Bearer.", "Bearer"),
		"expires_at":   int64Schema("Unix timestamp in seconds for OAuth connector tokens. API-key connectors may omit it.", 1790784000),
		"mcpUrl":       stringSchema("Connector MCP endpoint URL.", "https://api.canvas.solomon-ai.co/v1/mcp"),
	}, "access_token", "token_type", "mcpUrl")
}

func addSlackOAuthSchemas(schemas obj) {
	schemas["SlackClaimRequest"] = objectSchema("Slack install session ticket redemption.", obj{
		"session": stringSchema("State ticket from the solomon-ai://oauth/slack/done deep link.", "state_abc123"),
	}, "session")
	schemas["SlackClaimResponse"] = objectSchema("Connected Slack workspace metadata. The bot token is server-held and never returned.", obj{
		"connected": boolSchema("Whether the workspace connection was stored.", true),
		"teamId":    stringSchema("Slack workspace (team) id — the key Events API deliveries resolve against.", "T0EXAMPLE"),
		"teamName":  stringSchema("Workspace display name.", "Acme", nullable()),
		"scope":     stringSchema("Granted bot scopes, comma-separated.", "channels:history,channels:read", nullable()),
		"botUserId": stringSchema("Bot user id in the workspace.", "U0BOT", nullable()),
	}, "connected", "teamId")
}

func addCloudEventSchemas(schemas obj) {
	schemas["CloudEventIngestRequest"] = objectSchema("Normalized cloud event envelope posted by internal services, tests, or the desktop (RFC 003).", obj{
		"source":          stringEnum("Event source.", "internal", "gmail", "google_calendar", "slack", "webhook", "internal"),
		"sourceEventId":   stringSchema("Provider-side event id.", "evt_123", nullable()),
		"sourceAccountId": stringSchema("Connected-account key the event belongs to.", "acct_google_primary", nullable()),
		"eventType":       stringSchema("Provider-specific event type.", "email.received", nullable()),
		"subject":         stringSchema("Short title used in UI and routing prompts.", "Invoice #4821 dispute", nullable()),
		"text":            stringSchema("Human-readable gist used in routing prompts.", "Acme disputed invoice #4821 for $18,000.", nullable()),
		"payload":         freeFormSchema("Full normalized provider object. Sealed at rest; returned only by the event detail endpoint."),
		"dedupeKey":       stringSchema("Required idempotency anchor, unique per (user, source).", "gmail:msg:msg_123"),
		"occurredAt":      stringSchema("RFC3339 provider event time.", "2026-06-06T14:00:00Z", nullable()),
	}, "source", "dedupeKey")
	schemas["CloudEventIngestResponse"] = objectSchema("Ingestion result. 202 for a fresh event; 200 with deduped=true for an idempotent replay.", obj{
		"eventId":          stringSchema("Cloud event id.", "0c0afab1-7f6f-4f0b-9d8e-1e58e8b0f111"),
		"routingStatus":    stringEnum("Routing status at response time.", "pending", "pending", "routed", "skipped", "failed"),
		"deduped":          boolSchema("Whether this post matched an existing (user, source, dedupeKey) event.", false),
		"matchedTaskCount": intSchema("Tasks the router matched (populated once routed).", 0),
	}, "eventId", "routingStatus", "deduped")
	schemas["CloudEvent"] = objectSchema("Stored cloud event. payload and routing appear only on the detail endpoint.", obj{
		"id":               stringSchema("Cloud event id.", "0c0afab1-7f6f-4f0b-9d8e-1e58e8b0f111"),
		"source":           stringEnum("Event source.", "gmail", "gmail", "google_calendar", "slack", "webhook", "internal"),
		"sourceEventId":    stringSchema("Provider-side event id.", "evt_123", nullable()),
		"sourceAccountId":  stringSchema("Connected-account key.", "acct_google_primary", nullable()),
		"eventType":        stringSchema("Provider-specific event type.", "email.received", nullable()),
		"subject":          stringSchema("Short title.", "Invoice #4821 dispute", nullable()),
		"text":             stringSchema("Human-readable gist.", "Acme disputed invoice #4821.", nullable()),
		"dedupeKey":        stringSchema("Idempotency anchor.", "gmail:msg:msg_123"),
		"routingStatus":    stringEnum("Routing status.", "routed", "pending", "routed", "skipped", "failed"),
		"matchedTaskCount": intSchema("Tasks the router matched.", 1),
		"occurredAt":       stringSchema("RFC3339 provider event time.", "2026-06-06T14:00:00Z", nullable()),
		"receivedAt":       stringSchema("RFC3339 API receipt time.", "2026-06-06T14:00:02Z"),
		"routedAt":         stringSchema("RFC3339 router completion time.", "2026-06-06T14:00:09Z", nullable()),
		"routing":          freeFormSchema("Routing decision summary (threshold, prompt versions, per-task decisions). Detail endpoint only."),
		"payload":          freeFormSchema("Decrypted normalized provider payload. Detail endpoint only."),
	}, "id", "source", "dedupeKey", "routingStatus", "receivedAt")
	schemas["CloudEventListResponse"] = objectSchema("Cloud event page ordered by receivedAt descending.", obj{
		"events":     arraySchema("Events in this page (payload omitted).", ref("CloudEvent")),
		"nextCursor": stringSchema("Opaque cursor for the next page; empty when exhausted.", "2026-06-06T14:00:02.123456Z|0c0afab1-7f6f-4f0b-9d8e-1e58e8b0f111", nullable()),
	}, "events")
	schemas["CloudEventRun"] = objectSchema("Run triggered by a cloud event.", obj{
		"runId":       stringSchema("Run id.", "event-7e0a1f2b"),
		"status":      stringSchema("Run status.", "succeeded"),
		"trigger":     stringEnum("Run trigger.", "event", "event"),
		"executor":    stringEnum("Run executor.", "api", "api"),
		"taskSlug":    stringSchema("Slug of the task the run executed.", "acme-ar-watch", nullable()),
		"createdAt":   stringSchema("RFC3339 run creation time.", "2026-06-06T14:00:10Z"),
		"completedAt": stringSchema("RFC3339 run completion time.", "2026-06-06T14:02:31Z", nullable()),
	}, "runId", "status", "trigger", "executor", "createdAt")
	schemas["CloudEventRunsResponse"] = objectSchema("Runs triggered by one cloud event.", obj{
		"runs": arraySchema("Linked runs.", ref("CloudEventRun")),
	}, "runs")
	schemas["InternalCloudEventIngestRequest"] = objectSchema("Server-to-server cloud event ingestion: the caller names the event owner explicitly.", obj{
		"userId":    stringSchema("Rowboat user id (UUID) owning the event.", "a8dfa9b6-a7b2-46ea-982c-622a914c00e5"),
		"source":    stringEnum("Event source.", "internal", "gmail", "google_calendar", "slack", "webhook", "internal"),
		"dedupeKey": stringSchema("Required idempotency anchor.", "internal:job:42"),
	}, "userId", "source", "dedupeKey")
}

func addInternalSchemas(schemas obj) {
	schemas["PreConsentRequest"] = objectSchema("Ory pre-consent webhook payload mapped by ops.", obj{
		"workos_user_id":     stringSchema("WorkOS user id. If absent, subject is used.", "user_01HABCDEF"),
		"subject":            stringSchema("Fallback subject/user id from Ory.", "user_01HABCDEF", nullable()),
		"connector":          stringSchema("Connector slug being requested.", "canvas", nullable()),
		"requested_audience": stringSchema("Requested token audience. Used to resolve connector when connector is absent.", "canvas-api", nullable()),
	}, "requested_audience")
	schemas["Upsell"] = objectSchema("Upgrade instruction returned when a connector requires a higher plan.", obj{
		"requiredPlan": stringEnum("Minimum plan required.", "pro", "starter", "pro"),
		"message":      stringSchema("Human-readable upgrade copy.", "Upgrade to pro to connect Canvas"),
	}, "requiredPlan", "message")
	schemas["PreConsentResponse"] = objectSchema("Connector entitlement decision.", obj{
		"allow":  boolSchema("Whether Ory should continue the consent flow.", true),
		"upsell": ref("Upsell"),
	}, "allow")
	schemas["InternalInvalidateRequest"] = objectSchema("Server-to-server force disconnect request.", obj{
		"workos_user_id": stringSchema("WorkOS user id whose connection should be invalidated.", "user_01HABCDEF"),
		"connector":      stringSchema("Connector slug to disconnect.", "canvas"),
	}, "workos_user_id", "connector")
	schemas["InternalInvalidateResponse"] = objectSchema("Force disconnect result.", obj{
		"invalidated": boolSchema("Always true on successful handling, including no-op unknown users.", true),
		"deleted":     intSchema("Number of connection rows deleted. Omitted for unknown users.", 1),
	}, "invalidated")
	schemas["GraphQLRequest"] = objectSchema("GraphQL request envelope.", obj{
		"query":         stringSchema("GraphQL query or mutation.", "{ users(first: 10) { edges { node { id email } } } }"),
		"variables":     freeFormSchema("Optional GraphQL variables."),
		"operationName": stringSchema("Optional operation name.", "ListUsers", nullable()),
	}, "query")
	schemas["GraphQLResponse"] = objectSchema("GraphQL response envelope.", obj{
		"data":   freeFormSchema("GraphQL data result."),
		"errors": arraySchema("GraphQL execution errors.", freeFormSchema("GraphQL error.")),
	})
}

func addCommonResponses(responses obj) {
	responses["400"] = problemResponse("Bad request. The request is malformed, missing a required parameter, or has invalid JSON.", ref("ErrorEnvelope"), problemExample(400, "Bad Request", "missing model", "bad_request"))
	responses["401"] = problemResponse("Unauthorized. Missing, invalid, or expired bearer token or shared secret.", ref("ErrorEnvelope"), problemExample(401, "Unauthorized", "missing bearer token", "unauthorized"))
	responses["402"] = problemResponse("Payment required. The user does not have enough credits for the requested metered call.", ref("ErrorEnvelope"), problemExample(402, "Payment Required", "insufficient_credits", "insufficient_credits"))
	responses["403"] = problemResponse("Forbidden. The caller is authenticated but cannot access this resource.", ref("ErrorEnvelope"), problemExample(403, "Forbidden", "ticket does not belong to this user", "forbidden"))
	responses["404"] = problemResponse("Not found. The requested resource, connector, or OAuth handoff ticket does not exist.", ref("ErrorEnvelope"), problemExample(404, "Not Found", "connector not connected", "not_connected"))
	responses["409"] = problemResponse("Conflict. Usually means an upstream refresh token is invalid and the user must reconnect.", ref("ReconnectErrorEnvelope"), reconnectProblemExample())
	responses["410"] = problemResponse("Gone. A one-time handoff ticket existed but expired before redemption.", ref("ErrorEnvelope"), problemExample(410, "Gone", "ticket expired", "ticket_expired"))
	responses["429"] = problemResponse("Too many requests. A per-user rate limit bucket rejected the request.", ref("ErrorEnvelope"), problemExample(429, "Too Many Requests", "rate limit exceeded", "rate_limited"))
	responses["500"] = problemResponse("Internal server error.", ref("ErrorEnvelope"), problemExample(500, "Internal Server Error", "could not load billing", "internal_error"))
	responses["502"] = problemResponse("Bad gateway. A configured upstream provider failed or the provider is not configured.", ref("ErrorEnvelope"), problemExample(502, "Bad Gateway", "provider not configured", "provider_unconfigured"))
	responses["503"] = problemResponse("Service unavailable. Authentication or readiness dependencies are temporarily unavailable.", ref("ErrorEnvelope"), problemExample(503, "Service Unavailable", "authentication unavailable", "auth_unavailable"))
}

func addRuntimePaths(paths obj) {
	paths["/healthz"] = obj{"get": operation("System", "Liveness probe", "Returns ok when the HTTP process is alive. This does not prove dependencies are reachable.", "getHealthz", nil, nil, nil, obj{
		"200": jsonResponse("Process is alive.", ref("HealthResponse"), obj{"status": "ok"}),
	})}
	paths["/readyz"] = obj{"get": operation("System", "Readiness probe", "Runs registered readiness checks such as database connectivity and returns ready only when dependencies are usable.", "getReadyz", nil, nil, nil, obj{
		"200": jsonResponse("Service is ready.", ref("ReadyResponse"), obj{"status": "ready"}),
		"503": responseRef("503"),
	})}
	paths["/openapi.json"] = obj{"get": operation("System", "Download OpenAPI document", "Returns this enriched OpenAPI document. Scalar uses this endpoint to render /docs.", "getOpenAPI", nil, nil, nil, obj{
		"200": obj{"description": "OpenAPI 3.0 JSON document.", "content": obj{"application/json": obj{"schema": freeFormSchema("OpenAPI document.")}}},
	})}
	paths["/v1/config"] = obj{"get": operation("System", "Fetch desktop bootstrap config", "Public endpoint fetched by the desktop before sign-in. Values identify the app origin, OIDC issuer, optional WebSocket API, and static OAuth client id.", "getConfig", nil, nil, nil, obj{
		"200": jsonResponse("Desktop bootstrap config.", ref("ConfigResponse"), obj{"appUrl": "http://localhost:18080", "oidcIssuerUrl": "http://localhost:18090", "supabaseUrl": "http://localhost:18090", "websocketApiUrl": "", "oauthClientId": "solomon-desktop-kind"}),
	})}

	addAuthPaths(paths)
	addBillingPaths(paths)
	addBackgroundTaskPaths(paths)
	addLLMPaths(paths)
	addVendorProxyPaths(paths)
	addGoogleOAuthPaths(paths)
	addSlackOAuthPaths(paths)
	addConnectorPaths(paths)
	addCloudEventPaths(paths)
	addInternalPaths(paths)
}

func addCloudEventPaths(paths obj) {
	paths["/v1/events"] = obj{
		"post": operation("Cloud Events", "Ingest a cloud event", "Stores one normalized event idempotently on (user, source, dedupeKey) and enqueues async routing to matching API-target background tasks. Returns 202 for a fresh event and 200 with deduped=true for a replay.", "ingestCloudEvent", bearer(), nil, jsonRequest("Normalized event envelope.", ref("CloudEventIngestRequest"), obj{
			"source":    "internal",
			"eventType": "email.received",
			"subject":   "Invoice #4821 dispute",
			"text":      "Acme disputed invoice #4821 for $18,000 due to a pricing mismatch.",
			"payload":   obj{"provider": "gmail", "messageId": "msg_123"},
			"dedupeKey": "gmail:msg:msg_123",
		}), obj{
			"202": jsonResponse("Event stored, routing enqueued.", ref("CloudEventIngestResponse"), obj{"eventId": "0c0afab1-7f6f-4f0b-9d8e-1e58e8b0f111", "routingStatus": "pending", "deduped": false}),
			"200": jsonResponse("Duplicate dedupeKey: existing event returned, routing not re-run.", ref("CloudEventIngestResponse"), obj{"eventId": "0c0afab1-7f6f-4f0b-9d8e-1e58e8b0f111", "routingStatus": "routed", "deduped": true, "matchedTaskCount": 1}),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"413": problemResponse("Payload exceeds the configured size cap.", ref("ErrorEnvelope"), problemExample(413, "Request Entity Too Large", "payload exceeds 262144 bytes", "payload_too_large")),
			"500": responseRef("500"),
		}),
		"get": operation("Cloud Events", "List cloud events", "Lists the authenticated user's ingested events ordered by receivedAt descending. Payload is omitted from list responses; fetch the detail endpoint for it.", "listCloudEvents", bearer(), []any{
			queryParam("source", "Filter by event source.", false, stringSchema("Source.", "gmail")),
			queryParam("routingStatus", "Filter by routing status.", false, stringSchema("Routing status.", "routed")),
			queryParam("since", "Only events received at or after this RFC3339 time.", false, stringSchema("RFC3339 lower bound.", "2026-06-06T00:00:00Z")),
			queryParam("until", "Only events received at or before this RFC3339 time.", false, stringSchema("RFC3339 upper bound.", "2026-06-07T00:00:00Z")),
			queryParam("limit", "Page size (1-500, default 100).", false, intSchema("Page size.", 100)),
			queryParam("cursor", "Opaque cursor from a prior page's nextCursor.", false, stringSchema("Pagination cursor.", "")),
		}, nil, obj{
			"200": jsonResponse("Event page.", ref("CloudEventListResponse"), obj{"events": []any{}, "nextCursor": ""}),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"500": responseRef("500"),
		}),
	}
	paths["/v1/events/{eventId}"] = obj{"get": operation("Cloud Events", "Get a cloud event", "Returns one event including the decrypted payload and the routing decision summary.", "getCloudEvent", bearer(), []any{
		pathParam("eventId", "Cloud event id.", stringSchema("Event id.", "0c0afab1-7f6f-4f0b-9d8e-1e58e8b0f111")),
	}, nil, obj{
		"200": jsonResponse("Event detail.", ref("CloudEvent"), obj{"id": "0c0afab1-7f6f-4f0b-9d8e-1e58e8b0f111", "source": "internal", "dedupeKey": "gmail:msg:msg_123", "routingStatus": "routed", "matchedTaskCount": 1, "receivedAt": "2026-06-06T14:00:02Z"}),
		"401": responseRef("401"),
		"404": responseRef("404"),
		"500": responseRef("500"),
	})}
	paths["/v1/events/{eventId}/runs"] = obj{"get": operation("Cloud Events", "List runs triggered by a cloud event", "Returns the trigger=event runs this event fired — the event-to-run audit link.", "listCloudEventRuns", bearer(), []any{
		pathParam("eventId", "Cloud event id.", stringSchema("Event id.", "0c0afab1-7f6f-4f0b-9d8e-1e58e8b0f111")),
	}, nil, obj{
		"200": jsonResponse("Linked runs.", ref("CloudEventRunsResponse"), obj{"runs": []any{obj{"runId": "event-7e0a1f2b", "status": "succeeded", "trigger": "event", "executor": "api", "taskSlug": "acme-ar-watch", "createdAt": "2026-06-06T14:00:10Z"}}}),
		"401": responseRef("401"),
		"404": responseRef("404"),
		"500": responseRef("500"),
	})}
	paths["/v1/webhooks/google"] = obj{"post": operation("Cloud Events", "Google push webhook", "Receives Gmail Pub/Sub pushes and Google Calendar channel notifications. Verified against the shared GOOGLE_WEBHOOK_TOKEN (?token= for Pub/Sub, X-Goog-Channel-Token for Calendar). Events for accounts that resolve to a Rowboat user are ingested; unresolved pushes are acknowledged with 200 and dropped.", "googleWebhook", nil, []any{
		queryParam("token", "Shared webhook token configured on the Pub/Sub push subscription URL.", false, stringSchema("Webhook token.", "")),
	}, jsonRequestOptional("Pub/Sub push envelope (Gmail). Calendar notifications carry no body.", freeFormSchema("Pub/Sub push envelope."), obj{
		"message": obj{"data": "eyJlbWFpbEFkZHJlc3MiOiJtZUBnbWFpbC5jb20iLCJoaXN0b3J5SWQiOjk5ODg3N30=", "messageId": "m1"},
	}), obj{
		"200": obj{"description": "Acknowledged: sync handshake, duplicate, or unresolved account (dropped)."},
		"202": jsonResponse("Event ingested.", ref("CloudEventIngestResponse"), obj{"eventId": "0c0afab1-7f6f-4f0b-9d8e-1e58e8b0f111", "routingStatus": "pending", "deduped": false}),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"500": responseRef("500"),
	})}
	paths["/v1/webhooks/slack"] = obj{"post": operation("Cloud Events", "Slack Events API webhook", "Receives Slack Events API deliveries, verified via the X-Slack-Signature HMAC (v0:{ts}:{body} with SLACK_SIGNING_SECRET, ±5 minute replay window). Handles the url_verification handshake; event_callback deliveries for workspaces mapped to a Rowboat user are ingested, others are acknowledged and dropped.", "slackWebhook", nil, nil, jsonRequest("Slack Events API envelope.", freeFormSchema("Slack event envelope."), obj{
		"type": "event_callback", "team_id": "T0EXAMPLE", "event_id": "Ev001",
		"event": obj{"type": "message", "text": "hello"},
	}), obj{
		"200": obj{"description": "Handshake challenge echoed, duplicate, or unmapped workspace (dropped)."},
		"202": jsonResponse("Event ingested.", ref("CloudEventIngestResponse"), obj{"eventId": "0c0afab1-7f6f-4f0b-9d8e-1e58e8b0f111", "routingStatus": "pending", "deduped": false}),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"500": responseRef("500"),
	})}
	paths["/v1/internal/events"] = obj{"post": operation("Internal", "Ingest a cloud event (server-to-server)", "Internal-secret ingestion used by backend services and test fixtures. Identical to /v1/events except the caller names the owning userId explicitly.", "ingestInternalCloudEvent", internalSecret(), nil, jsonRequest("Normalized event envelope with explicit owner.", ref("InternalCloudEventIngestRequest"), obj{
		"userId":    "a8dfa9b6-a7b2-46ea-982c-622a914c00e5",
		"source":    "internal",
		"subject":   "Synthetic event",
		"dedupeKey": "internal:test:1",
	}), obj{
		"202": jsonResponse("Event stored, routing enqueued.", ref("CloudEventIngestResponse"), obj{"eventId": "0c0afab1-7f6f-4f0b-9d8e-1e58e8b0f111", "routingStatus": "pending", "deduped": false}),
		"200": jsonResponse("Duplicate dedupeKey: existing event returned.", ref("CloudEventIngestResponse"), obj{"eventId": "0c0afab1-7f6f-4f0b-9d8e-1e58e8b0f111", "routingStatus": "routed", "deduped": true}),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"500": responseRef("500"),
	})}
}

func addAuthPaths(paths obj) {
	paths["/v1/auth/workos/login-url"] = obj{"get": operation("Auth", "Create WorkOS AuthKit login URL", "Builds the WorkOS AuthKit authorize URL for the desktop. The desktop opens the returned URL in the browser, preserving state and optional PKCE challenge.", "createWorkOSLoginURL", nil, []any{
		queryParam("redirect_uri", "Desktop loopback or custom redirect URI registered with the provider.", true, stringSchema("Redirect URI.", "http://localhost:8080/oauth/callback")),
		queryParam("state", "Opaque state generated by the desktop and echoed through the login flow.", true, stringSchema("OAuth state.", "kind-smoke")),
		queryParam("code_challenge", "Optional S256 PKCE code challenge.", false, stringSchema("PKCE challenge.", "kind-smoke-challenge")),
	}, nil, obj{
		"200": jsonResponse("Authorize URL.", ref("WorkOSLoginURLResponse"), obj{"url": "http://localhost:18090/user_management/authorize?client_id=solomon-desktop-kind&response_type=code&state=kind-smoke"}),
		"400": responseRef("400"),
		"502": responseRef("502"),
	})}
	paths["/v1/auth/workos/exchange"] = obj{"post": operation("Auth", "Exchange WorkOS authorization code", "Completes the authorization-code exchange server-side with the WorkOS API key, then returns the desktop token bundle.", "exchangeWorkOSToken", nil, nil, jsonRequest("Authorization code and optional PKCE verifier.", ref("WorkOSExchangeRequest"), obj{"code": "auth_code_123", "codeVerifier": "pkce-verifier"}), tokenResponses("WorkOS token bundle."))}
	paths["/v1/auth/workos/refresh"] = obj{"post": operation("Auth", "Refresh WorkOS token bundle", "Refreshes a WorkOS AuthKit access token using the server-held WorkOS API key.", "refreshWorkOSToken", nil, nil, jsonRequest("Refresh token payload.", ref("WorkOSRefreshRequest"), obj{"refreshToken": "refresh_token_123"}), tokenResponses("Refreshed WorkOS token bundle."))}
}

func addBillingPaths(paths obj) {
	paths["/v1/me"] = obj{"get": operation("Billing", "Get current user and billing state", "Returns the authenticated user's local identity, plan, subscription status, and credit totals. Credit totals include top-level, monthly, and daily buckets consumed by the desktop billing UI.", "getMe", bearer(), nil, nil, obj{
		"200": jsonResponse("Current user and billing state.", ref("MeResponse"), obj{
			"user":    obj{"id": "a8dfa9b6-a7b2-46ea-982c-622a914c00e5", "email": "kind@solomon-ai.co"},
			"billing": obj{"plan": "free", "status": "active", "trialExpiresAt": nil, "usage": obj{"sanctionedCredits": 10000, "usedCredits": 0, "availableCredits": 10000, "monthly": obj{"sanctionedCredits": 10000, "usedCredits": 0, "availableCredits": 10000}, "daily": obj{"sanctionedCredits": 10000, "usedCredits": 0, "availableCredits": 10000, "usageDay": "2026-06-04"}}},
		}),
		"401": responseRef("401"),
		"500": responseRef("500"),
		"503": responseRef("503"),
	})}
}

func addBackgroundTaskPaths(paths obj) {
	paths["/v1/background-task-runs"] = obj{
		"get": operation("Background Tasks", "List account background task runs", "Lists all background task runs visible to the authenticated user. Use this for dashboards and polling views that need queued, running, failed, or API-worker Temporal runs without knowing a task slug first.", "listBackgroundTaskRunsForAccount", bearer(), runListQueryParams(true), nil, obj{
			"200": jsonResponse("Account run list.", ref("BackgroundTaskRunsResponse"), obj{"runs": []any{backgroundTaskRunExample()}}),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"500": responseRef("500"),
		}),
	}
	paths["/v1/background-tasks"] = obj{
		"get": operation("Background Tasks", "List background tasks", "Lists the authenticated user's server-readable desktop background task mirrors ordered by slug. This is the primary sync pull for the desktop task registry.", "listBackgroundTasks", bearer(), nil, nil, obj{
			"200": jsonResponse("Task list.", ref("BackgroundTaskListResponse"), obj{"tasks": []any{backgroundTaskExample()}}),
			"401": responseRef("401"),
			"500": responseRef("500"),
		}),
		"post": operation("Background Tasks", "Create background task mirror", "Creates the cloud mirror for a desktop task.yaml entry. If slug is omitted, Solomon AI API derives one from name. Slugs are unique per authenticated user.", "createBackgroundTask", bearer(), nil, jsonRequest("Task mirror payload.", ref("BackgroundTaskCreateRequest"), obj{
			"slug":         "daily-summary",
			"name":         "Daily Account Summary",
			"instructions": "Summarize important account changes and draft follow-up notes.",
			"active":       true,
			"triggers":     obj{"cronExpr": "0 9 * * *", "timezone": "America/New_York"},
			"model":        "openai/gpt-4.1-mini",
			"provider":     "openai",
			"createdAt":    "2026-06-04T20:38:00Z",
		}), obj{
			"201": jsonResponse("Created task mirror.", ref("BackgroundTask"), backgroundTaskExample()),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"409": problemResponse("A task with this slug already exists for the user.", ref("ErrorEnvelope"), problemExample(409, "Conflict", "background task already exists", "conflict")),
			"500": responseRef("500"),
		}),
	}
	paths["/v1/background-tasks/{slug}"] = obj{
		"get": operation("Background Tasks", "Get background task mirror", "Fetches one task mirror by slug for the authenticated user. Tenant scoping ensures the same slug can exist for different users without leaking data.", "getBackgroundTask", bearer(), slugParam(), nil, obj{
			"200": jsonResponse("Task mirror.", ref("BackgroundTask"), backgroundTaskExample()),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"500": responseRef("500"),
		}),
		"patch": operation("Background Tasks", "Patch background task mirror", "Applies a partial task update using optimistic locking. The desktop should send the current revision from its last read; stale writes return currentRevision for merge/retry.", "patchBackgroundTask", bearer(), slugParam(), jsonRequest("Revision-checked task patch.", ref("BackgroundTaskPatchRequest"), obj{
			"revision":       2,
			"name":           "Daily Account Summary",
			"triggers":       nil,
			"lastRunSummary": "No high-priority account changes.",
			"lastRunAt":      "2026-06-04T21:02:00Z",
		}), obj{
			"200": jsonResponse("Updated task mirror.", ref("BackgroundTask"), backgroundTaskExample()),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"409": revisionConflictResponse(),
			"500": responseRef("500"),
		}),
		"delete": operation("Background Tasks", "Delete background task mirror", "Deletes the task mirror and its artifact, runs, and run events after verifying the supplied task revision. This supports full local lifecycle parity when a desktop task is removed.", "deleteBackgroundTask", bearer(), append(slugParam(), revisionQueryParam()), nil, obj{
			"204": obj{"description": "Task mirror and child rows deleted."},
			"400": responseRef("400"),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"409": revisionConflictResponse(),
			"500": responseRef("500"),
		}),
	}
	paths["/v1/background-tasks/{slug}/artifact"] = obj{
		"get": operation("Background Tasks", "Get task artifact", "Returns the markdown artifact mirrored from bg-tasks/<slug>/index.md. If no artifact exists yet, the API returns an empty body with revision 0 so the desktop can create it with PUT.", "getBackgroundTaskArtifact", bearer(), slugParam(), nil, obj{
			"200": jsonResponse("Task artifact.", ref("BackgroundTaskArtifact"), backgroundTaskArtifactExample()),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"500": responseRef("500"),
		}),
		"put": operation("Background Tasks", "Put task artifact", "Creates or updates the markdown artifact mirror. Updates require the current artifact revision; creation can omit revision or send revision 0.", "putBackgroundTaskArtifact", bearer(), slugParam(), jsonRequest("Artifact body and optional revision.", ref("BackgroundTaskArtifactPutRequest"), obj{
			"revision": 2,
			"body":     "# Daily Account Summary\n\nUpdated context.",
		}), obj{
			"200": jsonResponse("Saved task artifact.", ref("BackgroundTaskArtifact"), backgroundTaskArtifactExample()),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"409": revisionConflictResponse(),
			"500": responseRef("500"),
		}),
	}
	paths["/v1/background-tasks/{slug}/runs"] = obj{
		"get": operation("Background Tasks", "List task runs", "Lists mirrored runs for a task. Poll with status, executor, limit, and cursor filters to drive desktop queue pickup, dashboards, and API-worker Temporal status views.", "listBackgroundTaskRuns", bearer(), append(slugParam(), runListQueryParams(false)...), nil, obj{
			"200": jsonResponse("Task runs.", ref("BackgroundTaskRunsResponse"), obj{"runs": []any{backgroundTaskRunExample()}}),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"500": responseRef("500"),
		}),
		"post": operation("Background Tasks", "Create task run mirror", "Creates a run mirror for a desktop execution. Use this for local scheduler/manual runs; use /trigger when a remote user action should queue a new local execution.", "createBackgroundTaskRun", bearer(), slugParam(), jsonRequest("Run mirror payload.", ref("BackgroundTaskRunCreateRequest"), obj{
			"runId":      "run-20260604-210000",
			"trigger":    "manual",
			"status":     "running",
			"startedAt":  "2026-06-04T21:01:00Z",
			"model":      "openai/gpt-4.1-mini",
			"provider":   "openai",
			"useCase":    "background-task",
			"subUseCase": "daily-summary",
		}), obj{
			"201": jsonResponse("Created run mirror.", ref("BackgroundTaskRun"), backgroundTaskRunExample()),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"409": problemResponse("A run with this runId already exists for the user.", ref("ErrorEnvelope"), problemExample(409, "Conflict", "run already exists", "conflict")),
			"500": responseRef("500"),
		}),
	}
	paths["/v1/background-tasks/{slug}/runs/{runId}"] = obj{
		"get": operation("Background Tasks", "Get task run", "Fetches the full mirrored state for one desktop or API-worker run, including Temporal ids and polling progress when present.", "getBackgroundTaskRun", bearer(), append(slugParam(), runIDParam()...), nil, obj{
			"200": jsonResponse("Run mirror.", ref("BackgroundTaskRun"), backgroundTaskRunExample()),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"500": responseRef("500"),
		}),
		"patch": operation("Background Tasks", "Patch task run mirror", "Updates run state with optimistic locking. Desktop should patch queued remote-trigger runs to running/succeeded/failed as it claims and completes them locally.", "patchBackgroundTaskRun", bearer(), append(slugParam(), runIDParam()...), jsonRequest("Revision-checked run patch.", ref("BackgroundTaskRunPatchRequest"), obj{
			"revision":    1,
			"localRunId":  "local-run-42",
			"status":      "succeeded",
			"summary":     "No high-priority account changes.",
			"completedAt": "2026-06-04T21:02:00Z",
		}), obj{
			"200": jsonResponse("Updated run mirror.", ref("BackgroundTaskRun"), backgroundTaskRunExample()),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"409": revisionConflictResponse(),
			"500": responseRef("500"),
		}),
	}
	paths["/v1/background-tasks/{slug}/runs/{runId}/status"] = obj{
		"get": operation("Background Tasks", "Poll task run status", "Returns a compact polling payload for one run. Clients should poll this Solomon AI API endpoint rather than Temporal directly.", "getBackgroundTaskRunStatus", bearer(), append(slugParam(), runIDParam()...), nil, obj{
			"200": jsonResponse("Compact run status.", ref("BackgroundTaskRunStatusResponse"), backgroundTaskRunStatusExample()),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"500": responseRef("500"),
		}),
	}
	paths["/v1/background-tasks/{slug}/runs/{runId}/cancel"] = obj{
		"post": operation("Background Tasks", "Cancel API-worker run", "Requests Temporal cancellation for an API-worker run and mirrors stopped/canceled state to Solomon AI. Desktop-local runs are rejected unless a future desktop cancellation bridge is added.", "cancelBackgroundTaskRun", bearer(), append(slugParam(), runIDParam()...), nil, obj{
			"202": jsonResponse("Cancellation accepted.", ref("BackgroundTaskRun"), backgroundTaskQueuedRunExample()),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"503": responseRef("503"),
			"502": responseRef("502"),
		}),
	}
	paths["/v1/background-tasks/{slug}/runs/{runId}/retry"] = obj{
		"post": operation("Background Tasks", "Retry API-worker run", "Creates a new API-worker run linked by previousRunId and starts a fresh Temporal workflow using the previous trigger/context.", "retryBackgroundTaskRun", bearer(), append(slugParam(), runIDParam()...), nil, obj{
			"202": jsonResponse("Retry run queued.", ref("BackgroundTaskRun"), backgroundTaskAPIRunExample()),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"503": responseRef("503"),
			"502": responseRef("502"),
		}),
	}
	paths["/v1/background-tasks/{slug}/runs/{runId}/signal"] = obj{
		"post": operation("Background Tasks", "Signal API-worker run", "Sends a constrained control signal to the Temporal workflow. V1 accepts pause, resume, and update_context signals for workflow versions that know how to consume them.", "signalBackgroundTaskRun", bearer(), append(slugParam(), runIDParam()...), jsonRequest("Signal payload.", ref("BackgroundTaskSignalRequest"), obj{"signal": "pause", "payload": obj{"reason": "operator requested"}}), obj{
			"202": jsonResponse("Signal accepted.", ref("BackgroundTaskRun"), backgroundTaskAPIRunExample()),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"503": responseRef("503"),
			"502": responseRef("502"),
		}),
	}
	paths["/v1/background-tasks/{slug}/runs/{runId}/events"] = obj{
		"get": operation("Background Tasks", "List task run events", "Returns mirrored JSONL events for a run ordered by seq. Use afterSeq for incremental polling of desktop and API-worker progress events.", "listBackgroundTaskRunEvents", bearer(), append(append(slugParam(), runIDParam()...), queryParam("afterSeq", "Optional sequence cursor. When provided, only events with seq greater than this value are returned.", false, intSchema("Last seen event seq.", 0))), nil, obj{
			"200": jsonResponse("Run events.", ref("BackgroundTaskRunEventsResponse"), obj{"events": []any{backgroundTaskRunEventExample()}}),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"500": responseRef("500"),
		}),
		"post": operation("Background Tasks", "Append task run events", "Appends a batch of JSONL run events. The unique (run, seq) key makes retries idempotent: duplicate seq values are counted as skipped.", "appendBackgroundTaskRunEvents", bearer(), append(slugParam(), runIDParam()...), jsonRequest("Run event batch.", ref("BackgroundTaskRunEventsAppendRequest"), obj{
			"events": []any{
				obj{"seq": 0, "event": obj{"type": "started"}},
				obj{"seq": 1, "type": "completed", "event": obj{"type": "completed", "summary": "ok"}},
			},
		}), obj{
			"200": jsonResponse("Append counts.", ref("BackgroundTaskRunEventsAppendResponse"), obj{"stored": 2, "skipped": 0}),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"500": responseRef("500"),
		}),
	}
	paths["/v1/background-tasks/{slug}/trigger"] = obj{
		"post": operation("Background Tasks", "Queue or start task trigger", "For executionTarget=desktop, queues a remote trigger with status=queued for desktop pickup. For executionTarget=api, creates an API-worker run and starts a Temporal workflow, while clients poll Solomon AI run status endpoints.", "triggerBackgroundTask", bearer(), slugParam(), jsonRequestOptional("Optional trigger context.", ref("BackgroundTaskTriggerRequest"), obj{
			"trigger": "manual",
			"context": "Run this now and focus on high-risk accounts.",
		}), obj{
			"202": jsonResponse("Queued or started run mirror.", ref("BackgroundTaskRun"), backgroundTaskQueuedRunExample()),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"502": responseRef("502"),
			"503": responseRef("503"),
			"500": responseRef("500"),
		}),
	}
}

func addLLMPaths(paths obj) {
	paths["/v1/llm/models"] = obj{"get": operation("LLM", "List routable LLM models", "Returns the sorted set of priced model ids the desktop can send to the LLM gateway.", "listLLMModels", bearer(), nil, nil, obj{
		"200": jsonResponse("Model catalog.", ref("LLMModelsResponse"), obj{"data": []any{obj{"id": "openai/gpt-4.1-mini"}, obj{"id": "anthropic/claude-sonnet-4-5"}}}),
		"401": responseRef("401"),
		"503": responseRef("503"),
	})}
	paths["/v1/llm/chat/completions"] = obj{"post": operation("LLM", "Proxy OpenAI-compatible chat completion", "Credit-gated chat completion endpoint. The gateway estimates and reserves credits, routes the desktop model id to OpenAI or OpenRouter, forwards the request, streams or buffers the upstream response, then settles actual token usage.", "createChatCompletion", bearer(), llmHeaderParams(), jsonRequest("OpenAI-compatible chat completions body.", ref("LLMChatCompletionsRequest"), obj{"model": "openai/gpt-4.1-mini", "messages": []any{obj{"role": "user", "content": "Summarize this customer."}}, "stream": true}), llmResponses(true))}
	paths["/v1/llm/completions"] = obj{"post": operation("LLM", "Proxy OpenAI-compatible legacy completion", "Credit-gated legacy completions endpoint. Request and response shape follows OpenAI-compatible /completions semantics.", "createCompletion", bearer(), llmHeaderParams(), jsonRequest("OpenAI-compatible completions body.", ref("LLMCompletionsRequest"), obj{"model": "openai/gpt-4.1-mini", "prompt": "Summarize this customer.", "max_tokens": 256}), llmResponses(true))}
	paths["/v1/llm/embeddings"] = obj{"post": operation("LLM", "Proxy OpenAI-compatible embeddings", "Credit-gated embeddings endpoint. The gateway requires a model, reserves credits, forwards the request, and records usage.", "createEmbedding", bearer(), llmHeaderParams(), jsonRequest("OpenAI-compatible embeddings body.", ref("LLMEmbeddingsRequest"), obj{"model": "openai/text-embedding-3-small", "input": []any{"invoice", "payment"}}), llmResponses(false))}
}

func addVendorProxyPaths(paths obj) {
	paths["/v1/voice/text-to-speech/{voiceId}"] = obj{"post": operation("Voice", "Generate speech audio", "Credit-gated ElevenLabs proxy. The text field is used for per-character credit charging and the full body is forwarded to ElevenLabs. Successful responses stream audio bytes back to the desktop.", "textToSpeech", bearer(), []any{
		pathParam("voiceId", "ElevenLabs voice id.", stringSchema("Voice id.", "21m00Tcm4TlvDq8ikWAM")),
		idempotencyHeaderParam(),
	}, jsonRequest("ElevenLabs text-to-speech request body.", ref("VoiceTextToSpeechRequest"), obj{"text": "Hello from Solomon AI.", "model_id": "eleven_multilingual_v2"}), obj{
		"200": binaryResponse("Audio stream returned by ElevenLabs.", "audio/mpeg"),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"402": responseRef("402"),
		"502": responseRef("502"),
		"503": responseRef("503"),
	})}
	paths["/v1/search/exa"] = obj{"post": operation("Search", "Run Exa search", "Credit-gated Exa /search proxy. The request body is forwarded unchanged and the upstream JSON response is returned unchanged.", "searchExa", bearer(), []any{idempotencyHeaderParam()}, jsonRequest("Exa /search request body.", ref("ExaSearchRequest"), obj{"query": "recent fintech accounts receivable trends", "numResults": 5, "type": "neural"}), obj{
		"200": jsonResponse("Exa search response.", ref("ExaSearchResponse"), obj{"results": []any{obj{"title": "Example result", "url": "https://example.com"}}}),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"402": responseRef("402"),
		"502": responseRef("502"),
		"503": responseRef("503"),
	})}
	composioOps := obj{}
	for _, method := range []string{"get", "post", "put", "patch", "delete"} {
		composioOps[method] = operation("Composio", "Proxy Composio v3 "+methodName(method), "Authenticated reverse proxy to Composio v3. The user's bearer token is replaced with the server-held Composio x-api-key, X-Solomon-User is attached, and connected-account access is scoped to the authenticated Rowboat user.", "proxyComposio"+methodName(method), bearer(), []any{
			pathParam("path", "Composio API path after /v1/composio. The runtime route accepts a slash-containing wildcard.", stringSchema("Composio path.", "toolkits")),
		}, nil, obj{
			"200": jsonResponse("Composio response body. Connected-account list responses are filtered to the caller's mapped accounts.", ref("ComposioProxyResponse"), obj{"items": []any{}}),
			"401": responseRef("401"),
			"404": responseRef("404"),
			"502": responseRef("502"),
			"503": responseRef("503"),
		})
	}
	paths["/v1/composio/{path}"] = composioOps
}

func addGoogleOAuthPaths(paths obj) {
	paths["/oauth/google/start"] = obj{"get": operation("Google OAuth", "Start Google OAuth consent", "Browser-facing endpoint opened by the desktop. It creates a one-time state ticket, then redirects the browser to Google's consent screen.", "startGoogleOAuth", nil, nil, nil, obj{
		"302": redirectResponse("Redirect to Google OAuth consent."),
		"500": htmlResponse("HTML error page when the flow cannot be started."),
		"502": htmlResponse("HTML error page when Google OAuth is not configured."),
	})}
	paths["/oauth/google/callback"] = obj{"get": operation("Google OAuth", "Handle Google OAuth callback", "Google redirect target. Exchanges the authorization code server-side, parks the token bundle under the state ticket, and returns an HTML page that deep-links back to the desktop.", "handleGoogleOAuthCallback", nil, []any{
		queryParam("state", "Opaque state ticket minted by /oauth/google/start.", true, stringSchema("State ticket.", "state_abc123")),
		queryParam("code", "Authorization code returned by Google.", false, stringSchema("Authorization code.", "4/0AfJoh...")),
		queryParam("error", "OAuth error returned by Google when the user cancels or consent fails.", false, stringSchema("OAuth error.", "access_denied")),
	}, nil, obj{
		"200": htmlResponse("HTML page that redirects to solomon-ai://oauth/google/done."),
		"400": htmlResponse("HTML error page for missing or expired state/code."),
	})}
	paths["/v1/google-oauth/claim"] = obj{"post": operation("Google OAuth", "Claim Google OAuth token bundle", "Consumes a one-time Google OAuth session ticket, verifies it belongs to the authenticated user when bound, persists the refresh token when present, and returns the token bundle to the desktop.", "claimGoogleOAuth", bearer(), nil, jsonRequest("Google OAuth session ticket.", ref("GoogleClaimRequest"), obj{"session": "state_abc123"}), obj{
		"200": jsonResponse("Claimed Google token bundle.", ref("OAuthTokenBundle"), obj{"access_token": "ya29.a0AfH6S...", "refresh_token": "1//refresh", "expires_at": 1790784000, "scope": "openid email profile", "token_type": "Bearer"}),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"403": responseRef("403"),
		"404": responseRef("404"),
		"410": responseRef("410"),
		"500": responseRef("500"),
		"503": responseRef("503"),
	})}
	paths["/v1/google-oauth/refresh"] = obj{"post": operation("Google OAuth", "Refresh Google access token", "Refreshes a Google access token using the server-held Google OAuth client id and secret. Google usually omits refresh_token on refresh; the desktop should preserve the old refresh token.", "refreshGoogleOAuth", bearer(), nil, jsonRequest("Google refresh token payload.", ref("GoogleRefreshRequest"), obj{"refreshToken": "1//refresh"}), obj{
		"200": jsonResponse("Refreshed Google access token bundle.", ref("OAuthTokenBundle"), obj{"access_token": "ya29.a0AfH6S...", "expires_at": 1790784000, "scope": "openid email profile", "token_type": "Bearer"}),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"409": responseRef("409"),
		"502": responseRef("502"),
		"503": responseRef("503"),
	})}
}

func addSlackOAuthPaths(paths obj) {
	paths["/oauth/slack/start"] = obj{"get": operation("Slack OAuth", "Start Slack workspace install", "Browser-facing endpoint opened by the desktop. It creates a one-time state ticket, then redirects the browser to Slack's OAuth v2 authorize screen with the configured bot scopes.", "startSlackOAuth", nil, nil, nil, obj{
		"302": redirectResponse("Redirect to Slack OAuth consent."),
		"500": htmlResponse("HTML error page when the flow cannot be started."),
		"502": htmlResponse("HTML error page when Slack OAuth is not configured."),
	})}
	paths["/oauth/slack/callback"] = obj{"get": operation("Slack OAuth", "Handle Slack OAuth callback", "Slack redirect target. Exchanges the authorization code server-side, parks the sealed workspace bundle under the state ticket, and returns an HTML page that deep-links back to the desktop.", "handleSlackOAuthCallback", nil, []any{
		queryParam("state", "Opaque state ticket minted by /oauth/slack/start.", true, stringSchema("State ticket.", "state_abc123")),
		queryParam("code", "Authorization code returned by Slack.", false, stringSchema("Authorization code.", "1234.5678.abcd")),
		queryParam("error", "OAuth error returned by Slack when the user cancels the install.", false, stringSchema("OAuth error.", "access_denied")),
	}, nil, obj{
		"200": htmlResponse("HTML page that redirects to solomon-ai://oauth/slack/done."),
		"400": htmlResponse("HTML error page for missing or expired state/code."),
	})}
	paths["/v1/slack-oauth/claim"] = obj{"post": operation("Slack OAuth", "Claim Slack workspace connection", "Atomically consumes a one-time Slack install ticket and persists the workspace connection (the team_id-to-user mapping the Slack events webhook resolves against). The bot token stays server-held; the response carries workspace metadata only.", "claimSlackOAuth", bearer(), nil, jsonRequest("Slack install session ticket.", ref("SlackClaimRequest"), obj{"session": "state_abc123"}), obj{
		"200": jsonResponse("Connected workspace metadata.", ref("SlackClaimResponse"), obj{"connected": true, "teamId": "T0EXAMPLE", "teamName": "Acme", "scope": "channels:history,channels:read", "botUserId": "U0BOT"}),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"404": responseRef("404"),
		"409": problemResponse("The browser install has not completed yet; retry after the deep link returns.", ref("ErrorEnvelope"), problemExample(409, "Conflict", "slack install not completed yet", "install_incomplete")),
		"410": responseRef("410"),
		"500": responseRef("500"),
	})}
}

func addConnectorPaths(paths obj) {
	paths["/v1/connectors"] = obj{"get": operation("Connectors", "List connectors", "Returns the configured connector registry plus the authenticated user's connection state for each connector.", "listConnectors", bearer(), nil, nil, obj{
		"200": jsonResponse("Connector registry with connection state.", ref("ConnectorsResponse"), obj{"connectors": []any{obj{"name": "canvas", "displayName": "Canvas", "description": "Banking, invoicing, dunning, transactions", "mcpUrl": "https://api.canvas.solomon-ai.co/v1/mcp", "authType": "oauth", "scopes": []any{"invoices:read"}, "connected": true, "connectedAt": "2026-06-04T20:38:00Z"}}}),
		"401": responseRef("401"),
		"500": responseRef("500"),
		"503": responseRef("503"),
	})}
	paths["/v1/connections/{name}/start"] = obj{"post": operation("Connectors", "Start connector OAuth flow", "Creates a sealed pending connection ticket, builds the Ory authorize URL with PKCE, and returns it for the desktop to open in a browser.", "startConnection", bearer(), connectorNameParam(), nil, obj{
		"200": jsonResponse("Connector authorize URL.", ref("ConnectionStartResponse"), obj{"authorize_url": "https://oauth.solomon-ai.co/oauth2/auth?client_id=rowboat-api&state=..."}),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"404": responseRef("404"),
		"500": responseRef("500"),
		"503": responseRef("503"),
	})}
	paths["/v1/connections/{name}/callback"] = obj{"get": operation("Connectors", "Handle connector OAuth callback", "Browser redirect target from Ory. The user is resolved from the sealed pending ticket, not from a bearer token. On success or failure it redirects to the desktop deep link.", "handleConnectionCallback", nil, append(connectorNameParam(),
		queryParam("state", "Opaque connection state generated by /start.", true, stringSchema("State.", "state_abc123")),
		queryParam("code", "Authorization code from Ory.", false, stringSchema("Authorization code.", "code_abc123")),
		queryParam("error", "OAuth error from Ory.", false, stringSchema("OAuth error.", "access_denied")),
	), nil, obj{
		"302": redirectResponse("Redirect to solomon-ai://connection-complete with connector and status."),
		"400": responseRef("400"),
		"500": responseRef("500"),
	})}
	paths["/v1/connections/{name}/mcp-token"] = obj{"post": operation("Connectors", "Mint connector MCP token", "Returns a short-lived MCP access token and target MCP URL for a connected connector. OAuth connectors refresh through Ory; api_key connectors return the sealed vendor key directly.", "createMCPToken", bearer(), connectorNameParam(), nil, obj{
		"200": jsonResponse("MCP token and endpoint.", ref("MCPTokenResponse"), obj{"access_token": "mcp_access_token", "token_type": "Bearer", "expires_at": 1790784000, "mcpUrl": "https://api.canvas.solomon-ai.co/v1/mcp"}),
		"401": responseRef("401"),
		"404": responseRef("404"),
		"500": responseRef("500"),
		"502": responseRef("502"),
		"503": responseRef("503"),
	})}
	paths["/v1/connections/{name}"] = obj{"delete": operation("Connectors", "Disconnect connector", "Idempotently disconnects a connector for the authenticated user. If a refresh token exists, rowboat-api attempts to revoke it at Ory before deleting the local connection.", "deleteConnection", bearer(), connectorNameParam(), nil, obj{
		"204": obj{"description": "Connector disconnected or was already absent."},
		"401": responseRef("401"),
		"500": responseRef("500"),
		"503": responseRef("503"),
	})}
}

func addInternalPaths(paths obj) {
	paths["/oauth-hooks/pre-consent"] = obj{"post": operation("Webhooks", "Evaluate connector pre-consent entitlement", "Shared-secret webhook called by OAuth infrastructure before consent. It resolves the requested connector and returns allow=true or an upsell payload based on the user's billing plan.", "preConsent", hookHMAC(), nil, jsonRequest("Pre-consent webhook payload.", ref("PreConsentRequest"), obj{"workos_user_id": "user_01HABCDEF", "connector": "canvas", "requested_audience": "canvas-api"}), obj{
		"200": jsonResponse("Consent decision.", ref("PreConsentResponse"), obj{"allow": false, "upsell": obj{"requiredPlan": "pro", "message": "Upgrade to pro to connect Canvas"}}),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"500": responseRef("500"),
	})}
	paths["/v1/internal/connections/invalidate"] = obj{"post": operation("Internal", "Force-disconnect a connector", "Server-to-server endpoint for products to invalidate a user's connector connection. Unknown users are treated as successful no-ops.", "invalidateConnection", internalSecret(), nil, jsonRequest("Invalidation target.", ref("InternalInvalidateRequest"), obj{"workos_user_id": "user_01HABCDEF", "connector": "canvas"}), obj{
		"200": jsonResponse("Invalidation result.", ref("InternalInvalidateResponse"), obj{"invalidated": true, "deleted": 1}),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"500": responseRef("500"),
	})}
	paths["/graphql"] = obj{"post": operation("GraphQL", "Admin GraphQL", "Internal admin GraphQL endpoint over the ent graph. The internal-secret middleware marks the request internal so resolvers can bypass per-user tenant scoping.", "graphql", internalSecret(), nil, jsonRequest("GraphQL request body.", ref("GraphQLRequest"), obj{"query": "{ users(first: 10) { edges { node { id email } } } }"}), obj{
		"200": jsonResponse("GraphQL response.", ref("GraphQLResponse"), obj{"data": obj{"users": obj{"edges": []any{}}}}),
		"401": responseRef("401"),
		"500": responseRef("500"),
	})}
}

func enrichEntitySchemas(schemas obj) {
	for name, desc := range map[string]string{
		"User":                   "Local mirror of a WorkOS identity. Upserted when a verified bearer token is first seen.",
		"UserHistory":            "Audit history for User rows, used for incident investigation.",
		"Subscription":           "User billing plan, status, trial expiry, Stripe identifiers, and credit grant.",
		"SubscriptionHistory":    "Audit history for Subscription rows.",
		"CreditLedger":           "Append-only credit grant, reservation, settlement, refund, or consumption entry.",
		"LLMUsage":               "One LLM gateway call with token counts, settled credit cost, request id, and feature telemetry.",
		"LLMUsageHistory":        "Audit history for LLMUsage rows.",
		"OAuthConnection":        "Long-lived third-party OAuth connection such as Google. Refresh tokens are sealed before storage.",
		"OAuthConnectionHistory": "Audit history for OAuthConnection rows.",
		"OAuthPending":           "Ephemeral one-time OAuth handoff ticket with sealed payload and expiry.",
		"MCPConnection":          "Per-user connector credential state for MCP products. Stores sealed OAuth refresh tokens or API keys.",
		"MCPConnectionHistory":   "Audit history for MCPConnection rows.",
		"BackgroundTask":         "Server-readable mirror of one desktop background task spec. Owned by a user and keyed by slug per user.",
		"BackgroundTaskHistory":  "Audit history for BackgroundTask rows.",
		"BackgroundTaskArtifact": "Markdown artifact mirror for bg-tasks/<slug>/index.md.",
		"BackgroundTaskRun":      "Mirrored run state for one desktop background task execution or queued remote trigger.",
		"BackgroundTaskRunEvent": "Mirrored JSONL event from a background task run log.",
	} {
		if s := asObj(schemas[name]); s != nil {
			s["description"] = desc
		}
	}

	propDocs := map[string]obj{
		"id":                      {"description": "Stable UUID primary key.", "example": "123e4567-e89b-12d3-a456-426614174000"},
		"created_at":              {"description": "Row creation timestamp.", "example": "2026-06-04T20:38:00Z"},
		"updated_at":              {"description": "Last row update timestamp.", "example": "2026-06-04T20:39:00Z"},
		"history_time":            {"description": "Timestamp when this history record was written.", "example": "2026-06-04T20:40:00Z"},
		"operation":               {"description": "Mutation operation that produced this history row.", "example": "UPDATE"},
		"ref":                     {"description": "UUID of the source row represented by a history row.", "example": "123e4567-e89b-12d3-a456-426614174000"},
		"email":                   {"description": "Best-known WorkOS primary email for the user.", "example": "user@example.com"},
		"workos_user_id":          {"description": "WorkOS user id used to resolve bearer tokens into local users.", "example": "user_01HABCDEF"},
		"workos_org_id":           {"description": "Optional WorkOS organization id for B2B/workspace contexts.", "example": "org_01HABCDEF"},
		"plan":                    {"description": "Billing plan slug.", "enum": []any{"free", "starter", "pro"}, "example": "free"},
		"status":                  {"description": "Lifecycle/status slug. Subscription rows use billing states; background task runs use queued/running/succeeded/failed/stopped.", "example": "active"},
		"trial_expires_at":        {"description": "Trial expiry timestamp when the user is trialing.", "example": "2026-07-01T00:00:00Z", "nullable": true},
		"sanctioned_credits":      {"description": "Credits granted by the current subscription.", "example": 10000},
		"stripe_customer_id":      {"description": "Stripe customer id when billing is backed by Stripe.", "example": "cus_123"},
		"stripe_subscription_id":  {"description": "Stripe subscription id when billing is backed by Stripe.", "example": "sub_123"},
		"delta":                   {"description": "Credit delta. Negative values consume/reserve credits; positive values grant or refund credits.", "example": -42},
		"reason":                  {"description": "Reason code for the ledger entry.", "enum": []any{"llm_call", "llm_call_reserve", "llm_settle", "voice_tts", "exa_search", "grant", "refund"}, "example": "llm_settle"},
		"request_id":              {"description": "Idempotency and trace anchor for a metered request.", "example": "9e2fb15a-936d-4f39-9372-73cfe0476ca8"},
		"ts":                      {"description": "Usage or ledger event timestamp.", "example": "2026-06-04T20:38:00Z"},
		"model":                   {"description": "Desktop-facing LLM model id.", "example": "openai/gpt-4.1-mini"},
		"use_case":                {"description": "Optional x-solomon-use-case header captured for cost allocation.", "example": "collections"},
		"sub_use_case":            {"description": "Optional x-solomon-sub-use-case header captured for cost allocation.", "example": "invoice-summary"},
		"agent_name":              {"description": "Optional x-solomon-agent-name header captured for cost allocation.", "example": "desktop-assistant"},
		"input_tokens":            {"description": "Input tokens reported by the upstream or estimated by Solomon AI API.", "example": 812},
		"output_tokens":           {"description": "Output tokens reported by the upstream.", "example": 210},
		"cost_units":              {"description": "Settled credit cost for the request.", "example": 8},
		"provider":                {"description": "Provider slug. Depending on the row this may be an OAuth provider, LLM provider, or execution backend.", "example": "openai"},
		"state":                   {"description": "Opaque one-time OAuth state/session ticket.", "example": "state_abc123"},
		"payload_encrypted":       {"description": "AES-GCM sealed OAuth handoff payload. Internal storage field.", "format": "byte", "writeOnly": true},
		"expires_at":              {"description": "Credential or one-time ticket expiry timestamp.", "example": "2026-06-04T20:48:00Z"},
		"connector":               {"description": "Connector slug.", "example": "canvas"},
		"audience":                {"description": "OAuth token audience for the connector.", "example": "canvas-api"},
		"scopes":                  {"description": "OAuth scopes granted or requested.", "example": []any{"invoices:read", "customers:read"}},
		"refresh_token_encrypted": {"description": "Sealed refresh token. Sensitive internal storage field; never returned by desktop endpoints.", "format": "byte", "writeOnly": true},
		"api_key_encrypted":       {"description": "Sealed vendor API key. Sensitive internal storage field; never returned by desktop endpoints.", "format": "byte", "writeOnly": true},
		"connected_at":            {"description": "Timestamp when the connector was connected.", "example": "2026-06-04T20:38:00Z"},
		"last_used_at":            {"description": "Timestamp when the connector credential was last minted or used.", "example": "2026-06-04T20:45:00Z"},
		"user":                    {"description": "User that owns this row."},
		"subscription":            {"description": "The user's billing subscription."},
		"ledger_entries":          {"description": "Append-only credit ledger entries for the user."},
		"llm_usages":              {"description": "LLM usage rows for the user."},
		"oauth_connections":       {"description": "Third-party OAuth connections for the user."},
		"mcp_connections":         {"description": "MCP connector connections for the user."},
	}
	for schemaName, schemaAny := range schemas {
		if schemaName == "ErrorEnvelope" || schemaName == "ReconnectErrorEnvelope" || schemaName == "RevisionConflictEnvelope" {
			continue
		}
		s := asObj(schemaAny)
		if s == nil {
			continue
		}
		props := asObj(s["properties"])
		for name, doc := range propDocs {
			if p := asObj(props[name]); p != nil {
				for k, v := range doc {
					p[k] = v
				}
			}
		}
	}

	backgroundPropDocs := map[string]obj{
		"slug":                 {"description": "Stable per-user background task slug matching bg-tasks/<slug> locally.", "example": "daily-summary"},
		"name":                 {"description": "Human-readable background task name.", "example": "Daily Account Summary"},
		"instructions":         {"description": "Background task instructions mirrored from task.yaml.", "example": "Summarize important account changes."},
		"active":               {"description": "Whether the background task is active for scheduling and remote trigger pickup.", "example": true},
		"triggers_json":        {"description": "Raw JSON trigger configuration from task.yaml.", "example": map[string]any{"cronExpr": "0 9 * * *", "timezone": "America/New_York"}},
		"execution_target":     {"description": "Execution target for the task. desktop runs locally; api starts a Temporal-backed API worker run.", "enum": []any{"desktop", "api"}, "example": "desktop"},
		"task_created_at":      {"description": "Original desktop task creation timestamp when known.", "example": "2026-06-04T20:38:00Z"},
		"last_attempt_at":      {"description": "Latest local attempt timestamp for this task.", "example": "2026-06-04T21:00:00Z", "nullable": true},
		"last_run_id":          {"description": "Latest mirrored local or remote-trigger run id.", "example": "run-20260604-210000"},
		"last_run_at":          {"description": "Latest local run timestamp.", "example": "2026-06-04T21:02:00Z", "nullable": true},
		"last_run_summary":     {"description": "Short summary from the latest run.", "example": "No high-priority account changes."},
		"last_run_error":       {"description": "Latest run error, empty when there was no error.", "example": ""},
		"revision":             {"description": "Optimistic-lock revision used by write endpoints.", "example": 2},
		"body":                 {"description": "Markdown artifact body for a background task.", "example": "# Daily Account Summary\n\nContext."},
		"run_id":               {"description": "Cloud-visible id for a mirrored run.", "example": "run-20260604-210000"},
		"previous_run_id":      {"description": "Previous run id when this run was created by retry.", "example": "run-20260604-205000"},
		"local_run_id":         {"description": "Actual desktop run id when different from run_id, especially after claiming a queued remote trigger.", "example": "local-run-42"},
		"trigger":              {"description": "Trigger source for a task run.", "enum": []any{"manual", "cron", "window", "event"}, "example": "manual"},
		"status":               {"description": "Background task run lifecycle state.", "enum": []any{"queued", "running", "succeeded", "failed", "stopped"}, "example": "succeeded"},
		"executor":             {"description": "Execution backend that owns this run.", "enum": []any{"desktop", "api"}, "example": "api"},
		"requested_context":    {"description": "Optional context supplied by a remote trigger request.", "example": "Run this now and focus on high-risk accounts."},
		"summary":              {"description": "Run summary mirrored from the desktop.", "example": "No high-priority account changes."},
		"error":                {"description": "Run error mirrored from the desktop.", "example": ""},
		"temporal_workflow_id": {"description": "Temporal workflow id for API-worker runs.", "example": "background-task/user/daily-summary/api-trigger-123"},
		"temporal_run_id":      {"description": "Temporal run id for API-worker runs.", "example": "01971cf4-3c7d-7aa0-9ac8-ef73bc506e16"},
		"temporal_status":      {"description": "Last mirrored Temporal status, separate from the product run status.", "example": "Running"},
		"temporal_started_at":  {"description": "Timestamp when Temporal execution started.", "example": "2026-06-04T21:01:00Z", "nullable": true},
		"temporal_closed_at":   {"description": "Timestamp when Temporal execution closed.", "example": "2026-06-04T21:02:00Z", "nullable": true},
		"progress_percent":     {"description": "Best-known progress percentage for polling clients.", "example": 50},
		"progress_message":     {"description": "Human-readable progress message.", "example": "Building API-native task artifact."},
		"last_heartbeat_at":    {"description": "Latest worker heartbeat/progress timestamp.", "example": "2026-06-04T21:01:30Z", "nullable": true},
		"started_at":           {"description": "Desktop run start timestamp.", "example": "2026-06-04T21:01:00Z", "nullable": true},
		"completed_at":         {"description": "Desktop run completion timestamp.", "example": "2026-06-04T21:02:00Z", "nullable": true},
		"seq":                  {"description": "Zero-based sequence number for a mirrored JSONL run event.", "example": 1},
		"event_type":           {"description": "Run event type, copied from the payload when not provided explicitly.", "example": "completed"},
		"event_json":           {"description": "Raw JSON event object from the desktop run log.", "example": map[string]any{"type": "completed", "summary": "ok"}},
		"received_at":          {"description": "Server timestamp when a run event was accepted.", "example": "2026-06-04T21:02:05Z"},
		"artifact":             {"description": "Markdown artifact mirror for the task."},
		"runs":                 {"description": "Mirrored runs for the task."},
		"run_events":           {"description": "Mirrored run events for the task."},
		"task":                 {"description": "Background task that owns this row."},
		"run":                  {"description": "Background task run that owns this event."},
	}
	for _, schemaName := range []string{"BackgroundTask", "BackgroundTaskArtifact", "BackgroundTaskRun", "BackgroundTaskRunEvent"} {
		if s := asObj(schemas[schemaName]); s != nil {
			props := asObj(s["properties"])
			for name, doc := range backgroundPropDocs {
				if p := asObj(props[name]); p != nil {
					merge(p, doc)
				}
			}
		}
	}
	if s := asObj(schemas["User"]); s != nil {
		props := asObj(s["properties"])
		for name, doc := range map[string]obj{
			"background_tasks":           {"description": "Background task mirrors owned by the user."},
			"background_task_artifacts":  {"description": "Background task artifact mirrors owned by the user."},
			"background_task_runs":       {"description": "Background task run mirrors owned by the user."},
			"background_task_run_events": {"description": "Background task run event mirrors owned by the user."},
		} {
			if p := asObj(props[name]); p != nil {
				merge(p, doc)
			}
		}
	}
}

func tokenResponses(successDescription string) obj {
	return obj{
		"200": jsonResponse(successDescription, ref("WorkOSTokenBundle"), obj{"access_token": "eyJhbGciOiJSUzI1NiIs...", "refresh_token": "refresh_token_123", "expires_at": 1790784000, "token_type": "Bearer", "user_id": "user_01HABCDEF", "email": "user@example.com"}),
		"400": responseRef("400"),
		"409": responseRef("409"),
		"502": responseRef("502"),
	}
}

func llmResponses(stream bool) obj {
	success := jsonResponse("OpenAI-compatible upstream response.", ref("LLMGatewayResponse"), obj{"id": "chatcmpl_123", "object": "chat.completion"})
	if stream {
		success = obj{
			"description": "OpenAI-compatible JSON response, or text/event-stream when stream=true.",
			"content": obj{
				"application/json":  obj{"schema": ref("LLMGatewayResponse"), "example": obj{"id": "chatcmpl_123", "object": "chat.completion"}},
				"text/event-stream": obj{"schema": obj{"type": "string"}, "example": "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n"},
			},
		}
	}
	return obj{
		"200": success,
		"400": responseRef("400"),
		"401": responseRef("401"),
		"402": responseRef("402"),
		"502": responseRef("502"),
		"503": responseRef("503"),
	}
}

func llmHeaderParams() []any {
	return []any{
		idempotencyHeaderParam(),
		headerParam("x-solomon-use-case", "Optional feature/use-case label recorded in LLMUsage for cost allocation.", false),
		headerParam("x-solomon-sub-use-case", "Optional sub-use-case label recorded in LLMUsage.", false),
		headerParam("x-solomon-agent-name", "Optional agent name recorded in LLMUsage.", false),
	}
}

func idempotencyHeaderParam() obj {
	return headerParam("Idempotency-Key", "Required stable key for metered POST retries. Reusing the same key for the same user, route, and method reuses the same credit reservation anchor.", true)
}

func connectorNameParam() []any {
	return []any{pathParam("name", "Connector slug, for example canvas, corinthian, or wispr.", stringSchema("Connector slug.", "canvas"))}
}

func slugParam() []any {
	return []any{pathParam("slug", "Background task slug, matching bg-tasks/<slug> locally.", stringSchema("Task slug.", "daily-summary"))}
}

func runIDParam() []any {
	return []any{pathParam("runId", "Cloud-visible run id for a background task run.", stringSchema("Run id.", "run-20260604-210000"))}
}

func runListQueryParams(includeSlug bool) []any {
	params := []any{
		queryParam("status", "Optional run status filter. Use queued for desktop pickup or running/failed/succeeded for polling dashboards.", false, stringEnum("Run status.", "queued", "queued", "running", "succeeded", "failed", "stopped")),
		queryParam("executor", "Optional execution backend filter.", false, stringEnum("Run executor.", "api", "desktop", "api")),
		queryParam("limit", "Maximum runs to return, from 1 to 500. Defaults to 100.", false, intSchema("Page size.", 100)),
		queryParam("cursor", "RFC3339 cursor returned as nextCursor from a previous page.", false, stringSchema("Pagination cursor.", "2026-06-04T21:00:30Z", obj{"format": "date-time"})),
	}
	if includeSlug {
		params = append(params, queryParam("slug", "Optional task slug filter for account-wide run polling.", false, stringSchema("Task slug.", "daily-summary")))
	}
	return params
}

func revisionQueryParam() any {
	return queryParam("revision", "Current task revision required for delete.", true, intSchema("Task revision.", 2))
}

func operation(tag, summary, description, id string, security []any, parameters []any, requestBody any, responses obj) obj {
	op := obj{
		"tags":        []any{tag},
		"summary":     summary,
		"description": description,
		"operationId": id,
		"responses":   responses,
	}
	if len(security) > 0 {
		op["security"] = security
	}
	if len(parameters) > 0 {
		op["parameters"] = parameters
	}
	if requestBody != nil {
		op["requestBody"] = requestBody
	}
	return op
}

func jsonRequest(description string, schema any, example any) obj {
	media := obj{"schema": schema}
	if example != nil {
		media["example"] = example
	}
	return obj{
		"description": description,
		"required":    true,
		"content":     obj{"application/json": media},
	}
}

func jsonRequestOptional(description string, schema any, example any) obj {
	body := jsonRequest(description, schema, example)
	body["required"] = false
	return body
}

func jsonResponse(description string, schema any, example any) obj {
	media := obj{"schema": schema}
	if example != nil {
		media["example"] = example
	}
	return obj{"description": description, "content": obj{"application/json": media}}
}

func problemResponse(description string, schema any, example any) obj {
	media := obj{"schema": schema}
	if example != nil {
		media["example"] = example
	}
	return obj{"description": description, "content": obj{"application/problem+json": media}}
}

func problemExample(status int, title, detail, code string) obj {
	return obj{
		"type":      "https://api.rowboat.dev/problems/" + code,
		"title":     title,
		"status":    status,
		"detail":    detail,
		"code":      code,
		"requestId": "req-abc123",
	}
}

func reconnectProblemExample() obj {
	ex := problemExample(409, "Conflict", "Google reports invalid_grant; user must reconnect.", "reconnect_required")
	ex["reconnectRequired"] = true
	return ex
}

func binaryResponse(description, contentType string) obj {
	return obj{"description": description, "content": obj{contentType: obj{"schema": obj{"type": "string", "format": "binary"}}}}
}

func htmlResponse(description string) obj {
	return obj{"description": description, "content": obj{"text/html": obj{"schema": obj{"type": "string"}}}}
}

func redirectResponse(description string) obj {
	return obj{
		"description": description,
		"headers": obj{
			"Location": obj{"description": "Redirect target.", "schema": obj{"type": "string", "format": "uri"}},
		},
	}
}

func responseRef(code string) obj {
	return obj{"$ref": "#/components/responses/" + code}
}

func revisionConflictResponse() obj {
	ex := problemExample(409, "Conflict", "revision conflict", "conflict")
	ex["currentRevision"] = 3
	return problemResponse("Revision conflict. The caller wrote with a stale revision and should retry with currentRevision.", ref("RevisionConflictEnvelope"), ex)
}

func backgroundTaskExample() obj {
	return obj{
		"id":              "a8dfa9b6-a7b2-46ea-982c-622a914c00e5",
		"slug":            "daily-summary",
		"name":            "Daily Account Summary",
		"instructions":    "Summarize important account changes and draft follow-up notes.",
		"active":          true,
		"triggers":        obj{"cronExpr": "0 9 * * *", "timezone": "America/New_York"},
		"model":           "openai/gpt-4.1-mini",
		"provider":        "openai",
		"executionTarget": "desktop",
		"createdAt":       "2026-06-04T20:38:00Z",
		"updatedAt":       "2026-06-04T20:39:00Z",
		"lastAttemptAt":   "2026-06-04T21:00:00Z",
		"lastRunId":       "run-20260604-210000",
		"lastRunAt":       "2026-06-04T21:02:00Z",
		"lastRunSummary":  "No high-priority account changes.",
		"lastRunError":    "",
		"revision":        2,
	}
}

func backgroundTaskArtifactExample() obj {
	return obj{
		"slug":      "daily-summary",
		"body":      "# Daily Account Summary\n\nUse this context when summarizing account changes.",
		"revision":  2,
		"updatedAt": "2026-06-04T20:39:00Z",
	}
}

func backgroundTaskRunExample() obj {
	return obj{
		"id":              "77f5e632-a841-4557-a8e4-9b8f0d207ff4",
		"runId":           "run-20260604-210000",
		"previousRunId":   "",
		"localRunId":      "local-run-42",
		"slug":            "daily-summary",
		"trigger":         "manual",
		"status":          "succeeded",
		"executor":        "desktop",
		"model":           "openai/gpt-4.1-mini",
		"provider":        "openai",
		"useCase":         "background-task",
		"subUseCase":      "daily-summary",
		"summary":         "No high-priority account changes.",
		"error":           "",
		"progressPercent": 100,
		"progressMessage": "Completed.",
		"startedAt":       "2026-06-04T21:01:00Z",
		"completedAt":     "2026-06-04T21:02:00Z",
		"createdAt":       "2026-06-04T21:00:30Z",
		"updatedAt":       "2026-06-04T21:02:05Z",
		"revision":        2,
	}
}

func backgroundTaskAPIRunExample() obj {
	run := backgroundTaskRunExample()
	run["runId"] = "api-trigger-4a31958c-3a0a-4cb2-9361-ea563cd0477b"
	run["localRunId"] = ""
	run["executor"] = "api"
	run["status"] = "queued"
	run["temporalWorkflowId"] = "background-task/user/daily-summary/api-trigger-4a31958c-3a0a-4cb2-9361-ea563cd0477b"
	run["temporalRunId"] = "01971cf4-3c7d-7aa0-9ac8-ef73bc506e16"
	run["temporalStatus"] = "Started"
	run["progressPercent"] = 0
	run["progressMessage"] = "Queued for API worker."
	run["startedAt"] = nil
	run["completedAt"] = nil
	run["revision"] = 2
	return run
}

func backgroundTaskRunStatusExample() obj {
	return obj{
		"runId":              "api-trigger-4a31958c-3a0a-4cb2-9361-ea563cd0477b",
		"slug":               "daily-summary",
		"status":             "running",
		"executor":           "api",
		"temporalWorkflowId": "background-task/user/daily-summary/api-trigger-4a31958c-3a0a-4cb2-9361-ea563cd0477b",
		"temporalRunId":      "01971cf4-3c7d-7aa0-9ac8-ef73bc506e16",
		"temporalStatus":     "Running",
		"progressPercent":    50,
		"progressMessage":    "Building API-native task artifact.",
		"lastHeartbeatAt":    "2026-06-04T21:01:30Z",
		"startedAt":          "2026-06-04T21:01:00Z",
		"completedAt":        nil,
		"error":              "",
		"revision":           3,
	}
}

func backgroundTaskQueuedRunExample() obj {
	run := backgroundTaskRunExample()
	run["runId"] = "remote-trigger-4a31958c-3a0a-4cb2-9361-ea563cd0477b"
	run["localRunId"] = ""
	run["executor"] = "desktop"
	run["trigger"] = "manual"
	run["status"] = "queued"
	run["requestedContext"] = "Run this now and focus on high-risk accounts."
	run["summary"] = ""
	run["startedAt"] = nil
	run["completedAt"] = nil
	run["revision"] = 1
	return run
}

func backgroundTaskRunEventExample() obj {
	return obj{
		"id":         "06227adb-924f-46f1-b324-1b10d080a660",
		"seq":        1,
		"type":       "completed",
		"event":      obj{"type": "completed", "summary": "ok"},
		"receivedAt": "2026-06-04T21:02:05Z",
	}
}

func ref(name string) obj {
	return obj{"$ref": "#/components/schemas/" + name}
}

func bearer() []any {
	return []any{obj{"BearerAuth": []any{}}}
}

func hookHMAC() []any {
	return []any{obj{"HookHMAC": []any{}}}
}

func internalSecret() []any {
	return []any{obj{"InternalSecret": []any{}}}
}

func pathParam(name, description string, schema any) obj {
	return obj{"name": name, "in": "path", "description": description, "required": true, "schema": schema}
}

func queryParam(name, description string, required bool, schema any) obj {
	return obj{"name": name, "in": "query", "description": description, "required": required, "schema": schema}
}

func headerParam(name, description string, required bool) obj {
	return obj{"name": name, "in": "header", "description": description, "required": required, "schema": obj{"type": "string"}}
}

func objectSchema(description string, props obj, required ...string) obj {
	s := obj{"type": "object", "description": description}
	if props != nil {
		s["properties"] = props
	}
	if len(required) > 0 {
		r := make([]any, len(required))
		for i, v := range required {
			r[i] = v
		}
		s["required"] = r
	}
	return s
}

func freeFormSchema(description string) obj {
	return obj{"type": "object", "description": description, "additionalProperties": true}
}

func stringSchema(description string, example any, extra ...obj) obj {
	s := obj{"type": "string", "description": description}
	if example != nil {
		s["example"] = example
	}
	merge(s, extra...)
	return s
}

func stringEnum(description string, example any, values ...any) obj {
	extra := obj{"enum": values}
	return stringSchema(description, example, extra)
}

func uuidSchema(description string, example string) obj {
	return stringSchema(description, example, obj{"format": "uuid"})
}

func intSchema(description string, example int, extra ...obj) obj {
	s := obj{"type": "integer", "description": description, "example": example}
	merge(s, extra...)
	return s
}

func int64Schema(description string, example int64) obj {
	return obj{"type": "integer", "format": "int64", "description": description, "example": example}
}

func numberSchema(description string, example float64) obj {
	return obj{"type": "number", "description": description, "example": example}
}

func boolSchema(description string, example bool) obj {
	return obj{"type": "boolean", "description": description, "example": example}
}

func arraySchema(description string, items any) obj {
	return obj{"type": "array", "description": description, "items": items}
}

func nullable() obj {
	return obj{"nullable": true}
}

func merge(target obj, extras ...obj) {
	for _, extra := range extras {
		for k, v := range extra {
			target[k] = v
		}
	}
}

func ensureObj(parent obj, key string) obj {
	if child := asObj(parent[key]); child != nil {
		return child
	}
	child := obj{}
	parent[key] = child
	return child
}

func asObj(v any) obj {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}

func methodName(method string) string {
	switch method {
	case "get":
		return "Get"
	case "post":
		return "Post"
	case "put":
		return "Put"
	case "patch":
		return "Patch"
	case "delete":
		return "Delete"
	default:
		return method
	}
}
