package googlewatch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/googlewatch"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

// mockGoogle is a fake token endpoint + Gmail/Calendar/Drive API recording calls.
type mockGoogle struct {
	mu            sync.Mutex
	tokenErr      string // non-empty → token endpoint returns this OAuth error
	gmailCalls    int
	calendarCalls []map[string]any // events.watch bodies
	driveCalls    []map[string]any // changes.watch bodies
	stopCalls     []map[string]any // channels/stop bodies
	srv           *httptest.Server
}

func newMockGoogle(t *testing.T) *mockGoogle {
	t.Helper()
	m := &mockGoogle{}
	exp := fmt.Sprintf("%d", time.Now().Add(6*24*time.Hour).UnixMilli())
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, _ *http.Request) {
		m.mu.Lock()
		defer m.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if m.tokenErr != "" {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": m.tokenErr})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "ya29.test"})
	})
	mux.HandleFunc("/gmail/v1/users/me/watch", func(w http.ResponseWriter, r *http.Request) {
		m.mu.Lock()
		m.gmailCalls++
		m.mu.Unlock()
		if got := r.Header.Get("Authorization"); got != "Bearer ya29.test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"historyId": "998877", "expiration": exp})
	})
	mux.HandleFunc("/calendars/primary/events/watch", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		m.mu.Lock()
		m.calendarCalls = append(m.calendarCalls, body)
		m.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]string{"resourceId": "res-1", "expiration": exp})
	})
	mux.HandleFunc("/changes/startPageToken", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"startPageToken": "drive-page-1"})
	})
	mux.HandleFunc("/changes/watch", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("pageToken") != "drive-page-1" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		m.mu.Lock()
		m.driveCalls = append(m.driveCalls, body)
		m.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]string{"resourceId": "drive-res-1", "expiration": exp})
	})
	mux.HandleFunc("/channels/stop", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		m.mu.Lock()
		m.stopCalls = append(m.stopCalls, body)
		m.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	})
	m.srv = httptest.NewServer(mux)
	t.Cleanup(m.srv.Close)
	return m
}

func setup(t *testing.T) (*ent.Client, *ent.User, *crypto.Sealer) {
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
	sealer, err := crypto.NewSealer("test-encryption-key-for-google-watch")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	return d.Client, u, sealer
}

func connectGoogle(t *testing.T, client *ent.Client, sealer *crypto.Sealer, u *ent.User, email string) *ent.OAuthConnection {
	t.Helper()
	sealed, err := sealer.SealString("1//refresh-token")
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	return client.OAuthConnection.Create().
		SetUser(u).
		SetProvider("google").
		SetRefreshTokenEncrypted(sealed).
		SetExternalAccountID(email).
		SaveX(context.Background())
}

func newManager(t *testing.T, client *ent.Client, sealer *crypto.Sealer, g *mockGoogle, topic string) *Manager {
	t.Helper()
	sec := secrets.NewFromConfig(appconfig.Config{GoogleOAuthClientID: "cid", GoogleOAuthClientSecret: "csec"})
	return New(client, sealer, sec, Config{
		GmailPubSubTopic: topic,
		WebhookURL:       "https://api.example/v1/webhooks/google",
		ChannelToken:     "tok-1",
		RenewMargin:      24 * time.Hour,
		TokenURL:         g.srv.URL + "/token",
		GmailBaseURL:     g.srv.URL,
		CalendarBaseURL:  g.srv.URL,
		DriveBaseURL:     g.srv.URL,
	}, zap.NewNop())
}

func TestBootstrapCreatesWatches(t *testing.T) {
	client, u, sealer := setup(t)
	connectGoogle(t, client, sealer, u, "me@gmail.com")
	g := newMockGoogle(t)
	m := newManager(t, client, sealer, g, "projects/p/topics/t")

	if err := m.RenewDue(context.Background()); err != nil {
		t.Fatalf("renew: %v", err)
	}

	ctx := auth.WithInternal(context.Background())
	rows := client.GoogleWatch.Query().AllX(ctx)
	if len(rows) != 3 {
		t.Fatalf("watch rows = %d, want 3 (gmail + calendar + drive)", len(rows))
	}
	byKind := map[string]*ent.GoogleWatch{}
	for _, r := range rows {
		byKind[r.Kind] = r
	}
	gm := byKind[KindGmail]
	if gm == nil || gm.HistoryID != "998877" || !gm.ExpiresAt.After(time.Now()) {
		t.Fatalf("gmail row = %+v", gm)
	}
	cal := byKind[KindCalendar]
	if cal == nil || !strings.HasPrefix(cal.ChannelID, "gcal:me@gmail.com:") || cal.ResourceID != "res-1" {
		t.Fatalf("calendar row = %+v (channel id must be gcal:{email}:{uuid})", cal)
	}
	drive := byKind[KindDrive]
	if drive == nil || !strings.HasPrefix(drive.ChannelID, "gdrive:me@gmail.com:") || drive.ResourceID != "drive-res-1" || drive.HistoryID != "drive-page-1" {
		t.Fatalf("drive row = %+v (channel id must be gdrive:{email}:{uuid})", drive)
	}
	if gm.RenewClaimedAt != nil || cal.RenewClaimedAt != nil || drive.RenewClaimedAt != nil {
		t.Fatal("claims must be released after successful registration")
	}
	// The registered channels carry the webhook address + verification token.
	if len(g.calendarCalls) != 1 {
		t.Fatalf("calendar watch calls = %d, want 1", len(g.calendarCalls))
	}
	call := g.calendarCalls[0]
	if call["address"] != "https://api.example/v1/webhooks/google" || call["token"] != "tok-1" {
		t.Fatalf("calendar watch body = %+v", call)
	}
	if len(g.driveCalls) != 1 {
		t.Fatalf("drive watch calls = %d, want 1", len(g.driveCalls))
	}
	call = g.driveCalls[0]
	if call["address"] != "https://api.example/v1/webhooks/google" || call["token"] != "tok-1" {
		t.Fatalf("drive watch body = %+v", call)
	}
}

func TestHealthyWatchesAreNotTouched(t *testing.T) {
	client, u, sealer := setup(t)
	connectGoogle(t, client, sealer, u, "me@gmail.com")
	g := newMockGoogle(t)
	m := newManager(t, client, sealer, g, "projects/p/topics/t")

	if err := m.RenewDue(context.Background()); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	gmailBefore := g.gmailCalls
	calBefore := len(g.calendarCalls)
	driveBefore := len(g.driveCalls)

	// Second pass: everything is fresh (expires in ~6d, margin 24h) → no calls.
	if err := m.RenewDue(context.Background()); err != nil {
		t.Fatalf("second pass: %v", err)
	}
	if g.gmailCalls != gmailBefore || len(g.calendarCalls) != calBefore || len(g.driveCalls) != driveBefore {
		t.Fatalf("healthy watches were re-registered (gmail %d→%d, cal %d→%d, drive %d→%d)",
			gmailBefore, g.gmailCalls, calBefore, len(g.calendarCalls), driveBefore, len(g.driveCalls))
	}
}

func TestRenewalStopsOldCalendarChannel(t *testing.T) {
	client, u, sealer := setup(t)
	connectGoogle(t, client, sealer, u, "me@gmail.com")
	g := newMockGoogle(t)
	m := newManager(t, client, sealer, g, "")

	if err := m.RenewDue(context.Background()); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	ctx := auth.WithInternal(context.Background())
	row := client.GoogleWatch.Query().Where(googlewatch.KindEQ(KindCalendar)).OnlyX(ctx)
	oldChannel := row.ChannelID

	// Force due: expire within the margin.
	client.GoogleWatch.UpdateOneID(row.ID).
		SetExpiresAt(time.Now().UTC().Add(time.Hour)).
		ExecX(ctx)

	if err := m.RenewDue(context.Background()); err != nil {
		t.Fatalf("renew: %v", err)
	}
	if len(g.stopCalls) != 1 || g.stopCalls[0]["id"] != oldChannel {
		t.Fatalf("old channel must be stopped before re-registering; stops=%+v", g.stopCalls)
	}
	row = client.GoogleWatch.Query().Where(googlewatch.KindEQ(KindCalendar)).OnlyX(ctx)
	if row.ChannelID == oldChannel {
		t.Fatal("renewal must mint a fresh channel id")
	}
}

func TestRenewalClaimExcludesPeers(t *testing.T) {
	client, u, sealer := setup(t)
	connectGoogle(t, client, sealer, u, "me@gmail.com")
	g := newMockGoogle(t)
	m := newManager(t, client, sealer, g, "")

	if err := m.RenewDue(context.Background()); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	ctx := auth.WithInternal(context.Background())
	row := client.GoogleWatch.Query().Where(googlewatch.KindEQ(KindCalendar)).OnlyX(ctx)

	// Due, but a peer claimed it moments ago.
	client.GoogleWatch.UpdateOneID(row.ID).
		SetExpiresAt(time.Now().UTC().Add(time.Hour)).
		SetRenewClaimedAt(time.Now().UTC()).
		ExecX(ctx)
	calBefore := len(g.calendarCalls)
	if err := m.RenewDue(context.Background()); err != nil {
		t.Fatalf("renew: %v", err)
	}
	if len(g.calendarCalls) != calBefore {
		t.Fatal("a live peer claim must exclude this replica")
	}

	// A stale claim (crashed renewer) is stolen.
	client.GoogleWatch.UpdateOneID(row.ID).
		SetRenewClaimedAt(time.Now().UTC().Add(-claimTTL - time.Minute)).
		ExecX(ctx)
	if err := m.RenewDue(context.Background()); err != nil {
		t.Fatalf("renew: %v", err)
	}
	if len(g.calendarCalls) != calBefore+1 {
		t.Fatal("a stale claim must be stolen and renewed")
	}
}

func TestInvalidGrantRecordsErrorAndSkipsRegistration(t *testing.T) {
	client, u, sealer := setup(t)
	connectGoogle(t, client, sealer, u, "me@gmail.com")
	g := newMockGoogle(t)
	g.tokenErr = "invalid_grant"
	m := newManager(t, client, sealer, g, "projects/p/topics/t")

	_ = m.RenewDue(context.Background()) // per-row errors are logged, not fatal

	ctx := auth.WithInternal(context.Background())
	rows := client.GoogleWatch.Query().AllX(ctx)
	if len(rows) != 3 {
		t.Fatalf("rows = %d, want 3 (rows persist with the error recorded)", len(rows))
	}
	for _, r := range rows {
		if !strings.Contains(r.LastError, "reconnect") {
			t.Fatalf("last_error = %q, want invalid_grant/reconnect marker", r.LastError)
		}
	}
	if g.gmailCalls != 0 || len(g.calendarCalls) != 0 || len(g.driveCalls) != 0 {
		t.Fatal("registration must not be attempted with a dead refresh token")
	}
}

func TestOrphanSweepRemovesDisconnectedWatches(t *testing.T) {
	client, u, sealer := setup(t)
	conn := connectGoogle(t, client, sealer, u, "me@gmail.com")
	g := newMockGoogle(t)
	m := newManager(t, client, sealer, g, "")

	if err := m.RenewDue(context.Background()); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	ctx := auth.WithInternal(context.Background())
	if n := client.GoogleWatch.Query().CountX(ctx); n != 2 {
		t.Fatalf("rows = %d, want 2", n)
	}

	// Disconnect: the connection row goes away; the next pass sweeps the watch.
	client.OAuthConnection.DeleteOne(conn).ExecX(ctx)
	if err := m.RenewDue(context.Background()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n := client.GoogleWatch.Query().CountX(ctx); n != 0 {
		t.Fatalf("rows = %d, want 0 after disconnect sweep", n)
	}
}

func TestGmailSkippedWithoutTopic(t *testing.T) {
	client, u, sealer := setup(t)
	connectGoogle(t, client, sealer, u, "me@gmail.com")
	g := newMockGoogle(t)
	m := newManager(t, client, sealer, g, "") // no topic

	if err := m.RenewDue(context.Background()); err != nil {
		t.Fatalf("renew: %v", err)
	}
	ctx := auth.WithInternal(context.Background())
	rows := client.GoogleWatch.Query().AllX(ctx)
	if len(rows) != 2 {
		t.Fatalf("rows = %+v, want calendar + drive when no Pub/Sub topic is configured", rows)
	}
	byKind := map[string]bool{}
	for _, row := range rows {
		byKind[row.Kind] = true
	}
	if !byKind[KindCalendar] || !byKind[KindDrive] {
		t.Fatalf("rows = %+v, want calendar + drive when no Pub/Sub topic is configured", rows)
	}
	if g.gmailCalls != 0 {
		t.Fatal("gmail watch must not be called without a topic")
	}
}
