package voice_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/credits"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/voice"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func setup(t *testing.T, sanctioned int) (*ent.Client, context.Context, *voice.Handler) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	bg := context.Background()
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(bg)
	userCtx := auth.WithUser(bg, u)
	d.Client.Subscription.Create().SetUser(u).SetSanctionedCredits(sanctioned).SaveX(userCtx)
	sec := secrets.NewFromConfig(appconfig.Config{ElevenLabsAPIKey: "xi-key"})
	h := voice.New(pricing.DefaultTable(), quota.New(d.Client, zap.NewNop()), sec, zap.NewNop())
	return d.Client, userCtx, h
}

func withVoiceID(ctx context.Context, id string) context.Context {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("voiceId", id)
	return context.WithValue(ctx, chi.RouteCtxKey, rctx)
}

func TestTextToSpeechProxiesAndCharges(t *testing.T) {
	client, ctx, h := setup(t, 10000)
	var gotKey, gotPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("xi-api-key")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "audio/mpeg")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ID3fake-audio-bytes"))
	}))
	defer upstream.Close()
	h.SetUpstream(upstream.URL)

	body := `{"text":"Hello there","model_id":"eleven_flash_v2_5"}` // 11 chars → 11 credits
	req := httptest.NewRequest(http.MethodPost, "/v1/voice/text-to-speech/voiceXYZ", strings.NewReader(body))
	req.Header.Set("Idempotency-Key", "voice-1")
	req = req.WithContext(withVoiceID(ctx, "voiceXYZ"))
	rec := httptest.NewRecorder()
	h.TextToSpeech(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "audio/mpeg" {
		t.Errorf("content-type = %q", ct)
	}
	if !strings.Contains(rec.Body.String(), "fake-audio-bytes") {
		t.Errorf("audio not relayed")
	}
	if gotKey != "xi-key" {
		t.Errorf("upstream xi-api-key = %q", gotKey)
	}
	if gotPath != "/v1/text-to-speech/voiceXYZ" {
		t.Errorf("upstream path = %q", gotPath)
	}
	if avail, _ := credits.Available(ctx, client, 10000); avail != 10000-11 {
		t.Fatalf("available = %d, want %d", avail, 10000-11)
	}
}

func TestTextToSpeechUpstreamErrorIsRedactedAndRefunded(t *testing.T) {
	client, ctx, h := setup(t, 10000)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"secret voice account acct_123"}`))
	}))
	defer upstream.Close()
	h.SetUpstream(upstream.URL)

	req := httptest.NewRequest(http.MethodPost, "/v1/voice/text-to-speech/v", strings.NewReader(`{"text":"Hello there"}`))
	req.Header.Set("Idempotency-Key", "voice-upstream-redaction")
	req = req.WithContext(withVoiceID(ctx, "v"))
	rec := httptest.NewRecorder()
	h.TextToSpeech(rec, req)
	if rec.Code != http.StatusBadGateway || strings.Contains(rec.Body.String(), "acct_123") {
		t.Fatalf("response = %d %s, want redacted 502", rec.Code, rec.Body.String())
	}
	if avail, _ := credits.Available(ctx, client, 10000); avail != 10000 {
		t.Fatalf("available after refund = %d, want 10000", avail)
	}
}

func TestTextToSpeechInsufficient(t *testing.T) {
	_, ctx, h := setup(t, 3) // less than 11 chars cost
	hit := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hit = true
		w.WriteHeader(200)
	}))
	defer upstream.Close()
	h.SetUpstream(upstream.URL)

	body := `{"text":"Hello there"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/voice/text-to-speech/v", strings.NewReader(body))
	req.Header.Set("Idempotency-Key", "voice-insufficient-1")
	req = req.WithContext(withVoiceID(ctx, "v"))
	rec := httptest.NewRecorder()
	h.TextToSpeech(rec, req)
	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("want 402, got %d", rec.Code)
	}
	if hit {
		t.Error("upstream must not be called on insufficient credits")
	}
}
