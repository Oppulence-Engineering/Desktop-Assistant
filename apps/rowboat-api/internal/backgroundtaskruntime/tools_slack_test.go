package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slackclient"
)

type fakeSlackTokenResolver struct {
	token  string
	teamID string
	err    error
}

func (r *fakeSlackTokenResolver) ResolveTeam(_ context.Context, _ string, teamID string) (string, error) {
	r.teamID = teamID
	if r.err != nil {
		return "", r.err
	}
	return r.token, nil
}

type fakeSlackThreadReader struct {
	token, channel, thread string
	limit                  int
	err                    error
}

func (r *fakeSlackThreadReader) ReadThread(_ context.Context, token, channel, threadTS string, limit int) ([]slackclient.Message, error) {
	r.token, r.channel, r.thread, r.limit = token, channel, threadTS, limit
	if r.err != nil {
		return nil, r.err
	}
	return []slackclient.Message{{User: "U1", Text: "hello", TS: threadTS}}, nil
}

type fakeSlackThreadWriter struct {
	token, channel, thread, text string
	err                          error
}

func (w *fakeSlackThreadWriter) PostMessage(_ context.Context, token, channel, threadTS, text string) error {
	w.token, w.channel, w.thread, w.text = token, channel, threadTS, text
	return w.err
}

func TestSlackThreadDefaultsFromEventPayload(t *testing.T) {
	defaults := SlackThreadDefaultsFromEventPayload("T-fallback", []byte(`{"team_id":"T1","event":{"channel":"C1","ts":"1700000000.000100"}}`))
	if defaults.TeamID != "T1" || defaults.Channel != "C1" || defaults.ThreadTS != "1700000000.000100" {
		t.Fatalf("defaults = %+v", defaults)
	}

	defaults = SlackThreadDefaultsFromEventPayload("T-fallback", []byte(`{"event":{"channel":"C2","thread_ts":"1700000000.000200","ts":"ignored"}}`))
	if defaults.TeamID != "T-fallback" || defaults.Channel != "C2" || defaults.ThreadTS != "1700000000.000200" {
		t.Fatalf("thread defaults = %+v", defaults)
	}
}

func TestSlackReadThreadToolUsesEventDefaults(t *testing.T) {
	resolver := &fakeSlackTokenResolver{token: "xoxb-1"}
	reader := &fakeSlackThreadReader{}
	tool := NewSlackReadThreadTool(resolver, reader, SlackThreadDefaults{
		TeamID: "T1", Channel: "C1", ThreadTS: "1700000000.000100",
	})
	audit := tool.(ToolAuditProvider).AuditInfo(nil)
	if audit.TrustTier != TierRead || audit.Connector != "slack" || !hasScopeValue(audit.RequiredScopes, SlackScopeChannelsHistory) {
		t.Fatalf("audit = %+v", audit)
	}
	out, err := tool.Invoke(context.Background(), ToolScope{UserID: "user-1"}, json.RawMessage(`{"limit":25}`))
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if resolver.teamID != "T1" || reader.token != "xoxb-1" || reader.channel != "C1" || reader.thread != "1700000000.000100" || reader.limit != 25 {
		t.Fatalf("call = resolver team %q reader %+v", resolver.teamID, reader)
	}
	if !strings.Contains(string(out), `"text":"hello"`) {
		t.Fatalf("out = %s", out)
	}
}

func TestSlackReadThreadToolAcceptsExplicitTarget(t *testing.T) {
	resolver := &fakeSlackTokenResolver{token: "xoxb-2"}
	reader := &fakeSlackThreadReader{}
	tool := NewSlackReadThreadTool(resolver, reader, SlackThreadDefaults{})
	out, err := tool.Invoke(context.Background(), ToolScope{UserID: "user-1"}, json.RawMessage(`{"teamId":"T2","channel":"C2","threadTs":"2.2"}`))
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if resolver.teamID != "T2" || reader.channel != "C2" || reader.thread != "2.2" {
		t.Fatalf("explicit target not used: team %q reader %+v", resolver.teamID, reader)
	}
	if !strings.Contains(string(out), `"teamId":"T2"`) {
		t.Fatalf("out = %s", out)
	}
}

func TestSlackReadThreadToolReturnsModelVisibleErrors(t *testing.T) {
	tool := NewSlackReadThreadTool(&fakeSlackTokenResolver{err: errors.New("not connected")}, &fakeSlackThreadReader{}, SlackThreadDefaults{
		TeamID: "T1", Channel: "C1", ThreadTS: "1.1",
	})
	out, err := tool.Invoke(context.Background(), ToolScope{UserID: "user-1"}, nil)
	if err != nil {
		t.Fatalf("invoke hard error: %v", err)
	}
	if !strings.Contains(string(out), "not connected") {
		t.Fatalf("expected model-visible error, got %s", out)
	}
}

func TestSlackReplyToolUsesEventDefaults(t *testing.T) {
	resolver := &fakeSlackTokenResolver{token: "xoxb-1"}
	writer := &fakeSlackThreadWriter{}
	tool := NewSlackReplyTool(resolver, writer, SlackThreadDefaults{
		TeamID: "T1", Channel: "C1", ThreadTS: "1700000000.000100",
	})
	audit := tool.(ToolAuditProvider).AuditInfo(nil)
	if audit.TrustTier != TierAct || audit.Connector != "slack" || !hasScopeValue(audit.RequiredScopes, SlackScopeChatWrite) {
		t.Fatalf("audit = %+v", audit)
	}
	out, err := tool.Invoke(context.Background(), ToolScope{UserID: "user-1", ApprovalID: "run/tool/1"}, json.RawMessage(`{"text":"Approved reply"}`))
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if resolver.teamID != "T1" || writer.token != "xoxb-1" || writer.channel != "C1" || writer.thread != "1700000000.000100" || writer.text != "Approved reply" {
		t.Fatalf("call = resolver team %q writer %+v", resolver.teamID, writer)
	}
	if !strings.Contains(string(out), `"posted":true`) {
		t.Fatalf("out = %s", out)
	}
}
