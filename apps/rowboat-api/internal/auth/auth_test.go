package auth_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	"go.uber.org/zap"
)

func testClient(t *testing.T) *ent.Client {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d.Client
}

func TestResolveUserCreatesUserAndFreeTierSubscription(t *testing.T) {
	client := testClient(t)
	m := auth.NewMiddleware(nil, client, nil, 10000, zap.NewNop())
	ctx := context.Background()

	u, err := m.ResolveUser(ctx, &oauthrs.Claims{WorkOSUserID: "user_1", Email: "a@x.co"})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if u.Email != "a@x.co" {
		t.Errorf("email = %q", u.Email)
	}

	// A free-tier subscription was minted (query scoped to this user).
	sub := client.Subscription.Query().OnlyX(auth.WithUser(ctx, u))
	if sub.SanctionedCredits != 10000 {
		t.Errorf("sanctioned credits = %d, want 10000", sub.SanctionedCredits)
	}
	if sub.Plan != "free" {
		t.Errorf("plan = %q, want free", sub.Plan)
	}
}

func TestResolveUserIsIdempotent(t *testing.T) {
	client := testClient(t)
	m := auth.NewMiddleware(nil, client, nil, 10000, zap.NewNop())
	ctx := context.Background()

	u1, _ := m.ResolveUser(ctx, &oauthrs.Claims{WorkOSUserID: "user_1", Email: "a@x.co"})
	u2, _ := m.ResolveUser(ctx, &oauthrs.Claims{WorkOSUserID: "user_1", Email: "a@x.co"})

	if u1.ID != u2.ID {
		t.Fatalf("expected same user id, got %s and %s", u1.ID, u2.ID)
	}
	if n := client.User.Query().CountX(ctx); n != 1 {
		t.Fatalf("expected 1 user, got %d", n)
	}
	if n := client.Subscription.Query().CountX(auth.WithInternal(ctx)); n != 1 {
		t.Fatalf("expected 1 subscription, got %d", n)
	}
}

func TestResolveUserRefreshesEmail(t *testing.T) {
	client := testClient(t)
	m := auth.NewMiddleware(nil, client, nil, 10000, zap.NewNop())
	ctx := context.Background()

	// First sight: no email in token.
	u1, _ := m.ResolveUser(ctx, &oauthrs.Claims{WorkOSUserID: "user_1"})
	if u1.Email != "" {
		t.Fatalf("expected empty email, got %q", u1.Email)
	}
	// Later token carries email → refreshed.
	u2, _ := m.ResolveUser(ctx, &oauthrs.Claims{WorkOSUserID: "user_1", Email: "real@x.co"})
	if u2.Email != "real@x.co" {
		t.Fatalf("expected refreshed email, got %q", u2.Email)
	}
}

func TestResolveUserRejectsMissingWorkOSID(t *testing.T) {
	client := testClient(t)
	m := auth.NewMiddleware(nil, client, nil, 10000, zap.NewNop())
	if _, err := m.ResolveUser(context.Background(), &oauthrs.Claims{}); err == nil {
		t.Fatal("expected error for missing workos_user_id")
	}
}

func TestRequireHookHMAC(t *testing.T) {
	secret := "hook-secret"
	var internalSeen bool
	h := auth.RequireHookHMAC(secret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		internalSeen = auth.IsInternalCaller(r.Context())
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"accepted":true}`))
	}))

	body := `{"version":1}`
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	nonce := base64.RawURLEncoding.EncodeToString([]byte("request-nonce"))
	sig := hookHMAC(t, secret, timestamp, nonce, body)

	// Valid signature produces an internal request and an exact-body signed
	// response that echoes the nonce.
	req := httptest.NewRequest(http.MethodPost, "/oauth-hooks/pre-consent", strings.NewReader(body))
	req.Header.Set("X-Hook-Timestamp", timestamp)
	req.Header.Set("X-Hook-Nonce", nonce)
	req.Header.Set("X-Hook-Signature", "sha256="+sig)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid sig: want 200, got %d", rec.Code)
	}
	if !internalSeen {
		t.Fatal("hook handler should run as internal caller")
	}
	if rec.Header().Get("X-Hook-Nonce") != nonce {
		t.Fatalf("response nonce = %q, want request nonce", rec.Header().Get("X-Hook-Nonce"))
	}
	responseTimestamp := rec.Header().Get("X-Hook-Timestamp")
	wantResponseSignature := "sha256=" + hookHMAC(t, secret, responseTimestamp, nonce, rec.Body.String())
	if rec.Header().Get("X-Hook-Signature") != wantResponseSignature {
		t.Fatalf("response signature = %q, want %q", rec.Header().Get("X-Hook-Signature"), wantResponseSignature)
	}

	// Missing freshness/nonce headers and tampered signatures fail closed.
	req = httptest.NewRequest(http.MethodPost, "/oauth-hooks/pre-consent", strings.NewReader(body))
	req.Header.Set("X-Hook-Signature", "sha256="+sig)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing signed headers: want 401, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/oauth-hooks/pre-consent", strings.NewReader(body))
	req.Header.Set("X-Hook-Timestamp", timestamp)
	req.Header.Set("X-Hook-Nonce", nonce)
	req.Header.Set("X-Hook-Signature", "sha256=deadbeef")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad sig: want 401, got %d", rec.Code)
	}
}

func TestRequireInternalSecret(t *testing.T) {
	guard := auth.RequireInternalSecret("s3cr3t")
	final := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := guard(final)

	req := httptest.NewRequest(http.MethodPost, "/v1/internal/x", nil)
	req.Header.Set("X-Internal-Secret", "s3cr3t")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid secret: want 200, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/internal/x", nil)
	req.Header.Set("X-Internal-Secret", "wrong")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad secret: want 401, got %d", rec.Code)
	}
}

func hookHMAC(t *testing.T, secret, timestamp, nonce, body string) string {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + "." + nonce + "." + body))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
