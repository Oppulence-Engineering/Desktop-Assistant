package auth_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/authmetrics"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"go.uber.org/zap"
)

const testIssuer = "https://auth.solomon-ai.co"
const jwtTestKID = "mw-key-1"

func jwksServerMW(t *testing.T) (string, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("gen key: %v", err)
	}
	n := base64.RawURLEncoding.EncodeToString(key.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())
	jwks := map[string]any{"keys": []map[string]string{
		{"kty": "RSA", "use": "sig", "alg": "RS256", "kid": jwtTestKID, "n": n, "e": e},
	}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jwks)
	}))
	t.Cleanup(srv.Close)
	return srv.URL, key
}

func signMW(t *testing.T, key *rsa.PrivateKey, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = jwtTestKID
	s, err := tok.SignedString(key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return s
}

func newJWTMiddleware(t *testing.T) (*auth.Middleware, *rsa.PrivateKey) {
	t.Helper()
	jwksURL, key := jwksServerMW(t)
	v, err := oauthrs.New(context.Background(), oauthrs.Config{
		IssuerURL: testIssuer, Audience: "rowboat-api", JWKSURL: jwksURL,
	})
	if err != nil {
		t.Fatalf("verifier: %v", err)
	}
	m := auth.NewMiddleware(v, testClient(t), nil, 10000, zap.NewNop())
	m.SetIssuerPolicy(auth.IssuerPolicy{WorkOSIssuer: testIssuer, ServiceIssuer: "rowboat-internal", BrokerIssuer: "rowboat-broker"})
	return m, key
}

func doAuthed(m *auth.Middleware, token string, sink *auth.Actor) *httptest.ResponseRecorder {
	final := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a, ok := auth.ActorFromCtx(r.Context()); ok && sink != nil {
			*sink = *a
		}
		w.WriteHeader(http.StatusOK)
	})
	h := m.RequireJWT(final)
	req := httptest.NewRequest(http.MethodGet, "/v1/llm/models", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRequireJWTAttachesActorAndAccepts(t *testing.T) {
	m, key := newJWTMiddleware(t)
	before := testutil.ToFloat64(authmetrics.TokenAccepted.WithLabelValues(auth.IssuerTypeWorkOS, auth.RouteGroupLLM))

	token := signMW(t, key, jwt.MapClaims{
		"iss": testIssuer, "aud": "rowboat-api", "sub": "user_mw_1",
		"exp": time.Now().Add(time.Hour).Unix(), "auth_time": float64(time.Now().Add(-time.Minute).Unix()),
		"ext": map[string]any{"workos_user_id": "user_mw_1", "email": "mw@x.co", "workos_org_id": "org_mw"},
	})
	var actor auth.Actor
	rec := doAuthed(m, token, &actor)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid token: got %d, want 200", rec.Code)
	}
	if actor.Kind != auth.KindUser || actor.WorkOSUserID != "user_mw_1" {
		t.Errorf("actor = %+v", actor)
	}
	if actor.WorkOSOrgID != "org_mw" {
		t.Errorf("actor org = %q, want org_mw", actor.WorkOSOrgID)
	}
	if actor.UserID == uuid.Nil {
		t.Error("actor user id should be the resolved local uuid, got nil")
	}
	if actor.TokenIssuer != testIssuer {
		t.Errorf("actor issuer = %q", actor.TokenIssuer)
	}
	after := testutil.ToFloat64(authmetrics.TokenAccepted.WithLabelValues(auth.IssuerTypeWorkOS, auth.RouteGroupLLM))
	if after-before != 1 {
		t.Errorf("accepted metric delta = %v, want 1", after-before)
	}
}

func TestRequireJWTRejectsExpired(t *testing.T) {
	m, key := newJWTMiddleware(t)
	before := testutil.ToFloat64(authmetrics.TokenRejected.WithLabelValues(auth.IssuerTypeWorkOS, auth.RouteGroupLLM, auth.ReasonExpired))
	token := signMW(t, key, jwt.MapClaims{
		"iss": testIssuer, "aud": "rowboat-api", "sub": "user_x",
		"exp": time.Now().Add(-time.Minute).Unix(),
	})
	if rec := doAuthed(m, token, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired: got %d, want 401", rec.Code)
	}
	after := testutil.ToFloat64(authmetrics.TokenRejected.WithLabelValues(auth.IssuerTypeWorkOS, auth.RouteGroupLLM, auth.ReasonExpired))
	if after-before != 1 {
		t.Errorf("rejected(expired) metric delta = %v, want 1", after-before)
	}
}

func TestRequireJWTRejectsMissingToken(t *testing.T) {
	m, _ := newJWTMiddleware(t)
	before := testutil.ToFloat64(authmetrics.TokenRejected.WithLabelValues(auth.IssuerTypeUnknown, auth.RouteGroupLLM, auth.ReasonMissingToken))
	if rec := doAuthed(m, "", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing token: got %d, want 401", rec.Code)
	}
	after := testutil.ToFloat64(authmetrics.TokenRejected.WithLabelValues(auth.IssuerTypeUnknown, auth.RouteGroupLLM, auth.ReasonMissingToken))
	if after-before != 1 {
		t.Errorf("rejected(missing) metric delta = %v, want 1", after-before)
	}
}

func TestRequireJWTVerifierUnavailable(t *testing.T) {
	// No verifier (JWKS unreachable at boot) → fail closed with 503.
	m := auth.NewMiddleware(nil, testClient(t), nil, 10000, zap.NewNop())
	if rec := doAuthed(m, "anything", nil); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("nil verifier: got %d, want 503", rec.Code)
	}
}

func TestResolveUserMapsAndSwitchesOrg(t *testing.T) {
	m := auth.NewMiddleware(nil, testClient(t), nil, 10000, zap.NewNop())
	ctx := context.Background()

	setBefore := testutil.ToFloat64(authmetrics.OrgMapped.WithLabelValues("set"))
	u, err := m.ResolveUser(ctx, &oauthrs.Claims{WorkOSUserID: "user_o", WorkOSOrgID: "org_a"})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if u.WorkosOrgID != "org_a" {
		t.Fatalf("org on create = %q", u.WorkosOrgID)
	}
	if d := testutil.ToFloat64(authmetrics.OrgMapped.WithLabelValues("set")) - setBefore; d != 1 {
		t.Errorf("org set metric delta = %v, want 1", d)
	}

	switchBefore := testutil.ToFloat64(authmetrics.OrgMapped.WithLabelValues("switched"))
	u2, err := m.ResolveUser(ctx, &oauthrs.Claims{WorkOSUserID: "user_o", WorkOSOrgID: "org_b"})
	if err != nil {
		t.Fatalf("resolve switch: %v", err)
	}
	if u2.WorkosOrgID != "org_b" {
		t.Errorf("org after switch = %q, want org_b", u2.WorkosOrgID)
	}
	if d := testutil.ToFloat64(authmetrics.OrgMapped.WithLabelValues("switched")) - switchBefore; d != 1 {
		t.Errorf("org switched metric delta = %v, want 1", d)
	}
}
