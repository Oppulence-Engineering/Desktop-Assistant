package connectors_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorauditevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
)

const strictContextBody = `{"version":1,"challenge":"hydra-consent-challenge","workos_user_id":"user_1","hydra_client_id":"broker","requested_audience":["mcp:canvas"],"requested_scopes":["canvas:invoices.read","canvas:customers.read"]}`

func startConsentContext(t *testing.T) (*httptest.ResponseRecorder, string, *connectors.Handler) {
	t.Helper()
	_, u, h := setup(t, connectors.DefaultRegistry())
	start := httptest.NewRecorder()
	h.Start(start, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/start", nil).
		WithContext(withParam(auth.WithUser(context.Background(), u), "name", "canvas")))
	if start.Code != http.StatusOK {
		t.Fatalf("start: %d %s", start.Code, start.Body.String())
	}
	contextRec := httptest.NewRecorder()
	h.PreConsent(contextRec, httptest.NewRequest(http.MethodPost, "/oauth-hooks/pre-consent", strings.NewReader(strictContextBody)).
		WithContext(auth.WithInternal(context.Background())))
	if contextRec.Code != http.StatusOK {
		t.Fatalf("context: %d %s", contextRec.Code, contextRec.Body.String())
	}
	var response struct {
		RequestID string `json:"request_id"`
	}
	if err := json.Unmarshal(contextRec.Body.Bytes(), &response); err != nil || response.RequestID == "" {
		t.Fatalf("decode context: %v %s", err, contextRec.Body.String())
	}
	return contextRec, response.RequestID, h
}

func TestPreConsentExactContractAndStrictRequest(t *testing.T) {
	contextRec, requestID, h := startConsentContext(t)

	var top map[string]json.RawMessage
	if err := json.Unmarshal(contextRec.Body.Bytes(), &top); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"request_id", "subject", "client", "connector", "scopes", "entitlement"} {
		if _, ok := top[key]; !ok {
			t.Fatalf("context response missing %q: %s", key, contextRec.Body.String())
		}
	}
	if len(top) != 6 {
		t.Fatalf("context response has unknown fields: %s", contextRec.Body.String())
	}
	var response struct {
		RequestID string `json:"request_id"`
		Subject   string `json:"subject"`
		Client    struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"client"`
		Connector struct {
			ID       string `json:"id"`
			Audience string `json:"audience"`
		} `json:"connector"`
		Scopes []struct {
			Name           string `json:"name"`
			Tier           string `json:"tier"`
			Required       bool   `json:"required"`
			RequiresStepUp bool   `json:"requires_step_up"`
		} `json:"scopes"`
		Entitlement map[string]any `json:"entitlement"`
	}
	if err := json.Unmarshal(contextRec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.RequestID != requestID || response.Subject != "user_1" || response.Client.ID != "broker" ||
		response.Client.DisplayName != "Rowboat Desktop" || response.Connector.ID != "canvas" ||
		response.Connector.Audience != "mcp:canvas" || len(response.Scopes) != 2 {
		t.Fatalf("unexpected context identities/catalog: %+v", response)
	}
	for _, scope := range response.Scopes {
		if scope.Name == "" || scope.Tier != "low" || !scope.Required || scope.RequiresStepUp {
			t.Fatalf("unexpected scope contract: %+v", scope)
		}
	}
	if len(response.Entitlement) != 1 || response.Entitlement["allowed"] != true {
		t.Fatalf("allowed entitlement must contain only allowed:true: %#v", response.Entitlement)
	}
	for _, forbidden := range []string{"state", "code_verifier", "payload_encrypted", "refresh_token", "owner_org_id", "expires_at"} {
		if strings.Contains(contextRec.Body.String(), forbidden) {
			t.Fatalf("context response leaked %q: %s", forbidden, contextRec.Body.String())
		}
	}

	// The same challenge is idempotent and returns the persisted request id.
	replay := httptest.NewRecorder()
	h.PreConsent(replay, httptest.NewRequest(http.MethodPost, "/oauth-hooks/pre-consent", strings.NewReader(strictContextBody)).
		WithContext(auth.WithInternal(context.Background())))
	if replay.Code != http.StatusOK || !strings.Contains(replay.Body.String(), `"request_id":"`+requestID+`"`) {
		t.Fatalf("context replay: %d %s", replay.Code, replay.Body.String())
	}

	for name, body := range map[string]string{
		"unknown_field":   strings.TrimSuffix(strictContextBody, "}") + `,"subject":"legacy"}`,
		"audience_scalar": strings.Replace(strictContextBody, `"requested_audience":["mcp:canvas"]`, `"requested_audience":"mcp:canvas"`, 1),
		"duplicate_scope": strings.Replace(strictContextBody, `"canvas:customers.read"]`, `"canvas:customers.read","canvas:customers.read"]`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.PreConsent(rec, httptest.NewRequest(http.MethodPost, "/oauth-hooks/pre-consent", strings.NewReader(body)).
				WithContext(auth.WithInternal(context.Background())))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("got %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestConsentAuditStrictEventsDurableDedupAndIdentityChecks(t *testing.T) {
	client, u, h := setup(t, connectors.DefaultRegistry())
	start := httptest.NewRecorder()
	h.Start(start, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/start", nil).
		WithContext(withParam(auth.WithUser(context.Background(), u), "name", "canvas")))
	contextRec := httptest.NewRecorder()
	h.PreConsent(contextRec, httptest.NewRequest(http.MethodPost, "/oauth-hooks/pre-consent", strings.NewReader(strictContextBody)).
		WithContext(auth.WithInternal(context.Background())))
	var contextResponse struct {
		RequestID string `json:"request_id"`
	}
	if err := json.Unmarshal(contextRec.Body.Bytes(), &contextResponse); err != nil || contextResponse.RequestID == "" {
		t.Fatalf("context: %v %s", err, contextRec.Body.String())
	}
	baseCount := client.ConnectorAuditEvent.Query().CountX(auth.WithUser(context.Background(), u))
	occurredAt := time.Now().UTC().Truncate(time.Millisecond)
	makePayload := func(eventID, event, result string) []byte {
		payload, err := json.Marshal(map[string]any{
			"version": 1, "event_id": eventID, "event": event,
			"occurred_at": occurredAt.Format(time.RFC3339Nano), "consent_session_id": "session-123",
			"context_request_id": contextResponse.RequestID, "workos_user_id": "user_1", "client_id": "broker",
			"connector_id": "canvas", "audience": "mcp:canvas",
			"scopes": []string{"canvas:invoices.read", "canvas:customers.read"}, "result": result,
		})
		if err != nil {
			t.Fatal(err)
		}
		return payload
	}
	post := func(payload []byte) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.AppendConsentAudit(rec, httptest.NewRequest(http.MethodPost, "/oauth-hooks/consent-audit", strings.NewReader(string(payload))).
			WithContext(auth.WithInternal(context.Background())))
		return rec
	}

	shown := makePayload("event-shown", "consent.shown", "eligible")
	for i := 0; i < 2; i++ {
		if rec := post(shown); rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"accepted":true}` {
			t.Fatalf("shown attempt %d: %d %s", i, rec.Code, rec.Body.String())
		}
	}
	for _, tc := range []struct {
		id, event, result string
	}{
		{"event-granted", "consent.granted", "approved"},
		{"event-denied", "consent.denied", "user_denied"},
	} {
		if rec := post(makePayload(tc.id, tc.event, tc.result)); rec.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", tc.event, rec.Code, rec.Body.String())
		}
	}
	if got := client.ConnectorAuditEvent.Query().CountX(auth.WithUser(context.Background(), u)); got != baseCount+3 {
		t.Fatalf("audit count = %d, want %d; exact replay must deduplicate", got, baseCount+3)
	}
	persisted := client.ConnectorAuditEvent.Query().Where(connectorauditevent.EventIDEQ("event-shown")).OnlyX(auth.WithInternal(context.Background()))
	if persisted.EventType != "consent.shown" || persisted.ConsentSessionID != "session-123" ||
		persisted.ContextRequestID != contextResponse.RequestID || persisted.Challenge != "hydra-consent-challenge" ||
		persisted.ClientID != "broker" || persisted.Result != "eligible" || !persisted.OccurredAt.Equal(occurredAt) {
		t.Fatalf("durable audit fields = %+v", persisted)
	}

	conflict := makePayload("event-shown", "consent.shown", "changed")
	if rec := post(conflict); rec.Code != http.StatusConflict {
		t.Fatalf("conflicting event_id: %d %s", rec.Code, rec.Body.String())
	}
	wrongIdentity := strings.Replace(string(makePayload("event-wrong-user", "consent.denied", "user_denied")), `"workos_user_id":"user_1"`, `"workos_user_id":"user_2"`, 1)
	if rec := post([]byte(wrongIdentity)); rec.Code != http.StatusForbidden {
		t.Fatalf("identity mismatch: %d %s", rec.Code, rec.Body.String())
	}
	unknownField := strings.TrimSuffix(string(makePayload("event-extra", "consent.denied", "user_denied")), "}") + `,"metadata":{"token":"secret"}}`
	if rec := post([]byte(unknownField)); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown audit field: %d %s", rec.Code, rec.Body.String())
	}
	invalidEvent := makePayload("event-invalid", "consent.approved", "approved")
	if rec := post(invalidEvent); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid event: %d %s", rec.Code, rec.Body.String())
	}
	if got := client.ConnectorAuditEvent.Query().CountX(auth.WithUser(context.Background(), u)); got != baseCount+3 {
		t.Fatalf("failed audit requests wrote rows: %d", got)
	}
}
