package communicationsync

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationinteraction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationsynccursor"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

type syncFixture struct {
	client  *ent.Client
	user    *ent.User
	service *Service
	server  *httptest.Server
	now     time.Time
}

func newSyncFixture(t *testing.T) *syncFixture {
	t.Helper()
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	mux := http.NewServeMux()
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	database, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	owner := database.Client.User.Create().
		SetEmail("owner@example.com").
		SetWorkosUserID("owner-1").
		SaveX(context.Background())
	sealer, err := crypto.NewSealer("communicationsync-test-encryption-key")
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := sealer.SealString("refresh-token")
	if err != nil {
		t.Fatal(err)
	}
	database.Client.OAuthConnection.Create().
		SetUser(owner).
		SetProvider("google").
		SetExternalAccountID("owner@example.com").
		SetRefreshTokenEncrypted(sealed).
		SaveX(auth.WithUser(context.Background(), owner))
	secretStore := secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "client", GoogleOAuthClientSecret: "secret"})
	service := New(database.Client, sealer, secretStore, googleapi.New(googleapi.Config{
		TokenURL: server.URL + "/token", GmailBaseURL: server.URL, CalendarBaseURL: server.URL,
	}), Config{BatchSize: 10}, zap.NewNop())
	service.now = func() time.Time { return now }
	f := &syncFixture{client: database.Client, user: owner, service: service, server: server, now: now}

	mux.HandleFunc("/token", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "access-token"})
	})
	return f
}

func (f *syncFixture) installGmailHandlers(t *testing.T, gap bool) {
	t.Helper()
	f.server.Config.Handler.(*http.ServeMux).HandleFunc("/gmail/v1/users/me/history", func(w http.ResponseWriter, r *http.Request) {
		if gap {
			http.Error(w, "gone", http.StatusNotFound)
			return
		}
		start := r.URL.Query().Get("startHistoryId")
		latest := "101"
		if start == "101" {
			latest = "102"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"historyId": latest,
			"history": []any{
				map[string]any{"messagesAdded": []any{map[string]any{"message": map[string]string{"id": "m-1", "threadId": "t-1"}}}},
				map[string]any{"messagesDeleted": []any{map[string]any{"message": map[string]string{"id": "m-deleted"}}}},
			},
		})
	})
	f.server.Config.Handler.(*http.ServeMux).HandleFunc("/gmail/v1/users/me/messages", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"messages": []any{map[string]string{"id": "m-1"}}})
	})
	f.server.Config.Handler.(*http.ServeMux).HandleFunc("/gmail/v1/users/me/messages/m-1", func(w http.ResponseWriter, r *http.Request) {
		if fields := r.URL.Query().Get("fields"); fields == "" || strings.Contains(fields, "data") {
			http.Error(w, "metadata projection must exclude body data", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "m-1", "threadId": "t-1", "internalDate": fmt.Sprintf("%d", f.now.UnixMilli()),
			"labelIds": []string{"SENT"}, "snippet": "metadata only",
			"payload": map[string]any{
				"headers": []any{
					map[string]string{"name": "From", "value": "Owner <owner@example.com>"},
					map[string]string{"name": "To", "value": "Customer <customer@example.com>"},
					map[string]string{"name": "Subject", "value": "Follow up"},
				},
				"parts": []any{map[string]any{
					"filename": "terms.pdf", "mimeType": "application/pdf",
					"body": map[string]any{"attachmentId": "attachment-1", "size": 42},
				}},
			},
		})
	})
	f.server.Config.Handler.(*http.ServeMux).HandleFunc("/gmail/v1/users/me/profile", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"emailAddress": "owner@example.com", "historyId": "200"})
	})
}

func TestGmailCursorAdvancesAndReplayIsIdempotent(t *testing.T) {
	f := newSyncFixture(t)
	f.installGmailHandlers(t, false)
	ctx := auth.WithInternal(context.Background())

	if err := f.service.EnqueueInvalidation(ctx, f.user, "gmail", "owner@example.com", f.now); err != nil {
		t.Fatal(err)
	}
	f.client.CommunicationSyncCursor.Update().
		Where(communicationsynccursor.SourceEQ("gmail")).
		SetCursor("100").
		ExecX(ctx)
	if err := f.service.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	cursor := f.client.CommunicationSyncCursor.Query().OnlyX(ctx)
	if cursor.Cursor != "101" || cursor.Status != "live" {
		t.Fatalf("cursor = %+v, want live at 101", cursor)
	}
	interaction := f.client.CommunicationInteraction.Query().OnlyX(ctx)
	if interaction.Direction != "outbound" || interaction.Deleted {
		t.Fatalf("interaction = %+v", interaction)
	}
	if got := interaction.QueryAttachments().CountX(ctx); got != 1 {
		t.Fatalf("attachments = %d, want 1", got)
	}

	if err := f.service.EnqueueInvalidation(ctx, f.user, "gmail", "owner@example.com", f.now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := f.service.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if got := f.client.CommunicationInteraction.Query().CountX(ctx); got != 1 {
		t.Fatalf("replayed interaction count = %d, want 1", got)
	}
	cursor = f.client.CommunicationSyncCursor.Query().OnlyX(ctx)
	if cursor.Cursor != "102" {
		t.Fatalf("cursor = %q, want 102", cursor.Cursor)
	}
}

func TestProtectedRecipientProjectsOwnerPrivateMetadata(t *testing.T) {
	f := newSyncFixture(t)
	f.installGmailHandlers(t, false)
	ctx := auth.WithInternal(context.Background())
	workspace, err := f.service.workspace(ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	f.client.CommunicationPrivacyRule.Create().
		SetWorkspace(workspace).SetOwner(f.user).
		SetKind("protected_domain").SetValue("example.com").SetValueHash("sha256:test").
		SaveX(ctx)
	if err := f.service.EnqueueInvalidation(ctx, f.user, "gmail", "owner@example.com", f.now); err != nil {
		t.Fatal(err)
	}
	f.client.CommunicationSyncCursor.Update().
		Where(communicationsynccursor.SourceEQ("gmail")).SetCursor("100").ExecX(ctx)
	if err := f.service.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	interaction := f.client.CommunicationInteraction.Query().OnlyX(ctx)
	if interaction.Visibility != "private" || interaction.Subject != "" || interaction.MetadataJSON != "{}" {
		t.Fatalf("protected projection retained workspace-visible content: %#v", interaction)
	}
}

func TestGmailGapRunsBoundedReconciliation(t *testing.T) {
	f := newSyncFixture(t)
	f.installGmailHandlers(t, true)
	ctx := auth.WithInternal(context.Background())
	workspace, err := f.service.workspace(ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	f.client.CommunicationSyncCursor.Create().
		SetWorkspace(workspace).
		SetOwner(f.user).
		SetSource("gmail").
		SetSourceAccountID("owner@example.com").
		SetCursor("expired").
		SetStatus("queued").
		SaveX(ctx)

	if err := f.service.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	cursor := f.client.CommunicationSyncCursor.Query().OnlyX(ctx)
	if cursor.Cursor != "200" || cursor.Status != "live" {
		t.Fatalf("gap recovery cursor = %+v, want live at 200", cursor)
	}
	if got := f.client.CommunicationInteraction.Query().CountX(ctx); got != 1 {
		t.Fatalf("reconciled interactions = %d, want 1", got)
	}
}

func TestCalendarExpiredTokenReconcilesCancellation(t *testing.T) {
	f := newSyncFixture(t)
	ctx := auth.WithInternal(context.Background())
	f.server.Config.Handler.(*http.ServeMux).HandleFunc("/calendars/primary/events", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("syncToken") == "expired-token" {
			http.Error(w, "expired", http.StatusGone)
			return
		}
		if r.URL.Query().Get("showDeleted") != "true" || r.URL.Query().Get("singleEvents") != "false" {
			http.Error(w, "missing incremental semantics", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"nextSyncToken": "calendar-2",
			"items": []any{map[string]any{
				"id": "event-1", "status": "cancelled", "summary": "Cancelled QBR",
				"recurringEventId": "series-1", "originalStartTime": map[string]string{"dateTime": f.now.Format(time.RFC3339)},
				"attachments": []any{map[string]string{"fileUrl": "https://drive.example/file/1", "title": "Agenda", "mimeType": "text/plain"}},
			}},
		})
	})
	workspace, err := f.service.workspace(ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	f.client.CommunicationSyncCursor.Create().
		SetWorkspace(workspace).
		SetOwner(f.user).
		SetSource("calendar").
		SetSourceAccountID("owner@example.com").
		SetCursor("expired-token").
		SetStatus("queued").
		SaveX(ctx)

	if err := f.service.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	cursor := f.client.CommunicationSyncCursor.Query().OnlyX(ctx)
	if cursor.Cursor != "calendar-2" || cursor.Status != "live" {
		t.Fatalf("calendar cursor = %+v", cursor)
	}
	event := f.client.CommunicationInteraction.Query().
		Where(communicationinteraction.ProviderObjectIDEQ("event-1")).
		OnlyX(ctx)
	if !event.Deleted {
		t.Fatal("cancelled event must be persisted as a tombstone")
	}
	if got := event.QueryAttachments().CountX(ctx); got != 1 {
		t.Fatalf("calendar attachment metadata count = %d, want 1", got)
	}
}

func TestNewerInvalidationRemainsQueuedAfterLease(t *testing.T) {
	f := newSyncFixture(t)
	ctx := auth.WithInternal(context.Background())
	workspace, err := f.service.workspace(ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	row := f.client.CommunicationSyncCursor.Create().
		SetWorkspace(workspace).
		SetOwner(f.user).
		SetSource("gmail").
		SetSourceAccountID("owner@example.com").
		SetStatus("running").
		SetLeaseClaimedAt(f.now).
		SetLastProviderEventAt(f.now.Add(time.Second)).
		SaveX(ctx)
	row.Cursor = "advanced"
	if err := f.service.finish(ctx, row, f.now); err != nil {
		t.Fatal(err)
	}
	row = f.client.CommunicationSyncCursor.Query().Where(communicationsynccursor.IDEQ(row.ID)).OnlyX(ctx)
	if row.Status != "queued" || row.Cursor != "advanced" {
		t.Fatalf("cursor = %+v, newer invalidation must remain queued", row)
	}
}
