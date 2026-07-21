package workosauth_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
)

// fakeAccessToken builds an unsigned-but-well-formed JWT carrying an exp claim
// (the broker reads exp via ParseUnverified).
func fakeAccessToken(t *testing.T, exp time.Time) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject:   "user_01ABC",
		ExpiresAt: jwt.NewNumericDate(exp),
	})
	s, err := tok.SignedString([]byte("test"))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return s
}

// workosMock stands in for WorkOS's /user_management/authenticate.
func workosMock(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/user_management/authenticate", handler)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestExchangeSuccess(t *testing.T) {
	exp := time.Now().Add(time.Hour).Truncate(time.Second)
	var gotBody map[string]string
	srv := workosMock(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &gotBody)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  fakeAccessToken(t, exp),
			"refresh_token": "rt_123",
			"user":          map[string]string{"id": "user_01ABC", "email": "a@x.co"},
		})
	})

	h := workosauth.New("client_test", "sk_test_key", srv.URL, "", zap.NewNop())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/workos/exchange",
		strings.NewReader(`{"code":"abc","codeVerifier":"v123"}`))
	h.Exchange(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	// The broker must present the API key as the client secret + forward PKCE.
	if gotBody["client_secret"] != "sk_test_key" || gotBody["grant_type"] != "authorization_code" {
		t.Errorf("upstream payload wrong: %+v", gotBody)
	}
	if gotBody["code"] != "abc" || gotBody["code_verifier"] != "v123" {
		t.Errorf("code/verifier not forwarded: %+v", gotBody)
	}
	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresAt    int64  `json:"expires_at"`
		TokenType    string `json:"token_type"`
		UserID       string `json:"user_id"`
		Email        string `json:"email"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.RefreshToken != "rt_123" || out.TokenType != "Bearer" || out.UserID != "user_01ABC" || out.Email != "a@x.co" {
		t.Errorf("bundle = %+v", out)
	}
	if out.ExpiresAt != exp.Unix() {
		t.Errorf("expires_at = %d, want %d (from token exp)", out.ExpiresAt, exp.Unix())
	}
}

func TestExchangeInvalidGrantMapsToReconnect(t *testing.T) {
	srv := workosMock(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
	})
	h := workosauth.New("client_test", "sk_test_key", srv.URL, "", zap.NewNop())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/exchange", strings.NewReader(`{"code":"bad"}`))
	h.Exchange(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 reconnect", rec.Code)
	}
}

func TestRefreshSuccess(t *testing.T) {
	var grant string
	srv := workosMock(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var m map[string]string
		_ = json.Unmarshal(body, &m)
		grant = m["grant_type"]
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  fakeAccessToken(t, time.Now().Add(time.Hour)),
			"refresh_token": "rt_next",
		})
	})
	h := workosauth.New("client_test", "sk_test_key", srv.URL, "", zap.NewNop())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/refresh", strings.NewReader(`{"refreshToken":"rt_old"}`))
	h.Refresh(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if grant != "refresh_token" {
		t.Errorf("grant_type = %q, want refresh_token", grant)
	}
}

func TestLoginURL(t *testing.T) {
	h := workosauth.New("client_test", "sk_test_key", "https://api.workos.com", "", zap.NewNop())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"/login-url?redirect_uri=http://localhost:8080/oauth/callback&state=s1&code_challenge=cc1", nil)
	h.LoginURL(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var out struct {
		URL string `json:"url"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	for _, want := range []string{
		"https://api.workos.com/user_management/authorize?",
		"client_id=client_test", "provider=authkit",
		"code_challenge=cc1", "code_challenge_method=S256", "state=s1",
	} {
		if !strings.Contains(out.URL, want) {
			t.Errorf("login url %q missing %q", out.URL, want)
		}
	}
}

func TestLoginURLProvider(t *testing.T) {
	h := workosauth.New("client_test", "sk_test_key", "https://api.workos.com", "", zap.NewNop())
	cases := map[string]string{
		"GoogleOAuth": "provider=GoogleOAuth", // recognized → passed through
		"authkit":     "provider=authkit",     // explicit default
		"Nonsense":    "provider=authkit",     // unknown → falls back to picker
	}
	for requested, want := range cases {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet,
			"/login-url?redirect_uri=http://localhost:8080/oauth/callback&state=s1&provider="+requested, nil)
		h.LoginURL(rec, req)
		var out struct {
			URL string `json:"url"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		if !strings.Contains(out.URL, want) {
			t.Errorf("provider %q: login url %q missing %q", requested, out.URL, want)
		}
	}
}

func TestUnconfiguredReturns502(t *testing.T) {
	h := workosauth.New("", "", "", "", zap.NewNop()) // no creds
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/exchange", strings.NewReader(`{"code":"x"}`))
	h.Exchange(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", rec.Code)
	}
}
