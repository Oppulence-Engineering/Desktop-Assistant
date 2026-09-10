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
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(auth.WithInternal(context.Background()))
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
		SetExecutionTarget("api").SaveX(ctx)
	for i, status := range []string{"succeeded", "failed"} {
		create := client.BackgroundTaskRun.Create().
			SetUser(u).SetTask(task).
			SetRunID("run-" + status).SetStatus(status).SetExecutor("api").
			SetCreatedAt(time.Date(2026, 6, 1+i, 0, 0, 0, 0, time.UTC))
		if status == "succeeded" {
			create = create.SetSummary("all good")
		} else {
			create = create.SetError("insufficient credits for cloud run preflight").SetErrorCode("llm_call_failed")
		}
		create.SaveX(ctx)
	}
	// The in-flight run must be excluded.
	client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).
		SetRunID("run-current").SetStatus("running").SetExecutor("api").
		SaveX(ctx)

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

	other := client.User.Create().SetEmail("other@x.co").SetWorkosUserID("user_other_history").SaveX(ctx)
	otherTask := client.BackgroundTask.Create().SetUser(other).SetSlug("other").SetName("Other").SetInstructions("i").SetExecutionTarget("api").SaveX(ctx)
	client.BackgroundTaskRun.Create().SetUser(other).SetTask(otherTask).SetRunID("other-secret").SetStatus("failed").SetExecutor("api").SaveX(ctx)
	userTool := NewUserRunHistoryTool(client, u.ID)
	out, err = userTool.Invoke(ctx, ToolScope{UserID: u.ID.String()}, json.RawMessage(`{"status":"failed"}`))
	if err != nil || !strings.Contains(string(out), "run-failed") || !strings.Contains(string(out), "insufficient credits") || strings.Contains(string(out), "other-secret") || strings.Contains(string(out), "run-succeeded") {
		t.Fatalf("user history = %s err=%v", out, err)
	}
	if _, err := userTool.Invoke(ctx, ToolScope{UserID: other.ID.String()}, json.RawMessage(`{}`)); err == nil {
		t.Fatal("user run history accepted another workflow owner")
	}
}

func TestWorkflowReadToolIsTenantScoped(t *testing.T) {
	client, owner, ctx := setupDB(t)
	now := time.Date(2026, 9, 9, 17, 45, 0, 0, time.UTC)
	task := client.BackgroundTask.Create().SetUser(owner).SetSlug("relationship-refresh").SetName("Relationship Refresh").
		SetInstructions("Refresh relationship state from stored evidence.").SetExecutionTarget("api").
		SetTriggersJSON(`[{"type":"cron","cron":"*/15 * * * *"}]`).SetScheduleSyncState("current").
		SetScheduleSyncedAt(now).SetLastRunID("stale-run").SetLastRunAt(now.Add(-24 * time.Hour)).SaveX(ctx)
	client.BackgroundTaskRun.Create().SetUser(owner).SetTask(task).SetRunID("run-owner").SetStatus("failed").
		SetExecutor("api").SetError("insufficient credits").SetErrorCode("insufficient_credits").SetCreatedAt(now).SaveX(ctx)
	client.BackgroundTask.Create().SetUser(owner).SetSlug("paused").SetName("Paused").SetInstructions("Paused workflow.").
		SetActive(false).SetExecutionTarget("api").SaveX(ctx)
	other := client.User.Create().SetEmail("other-workflow@x.co").SetWorkosUserID("user_other_workflow").SaveX(ctx)
	client.BackgroundTask.Create().SetUser(other).SetSlug("other-secret").SetName("Other Secret").SetInstructions("secret").SaveX(ctx)

	tool := NewWorkflowReadTool(client, owner.ID)
	out, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"active":true}`))
	if err != nil || !strings.Contains(string(out), "relationship-refresh") || !strings.Contains(string(out), `"scheduleSyncState":"current"`) || !strings.Contains(string(out), `"lastRunStatus":"failed"`) || !strings.Contains(string(out), "insufficient credits") || strings.Contains(string(out), "stale-run") || strings.Contains(string(out), "other-secret") || strings.Contains(string(out), `"slug":"paused"`) {
		t.Fatalf("workflow.read = %s err=%v", out, err)
	}
	if _, err := tool.Invoke(ctx, ToolScope{UserID: other.ID.String()}, json.RawMessage(`{}`)); err == nil {
		t.Fatal("workflow.read accepted another workflow owner")
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
		SaveX(auth.WithInternal(context.Background()))

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
	mux.HandleFunc("/gmail/v1/users/me/messages", func(w http.ResponseWriter, r *http.Request) {
		messageID, nextPageToken := "m1", "page_2"
		if r.URL.Query().Get("pageToken") == "page_2" {
			messageID, nextPageToken = "m2", ""
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"messages": []map[string]string{{"id": messageID, "threadId": "t1"}}, "nextPageToken": nextPageToken})
	})
	mux.HandleFunc("/gmail/v1/users/me/labels", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"labels": []map[string]string{
			{"id": "INBOX", "name": "INBOX", "type": "system"},
			{"id": "Label_1", "name": "Customers/Acme", "type": "user"},
		}})
	})
	mux.HandleFunc("/gmail/v1/users/me/labels/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/gmail/v1/users/me/labels/INBOX" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "INBOX", "name": "INBOX", "type": "system",
			"messagesTotal": 120, "messagesUnread": 7, "threadsTotal": 100, "threadsUnread": 5,
		})
	})
	mux.HandleFunc("/gmail/v1/users/me/profile", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"emailAddress": "dev@solomon-ai.co", "messagesTotal": 4821, "threadsTotal": 3210, "historyId": "12345",
		})
	})
	mux.HandleFunc("/gmail/v1/users/me/messages/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("format") == "metadata" {
			headers := "," + strings.Join(r.URL.Query()["metadataHeaders"], ",") + ","
			for _, want := range []string{"From", "To", "Cc", "Subject", "Date"} {
				if !strings.Contains(headers, ","+want+",") {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
			}
		}
		messageID := strings.TrimPrefix(r.URL.Path, "/gmail/v1/users/me/messages/")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": messageID, "threadId": "t1", "snippet": "snippet", "internalDate": "1788973200000", "labelIds": []string{"SENT", "IMPORTANT"},
			"payload": map[string]any{
				"mimeType": "multipart/mixed",
				"headers": []map[string]string{
					{"name": "From", "value": "Dev <dev@solomon-ai.co>"}, {"name": "To", "value": "Acme <hi@acme.com>"},
					{"name": "Cc", "value": "Finance <finance@acme.com>"}, {"name": "Subject", "value": "Invoice 4821"},
				},
				"parts": []map[string]any{
					{"mimeType": "text/plain", "body": map[string]any{"data": "ZnVsbCBtZXNzYWdlIQ"}},
					{"filename": "invoice.pdf", "mimeType": "application/pdf", "body": map[string]any{"attachmentId": "att_1", "size": 4821}},
				},
			},
		})
	})
	mux.HandleFunc("/gmail/v1/users/me/threads/", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"messages": []map[string]any{
			{
				"id": "m1", "threadId": "t1", "snippet": "first", "internalDate": "1788973200000",
				"payload": map[string]any{
					"mimeType": "multipart/mixed",
					"headers":  []map[string]string{{"name": "From", "value": "Acme <hi@acme.com>"}, {"name": "Subject", "value": "Renewal"}},
					"parts": []map[string]any{
						{"mimeType": "text/plain", "body": map[string]any{"data": "Zmlyc3QgZnVsbA=="}},
						{"filename": "thread.pdf", "mimeType": "application/pdf", "body": map[string]any{"attachmentId": "att_thread", "size": 321}},
					},
				},
			},
			{
				"id": "m2", "threadId": "t1", "snippet": "reply", "internalDate": "1788976800000", "labelIds": []string{"SENT"},
				"payload": map[string]any{
					"mimeType": "text/plain", "body": map[string]any{"data": "c2Vjb25kIGZ1bGw="},
					"headers": []map[string]string{{"name": "To", "value": "Acme <hi@acme.com>"}, {"name": "Subject", "value": "Re: Renewal"}},
				},
			},
		}})
	})
	mux.HandleFunc("/calendars/primary/events/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/calendars/primary/events/evt_1" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "evt_1", "summary": "Acme QBR", "description": "Review renewal terms",
			"location": "Board room", "status": "confirmed", "hangoutLink": "https://meet.google.com/abc-defg-hij",
			"htmlLink": "https://calendar.google.com/event?eid=evt_1", "organizer": map[string]string{"email": "owner@solomon-ai.co"},
			"start": map[string]string{"dateTime": "2026-09-11T17:00:00Z"}, "end": map[string]string{"dateTime": "2026-09-11T18:00:00Z"},
			"attendees": []map[string]string{{"email": "champion@acme.com"}},
		})
	})
	mux.HandleFunc("/calendars/primary/events", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("maxResults") == "2500" && r.URL.Query().Get("q") == "Acme" {
			items, nextPageToken := []map[string]string{{"id": "count_1"}, {"id": "count_2"}}, "calendar_count_2"
			if r.URL.Query().Get("pageToken") == "calendar_count_2" {
				items, nextPageToken = []map[string]string{{"id": "count_3"}}, ""
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"items": items, "nextPageToken": nextPageToken})
			return
		}
		if r.URL.Query().Get("maxResults") != "2500" {
			eventID, nextPageToken := "evt_page_1", "calendar_page_2"
			if r.URL.Query().Get("pageToken") == "calendar_page_2" {
				eventID, nextPageToken = "evt_page_2", ""
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"nextPageToken": nextPageToken,
				"items": []map[string]any{{
					"id": eventID, "summary": "Paged event",
					"start": map[string]string{"dateTime": "2026-09-11T10:00:00Z"},
					"end":   map[string]string{"dateTime": "2026-09-11T11:00:00Z"},
				}},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"timeZone": "UTC",
			"items": []map[string]any{
				{
					"id": "busy_1", "summary": "Private customer meeting",
					"start": map[string]string{"dateTime": "2026-09-11T10:00:00Z"},
					"end":   map[string]string{"dateTime": "2026-09-11T11:00:00Z"},
				},
				{
					"id": "free_1", "summary": "Working location", "transparency": "transparent",
					"start": map[string]string{"dateTime": "2026-09-11T12:00:00Z"},
					"end":   map[string]string{"dateTime": "2026-09-11T13:00:00Z"},
				},
			},
		})
	})
	mux.HandleFunc("/files", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"files": []map[string]any{{
				"id": "file_1", "name": "Invoice 4821.pdf", "mimeType": "application/pdf",
				"modifiedTime": "2026-06-08T17:00:00Z",
				"webViewLink":  "https://drive.google.com/file/d/file_1/view",
			}},
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
			SaveX(auth.WithInternal(context.Background()))
	}

	t.Run("happy path", func(t *testing.T) {
		srv := googleMock(t, "")
		google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", GmailBaseURL: srv.URL})
		connect(ScopeGmailReadonly)
		tool := NewGmailReadTool(client, sealer, sec, google, u.ID)
		out, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"query":"from:acme.com","limit":5}`))
		if err != nil {
			t.Fatalf("out = %s err = %v", out, err)
		}
		for _, needle := range []string{`"from":"Dev \u003cdev@solomon-ai.co\u003e"`, `"to":"Acme \u003chi@acme.com\u003e"`, `"cc":"Finance \u003cfinance@acme.com\u003e"`, `"receivedAt":"2026-09-09T17:00:00Z"`, `"labels":["SENT","IMPORTANT"]`, `"outbound":true`, `"snippet":"snippet"`} {
			if !strings.Contains(string(out), needle) {
				t.Fatalf("search missing %q: %s", needle, out)
			}
		}
		if !strings.Contains(string(out), `"nextPageToken":"page_2"`) {
			t.Fatalf("search missing page token: %s", out)
		}
		out, err = tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"query":"from:acme.com","limit":5,"pageToken":"page_2"}`))
		if err != nil || !strings.Contains(string(out), `"id":"m2"`) || strings.Contains(string(out), `"nextPageToken"`) {
			t.Fatalf("second page out = %s err = %v", out, err)
		}
		if _, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"threadId":"t1","pageToken":"page_2"}`)); err == nil || !strings.Contains(err.Error(), "only valid with query") {
			t.Fatalf("pageToken with thread err = %v", err)
		}
	})

	t.Run("counts matching messages", func(t *testing.T) {
		srv := googleMock(t, "")
		google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", GmailBaseURL: srv.URL})
		connect(ScopeGmailReadonly)
		tool := NewGmailReadTool(client, sealer, sec, google, u.ID)
		out, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"query":"is:unread","countOnly":true}`))
		if err != nil || !strings.Contains(string(out), `"matchingMessages":2`) || !strings.Contains(string(out), `"complete":true`) || strings.Contains(string(out), `"messages"`) {
			t.Fatalf("out = %s err = %v", out, err)
		}
		if operation := tool.(ToolAuditProvider).AuditInfo(json.RawMessage(`{"query":"is:unread","countOnly":true}`)).Operation; operation != "gmail.search.count" {
			t.Fatalf("operation = %q, want gmail.search.count", operation)
		}
		if _, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"query":"is:unread","countOnly":true,"pageToken":"page_2"}`)); err == nil {
			t.Fatal("gmail count accepted pageToken")
		}
	})

	t.Run("reads one exact message", func(t *testing.T) {
		srv := googleMock(t, "")
		google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", GmailBaseURL: srv.URL})
		connect(ScopeGmailReadonly)
		tool := NewGmailReadTool(client, sealer, sec, google, u.ID)
		out, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"messageId":"m1"}`))
		if err != nil || !strings.Contains(string(out), `"threadId":"t1"`) || !strings.Contains(string(out), `"from":"Dev \u003cdev@solomon-ai.co\u003e"`) || !strings.Contains(string(out), `"to":"Acme \u003chi@acme.com\u003e"`) || !strings.Contains(string(out), `"cc":"Finance \u003cfinance@acme.com\u003e"`) || !strings.Contains(string(out), `"subject":"Invoice 4821"`) || !strings.Contains(string(out), `"receivedAt":"`) || !strings.Contains(string(out), `"labels":["SENT","IMPORTANT"]`) || !strings.Contains(string(out), `"outbound":true`) || !strings.Contains(string(out), `"body":"full message!"`) || !strings.Contains(string(out), `"filename":"invoice.pdf"`) || !strings.Contains(string(out), `"size":4821`) {
			t.Fatalf("out = %s err = %v", out, err)
		}
		if operation := tool.(ToolAuditProvider).AuditInfo(json.RawMessage(`{"messageId":"m1"}`)).Operation; operation != "gmail.message.read" {
			t.Fatalf("operation = %q, want gmail.message.read", operation)
		}
	})

	t.Run("reads labels", func(t *testing.T) {
		srv := googleMock(t, "")
		google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", GmailBaseURL: srv.URL})
		connect(ScopeGmailReadonly)
		tool := NewGmailReadTool(client, sealer, sec, google, u.ID)
		out, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"listLabels":true}`))
		if err != nil || !strings.Contains(string(out), `"id":"INBOX"`) || !strings.Contains(string(out), `"name":"Customers/Acme"`) || !strings.Contains(string(out), `"type":"user"`) {
			t.Fatalf("out = %s err = %v", out, err)
		}
		if operation := tool.(ToolAuditProvider).AuditInfo(json.RawMessage(`{"listLabels":true}`)).Operation; operation != "gmail.labels.read" {
			t.Fatalf("operation = %q, want gmail.labels.read", operation)
		}
		if _, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"query":"x","listLabels":true}`)); err == nil {
			t.Fatal("gmail label read accepted another mode")
		}
	})

	t.Run("reads one label", func(t *testing.T) {
		srv := googleMock(t, "")
		google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", GmailBaseURL: srv.URL})
		connect(ScopeGmailReadonly)
		tool := NewGmailReadTool(client, sealer, sec, google, u.ID)
		out, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"labelId":"INBOX"}`))
		if err != nil || !strings.Contains(string(out), `"messagesTotal":120`) || !strings.Contains(string(out), `"messagesUnread":7`) || !strings.Contains(string(out), `"threadsTotal":100`) || !strings.Contains(string(out), `"threadsUnread":5`) {
			t.Fatalf("out = %s err = %v", out, err)
		}
		if operation := tool.(ToolAuditProvider).AuditInfo(json.RawMessage(`{"labelId":"INBOX"}`)).Operation; operation != "gmail.label.read" {
			t.Fatalf("operation = %q, want gmail.label.read", operation)
		}
		if _, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"labelId":"INBOX","listLabels":true}`)); err == nil {
			t.Fatal("gmail label detail accepted another mode")
		}
	})

	t.Run("reads mailbox profile", func(t *testing.T) {
		srv := googleMock(t, "")
		google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", GmailBaseURL: srv.URL})
		connect(ScopeGmailReadonly)
		tool := NewGmailReadTool(client, sealer, sec, google, u.ID)
		out, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"mailboxProfile":true}`))
		if err != nil || !strings.Contains(string(out), `"emailAddress":"dev@solomon-ai.co"`) || !strings.Contains(string(out), `"messagesTotal":4821`) || !strings.Contains(string(out), `"threadsTotal":3210`) || !strings.Contains(string(out), `"historyId":"12345"`) {
			t.Fatalf("out = %s err = %v", out, err)
		}
		if operation := tool.(ToolAuditProvider).AuditInfo(json.RawMessage(`{"mailboxProfile":true}`)).Operation; operation != "gmail.profile.read" {
			t.Fatalf("operation = %q, want gmail.profile.read", operation)
		}
		if _, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"listLabels":true,"mailboxProfile":true}`)); err == nil {
			t.Fatal("gmail profile read accepted another mode")
		}
	})

	t.Run("reads one thread", func(t *testing.T) {
		srv := googleMock(t, "")
		google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", GmailBaseURL: srv.URL})
		connect(ScopeGmailReadonly)
		tool := NewGmailReadTool(client, sealer, sec, google, u.ID)
		out, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"threadId":"t1"}`))
		if err != nil || !strings.Contains(string(out), `"snippet":"first"`) || !strings.Contains(string(out), `"outbound":true`) {
			t.Fatalf("out = %s err = %v", out, err)
		}
		if operation := tool.(ToolAuditProvider).AuditInfo(json.RawMessage(`{"threadId":"t1"}`)).Operation; operation != "gmail.thread.read" {
			t.Fatalf("operation = %q, want gmail.thread.read", operation)
		}
		out, err = tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"threadId":"t1","includeBodies":true}`))
		if err != nil || !strings.Contains(string(out), `"body":"first full"`) || !strings.Contains(string(out), `"body":"second full"`) || !strings.Contains(string(out), `"filename":"thread.pdf"`) || !strings.Contains(string(out), `"size":321`) {
			t.Fatalf("full out = %s err = %v", out, err)
		}
		if operation := tool.(ToolAuditProvider).AuditInfo(json.RawMessage(`{"threadId":"t1","includeBodies":true}`)).Operation; operation != "gmail.thread.read.full" {
			t.Fatalf("operation = %q, want gmail.thread.read.full", operation)
		}
		if _, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"query":"x","includeBodies":true}`)); err == nil || !strings.Contains(err.Error(), "only valid with threadId") {
			t.Fatalf("includeBodies with query err = %v", err)
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

func TestCalendarReadToolReadsOneExactEvent(t *testing.T) {
	client, u, ctx := setupDB(t)
	sealer := testSealer(t)
	sec := secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "cid", GoogleOAuthClientSecret: "csec"})
	sealed, _ := sealer.SealString("1//refresh")
	client.OAuthConnection.Create().SetUser(u).SetProvider("google").
		SetRefreshTokenEncrypted(sealed).SetScopes([]string{ScopeCalendarReadonly}).SaveX(ctx)
	srv := googleMock(t, "")
	google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", CalendarBaseURL: srv.URL})
	tool := NewCalendarReadTool(client, sealer, sec, google, u.ID)

	out, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"eventId":"evt_1"}`))
	if err != nil || !strings.Contains(string(out), `"description":"Review renewal terms"`) || !strings.Contains(string(out), `"conferenceLink":"https://meet.google.com/abc-defg-hij"`) {
		t.Fatalf("out = %s err = %v", out, err)
	}
	if operation := tool.(ToolAuditProvider).AuditInfo(json.RawMessage(`{"eventId":"evt_1"}`)).Operation; operation != "calendar.event.read" {
		t.Fatalf("operation = %q, want calendar.event.read", operation)
	}
	if _, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"eventId":"evt_1","query":"Acme"}`)); err == nil {
		t.Fatal("calendar detail accepted list filters")
	}
}

func TestCalendarReadToolPaginatesList(t *testing.T) {
	client, u, ctx := setupDB(t)
	sealer := testSealer(t)
	sec := secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "cid", GoogleOAuthClientSecret: "csec"})
	sealed, _ := sealer.SealString("1//refresh")
	client.OAuthConnection.Create().SetUser(u).SetProvider("google").
		SetRefreshTokenEncrypted(sealed).SetScopes([]string{ScopeCalendarReadonly}).SaveX(ctx)
	srv := googleMock(t, "")
	google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", CalendarBaseURL: srv.URL})
	tool := NewCalendarReadTool(client, sealer, sec, google, u.ID)

	out, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"timeMin":"2026-09-01T00:00:00Z","timeMax":"2026-10-01T00:00:00Z","limit":1}`))
	if err != nil || !strings.Contains(string(out), `"id":"evt_page_1"`) || !strings.Contains(string(out), `"nextPageToken":"calendar_page_2"`) {
		t.Fatalf("first page out = %s err = %v", out, err)
	}
	out, err = tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"timeMin":"2026-09-01T00:00:00Z","timeMax":"2026-10-01T00:00:00Z","limit":1,"pageToken":"calendar_page_2"}`))
	if err != nil || !strings.Contains(string(out), `"id":"evt_page_2"`) || strings.Contains(string(out), `"nextPageToken"`) {
		t.Fatalf("second page out = %s err = %v", out, err)
	}
	if _, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"eventId":"evt_1","pageToken":"calendar_page_2"}`)); err == nil {
		t.Fatal("calendar detail accepted pageToken")
	}
	if _, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"timeMin":"2026-09-01T00:00:00Z","timeMax":"2026-10-01T00:00:00Z","durationMinutes":60,"pageToken":"calendar_page_2"}`)); err == nil {
		t.Fatal("calendar availability accepted pageToken")
	}
}

func TestCalendarReadToolCountsBoundedEventsWithoutDetails(t *testing.T) {
	client, u, ctx := setupDB(t)
	sealer := testSealer(t)
	sec := secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "cid", GoogleOAuthClientSecret: "csec"})
	sealed, _ := sealer.SealString("1//refresh")
	client.OAuthConnection.Create().SetUser(u).SetProvider("google").
		SetRefreshTokenEncrypted(sealed).SetScopes([]string{ScopeCalendarReadonly}).SaveX(ctx)
	srv := googleMock(t, "")
	google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", CalendarBaseURL: srv.URL})
	tool := NewCalendarReadTool(client, sealer, sec, google, u.ID)

	out, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"timeMin":"2026-09-01T00:00:00Z","timeMax":"2026-10-01T00:00:00Z","query":"Acme","countOnly":true}`))
	if err != nil || !strings.Contains(string(out), `"matchingEvents":3`) || !strings.Contains(string(out), `"complete":true`) || strings.Contains(string(out), `"events"`) {
		t.Fatalf("out = %s err = %v", out, err)
	}
	if operation := tool.(ToolAuditProvider).AuditInfo(json.RawMessage(`{"countOnly":true}`)).Operation; operation != "calendar.events.count" {
		t.Fatalf("operation = %q, want calendar.events.count", operation)
	}
	if _, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"timeMin":"2026-09-01T00:00:00Z","countOnly":true}`)); err == nil {
		t.Fatal("calendar count accepted missing timeMax")
	}
	if _, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"timeMin":"2026-09-01T00:00:00Z","timeMax":"2026-10-01T00:00:00Z","countOnly":true,"pageToken":"calendar_page_2"}`)); err == nil {
		t.Fatal("calendar count accepted pageToken")
	}
}

func TestCalendarReadToolFindsAvailabilityWithoutEventDetails(t *testing.T) {
	client, u, ctx := setupDB(t)
	sealer := testSealer(t)
	sec := secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "cid", GoogleOAuthClientSecret: "csec"})
	sealed, _ := sealer.SealString("1//refresh")
	client.OAuthConnection.Create().SetUser(u).SetProvider("google").
		SetRefreshTokenEncrypted(sealed).SetScopes([]string{ScopeCalendarReadonly}).SaveX(ctx)
	srv := googleMock(t, "")
	google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", CalendarBaseURL: srv.URL})
	tool := NewCalendarReadTool(client, sealer, sec, google, u.ID)

	out, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"timeMin":"2026-09-11T09:00:00Z","timeMax":"2026-09-11T14:00:00Z","durationMinutes":60}`))
	if err != nil {
		t.Fatalf("out = %s err = %v", out, err)
	}
	var availability googleapi.CalendarAvailability
	if err := json.Unmarshal(out, &availability); err != nil {
		t.Fatalf("decode availability: %v", err)
	}
	if len(availability.Slots) != 2 || availability.Slots[0].Start != "2026-09-11T09:00:00Z" || availability.Slots[0].End != "2026-09-11T10:00:00Z" || availability.Slots[1].Start != "2026-09-11T11:00:00Z" || availability.Slots[1].End != "2026-09-11T14:00:00Z" {
		t.Fatalf("availability = %#v", availability)
	}
	if strings.Contains(string(out), "Private customer meeting") || strings.Contains(string(out), "Working location") {
		t.Fatalf("availability leaked event details: %s", out)
	}
	if operation := tool.(ToolAuditProvider).AuditInfo(json.RawMessage(`{"durationMinutes":60}`)).Operation; operation != "calendar.availability.read" {
		t.Fatalf("operation = %q, want calendar.availability.read", operation)
	}
	if _, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"timeMin":"2026-09-11T09:00:00Z","durationMinutes":60}`)); err == nil {
		t.Fatal("availability accepted missing timeMax")
	}
}

func TestDriveReadTool(t *testing.T) {
	client, u, ctx := setupDB(t)
	sealer := testSealer(t)
	sec := secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "cid", GoogleOAuthClientSecret: "csec"})
	srv := googleMock(t, "")
	google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", DriveBaseURL: srv.URL})

	connect := func(scopes ...string) {
		sealed, _ := sealer.SealString("1//refresh")
		client.OAuthConnection.Delete().ExecX(ctx)
		client.OAuthConnection.Create().
			SetUser(u).SetProvider("google").
			SetRefreshTokenEncrypted(sealed).SetScopes(scopes).
			SaveX(auth.WithInternal(context.Background()))
	}

	t.Run("happy path", func(t *testing.T) {
		connect(ScopeDriveReadonly)
		tool := NewDriveReadTool(client, sealer, sec, google, u.ID)
		out, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"query":"name contains 'invoice'","limit":2}`))
		if err != nil || !strings.Contains(string(out), `"name":"Invoice 4821.pdf"`) {
			t.Fatalf("out = %s err = %v", out, err)
		}
	})

	t.Run("missing scope is connector_unavailable", func(t *testing.T) {
		connect(ScopeGmailReadonly)
		tool := NewDriveReadTool(client, sealer, sec, google, u.ID)
		_, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{}`))
		if re, ok := AsRuntimeError(err); !ok || re.Code != CodeConnectorUnavailable {
			t.Fatalf("err = %v, want connector_unavailable", err)
		}
	})
}

func googleWriteMock(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "ya29.t"})
	})
	mux.HandleFunc("/gmail/v1/users/me/messages/send", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"id": "msg_1", "threadId": "thr_1"})
	})
	mux.HandleFunc("/calendars/primary/events", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "evt_1", "summary": "Kickoff",
			"start": map[string]string{"dateTime": "2026-06-27T15:00:00Z"},
			"end":   map[string]string{"dateTime": "2026-06-27T15:30:00Z"},
		})
	})
	mux.HandleFunc("/calendars/primary/events/evt_1", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "evt_1", "summary": "Updated",
			"start": map[string]string{"dateTime": "2026-06-27T16:00:00Z"},
			"end":   map[string]string{"dateTime": "2026-06-27T16:30:00Z"},
		})
	})
	mux.HandleFunc("/files/file_1", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"id": "file_1", "name": "Plan", "mimeType": "text/plain"})
	})
	mux.HandleFunc("/upload/files/file_1", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Query().Get("uploadType") != "multipart" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"id": "file_1", "name": "Plan.txt", "mimeType": "text/plain"})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestGoogleWriteTools(t *testing.T) {
	client, u, ctx := setupDB(t)
	sealer := testSealer(t)
	sec := secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "cid", GoogleOAuthClientSecret: "csec"})
	srv := googleWriteMock(t)
	google := googleapi.New(googleapi.Config{
		TokenURL:        srv.URL + "/token",
		GmailBaseURL:    srv.URL,
		CalendarBaseURL: srv.URL,
		DriveBaseURL:    srv.URL,
	})
	sealed, _ := sealer.SealString("1//refresh")
	client.OAuthConnection.Create().
		SetUser(u).SetProvider("google").
		SetRefreshTokenEncrypted(sealed).
		SetScopes([]string{ScopeGmailSend, ScopeCalendarEvents, ScopeDriveFile}).
		SaveX(ctx)

	for _, tc := range []struct {
		name      string
		tool      Tool
		args      json.RawMessage
		want      string
		wantScope string
	}{
		{
			name:      "gmail send",
			tool:      NewGmailSendTool(client, sealer, sec, google, u.ID),
			args:      json.RawMessage(`{"to":"x@y.co","subject":"Hi","body":"hello"}`),
			want:      `"messageId":"msg_1"`,
			wantScope: ScopeGmailSend,
		},
		{
			name:      "calendar create",
			tool:      NewCalendarCreateTool(client, sealer, sec, google, u.ID),
			args:      json.RawMessage(`{"summary":"Kickoff","start":"2026-06-27T15:00:00Z","end":"2026-06-27T15:30:00Z"}`),
			want:      `"id":"evt_1"`,
			wantScope: ScopeCalendarEvents,
		},
		{
			name:      "calendar update",
			tool:      NewCalendarUpdateTool(client, sealer, sec, google, u.ID),
			args:      json.RawMessage(`{"eventId":"evt_1","summary":"Updated","start":"2026-06-27T16:00:00Z","end":"2026-06-27T16:30:00Z"}`),
			want:      `"summary":"Updated"`,
			wantScope: ScopeCalendarEvents,
		},
		{
			name:      "drive metadata update",
			tool:      NewDriveUpdateTool(client, sealer, sec, google, u.ID),
			args:      json.RawMessage(`{"fileId":"file_1","name":"Plan"}`),
			want:      `"name":"Plan"`,
			wantScope: ScopeDriveFile,
		},
		{
			name:      "drive content replace",
			tool:      NewDriveUpdateTool(client, sealer, sec, google, u.ID),
			args:      json.RawMessage(`{"fileId":"file_1","replaceContent":true,"name":"Plan.txt","mimeType":"text/plain","content":"replacement"}`),
			want:      `"name":"Plan.txt"`,
			wantScope: ScopeDriveFile,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			out, err := tc.tool.Invoke(ctx, ToolScope{}, tc.args)
			if err != nil {
				t.Fatalf("invoke: %v", err)
			}
			if !strings.Contains(string(out), tc.want) {
				t.Fatalf("out = %s, want %s", out, tc.want)
			}
			audit := tc.tool.(ToolAuditProvider).AuditInfo(tc.args)
			if audit.TrustTier != TierAct {
				t.Fatalf("audit tier = %q, want act", audit.TrustTier)
			}
			if !hasScopeValue(audit.RequiredScopes, tc.wantScope) {
				t.Fatalf("audit scopes = %v, want %q", audit.RequiredScopes, tc.wantScope)
			}
		})
	}
}

func TestGmailSendToolMissingScope(t *testing.T) {
	client, u, ctx := setupDB(t)
	sealer := testSealer(t)
	sec := secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "cid", GoogleOAuthClientSecret: "csec"})
	srv := googleWriteMock(t)
	google := googleapi.New(googleapi.Config{TokenURL: srv.URL + "/token", GmailBaseURL: srv.URL})
	sealed, _ := sealer.SealString("1//refresh")
	client.OAuthConnection.Create().
		SetUser(u).SetProvider("google").
		SetRefreshTokenEncrypted(sealed).
		SetScopes([]string{ScopeGmailCompose}).
		SaveX(ctx)

	tool := NewGmailSendTool(client, sealer, sec, google, u.ID)
	_, err := tool.Invoke(ctx, ToolScope{}, json.RawMessage(`{"to":"x@y.co","body":"hello"}`))
	if re, ok := AsRuntimeError(err); !ok || re.Code != CodeConnectorUnavailable {
		t.Fatalf("err = %v, want connector_unavailable", err)
	}
}
