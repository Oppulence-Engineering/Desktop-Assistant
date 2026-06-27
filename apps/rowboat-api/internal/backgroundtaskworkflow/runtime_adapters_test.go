package backgroundtaskworkflow

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/faculties"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slackclient"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/websearch"
)

type fakeSlackTeamTokenResolver struct {
	token  string
	teamID string
}

func (r *fakeSlackTeamTokenResolver) ResolveTeam(_ context.Context, _ string, teamID string) (string, error) {
	r.teamID = teamID
	return r.token, nil
}

type fakeWorkflowMCPResolver struct {
	userID    string
	connector string
}

func (r *fakeWorkflowMCPResolver) ResolveMCP(_ context.Context, userID, connector string) (string, string, string, error) {
	r.userID = userID
	r.connector = connector
	return "https://mcp.test", "Bearer", "mcp-token", nil
}

type fakeWorkflowMCPClient struct {
	listToken string
	callToken string
	callTool  string
}

func (c *fakeWorkflowMCPClient) ListTools(_ context.Context, _, _, accessToken string) (json.RawMessage, error) {
	c.listToken = accessToken
	return json.RawMessage(`{"tools":[{"name":"customer.lookup"}]}`), nil
}

func (c *fakeWorkflowMCPClient) CallTool(_ context.Context, _, _, accessToken, toolName string, _ json.RawMessage) (json.RawMessage, error) {
	c.callToken = accessToken
	c.callTool = toolName
	return json.RawMessage(`{"content":[{"type":"text","text":"ok"}]}`), nil
}

func TestRunControlSourceReadsDurableSignals(t *testing.T) {
	client, err := dbOpenForTest(t)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	taskRow := client.BackgroundTask.Create().
		SetUser(u).SetSlug("s").SetName("S").SetInstructions("i").
		SetExecutionTarget("api").SaveX(ctx)
	run := client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(taskRow).SetRunID("run-1").SetStatus("running").SetExecutor("api").
		SaveX(ctx)

	appendSignal := func(seq int, signal string, payload map[string]any) {
		t.Helper()
		raw, err := json.Marshal(map[string]any{
			"type":    EventSignal,
			"signal":  signal,
			"payload": payload,
		})
		if err != nil {
			t.Fatalf("marshal signal: %v", err)
		}
		client.BackgroundTaskRunEvent.Create().
			SetUser(u).
			SetTask(taskRow).
			SetRun(run).
			SetSeq(seq).
			SetEventType(EventSignal).
			SetEventJSON(string(raw)).
			SaveX(ctx)
	}

	appendSignal(0, "pause", nil)
	appendSignal(1, "update_context", map[string]any{"context": "Use corrected account data."})

	source := newRunControlSource(&Activities{Client: client}, run)
	state, err := source.Checkpoint(ctx)
	if err != nil {
		t.Fatalf("checkpoint: %v", err)
	}
	if !state.Paused {
		t.Fatal("state should be paused after pause signal")
	}
	if len(state.ContextUpdates) != 1 || state.ContextUpdates[0] != "Use corrected account data." {
		t.Fatalf("context updates = %+v", state.ContextUpdates)
	}

	appendSignal(2, "resume", nil)
	state, err = source.Checkpoint(ctx)
	if err != nil {
		t.Fatalf("checkpoint resume: %v", err)
	}
	if state.Paused {
		t.Fatal("state should not be paused after resume signal")
	}
	if n := client.BackgroundTaskRunEvent.Query().Where(backgroundtaskrunevent.EventTypeEQ(EventSignal)).CountX(ctx); n != 3 {
		t.Fatalf("signal rows = %d, want 3", n)
	}

	appendSignal(3, "approve_tool", map[string]any{"approvalId": "run-1/tool/2", "resolvedBy": "tester"})
	state, err = source.Checkpoint(ctx)
	if err != nil {
		t.Fatalf("checkpoint approval: %v", err)
	}
	if decision, ok := state.ToolApprovals["run-1/tool/2"]; !ok || !decision.Approved || decision.ResolvedBy != "tester" {
		t.Fatalf("approval decision = %+v ok=%v", decision, ok)
	}
}

func TestToolRegistryAddsConfiguredCloudReadTools(t *testing.T) {
	client, err := dbOpenForTest(t)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	taskRow := client.BackgroundTask.Create().
		SetUser(u).SetSlug("s").SetName("S").SetInstructions("i").
		SetExecutionTarget("api").SaveX(ctx)
	run := client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(taskRow).SetRunID("run-1").SetStatus("running").SetExecutor("api").
		SaveX(ctx)
	task := client.BackgroundTask.Query().Where(backgroundtask.IDEQ(taskRow.ID)).WithUser().OnlyX(ctx)

	webSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"results":[{"title":"Rowboat","url":"https://rowboat.test","content":"cloud tasks"}]}`))
	}))
	t.Cleanup(webSrv.Close)

	var conduitUser, conduitPath string
	conduitSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conduitUser = r.Header.Get("X-Rowboat-User")
		conduitPath = r.URL.Path
		_, _ = w.Write([]byte(`{"threads":[{"id":"thread-1"}]}`))
	}))
	t.Cleanup(conduitSrv.Close)

	var eigenPath string
	eigenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		eigenPath = r.URL.Path
		_, _ = w.Write([]byte(`{"scenario":"runway","months":8}`))
	}))
	t.Cleanup(eigenSrv.Close)

	a := &Activities{
		Client:  client,
		Web:     websearch.New(webSrv.URL, "web-key", outbound.Policy{}),
		Conduit: faculties.New("conduit", conduitSrv.URL, "rowboat-internal", "signing-secret", outbound.Policy{}),
		Eigen:   faculties.New("eigen", eigenSrv.URL, "rowboat-internal", "signing-secret", outbound.Policy{}),
	}
	registry := a.toolRegistry(ctx, task, run)
	scope := backgroundtaskruntime.ToolScope{UserID: u.ID.String(), RunID: run.RunID}

	webTool, err := registry.Lookup("web.search")
	if err != nil {
		t.Fatalf("web.search lookup: %v", err)
	}
	webOut, err := webTool.Invoke(ctx, scope, json.RawMessage(`{"query":"rowboat","max_results":1}`))
	if err != nil || !strings.Contains(string(webOut), `"title":"Rowboat"`) {
		t.Fatalf("web.search out = %s err = %v", webOut, err)
	}

	conduitTool, err := registry.Lookup("conduit.read")
	if err != nil {
		t.Fatalf("conduit.read lookup: %v", err)
	}
	conduitOut, err := conduitTool.Invoke(ctx, scope, json.RawMessage(`{"operation":"thread_for_invoice"}`))
	if err != nil || !strings.Contains(string(conduitOut), `"threads"`) {
		t.Fatalf("conduit.read out = %s err = %v", conduitOut, err)
	}
	if conduitPath != "/v1/query" || conduitUser != u.ID.String() {
		t.Fatalf("conduit path/user = %q/%q", conduitPath, conduitUser)
	}

	eigenTool, err := registry.Lookup("eigen.simulate")
	if err != nil {
		t.Fatalf("eigen.simulate lookup: %v", err)
	}
	eigenOut, err := eigenTool.Invoke(ctx, scope, json.RawMessage(`{"scenario":"runway"}`))
	if err != nil || !strings.Contains(string(eigenOut), `"months":8`) {
		t.Fatalf("eigen.simulate out = %s err = %v", eigenOut, err)
	}
	if eigenPath != "/v1/simulate" {
		t.Fatalf("eigen path = %q", eigenPath)
	}

	if _, err := registry.Lookup("connector.write.gmail_draft"); !errors.Is(err, backgroundtaskruntime.ErrToolNotAllowed) {
		t.Fatalf("gmail draft must require compose scope, err = %v", err)
	}
}

func TestToolRegistryOmitsUnconfiguredServiceTools(t *testing.T) {
	client, err := dbOpenForTest(t)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	taskRow := client.BackgroundTask.Create().
		SetUser(u).SetSlug("s").SetName("S").SetInstructions("i").
		SetExecutionTarget("api").SaveX(ctx)
	run := client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(taskRow).SetRunID("run-1").SetStatus("running").SetExecutor("api").
		SaveX(ctx)
	task := client.BackgroundTask.Query().Where(backgroundtask.IDEQ(taskRow.ID)).WithUser().OnlyX(ctx)

	registry := (&Activities{Client: client}).toolRegistry(ctx, task, run)
	for _, name := range []string{"web.search", "conduit.read", "eigen.simulate", "connector.read.slack_thread", "connector.write.slack_reply", "connector.mcp.list_tools", "connector.mcp.call_tool"} {
		if _, err := registry.Lookup(name); !errors.Is(err, backgroundtaskruntime.ErrToolNotAllowed) {
			t.Fatalf("%s lookup err = %v, want not allowed", name, err)
		}
	}
}

func TestToolRegistryAddsMCPConnectorTools(t *testing.T) {
	client, err := dbOpenForTest(t)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	taskRow := client.BackgroundTask.Create().
		SetUser(u).SetSlug("s").SetName("S").SetInstructions("i").
		SetExecutionTarget("api").SaveX(ctx)
	run := client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(taskRow).SetRunID("run-1").SetStatus("running").SetExecutor("api").
		SaveX(ctx)
	task := client.BackgroundTask.Query().Where(backgroundtask.IDEQ(taskRow.ID)).WithUser().OnlyX(ctx)

	resolver := &fakeWorkflowMCPResolver{}
	mcp := &fakeWorkflowMCPClient{}
	registry := (&Activities{
		Client:        client,
		MCPResolver:   resolver,
		MCP:           mcp,
		MCPConnectors: []string{"canvas"},
		MCPPolicies: []backgroundtaskruntime.MCPConnectorPolicy{{
			Name:  "canvas",
			Tools: []backgroundtaskruntime.MCPToolPolicy{{Name: "customer.lookup", TrustTier: backgroundtaskruntime.TierRead}},
		}},
	}).toolRegistry(ctx, task, run)
	scope := backgroundtaskruntime.ToolScope{UserID: u.ID.String(), RunID: run.RunID}

	listTool, err := registry.Lookup("connector.mcp.list_tools")
	if err != nil {
		t.Fatalf("list lookup: %v", err)
	}
	listOut, err := listTool.Invoke(ctx, scope, json.RawMessage(`{"connector":"canvas"}`))
	if err != nil || !strings.Contains(string(listOut), `"customer.lookup"`) {
		t.Fatalf("list out = %s err = %v", listOut, err)
	}
	if resolver.userID != u.ID.String() || resolver.connector != "canvas" || mcp.listToken != "mcp-token" {
		t.Fatalf("resolver/list token = %q/%q/%q", resolver.userID, resolver.connector, mcp.listToken)
	}

	callTool, err := registry.Lookup("connector.mcp.call_tool")
	if err != nil {
		t.Fatalf("call lookup: %v", err)
	}
	callOut, err := callTool.Invoke(ctx, scope, json.RawMessage(`{"connector":"canvas","tool":"customer.lookup","arguments":{"id":"cust_1"}}`))
	if err != nil || !strings.Contains(string(callOut), `"ok"`) {
		t.Fatalf("call out = %s err = %v", callOut, err)
	}
	if mcp.callToken != "mcp-token" || mcp.callTool != "customer.lookup" {
		t.Fatalf("call token/tool = %q/%q", mcp.callToken, mcp.callTool)
	}

	denied, err := callTool.Invoke(ctx, scope, json.RawMessage(`{"connector":"canvas","tool":"invoice.delete","arguments":{"id":"inv_1"}}`))
	if err != nil || !strings.Contains(string(denied), "not allowlisted") {
		t.Fatalf("unallowlisted call out = %s err = %v", denied, err)
	}
}

func TestToolRegistryAddsGoogleToolsByGrantedScope(t *testing.T) {
	client, err := dbOpenForTest(t)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	taskRow := client.BackgroundTask.Create().
		SetUser(u).SetSlug("s").SetName("S").SetInstructions("i").
		SetExecutionTarget("api").SaveX(ctx)
	run := client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(taskRow).SetRunID("run-1").SetStatus("running").SetExecutor("api").
		SaveX(ctx)
	task := client.BackgroundTask.Query().Where(backgroundtask.IDEQ(taskRow.ID)).WithUser().OnlyX(ctx)

	sealer, err := crypto.NewSealer("test-encryption-key-for-registry")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	sealed, _ := sealer.SealString("1//refresh")
	client.OAuthConnection.Create().
		SetUser(u).SetProvider("google").
		SetRefreshTokenEncrypted(sealed).
		SetScopes([]string{
			backgroundtaskruntime.ScopeDriveReadonly,
			backgroundtaskruntime.ScopeDriveFile,
			backgroundtaskruntime.ScopeGmailCompose,
			backgroundtaskruntime.ScopeGmailSend,
			backgroundtaskruntime.ScopeCalendarEvents,
		}).
		SaveX(ctx)

	registry := (&Activities{
		Client:  client,
		Sealer:  sealer,
		Secrets: secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "cid", GoogleOAuthClientSecret: "csec"}),
		Google:  googleapi.New(googleapi.Config{}),
	}).toolRegistry(ctx, task, run)

	if _, err := registry.Lookup("connector.read.drive"); err != nil {
		t.Fatalf("drive lookup: %v", err)
	}
	if draft, err := registry.Lookup("connector.write.gmail_draft"); err != nil {
		t.Fatalf("gmail draft lookup with compose scope: %v", err)
	} else if audit := draft.(backgroundtaskruntime.ToolAuditProvider).AuditInfo(nil); audit.TrustTier != backgroundtaskruntime.TierAct {
		t.Fatalf("gmail draft trust tier = %q, want act", audit.TrustTier)
	}
	for _, name := range []string{
		"connector.write.gmail_send",
		"connector.write.calendar_create",
		"connector.write.calendar_update",
		"connector.write.drive_update",
	} {
		tool, err := registry.Lookup(name)
		if err != nil {
			t.Fatalf("%s lookup with write scope: %v", name, err)
		}
		if audit := tool.(backgroundtaskruntime.ToolAuditProvider).AuditInfo(nil); audit.TrustTier != backgroundtaskruntime.TierAct {
			t.Fatalf("%s trust tier = %q, want act", name, audit.TrustTier)
		}
	}
	for _, name := range []string{"connector.read.gmail", "connector.read.calendar"} {
		if _, err := registry.Lookup(name); !errors.Is(err, backgroundtaskruntime.ErrToolNotAllowed) {
			t.Fatalf("%s lookup err = %v, want not allowed without scope", name, err)
		}
	}
}

func TestToolRegistryAddsSlackThreadReadWithEventDefaults(t *testing.T) {
	client, err := dbOpenForTest(t)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	taskRow := client.BackgroundTask.Create().
		SetUser(u).SetSlug("s").SetName("S").SetInstructions("i").
		SetExecutionTarget("api").SaveX(ctx)

	sealer, err := crypto.NewSealer("test-encryption-key-for-slack-registry")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	payload := []byte(`{"team_id":"T1","event":{"type":"message","channel":"C1","thread_ts":"1700000000.000100","ts":"1700000000.000101","text":"hello"}}`)
	sealed, err := sealer.Seal(payload)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	ev := client.CloudEvent.Create().
		SetUser(u).
		SetSource("slack").
		SetSourceAccountID("T1").
		SetSourceEventID("Ev1").
		SetEventType("message").
		SetText("hello").
		SetPayloadCiphertext(sealed).
		SetDedupeKey("slack:T1:Ev1").
		SaveX(ctx)
	run := client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(taskRow).SetRunID("run-slack-1").SetStatus("running").SetExecutor("api").
		SetCloudEventID(ev.ID).
		SaveX(ctx)
	task := client.BackgroundTask.Query().Where(backgroundtask.IDEQ(taskRow.ID)).WithUser().OnlyX(ctx)

	var gotAuth, gotChannel, gotThread string
	slackSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotChannel = r.URL.Query().Get("channel")
		gotThread = r.URL.Query().Get("ts")
		_, _ = w.Write([]byte(`{"ok":true,"messages":[{"user":"U1","text":"hello","ts":"1700000000.000100"}]}`))
	}))
	t.Cleanup(slackSrv.Close)
	slack := slackclient.New(outbound.Policy{})
	slack.SetBaseURL(slackSrv.URL)
	tokens := &fakeSlackTeamTokenResolver{token: "xoxb-test"}

	registry := (&Activities{Client: client, Sealer: sealer, Slack: slack, SlackTokens: tokens}).toolRegistry(ctx, task, run)
	tool, err := registry.Lookup("connector.read.slack_thread")
	if err != nil {
		t.Fatalf("slack lookup: %v", err)
	}
	replyTool, err := registry.Lookup("connector.write.slack_reply")
	if err != nil {
		t.Fatalf("slack reply lookup: %v", err)
	}
	if audit := replyTool.(backgroundtaskruntime.ToolAuditProvider).AuditInfo(nil); audit.TrustTier != backgroundtaskruntime.TierAct {
		t.Fatalf("slack reply trust tier = %q, want act", audit.TrustTier)
	}
	out, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: u.ID.String(), RunID: run.RunID}, nil)
	if err != nil {
		t.Fatalf("slack invoke: %v", err)
	}
	if tokens.teamID != "T1" || gotAuth != "Bearer xoxb-test" || gotChannel != "C1" || gotThread != "1700000000.000100" {
		t.Fatalf("slack call team/auth/channel/thread = %q/%q/%q/%q", tokens.teamID, gotAuth, gotChannel, gotThread)
	}
	if !strings.Contains(string(out), `"text":"hello"`) {
		t.Fatalf("out = %s", out)
	}
}
