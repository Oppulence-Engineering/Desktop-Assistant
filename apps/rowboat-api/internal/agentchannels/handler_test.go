package agentchannels

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsession"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

const testSlackSecret = "slack-signing-secret"

func signSlack(secret, ts string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("v0:" + ts + ":"))
	mac.Write(body)
	return "v0=" + hex.EncodeToString(mac.Sum(nil))
}

// postSlackInbound signs and posts an Events API delivery, returning the status.
func postSlackInbound(t *testing.T, url string, body []byte, headers map[string]string) int {
	t.Helper()
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Slack-Request-Timestamp", ts)
	req.Header.Set("X-Slack-Signature", signSlack(testSlackSecret, ts, body))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	return resp.StatusCode
}

func newInboundHarness(t *testing.T) (*ent.Client, *ent.User, *fakeController, *httptest.Server) {
	t.Helper()
	client, u, starter, ctrl := setup(t)
	// Map the Slack workspace (team T1) to the user.
	client.OAuthConnection.Create().
		SetUser(u).SetProvider("slack").SetExternalAccountID("T1").
		SetRefreshTokenEncrypted([]byte("sealed")).SaveX(context.Background())

	d := New(client, starter, "assistant", zap.NewNop())
	h := NewHandler(client, d, testSlackSecret, zap.NewNop())
	r := chi.NewRouter()
	r.Post("/v1/agent-channels/slack", h.SlackInbound)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return client, u, ctrl, srv
}

func TestStripSlackMentions(t *testing.T) {
	cases := map[string]string{
		"<@U0BOT> summarize this thread": "summarize this thread",
		"<@U0BOT|bot> hey there":         "hey there",
		"no mention here":                "no mention here",
		// Only the leading (bot trigger) mention is stripped; in-body referents
		// like @sarah are preserved so the agent still sees who the request names.
		"<@U0BOT> remind <@U2SARAH> about the report": "remind <@U2SARAH> about the report",
		"<@U1> <@U2> hello":                           "hello",
		"<@U0BOT>":                                    "",
	}
	for in, want := range cases {
		if got := stripSlackMentions(in); got != want {
			t.Fatalf("stripSlackMentions(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSlackInboundAppMentionDispatches(t *testing.T) {
	client, u, ctrl, srv := newInboundHarness(t)

	body := []byte(`{"type":"event_callback","team_id":"T1","event_id":"Ev1","event":{"type":"app_mention","text":"<@U0BOT> summarize this thread","channel":"C1","ts":"1700000000.000100"}}`)
	if got := postSlackInbound(t, srv.URL+"/v1/agent-channels/slack", body, nil); got != http.StatusOK {
		t.Fatalf("status = %d, want 200", got)
	}
	if ctrl.starts != 1 {
		t.Fatalf("expected 1 session start, got %d", ctrl.starts)
	}
	if len(ctrl.lastStart.Pending) != 1 || ctrl.lastStart.Pending[0].Input != "summarize this thread" {
		t.Fatalf("dispatched input = %+v, want mention-stripped 'summarize this thread'", ctrl.lastStart.Pending)
	}
	n := client.AgentSession.Query().
		Where(agentsession.ChannelKeyEQ("slack:T1:C1:1700000000.000100")).
		CountX(auth.WithUser(context.Background(), u))
	if n != 1 {
		t.Fatalf("expected 1 session for channel key, got %d", n)
	}
}

func TestSlackInboundDedupesByEventID(t *testing.T) {
	_, _, ctrl, srv := newInboundHarness(t)
	body := []byte(`{"type":"event_callback","team_id":"T1","event_id":"Ev1","event":{"type":"app_mention","text":"<@U0BOT> hi","channel":"C1","ts":"1700000000.000100"}}`)
	// First delivery dispatches.
	if got := postSlackInbound(t, srv.URL+"/v1/agent-channels/slack", body, nil); got != http.StatusOK {
		t.Fatalf("first status = %d, want 200", got)
	}
	// A retry of the SAME event_id is deduped (no second turn), even though it
	// carries the retry header.
	if got := postSlackInbound(t, srv.URL+"/v1/agent-channels/slack", body, map[string]string{"X-Slack-Retry-Num": "1"}); got != http.StatusOK {
		t.Fatalf("retry status = %d, want 200", got)
	}
	if ctrl.starts != 1 {
		t.Fatalf("expected exactly 1 session start across duplicate deliveries, got %d", ctrl.starts)
	}
}

func TestSlackInboundProcessesRetryWhenFirstNeverDispatched(t *testing.T) {
	_, _, ctrl, srv := newInboundHarness(t)
	// Distinct event_id never seen before (simulating a first attempt that failed
	// before dispatch, so nothing was claimed) — the retry must be processed, not
	// dropped on the basis of the retry header alone.
	body := []byte(`{"type":"event_callback","team_id":"T1","event_id":"Ev-late","event":{"type":"app_mention","text":"<@U0BOT> hi","channel":"C1","ts":"1700000000.000900"}}`)
	if got := postSlackInbound(t, srv.URL+"/v1/agent-channels/slack", body, map[string]string{"X-Slack-Retry-Num": "2"}); got != http.StatusOK {
		t.Fatalf("status = %d, want 200", got)
	}
	if ctrl.starts != 1 {
		t.Fatalf("retry of an undispatched event must be processed, got %d starts", ctrl.starts)
	}
}

func TestSlackInboundIgnoresNonMention(t *testing.T) {
	_, _, ctrl, srv := newInboundHarness(t)
	// A plain message (not an @-mention) must not trigger the bot.
	body := []byte(`{"type":"event_callback","team_id":"T1","event_id":"Ev2","event":{"type":"message","text":"just chatting","channel":"C1","ts":"1700000000.000200"}}`)
	if got := postSlackInbound(t, srv.URL+"/v1/agent-channels/slack", body, nil); got != http.StatusOK {
		t.Fatalf("status = %d, want 200", got)
	}
	if ctrl.starts != 0 {
		t.Fatalf("non-mention message must not dispatch, but %d started", ctrl.starts)
	}
}

func TestSlackInboundIgnoresBotMention(t *testing.T) {
	_, _, ctrl, srv := newInboundHarness(t)
	// An app_mention authored by a bot (bot_id set) must not loop back.
	body := []byte(`{"type":"event_callback","team_id":"T1","event_id":"Ev3","event":{"type":"app_mention","bot_id":"B1","text":"<@U0BOT> echo","channel":"C1","ts":"1700000000.000300"}}`)
	if got := postSlackInbound(t, srv.URL+"/v1/agent-channels/slack", body, nil); got != http.StatusOK {
		t.Fatalf("status = %d, want 200", got)
	}
	if ctrl.starts != 0 {
		t.Fatalf("bot-authored mention must not dispatch, but %d started", ctrl.starts)
	}
}

type fakeApprover struct {
	calls []agentworkflow.ApproveAction
	users []string
	sess  []string
}

func (f *fakeApprover) Approve(_ context.Context, userID, sessionID string, in agentworkflow.ApproveAction) (agentworkflow.TurnAck, error) {
	f.users = append(f.users, userID)
	f.sess = append(f.sess, sessionID)
	f.calls = append(f.calls, in)
	return agentworkflow.TurnAck{Accepted: true}, nil
}

func TestSlackInteractivityResolvesApproval(t *testing.T) {
	// Build the handler directly (the inbound harness does not wire approvals).
	c, _, _, _ := setup(t)
	d := New(c, nil, "assistant", zap.NewNop())
	h := NewHandler(c, d, testSlackSecret, zap.NewNop())
	approver := &fakeApprover{}
	h.SetApprovals(approver, nil) // nil slack client → skip response_url update
	r := chi.NewRouter()
	r.Post("/v1/agent-channels/slack/interactivity", h.SlackInteractivity)
	srv := httptest.NewServer(r)
	defer srv.Close()

	value, _ := json.Marshal(map[string]string{
		"approvalId": "sess-1/turn/0/approval/0", "sessionId": "sess-1",
		"userId": "00000000-0000-0000-0000-000000000009", "decision": "granted",
	})
	payload, _ := json.Marshal(map[string]any{
		"type":         "block_actions",
		"user":         map[string]any{"id": "U7"},
		"response_url": "https://hooks.slack.test/x",
		"actions":      []any{map[string]any{"action_id": "agent_approve", "value": string(value)}},
	})
	body := []byte("payload=" + url.QueryEscape(string(payload)))

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/agent-channels/slack/interactivity", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("X-Slack-Request-Timestamp", ts)
	req.Header.Set("X-Slack-Signature", signSlack(testSlackSecret, ts, body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if len(approver.calls) != 1 {
		t.Fatalf("expected 1 approval call, got %d", len(approver.calls))
	}
	got := approver.calls[0]
	if got.ApprovalID != "sess-1/turn/0/approval/0" || got.Decision != "granted" {
		t.Fatalf("approval = %+v", got)
	}
	if approver.users[0] != "00000000-0000-0000-0000-000000000009" || approver.sess[0] != "sess-1" {
		t.Fatalf("resolved user/session = %q/%q", approver.users[0], approver.sess[0])
	}
	if got.ResolvedBy != "slack:U7" {
		t.Fatalf("resolvedBy = %q", got.ResolvedBy)
	}
}

// postInteractivity signs and posts a block_actions payload whose button value
// names the requester (slackUser) and is clicked by clicker. Returns the status
// and the approver to assert against.
func postInteractivity(t *testing.T, slackUser, clicker string) (int, *fakeApprover) {
	t.Helper()
	c, _, _, _ := setup(t)
	d := New(c, nil, "assistant", zap.NewNop())
	h := NewHandler(c, d, testSlackSecret, zap.NewNop())
	approver := &fakeApprover{}
	h.SetApprovals(approver, nil)
	r := chi.NewRouter()
	r.Post("/v1/agent-channels/slack/interactivity", h.SlackInteractivity)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	value, _ := json.Marshal(map[string]string{
		"approvalId": "sess-1/turn/0/approval/0", "sessionId": "sess-1",
		"userId": "00000000-0000-0000-0000-000000000009", "decision": "granted",
		"slackUser": slackUser,
	})
	payload, _ := json.Marshal(map[string]any{
		"type":    "block_actions",
		"user":    map[string]any{"id": clicker},
		"actions": []any{map[string]any{"action_id": "agent_approve", "value": string(value)}},
	})
	body := []byte("payload=" + url.QueryEscape(string(payload)))
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/agent-channels/slack/interactivity", bytes.NewReader(body))
	req.Header.Set("X-Slack-Request-Timestamp", ts)
	req.Header.Set("X-Slack-Signature", signSlack(testSlackSecret, ts, body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	return resp.StatusCode, approver
}

func TestSlackInteractivityRejectsNonRequester(t *testing.T) {
	status, approver := postInteractivity(t, "U_REQUESTER", "U_SOMEONE_ELSE")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if len(approver.calls) != 0 {
		t.Fatalf("a non-requester click must not resolve the approval, got %d calls", len(approver.calls))
	}
}

func TestSlackInteractivityAllowsRequester(t *testing.T) {
	status, approver := postInteractivity(t, "U_REQUESTER", "U_REQUESTER")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if len(approver.calls) != 1 {
		t.Fatalf("the requester's click must resolve the approval, got %d calls", len(approver.calls))
	}
}

func TestSlackInteractivityRejectsBadSignature(t *testing.T) {
	c, _, _, _ := setup(t)
	d := New(c, nil, "assistant", zap.NewNop())
	h := NewHandler(c, d, testSlackSecret, zap.NewNop())
	h.SetApprovals(&fakeApprover{}, nil)
	r := chi.NewRouter()
	r.Post("/v1/agent-channels/slack/interactivity", h.SlackInteractivity)
	srv := httptest.NewServer(r)
	defer srv.Close()

	body := []byte("payload=%7B%7D")
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/agent-channels/slack/interactivity", bytes.NewReader(body))
	req.Header.Set("X-Slack-Request-Timestamp", strconv.FormatInt(time.Now().Unix(), 10))
	req.Header.Set("X-Slack-Signature", "v0=bad")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestSlackInboundURLVerification(t *testing.T) {
	_, _, _, srv := newInboundHarness(t)
	body := []byte(`{"type":"url_verification","challenge":"abc123"}`)
	if got := postSlackInbound(t, srv.URL+"/v1/agent-channels/slack", body, nil); got != http.StatusOK {
		t.Fatalf("status = %d, want 200", got)
	}
}

func TestSlackInboundRejectsBadSignature(t *testing.T) {
	_, _, _, srv := newInboundHarness(t)
	body := []byte(`{"type":"event_callback","team_id":"T1","event":{"type":"app_mention","text":"<@U0BOT> hi","channel":"C1","ts":"1.1"}}`)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/agent-channels/slack", bytes.NewReader(body))
	req.Header.Set("X-Slack-Request-Timestamp", strconv.FormatInt(time.Now().Unix(), 10))
	req.Header.Set("X-Slack-Signature", "v0=deadbeef")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}
