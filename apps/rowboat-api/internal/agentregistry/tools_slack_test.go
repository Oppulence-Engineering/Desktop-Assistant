package agentregistry

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slackclient"
	"go.uber.org/zap"
)

type fakeCreds struct {
	token string
	err   error
}

func (f fakeCreds) Resolve(_ context.Context, _, _ string) (string, error) {
	return f.token, f.err
}

// slackToolEnv builds an ent client with one session row, a Slack mock server,
// and the ToolDeps + scope a Slack tool sees. lastPost captures a post body.
func slackToolEnv(t *testing.T, channel, channelKey string, creds CredResolver) (ToolDeps, backgroundtaskruntime.ToolScope, *string) {
	t.Helper()
	ctx := context.Background()
	d, err := db.Open(ctx, appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })

	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("u1").SaveX(ctx)
	const sessionID = "sess-1"
	d.Client.AgentSession.Create().
		SetUser(u).SetSessionID(sessionID).SetAgentSlug("concierge-slack").
		SetAgentSource("builtin").SetChannel(channel).SetChannelKey(channelKey).
		SetStatus("active").SaveX(auth.WithUser(ctx, u))

	var lastPost string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/conversations.replies":
			_, _ = w.Write([]byte(`{"ok":true,"messages":[{"user":"U1","text":"please summarize","ts":"1.1"}]}`))
		case "/chat.postMessage":
			b, _ := io.ReadAll(r.Body)
			lastPost = string(b)
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)

	sc := slackclient.New(outbound.Policy{})
	sc.SetBaseURL(srv.URL)
	deps := ToolDeps{Client: d.Client, Creds: creds, Slack: sc}
	scope := backgroundtaskruntime.ToolScope{UserID: u.ID.String(), RunID: sessionID}
	return deps, scope, &lastPost
}

func TestSlackReadThreadTool(t *testing.T) {
	deps, scope, _ := slackToolEnv(t, "slack", "slack:T1:C1:1.1", fakeCreds{token: "xoxb-1"})
	tool := SlackReadThreadCapability().Build(deps)

	out, err := tool.Invoke(auth.WithInternal(context.Background()), scope, nil)
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	var res struct {
		Messages []slackclient.Message `json:"messages"`
		Error    string                `json:"error"`
	}
	if uerr := json.Unmarshal(out, &res); uerr != nil {
		t.Fatalf("unmarshal: %v (%s)", uerr, out)
	}
	if res.Error != "" {
		t.Fatalf("unexpected error observation: %s", res.Error)
	}
	if len(res.Messages) != 1 || res.Messages[0].Text != "please summarize" {
		t.Fatalf("messages = %+v", res.Messages)
	}
}

func TestSlackPostMessageToolDefaultsToThread(t *testing.T) {
	deps, scope, lastPost := slackToolEnv(t, "slack", "slack:T1:C1:1.1", fakeCreds{token: "xoxb-1"})
	tool := SlackPostMessageCapability().Build(deps)

	out, err := tool.Invoke(auth.WithInternal(context.Background()), scope, json.RawMessage(`{"text":"done!"}`))
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if !strings.Contains(string(out), `"ok":true`) {
		t.Fatalf("result = %s", out)
	}
	for _, want := range []string{`"channel":"C1"`, `"text":"done!"`, `"thread_ts":"1.1"`} {
		if !strings.Contains(*lastPost, want) {
			t.Fatalf("posted body %q missing %q", *lastPost, want)
		}
	}
}

func TestSlackToolNonSlackSession(t *testing.T) {
	deps, scope, _ := slackToolEnv(t, "http", "", fakeCreds{token: "xoxb-1"})
	tool := SlackReadThreadCapability().Build(deps)
	out, err := tool.Invoke(auth.WithInternal(context.Background()), scope, nil)
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if !strings.Contains(string(out), "only available in Slack") {
		t.Fatalf("expected Slack-only observation, got %s", out)
	}
}

func TestSlackToolNotConnected(t *testing.T) {
	deps, scope, _ := slackToolEnv(t, "slack", "slack:T1:C1:1.1", fakeCreds{err: context.DeadlineExceeded})
	tool := SlackReadThreadCapability().Build(deps)
	out, err := tool.Invoke(auth.WithInternal(context.Background()), scope, nil)
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if !strings.Contains(string(out), "error") {
		t.Fatalf("expected an error observation, got %s", out)
	}
}

func TestSlackToolsRegisteredInDefaultCatalog(t *testing.T) {
	cat := DefaultCatalog()
	for _, name := range []string{"slack.read_thread", "slack.post_message"} {
		if _, ok := cat.Get(name); !ok {
			t.Fatalf("capability %q not registered in DefaultCatalog", name)
		}
	}
	// post_message is an outward-facing act → must be approval-eligible.
	post, _ := cat.Get("slack.post_message")
	if !RequiresApproval(post.TrustTier) {
		t.Fatalf("slack.post_message tier %q must require approval", post.TrustTier)
	}
}
