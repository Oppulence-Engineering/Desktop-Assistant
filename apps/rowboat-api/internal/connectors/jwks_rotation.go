package connectors

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

const (
	JWKSRotationActivate = "activate"
	JWKSRotationRetire   = "retire"

	defaultJWKSRotationTimeout  = 5 * time.Second
	defaultJWKSRotationMaxBytes = int64(1 << 20)
	defaultJWKSRetirementWait   = 17 * time.Minute // 15m max token TTL + skew/cache allowance.
)

// JWKSRotationPolicy describes an operational pre-activation or pre-retirement
// gate. ReplicaJWKSURLs must be direct per-replica endpoints, not one load
// balancer URL, so a skewed rollout cannot masquerade as convergence.
type JWKSRotationPolicy struct {
	Phase            string
	ReplicaJWKSURLs  []string
	RequiredKeyIDs   []string
	CandidateKeyID   string
	RetiringKeyID    string
	ActivatedAt      time.Time
	MinimumOverlap   time.Duration
	HTTPTimeout      time.Duration
	MaxResponseBytes int64
	Now              func() time.Time
}

// JWKSConvergenceReport is safe to publish as deployment evidence. It contains
// only non-secret key IDs and a digest of the canonical public JWKS.
type JWKSConvergenceReport struct {
	Phase       string              `json:"phase"`
	Digest      string              `json:"digest"`
	KeyIDs      []string            `json:"key_ids"`
	ReplicaKeys map[string][]string `json:"replica_keys"`
	CheckedAt   time.Time           `json:"checked_at"`
}

// CheckJWKSRotationConvergence fails unless every directly-addressed replica
// publishes byte-equivalent canonical public keys and the phase-specific safety
// preconditions are met.
func CheckJWKSRotationConvergence(ctx context.Context, policy JWKSRotationPolicy) (JWKSConvergenceReport, error) {
	now := policy.Now
	if now == nil {
		now = time.Now
	}
	report := JWKSConvergenceReport{Phase: policy.Phase, ReplicaKeys: map[string][]string{}, CheckedAt: now().UTC()}
	if policy.Phase != JWKSRotationActivate && policy.Phase != JWKSRotationRetire {
		return report, fmt.Errorf("JWKS rotation phase must be %q or %q", JWKSRotationActivate, JWKSRotationRetire)
	}
	if len(policy.ReplicaJWKSURLs) < 2 {
		return report, errors.New("at least two direct replica JWKS URLs are required")
	}
	timeout := policy.HTTPTimeout
	if timeout <= 0 {
		timeout = defaultJWKSRotationTimeout
	}
	maxBytes := policy.MaxResponseBytes
	if maxBytes <= 0 {
		maxBytes = defaultJWKSRotationMaxBytes
	}
	client := &http.Client{
		Timeout:       timeout,
		Transport:     &http.Transport{Proxy: nil},
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}

	var expectedDigest string
	var expectedKids []string
	for _, endpoint := range policy.ReplicaJWKSURLs {
		endpoint = strings.TrimSpace(endpoint)
		if endpoint == "" {
			return report, errors.New("replica JWKS URL must not be empty")
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return report, fmt.Errorf("build replica JWKS request: %w", err)
		}
		resp, err := client.Do(req)
		if err != nil {
			return report, fmt.Errorf("fetch replica JWKS %q: %w", endpoint, err)
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
		closeErr := resp.Body.Close()
		if readErr != nil {
			return report, fmt.Errorf("read replica JWKS %q: %w", endpoint, readErr)
		}
		if closeErr != nil {
			return report, fmt.Errorf("close replica JWKS %q: %w", endpoint, closeErr)
		}
		if resp.StatusCode != http.StatusOK {
			return report, fmt.Errorf("replica JWKS %q returned HTTP %d", endpoint, resp.StatusCode)
		}
		if int64(len(body)) > maxBytes {
			return report, fmt.Errorf("replica JWKS %q exceeds %d bytes", endpoint, maxBytes)
		}
		digest, kids, err := canonicalJWKSDigest(body)
		if err != nil {
			return report, fmt.Errorf("parse replica JWKS %q: %w", endpoint, err)
		}
		report.ReplicaKeys[endpoint] = kids
		if expectedDigest == "" {
			expectedDigest, expectedKids = digest, kids
			continue
		}
		if digest != expectedDigest {
			return report, fmt.Errorf("JWKS publication is not converged: replica %q publishes digest %s, expected %s", endpoint, digest, expectedDigest)
		}
	}
	report.Digest = expectedDigest
	report.KeyIDs = expectedKids
	for _, required := range uniqueNonEmpty(policy.RequiredKeyIDs) {
		if !containsString(expectedKids, required) {
			return report, fmt.Errorf("converged JWKS is missing required key %q", required)
		}
	}

	switch policy.Phase {
	case JWKSRotationActivate:
		candidate := strings.TrimSpace(policy.CandidateKeyID)
		if candidate == "" || !containsString(expectedKids, candidate) {
			return report, fmt.Errorf("candidate signing key %q is not converged on every replica", candidate)
		}
	case JWKSRotationRetire:
		retiring := strings.TrimSpace(policy.RetiringKeyID)
		if retiring == "" || !containsString(expectedKids, retiring) {
			return report, fmt.Errorf("retiring key %q must remain published until the pre-retirement gate passes", retiring)
		}
		if policy.ActivatedAt.IsZero() {
			return report, errors.New("activation timestamp is required for retirement")
		}
		minimum := policy.MinimumOverlap
		if minimum <= 0 {
			minimum = defaultJWKSRetirementWait
		}
		if elapsed := report.CheckedAt.Sub(policy.ActivatedAt); elapsed < minimum {
			return report, fmt.Errorf("retirement overlap is only %s; wait at least %s after activation", elapsed.Round(time.Second), minimum)
		}
	}
	return report, nil
}

func canonicalJWKSDigest(body []byte) (string, []string, error) {
	var document struct {
		Keys []map[string]any `json:"keys"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	if err := decoder.Decode(&document); err != nil {
		return "", nil, err
	}
	if len(document.Keys) == 0 {
		return "", nil, errors.New("JWKS contains no keys")
	}
	byKid := make(map[string]map[string]any, len(document.Keys))
	kids := make([]string, 0, len(document.Keys))
	for _, key := range document.Keys {
		kid, _ := key["kid"].(string)
		kid = strings.TrimSpace(kid)
		if kid == "" {
			return "", nil, errors.New("JWKS key has no kid")
		}
		if _, duplicate := byKid[kid]; duplicate {
			return "", nil, fmt.Errorf("JWKS contains duplicate kid %q", kid)
		}
		byKid[kid] = key
		kids = append(kids, kid)
	}
	sort.Strings(kids)
	ordered := make([]map[string]any, 0, len(kids))
	for _, kid := range kids {
		ordered = append(ordered, byKid[kid])
	}
	canonical, err := json.Marshal(struct {
		Keys []map[string]any `json:"keys"`
	}{Keys: ordered})
	if err != nil {
		return "", nil, err
	}
	digest := sha256.Sum256(canonical)
	return hex.EncodeToString(digest[:]), kids, nil
}

func uniqueNonEmpty(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func containsString(values []string, target string) bool {
	index := sort.SearchStrings(values, target)
	return index < len(values) && values[index] == target
}
