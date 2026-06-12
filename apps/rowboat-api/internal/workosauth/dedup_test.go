package workosauth_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
	"go.uber.org/zap"
)

func newSHA256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func newSealer(t *testing.T) *crypto.Sealer {
	t.Helper()
	s, err := crypto.NewSealer("test-passphrase-for-refresh-dedup")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	return s
}

// rotatingWorkOS mimics WorkOS rotation semantics: each refresh token is
// single-use; reuse returns invalid_grant. Counts upstream hits.
func rotatingWorkOS(t *testing.T) (*httptest.Server, *atomic.Int64) {
	t.Helper()
	var hits atomic.Int64
	var mu sync.Mutex
	consumed := map[string]bool{}
	next := 0
	srv := workosMock(t, func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		rt := body["refresh_token"]
		mu.Lock()
		defer mu.Unlock()
		if consumed[rt] {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
			return
		}
		consumed[rt] = true
		next++
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  fakeAccessToken(t, time.Now().Add(time.Hour)),
			"refresh_token": "rt_rotated_" + strings.Repeat("x", next),
			"user":          map[string]string{"id": "user_01ABC", "email": "a@x.co"},
		})
	})
	return srv, &hits
}

func dedupHandler(t *testing.T, upstreamURL string) *workosauth.Handler {
	t.Helper()
	h := workosauth.New("client_test", "sk_test_key", upstreamURL, "", zap.NewNop())
	h.SetRefreshDedup(workosauth.NewMemoryRefreshCache(), newSealer(t))
	return h
}

func doRefresh(h *workosauth.Handler, refreshToken string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/workos/refresh",
		strings.NewReader(`{"refreshToken":"`+refreshToken+`"}`))
	h.Refresh(rec, req)
	return rec
}

func TestRefreshDedupSequentialReplay(t *testing.T) {
	srv, hits := rotatingWorkOS(t)
	h := dedupHandler(t, srv.URL)

	first := doRefresh(h, "rt_original")
	if first.Code != http.StatusOK {
		t.Fatalf("first refresh: status=%d body=%s", first.Code, first.Body.String())
	}
	// Replay the SAME (now consumed upstream) token — must serve the cached
	// rotated bundle, not invalid_grant.
	second := doRefresh(h, "rt_original")
	if second.Code != http.StatusOK {
		t.Fatalf("replayed refresh: status=%d body=%s", second.Code, second.Body.String())
	}
	if first.Body.String() != second.Body.String() {
		t.Errorf("replay returned a different bundle:\n%s\nvs\n%s", first.Body.String(), second.Body.String())
	}
	if hits.Load() != 1 {
		t.Errorf("upstream hits = %d, want 1", hits.Load())
	}
}

func TestRefreshDedupConcurrent(t *testing.T) {
	srv, hits := rotatingWorkOS(t)
	h := dedupHandler(t, srv.URL)

	const n = 8
	var wg sync.WaitGroup
	codes := make([]int, n)
	bodies := make([]string, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			rec := doRefresh(h, "rt_original")
			codes[i] = rec.Code
			bodies[i] = rec.Body.String()
		}(i)
	}
	wg.Wait()

	for i, c := range codes {
		if c != http.StatusOK {
			t.Fatalf("caller %d: status=%d body=%s", i, c, bodies[i])
		}
		if bodies[i] != bodies[0] {
			t.Errorf("caller %d received a different bundle", i)
		}
	}
	if hits.Load() != 1 {
		t.Errorf("upstream hits = %d, want 1 (singleflight)", hits.Load())
	}
}

func TestRefreshDedupInvalidGrantNegativeCache(t *testing.T) {
	var hits atomic.Int64
	srv := workosMock(t, func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
	})
	h := dedupHandler(t, srv.URL)

	first := doRefresh(h, "rt_dead")
	if first.Code != http.StatusConflict {
		t.Fatalf("first: status=%d body=%s", first.Code, first.Body.String())
	}
	if !strings.Contains(first.Body.String(), "reconnectRequired") {
		t.Errorf("409 body missing reconnectRequired flag: %s", first.Body.String())
	}
	second := doRefresh(h, "rt_dead")
	if second.Code != http.StatusConflict {
		t.Fatalf("replay: status=%d body=%s", second.Code, second.Body.String())
	}
	if hits.Load() != 1 {
		t.Errorf("upstream hits = %d, want 1 (negative cache)", hits.Load())
	}
}

func TestRefreshDedupDistinctTokensNotCollapsed(t *testing.T) {
	srv, hits := rotatingWorkOS(t)
	h := dedupHandler(t, srv.URL)

	a := doRefresh(h, "rt_a")
	b := doRefresh(h, "rt_b")
	if a.Code != http.StatusOK || b.Code != http.StatusOK {
		t.Fatalf("status a=%d b=%d", a.Code, b.Code)
	}
	if a.Body.String() == b.Body.String() {
		t.Error("distinct tokens must not share a cached bundle")
	}
	if hits.Load() != 2 {
		t.Errorf("upstream hits = %d, want 2", hits.Load())
	}
}

func TestRefreshDedupCacheValueIsSealed(t *testing.T) {
	srv, _ := rotatingWorkOS(t)
	cache := workosauth.NewMemoryRefreshCache()
	h := workosauth.New("client_test", "sk_test_key", srv.URL, "", zap.NewNop())
	h.SetRefreshDedup(cache, newSealer(t))

	rec := doRefresh(h, "rt_original")
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d", rec.Code)
	}
	var bundle struct {
		RefreshToken string `json:"refresh_token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &bundle)
	if bundle.RefreshToken == "" {
		t.Fatal("no rotated refresh token in response")
	}

	// The cached value must not contain the rotated token in plaintext.
	sum := newSHA256Hex("rt_original")
	sealed, ok, err := cache.Get(t.Context(), "workos:refresh:result:v1:"+sum)
	if err != nil || !ok {
		t.Fatalf("expected cached result (ok=%v err=%v)", ok, err)
	}
	if strings.Contains(string(sealed), bundle.RefreshToken) {
		t.Error("cached refresh result is plaintext")
	}
}

func TestRefreshWithoutDedupStillWorks(t *testing.T) {
	srv, hits := rotatingWorkOS(t)
	h := workosauth.New("client_test", "sk_test_key", srv.URL, "", zap.NewNop())
	// No SetRefreshDedup: legacy direct path.
	rec := doRefresh(h, "rt_original")
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if hits.Load() != 1 {
		t.Errorf("upstream hits = %d, want 1", hits.Load())
	}
}
