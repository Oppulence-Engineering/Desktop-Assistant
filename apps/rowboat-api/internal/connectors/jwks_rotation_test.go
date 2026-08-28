package connectors

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
)

type mutableJWKS struct {
	mu     sync.RWMutex
	issuer *RSAResourceTokenIssuer
}

func (m *mutableJWKS) set(issuer *RSAResourceTokenIssuer) {
	m.mu.Lock()
	m.issuer = issuer
	m.mu.Unlock()
}

func (m *mutableJWKS) serve(w http.ResponseWriter, _ *http.Request) {
	m.mu.RLock()
	issuer := m.issuer
	m.mu.RUnlock()
	_ = json.NewEncoder(w).Encode(issuer.JWKS())
}

func TestStagedSignerRotationRejectsSkewedReplicasBeforeActivationAndRetirement(t *testing.T) {
	oldKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	newKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	oldOnly := newTestIssuer(t, oldKey, "old", map[string]*rsa.PrivateKey{"old": oldKey})
	overlapOld := newTestIssuer(t, oldKey, "old", map[string]*rsa.PrivateKey{"old": oldKey, "new": newKey})
	overlapNew := newTestIssuer(t, newKey, "new", map[string]*rsa.PrivateKey{"old": oldKey, "new": newKey})
	newOnly := newTestIssuer(t, newKey, "new", map[string]*rsa.PrivateKey{"new": newKey})

	replicaA := &mutableJWKS{issuer: oldOnly}
	replicaB := &mutableJWKS{issuer: overlapOld}
	serverA := httptest.NewServer(http.HandlerFunc(replicaA.serve))
	defer serverA.Close()
	serverB := httptest.NewServer(http.HandlerFunc(replicaB.serve))
	defer serverB.Close()

	var lbRequests atomic.Int64
	loadBalancer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Deterministically route initial load-balancer requests to the stale pod.
		if lbRequests.Add(1) <= 2 {
			replicaA.serve(w, r)
			return
		}
		replicaB.serve(w, r)
	}))
	defer loadBalancer.Close()

	verifier, err := oauthrs.New(context.Background(), oauthrs.Config{
		IssuerURL: "https://broker.test", Audience: "mcp:canvas", JWKSURL: loadBalancer.URL,
		AllowedJWKSOrigins: []string{loadBalancer.URL}, AllowLocalhostDevelopment: true,
		UnknownKIDRefreshCooldown: time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	newToken := mintTestToken(t, overlapNew)
	if _, err := verifier.Verify(newToken); err == nil {
		t.Fatal("new-key token unexpectedly survived a stale load-balancer JWKS response")
	}

	activationPolicy := JWKSRotationPolicy{
		Phase: JWKSRotationActivate, ReplicaJWKSURLs: []string{serverA.URL, serverB.URL},
		RequiredKeyIDs: []string{"old", "new"}, CandidateKeyID: "new",
	}
	if _, err := CheckJWKSRotationConvergence(context.Background(), activationPolicy); err == nil {
		t.Fatal("activation gate accepted old-only/overlap replica skew")
	}

	// Publication rollout converges before any replica activates the new signer.
	replicaA.set(overlapOld)
	activationTime := time.Date(2026, 8, 27, 22, 0, 0, 0, time.UTC)
	activationPolicy.Now = func() time.Time { return activationTime }
	activationReport, err := CheckJWKSRotationConvergence(context.Background(), activationPolicy)
	if err != nil {
		t.Fatalf("converged activation gate failed: %v", err)
	}
	if len(activationReport.KeyIDs) != 2 || activationReport.KeyIDs[0] != "new" || activationReport.KeyIDs[1] != "old" {
		t.Fatalf("unexpected activation report: %+v", activationReport)
	}

	// Only after the gate passes does the active signer move to the new key. Both
	// load-balancer backends still publish both public keys, so every route works.
	replicaA.set(overlapNew)
	replicaB.set(overlapNew)
	convergedVerifier, err := oauthrs.New(context.Background(), oauthrs.Config{
		IssuerURL: "https://broker.test", Audience: "mcp:canvas", JWKSURL: loadBalancer.URL,
		AllowedJWKSOrigins: []string{loadBalancer.URL}, AllowLocalhostDevelopment: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := convergedVerifier.Verify(newToken); err != nil {
		t.Fatalf("new token failed after all-pod overlap convergence: %v", err)
	}

	retirementPolicy := JWKSRotationPolicy{
		Phase: JWKSRotationRetire, ReplicaJWKSURLs: []string{serverA.URL, serverB.URL},
		RequiredKeyIDs: []string{"old", "new"}, RetiringKeyID: "old", ActivatedAt: activationTime,
		MinimumOverlap: 17 * time.Minute,
		Now:            func() time.Time { return activationTime.Add(16 * time.Minute) },
	}
	if _, err := CheckJWKSRotationConvergence(context.Background(), retirementPolicy); err == nil {
		t.Fatal("retirement gate ignored token TTL plus skew/cache overlap")
	}
	retirementPolicy.Now = func() time.Time { return activationTime.Add(18 * time.Minute) }
	replicaB.set(newOnly)
	if _, err := CheckJWKSRotationConvergence(context.Background(), retirementPolicy); err == nil {
		t.Fatal("retirement gate accepted overlap/new-only replica skew")
	}
	replicaB.set(overlapNew)
	if _, err := CheckJWKSRotationConvergence(context.Background(), retirementPolicy); err != nil {
		t.Fatalf("retirement gate failed after full overlap: %v", err)
	}

	// The old public key is removed only after the pre-retirement proof passes.
	replicaA.set(newOnly)
	replicaB.set(newOnly)
	retiredVerifier, err := oauthrs.New(context.Background(), oauthrs.Config{
		IssuerURL: "https://broker.test", Audience: "mcp:canvas", JWKSURL: loadBalancer.URL,
		AllowedJWKSOrigins: []string{loadBalancer.URL}, AllowLocalhostDevelopment: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := retiredVerifier.Verify(newToken); err != nil {
		t.Fatalf("new token failed after safe retirement: %v", err)
	}
}
