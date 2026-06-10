package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

func setupDB(t *testing.T) (*ent.Client, *ent.User, context.Context) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(context.Background())
	return d.Client, u, auth.WithInternal(context.Background())
}

func testSealer(t *testing.T) *crypto.Sealer {
	t.Helper()
	s, err := crypto.NewSealer("test-encryption-key-for-runtime")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	return s
}

func TestStagedArtifactReadYourWritesAndFlush(t *testing.T) {
	ctx := context.Background()
	store := &fakeArtifactStore{body: "old body"}
	staged := newStagedArtifact(store)

	read := &artifactReadTool{staged: staged}
	write := &artifactWriteTool{staged: staged, maxBytes: 64}

	// Read before any write returns the persisted body.
	out, err := read.Invoke(ctx, ToolScope{}, nil)
	if err != nil || !strings.Contains(string(out), "old body") {
		t.Fatalf("read = %s err = %v", out, err)
	}

	// Stage a write; nothing hits the store yet, but reads see it.
	if _, err := write.Invoke(ctx, ToolScope{}, json.RawMessage(`{"body":"new body"}`)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if len(store.writes) != 0 {
		t.Fatal("staged write must not touch the store")
	}
	out, _ = read.Invoke(ctx, ToolScope{}, nil)
	if !strings.Contains(string(out), "new body") {
		t.Fatalf("read after stage = %s, want staged body", out)
	}

	// Oversized stage is a tool error (model can shorten), not terminal.
	if _, err := write.Invoke(ctx, ToolScope{}, json.RawMessage(`{"body":"`+strings.Repeat("x", 100)+`"}`)); err == nil {
		t.Fatal("oversized stage must error")
	}

	// Flush performs the single durable write.
	n, err := staged.flush(ctx, 1<<20)
	if err != nil || n != len("new body") || len(store.writes) != 1 || store.writes[0] != "new body" {
		t.Fatalf("flush n=%d err=%v writes=%v", n, err, store.writes)
	}

	// Flush-time size breach is terminal with the artifact code.
	staged.stage(strings.Repeat("y", 100), "")
	if _, err := staged.flush(ctx, 50); err == nil {
		t.Fatal("flush over limit must fail")
	} else if re, ok := AsRuntimeError(err); !ok || re.Code != CodeRuntimeArtifactTooLarge {
		t.Fatalf("flush err = %v, want %s", err, CodeRuntimeArtifactTooLarge)
	}
}

func TestRunHistoryTool(t *testing.T) {
	client, u, ctx := setupDB(t)
	task := client.BackgroundTask.Create().
		SetUser(u).SetSlug("s").SetName("S").SetInstructions("i").
		SetExecutionTarget("api").SaveX(context.Background())
	for i, status := range []string{"succeeded", "failed"} {
		create := client.BackgroundTaskRun.Create().
			SetUser(u).SetTask(task).
			SetRunID("run-" + status).SetStatus(status).SetExecutor("api").
			SetCreatedAt(time.Date(2026, 6, 1+i, 0, 0, 0, 0, time.UTC))
		if status == "succeeded" {
			create = create.SetSummary("all good")
		} else {
			create = create.SetErrorCode("llm_call_failed")
		}
		create.SaveX(context.Background())
	}
	// The in-flight run must be excluded.
	client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).
		SetRunID("run-current").SetStatus("running").SetExecutor("api").
		SaveX(context.Background())

	tool := NewRunHistoryTool(client, task.ID, "run-current")
	out, err := tool.Invoke(ctx, ToolScope{}, nil)
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	s := string(out)
	if !strings.Contains(s, "run-succeeded") || !strings.Contains(s, "all good") ||
		!strings.Contains(s, "llm_call_failed") || strings.Contains(s, "run-current") {
		t.Fatalf("history = %s", s)
	}
}

func TestEventReadTool(t *testing.T) {
	client, u, ctx := setupDB(t)
	sealer := testSealer(t)
	sealed, _ := sealer.Seal([]byte(`{"provider":"gmail","messageId":"msg_1"}`))
	ev := client.CloudEvent.Create().
		SetUser(u).SetSource("gmail").SetDedupeKey("k1").
		SetSubject("Invoice dispute").SetText("Acme disputed.").
		SetPayloadCiphertext(sealed).
		SaveX(context.Background())

	tool := NewEventReadTool(client, sealer, ev.ID)
	out, err := tool.Invoke(ctx, ToolScope{}, nil)
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	s := string(out)
	for _, needle := range []string{"Invoice dispute", "Acme disputed.", `"messageId":"msg_1"`} {
		if !strings.Contains(s, needle) {
			t.Fatalf("event read missing %q: %s", needle, s)
		}
	}
}

func googleMock(t *testing.T, tokenErr string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if tokenErr != "" {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": tokenErr})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "ya29.t"})
	})
	mux.HandleFunc("/gmail/v1/users/me/messages", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"messages": []map[string]string{{"id": "m1", "threadId": "t1"}}})
	})
	mux.HandleFunc("/gmail/v1/users/me/messages/", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "m1", "threadId": "t1", "snippet": "snippet",
			"payload": map[string]any{"headers": []map[string]string{{"name": "Subject", "value": "Hi"}}},
		})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestGmailReadTool(t *testing.T) {
	client, u, ctx := setupDB(t)
	sealer := testSealer(t)
	sec := secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "cid", GoogleOAuthClientSecret: "csec"})

	connect := func(scopes ...string) {
		sealed, _ := sealer.SealString("1//refresh")
		client.OAuthConnection.Delete().ExecX(ctx)
		client.OAuthConnection.Create().
			SetUser(u).SetProvider("google").
			SetRefreshTokenEncrypted(sealed).SetScopes(scopes).
			SaveX(context.Background())
	}

	t.Run("happy path", func(t *testing.T) {
		srv := googleMock(t, "")
		google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", GmailBaseURL: srv.URL})
		connect(ScopeGmailReadonly)
		tool := NewGmailReadTool(client, sealer, sec, google, u.ID)
		out, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"query":"from:acme.com","limit":5}`))
		if err != nil || !strings.Contains(string(out), `"snippet":"snippet"`) {
			t.Fatalf("out = %s err = %v", out, err)
		}
	})

	t.Run("missing scope is connector_unavailable", func(t *testing.T) {
		srv := googleMock(t, "")
		google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", GmailBaseURL: srv.URL})
		connect(ScopeCalendarReadonly) // wrong scope
		tool := NewGmailReadTool(client, sealer, sec, google, u.ID)
		_, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"query":"x"}`))
		if re, ok := AsRuntimeError(err); !ok || re.Code != CodeConnectorUnavailable {
			t.Fatalf("err = %v, want connector_unavailable", err)
		}
	})

	t.Run("no connection is connector_unavailable", func(t *testing.T) {
		srv := googleMock(t, "")
		google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", GmailBaseURL: srv.URL})
		client.OAuthConnection.Delete().ExecX(ctx)
		tool := NewGmailReadTool(client, sealer, sec, google, u.ID)
		_, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"query":"x"}`))
		if re, ok := AsRuntimeError(err); !ok || re.Code != CodeConnectorUnavailable {
			t.Fatalf("err = %v, want connector_unavailable", err)
		}
	})

	t.Run("invalid_grant is connector_unavailable", func(t *testing.T) {
		srv := googleMock(t, "invalid_grant")
		google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", GmailBaseURL: srv.URL})
		connect(ScopeGmailReadonly)
		tool := NewGmailReadTool(client, sealer, sec, google, u.ID)
		_, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"query":"x"}`))
		if re, ok := AsRuntimeError(err); !ok || re.Code != CodeConnectorUnavailable {
			t.Fatalf("err = %v, want connector_unavailable", err)
		}
	})
}
