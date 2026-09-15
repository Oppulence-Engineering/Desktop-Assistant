package auth_test

import (
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/authmetrics"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
)

// newJWTMiddlewareFor builds a verifying middleware on the given client, so a
// test can seed rows that the middleware then reads.
func newJWTMiddlewareFor(t *testing.T, client *ent.Client) (*auth.Middleware, *rsa.PrivateKey) {
	t.Helper()
	jwksURL, key := jwksServerMW(t)
	v, err := oauthrs.NewGeneric(context.Background(), oauthrs.GenericConfig{
		IssuerURL:                 testIssuer,
		Audience:                  "rowboat-api",
		JWKSURL:                   jwksURL,
		AllowedJWKSOrigins:        []string{jwksURL},
		AllowLocalhostDevelopment: true,
	})
	if err != nil {
		t.Fatalf("verifier: %v", err)
	}
	m := auth.NewMiddleware(v, client, nil, 10000, zap.NewNop())
	m.SetIssuerPolicy(auth.IssuerPolicy{WorkOSIssuer: testIssuer, ServiceIssuer: "rowboat-internal", BrokerIssuer: "rowboat-broker"})
	return m, key
}

func tombstone(t *testing.T, client *ent.Client, workosUserID string) {
	t.Helper()
	client.DeletedIdentity.Create().SetKeyHash(auth.DeletedIdentityKey(workosUserID)).SaveX(context.Background())
}

func usersWith(t *testing.T, client *ent.Client, workosUserID string) int {
	t.Helper()
	return client.User.Query().Where(user.WorkosUserIDEQ(workosUserID)).CountX(context.Background())
}

func TestDeletedIdentityKeyIsAOneWayHashOfTheWorkOSID(t *testing.T) {
	key := auth.DeletedIdentityKey("user_gone")
	sum := sha256.Sum256([]byte("user_gone"))
	if want := hex.EncodeToString(sum[:]); key != want {
		t.Fatalf("key = %q, want %q", key, want)
	}
	if strings.Contains(key, "user_gone") {
		t.Fatal("the key must not contain the WorkOS user id")
	}
	if key == auth.DeletedIdentityKey("user_gone2") {
		t.Fatal("different ids must give different keys")
	}
}

func TestResolveUserRefusesATokenOfADeletedAccount(t *testing.T) {
	client := testClient(t)
	m := auth.NewMiddleware(nil, client, nil, 10000, zap.NewNop())
	tombstone(t, client, "user_gone")

	u, err := m.ResolveUser(context.Background(), &oauthrs.Claims{WorkOSUserID: "user_gone", Email: "gone@x.co"})
	if !errors.Is(err, auth.ErrIdentityDeleted) || u != nil {
		t.Fatalf("ResolveUser = %v, %v; want nil, ErrIdentityDeleted", u, err)
	}
	if n := usersWith(t, client, "user_gone"); n != 0 {
		t.Fatalf("users for the deleted identity = %d, want 0", n)
	}
}

func TestResolveUserStillCreatesOtherAccountsNextToATombstone(t *testing.T) {
	client := testClient(t)
	m := auth.NewMiddleware(nil, client, nil, 10000, zap.NewNop())
	tombstone(t, client, "user_gone")

	u, err := m.ResolveUser(context.Background(), &oauthrs.Claims{WorkOSUserID: "user_new", Email: "new@x.co"})
	if err != nil {
		t.Fatalf("resolve a new account: %v", err)
	}
	if u.Email != "new@x.co" || usersWith(t, client, "user_new") != 1 {
		t.Fatalf("new account = %+v", u)
	}
}

func TestRequireJWTAnswers401ForADeletedAccount(t *testing.T) {
	client := testClient(t)
	m, key := newJWTMiddlewareFor(t, client)
	tombstone(t, client, "user_gone")
	rejected := authmetrics.TokenRejected.WithLabelValues(auth.IssuerTypeWorkOS, auth.RouteGroupLLM, auth.ReasonAccountDeleted)
	before := testutil.ToFloat64(rejected)

	token := signMW(t, key, jwt.MapClaims{
		"iss": testIssuer, "aud": "rowboat-api", "sub": "user_gone",
		"exp": time.Now().Add(time.Hour).Unix(),
		"ext": map[string]any{"workos_user_id": "user_gone", "email": "gone@x.co"},
	})
	rec := doAuthed(m, token, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("deleted account: got %d, want 401", rec.Code)
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Code != "account_deleted" {
		t.Fatalf("body = %s (%v), want code account_deleted", rec.Body.String(), err)
	}
	if delta := testutil.ToFloat64(rejected) - before; delta != 1 {
		t.Errorf("rejected(account_deleted) metric delta = %v, want 1", delta)
	}
	if n := usersWith(t, client, "user_gone"); n != 0 {
		t.Fatalf("the request created %d users, want 0", n)
	}
}
