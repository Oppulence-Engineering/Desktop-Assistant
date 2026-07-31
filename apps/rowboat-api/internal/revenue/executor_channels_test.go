package revenue

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

type staticSlackTokens struct {
	token  string
	teamID string
}

func (s staticSlackTokens) Resolve(context.Context, string, string) (string, error) {
	return s.token, nil
}

func (s staticSlackTokens) ResolveTeam(_ context.Context, _, teamID string) (string, error) {
	s.teamID = teamID
	return s.token, nil
}

func TestRoutingExecutorDispatchesEverySupportedChannel(t *testing.T) {
	email := &fakeExecutor{result: &ExecResult{ProviderMessageID: "email"}}
	slack := &fakeExecutor{result: &ExecResult{ProviderMessageID: "slack"}}
	calendar := &fakeExecutor{result: &ExecResult{ProviderMessageID: "calendar"}}
	crm := &fakeExecutor{result: &ExecResult{ProviderMessageID: "crm"}}
	router := NewRoutingExecutor(email, slack, calendar, crm)

	tests := []struct {
		channel string
		want    string
	}{
		{channel: "email", want: "email"},
		{channel: "slack", want: "slack"},
		{channel: "calendar", want: "calendar"},
		{channel: "crm", want: "crm"},
		{channel: "crm_task", want: "crm"},
		{channel: "task", want: "crm"},
	}
	for _, tt := range tests {
		t.Run(tt.channel, func(t *testing.T) {
			got, err := router.Execute(context.Background(), ExecRequest{Action: &ent.RevenueAction{Channel: tt.channel}})
			if err != nil {
				t.Fatalf("route %s: %v", tt.channel, err)
			}
			if got.ProviderMessageID != tt.want {
				t.Fatalf("route %s = %q, want %q", tt.channel, got.ProviderMessageID, tt.want)
			}
		})
	}
	if email.calls != 1 || slack.calls != 1 || calendar.calls != 1 || crm.calls != 3 {
		t.Fatalf("unexpected route counts: email=%d slack=%d calendar=%d crm=%d", email.calls, slack.calls, calendar.calls, crm.calls)
	}
}

func TestSlackExecutorUsesSDKAndExplicitTarget(t *testing.T) {
	var gotForm url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat.postMessage" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse form: %v", err)
		}
		gotForm = r.Form
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true,"channel":"C123","ts":"1712345678.001"}`)
	}))
	t.Cleanup(server.Close)

	exec := NewSlackExecutor(staticSlackTokens{token: "xoxb-test"}, outbound.Policy{})
	exec.SetAPIURL(server.URL)
	result, err := exec.Execute(context.Background(), ExecRequest{
		Mode:   ExecModeSend,
		UserID: uuid.New(),
		Action: &ent.RevenueAction{
			Channel:          "slack",
			SenderAccountRef: "slack:T123:C123:1711111111.000",
			ProposedSubject:  "Next step",
			ProposedMessage:  "Send the recap.",
		},
	})
	if err != nil {
		t.Fatalf("execute Slack: %v", err)
	}
	if result.ProviderMessageID != "1712345678.001" || result.ProviderThreadID != "1711111111.000" {
		t.Fatalf("result = %+v", result)
	}
	if gotForm.Get("token") != "xoxb-test" || gotForm.Get("channel") != "C123" || gotForm.Get("thread_ts") != "1711111111.000" {
		t.Fatalf("Slack form = %#v", gotForm)
	}
	if gotForm.Get("text") != "*Next step*\nSend the recap." {
		t.Fatalf("Slack text = %q", gotForm.Get("text"))
	}
}

func TestSlackExecutorServerErrorIsAmbiguousAndNotRetried(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		http.Error(w, "provider unavailable", http.StatusBadGateway)
	}))
	t.Cleanup(server.Close)

	exec := NewSlackExecutor(staticSlackTokens{token: "xoxb-test"}, outbound.Policy{})
	exec.SetAPIURL(server.URL)
	_, err := exec.Execute(context.Background(), ExecRequest{
		Mode: ExecModeSend, UserID: uuid.New(),
		Action: &ent.RevenueAction{
			Channel: "slack", SenderAccountRef: "slack:T123:C123",
			ProposedMessage: "Reviewed follow-up",
		},
	})
	if !errors.Is(err, ErrAmbiguous) {
		t.Fatalf("Slack 5xx must be ambiguous, got %v", err)
	}
	if calls != 1 {
		t.Fatalf("Slack write was retried %d times; want exactly one attempt", calls)
	}
}

func TestCalendarExecutorCreatesReviewedEvent(t *testing.T) {
	g := newGmailFixture(t, []string{scopeCalendarEvents})
	start := time.Date(2026, 8, 4, 15, 0, 0, 0, time.UTC)
	exec := NewCalendarExecutor(g.exec)
	result, err := exec.Execute(g.ctx, ExecRequest{
		Mode:   ExecModeSend,
		UserID: g.user.ID,
		Action: &ent.RevenueAction{
			Channel:         "calendar",
			DueAt:           &start,
			RecipientEmail:  "buyer@example.com",
			ProposedSubject: "Pilot kickoff",
			ProposedMessage: "Review implementation milestones.",
		},
	})
	if err != nil {
		t.Fatalf("execute Calendar: %v", err)
	}
	if result.ProviderMessageID != "evt_1" || result.ProviderThreadID != "https://calendar.test/evt_1" || g.calendar != 1 || g.calendarSendUpdates != "all" {
		t.Fatalf("result=%+v calendar calls=%d sendUpdates=%q", result, g.calendar, g.calendarSendUpdates)
	}
}

func TestHubSpotExecutorUsesSDKWithAssociation(t *testing.T) {
	f := newFixture(t)
	sealer, err := crypto.NewSealer("test-encryption-key-for-hubspot")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	sealed, err := sealer.SealString("pat-na1-test")
	if err != nil {
		t.Fatalf("seal token: %v", err)
	}
	f.client.MCPConnection.Create().
		SetUser(f.user).
		SetConnector("hubspot").
		SetAudience("hubspot-api").
		SetAPIKeyEncrypted(sealed).
		SaveX(f.ctx)

	var gotPath, gotAuthorization string
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuthorization = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"note-42","archived":false,"createdAt":"2026-07-31T12:00:00Z","updatedAt":"2026-07-31T12:00:00Z","properties":{}}`)
	}))
	t.Cleanup(server.Close)

	exec := NewHubSpotExecutor(f.client, sealer, outbound.Policy{})
	exec.SetBaseURL(server.URL)
	exec.now = func() time.Time { return time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC) }
	result, err := exec.Execute(f.ctx, ExecRequest{
		Mode:   ExecModeSend,
		UserID: f.user.ID,
		Action: &ent.RevenueAction{
			Channel:          "crm",
			SenderAccountRef: "hubspot:contact:12345",
			ProposedMessage:  "Customer agreed to the pilot.",
		},
	})
	if err != nil {
		t.Fatalf("execute HubSpot: %v", err)
	}
	if result.ProviderMessageID != "note-42" || result.ProviderThreadID != "hubspot:contact:12345" {
		t.Fatalf("result = %+v", result)
	}
	if gotPath != "/crm/objects/2026-03/notes" || gotAuthorization != "Bearer pat-na1-test" {
		t.Fatalf("request path=%q authorization=%q", gotPath, gotAuthorization)
	}
	properties, ok := gotBody["properties"].(map[string]any)
	if !ok || properties["hs_note_body"] != "Customer agreed to the pilot." {
		t.Fatalf("properties = %#v", gotBody["properties"])
	}
	associations, ok := gotBody["associations"].([]any)
	if !ok || len(associations) != 1 {
		t.Fatalf("associations = %#v", gotBody["associations"])
	}
	association := associations[0].(map[string]any)
	if association["to"].(map[string]any)["id"] != "12345" {
		t.Fatalf("association target = %#v", association["to"])
	}
	types := association["types"].([]any)
	if types[0].(map[string]any)["associationTypeId"] != float64(202) {
		t.Fatalf("association type = %#v", types[0])
	}
}

func TestProviderTargetsRejectImplicitDestinations(t *testing.T) {
	_, _, _, err := slackTarget(&ent.RevenueAction{SenderAccountRef: "C123"})
	if err == nil || !strings.Contains(err.Error(), "slack:<team-id>") {
		t.Fatalf("Slack target error = %v", err)
	}
	_, _, err = hubSpotTarget(&ent.RevenueAction{SenderAccountRef: "12345"})
	if err == nil || !strings.Contains(err.Error(), "hubspot:<contact") {
		t.Fatalf("HubSpot target error = %v", err)
	}
}

func TestHubSpotCredentialIsTenantScoped(t *testing.T) {
	f := newFixture(t)
	sealer, err := crypto.NewSealer("test-encryption-key-for-hubspot")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	exec := NewHubSpotExecutor(f.client, sealer, outbound.Policy{})
	other := newUser(t, f.client, "other-hubspot@x.co", "user_other_hubspot")
	_, err = exec.token(auth.WithUser(context.Background(), other), other.ID)
	if err == nil || !strings.Contains(err.Error(), "not connected") {
		t.Fatalf("other tenant credential lookup = %v", err)
	}
}
