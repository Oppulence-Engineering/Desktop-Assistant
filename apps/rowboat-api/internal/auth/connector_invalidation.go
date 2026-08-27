package auth

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
)

const (
	// ConnectorInvalidationCapabilityProduct identifies a bounded product/service
	// principal that may invalidate only configured connectors and selector classes.
	ConnectorInvalidationCapabilityProduct = "connector_invalidation"
	// ConnectorInvalidationCapabilityPlatformAdmin identifies the separate,
	// explicit principal capability allowed to perform global invalidation.
	ConnectorInvalidationCapabilityPlatformAdmin = "platform_admin"

	// ConnectorInvalidationSelectorConnection selects one immutable connection ID.
	ConnectorInvalidationSelectorConnection = "connection"
	// ConnectorInvalidationSelectorUser selects credentials owned by one user ID.
	ConnectorInvalidationSelectorUser = "user"
	// ConnectorInvalidationSelectorOrganization selects credentials by their
	// immutable grant-time organization ID.
	ConnectorInvalidationSelectorOrganization = "organization"
	// ConnectorInvalidationSelectorConnector selects all credentials for a connector.
	ConnectorInvalidationSelectorConnector = "connector"

	// ConnectorInvalidationJWTRequiredScope is required on service JWT callers.
	ConnectorInvalidationJWTRequiredScope = "connector:invalidate"

	maxConnectorInvalidationBody       = 1 << 16
	connectorInvalidationSignatureSkew = 5 * time.Minute
)

var connectorInvalidationPrincipalName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

// ConnectorInvalidationPrincipalConfig binds one individually authenticated
// product/service identity to the connector and selector classes it may revoke.
// HMACSecret enables signed-request authentication. A configured service JWT
// verifier enables JWT authentication for the same principal name via sub.
type ConnectorInvalidationPrincipalConfig struct {
	Principal       string   `json:"principal"`
	Capability      string   `json:"capability"`
	Connectors      []string `json:"connectors"`
	SelectorClasses []string `json:"selector_classes"`
	HMACSecret      string   `json:"hmac_secret"`
}

// ConnectorInvalidationAuth authenticates connector invalidation callers and
// installs a scoped service Actor. Product principals are never implicitly
// platform administrators. Global invalidation requires an explicit
// platform_admin policy entry with its own identity and credential.
type ConnectorInvalidationAuth struct {
	policies    map[string]ConnectorInvalidationPrincipalConfig
	jwtVerifier *oauthrs.Verifier
	nonceStore  HookNonceStore
}

// NewConnectorInvalidationAuth parses the bounded principal policy document.
// The empty document is accepted for local development, but Require fails closed
// until at least one principal is configured.
func NewConnectorInvalidationAuth(raw string, jwtVerifier *oauthrs.Verifier, nonceStore HookNonceStore) (*ConnectorInvalidationAuth, error) {
	a := &ConnectorInvalidationAuth{
		policies:    make(map[string]ConnectorInvalidationPrincipalConfig),
		jwtVerifier: jwtVerifier,
		nonceStore:  nonceStore,
	}
	if strings.TrimSpace(raw) == "" {
		return a, nil
	}
	if len(raw) > 64<<10 {
		return nil, errors.New("connector invalidation principal configuration exceeds 65536 bytes")
	}
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	var configured []ConnectorInvalidationPrincipalConfig
	if err := dec.Decode(&configured); err != nil {
		return nil, fmt.Errorf("decode connector invalidation principals: %w", err)
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return nil, errors.New("connector invalidation principals must contain exactly one JSON document")
	}
	if len(configured) == 0 || len(configured) > 64 {
		return nil, errors.New("connector invalidation principals must contain between 1 and 64 entries")
	}
	for _, policy := range configured {
		policy.Principal = strings.TrimSpace(policy.Principal)
		policy.Capability = strings.TrimSpace(policy.Capability)
		if policy.Capability == "" {
			policy.Capability = ConnectorInvalidationCapabilityProduct
		}
		if !connectorInvalidationPrincipalName.MatchString(policy.Principal) {
			return nil, fmt.Errorf("invalid connector invalidation principal %q", policy.Principal)
		}
		if _, duplicate := a.policies[policy.Principal]; duplicate {
			return nil, fmt.Errorf("duplicate connector invalidation principal %q", policy.Principal)
		}
		if policy.HMACSecret != "" && len(policy.HMACSecret) < 32 {
			return nil, fmt.Errorf("connector invalidation principal %q HMAC secret must be at least 32 bytes", policy.Principal)
		}
		if policy.HMACSecret == "" && jwtVerifier == nil {
			return nil, fmt.Errorf("connector invalidation principal %q has no usable HMAC or JWT authentication", policy.Principal)
		}
		connectors, err := uniqueBoundedPrincipalValues(policy.Connectors, 128)
		if err != nil {
			return nil, fmt.Errorf("connector invalidation principal %q connectors: %w", policy.Principal, err)
		}
		selectors, err := uniqueBoundedPrincipalValues(policy.SelectorClasses, 64)
		if err != nil {
			return nil, fmt.Errorf("connector invalidation principal %q selector_classes: %w", policy.Principal, err)
		}
		policy.Connectors = connectors
		policy.SelectorClasses = selectors
		switch policy.Capability {
		case ConnectorInvalidationCapabilityProduct:
			if len(policy.Connectors) == 0 || len(policy.SelectorClasses) == 0 {
				return nil, fmt.Errorf("connector invalidation principal %q requires connectors and selector_classes", policy.Principal)
			}
			for _, selector := range policy.SelectorClasses {
				if !validConnectorInvalidationSelector(selector) {
					return nil, fmt.Errorf("connector invalidation principal %q has unknown selector class %q", policy.Principal, selector)
				}
			}
		case ConnectorInvalidationCapabilityPlatformAdmin:
			if len(policy.Connectors) != 0 || len(policy.SelectorClasses) != 0 {
				return nil, fmt.Errorf("platform-admin principal %q must not declare product connector or selector limits", policy.Principal)
			}
		default:
			return nil, fmt.Errorf("connector invalidation principal %q has unknown capability %q", policy.Principal, policy.Capability)
		}
		a.policies[policy.Principal] = policy
	}
	return a, nil
}

func uniqueBoundedPrincipalValues(values []string, maxLen int) ([]string, error) {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || len(value) > maxLen {
			return nil, errors.New("values must be non-empty and bounded")
		}
		if _, duplicate := seen[value]; duplicate {
			return nil, fmt.Errorf("duplicate value %q", value)
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out, nil
}

func validConnectorInvalidationSelector(selector string) bool {
	switch selector {
	case ConnectorInvalidationSelectorConnection, ConnectorInvalidationSelectorUser,
		ConnectorInvalidationSelectorOrganization, ConnectorInvalidationSelectorConnector:
		return true
	default:
		return false
	}
}

// Require authenticates either a signed HMAC request or a service JWT. HMAC
// authentication binds the method, escaped path, timestamp, nonce, and body
// digest and reserves the nonce across replicas. JWT authentication requires
// connector:invalidate and maps the verified sub to a configured principal.
func (a *ConnectorInvalidationAuth) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a == nil || len(a.policies) == 0 {
			httpx.Error(w, http.StatusServiceUnavailable, "connector invalidation authentication not configured", "auth_unavailable")
			return
		}
		var (
			policy ConnectorInvalidationPrincipalConfig
			ok     bool
		)
		if raw := oauthrs.BearerToken(r); raw != "" {
			if a.jwtVerifier == nil {
				httpx.Error(w, http.StatusUnauthorized, "service JWT authentication unavailable", "unauthorized")
				return
			}
			claims, err := a.jwtVerifier.Verify(raw)
			if err != nil || !claims.HasScope(ConnectorInvalidationJWTRequiredScope) {
				httpx.Error(w, http.StatusUnauthorized, "invalid connector invalidation service token", "unauthorized")
				return
			}
			policy, ok = a.policies[claims.Subject]
			if !ok {
				httpx.Error(w, http.StatusForbidden, "service principal is not authorized for connector invalidation", "forbidden")
				return
			}
		} else {
			var authenticated bool
			policy, authenticated = a.authenticateHMAC(w, r)
			if !authenticated {
				return
			}
		}

		actor := &Actor{
			Kind:                   KindService,
			ServiceName:            policy.Principal,
			Capabilities:           []string{policy.Capability},
			AllowedConnectors:      append([]string(nil), policy.Connectors...),
			AllowedSelectorClasses: append([]string(nil), policy.SelectorClasses...),
		}
		ctx := WithInternal(r.Context())
		ctx = WithActor(ctx, actor)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (a *ConnectorInvalidationAuth) authenticateHMAC(w http.ResponseWriter, r *http.Request) (ConnectorInvalidationPrincipalConfig, bool) {
	var zero ConnectorInvalidationPrincipalConfig
	if a.nonceStore == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "connector invalidation replay protection unavailable", "auth_unavailable")
		return zero, false
	}
	principal := r.Header.Get("X-Connector-Principal")
	policy, ok := a.policies[principal]
	if !ok || policy.HMACSecret == "" {
		httpx.Error(w, http.StatusUnauthorized, "invalid connector invalidation principal", "unauthorized")
		return zero, false
	}
	body, readOK := httpx.ReadBody(w, r, maxConnectorInvalidationBody)
	_ = r.Body.Close()
	if !readOK {
		return zero, false
	}
	r.Body = io.NopCloser(bytes.NewReader(body))

	timestamp := r.Header.Get("X-Connector-Timestamp")
	nonce := r.Header.Get("X-Connector-Nonce")
	supplied := r.Header.Get("X-Connector-Signature")
	millis, err := strconv.ParseInt(timestamp, 10, 64)
	decodedNonce, nonceErr := base64.RawURLEncoding.DecodeString(nonce)
	if len(r.Header.Values("X-Connector-Principal")) != 1 || len(r.Header.Values("X-Connector-Timestamp")) != 1 ||
		len(r.Header.Values("X-Connector-Nonce")) != 1 || len(r.Header.Values("X-Connector-Signature")) != 1 ||
		err != nil || timestamp == "" || timestamp != strings.TrimSpace(timestamp) || nonce == "" || nonce != strings.TrimSpace(nonce) ||
		nonceErr != nil || len(decodedNonce) < 16 || len(decodedNonce) > 64 ||
		time.Since(time.UnixMilli(millis)).Abs() > connectorInvalidationSignatureSkew || !strings.HasPrefix(supplied, "sha256=") {
		httpx.Error(w, http.StatusUnauthorized, "invalid connector invalidation signature headers", "unauthorized")
		return zero, false
	}

	bodyHash := sha256.Sum256(body)
	canonical := strings.Join([]string{
		"v1",
		r.Method,
		r.URL.EscapedPath(),
		principal,
		timestamp,
		nonce,
		hex.EncodeToString(bodyHash[:]),
	}, "\n")
	mac := hmac.New(sha256.New, []byte(policy.HMACSecret))
	_, _ = mac.Write([]byte(canonical))
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(supplied), []byte(expected)) != 1 {
		httpx.Error(w, http.StatusUnauthorized, "invalid connector invalidation signature", "unauthorized")
		return zero, false
	}
	reservation := "connector-invalidation:" + principal + ":" + nonce
	if err := a.nonceStore.Reserve(r.Context(), reservation, time.UnixMilli(millis).Add(connectorInvalidationSignatureSkew)); err != nil {
		if errors.Is(err, ErrHookNonceReplayed) {
			httpx.Error(w, http.StatusConflict, "connector invalidation request replayed", "replay_detected")
			return zero, false
		}
		httpx.Error(w, http.StatusServiceUnavailable, "connector invalidation replay protection unavailable", "auth_unavailable")
		return zero, false
	}
	return policy, true
}

// ConnectorInvalidationPolicyAllows reports whether a scoped service actor may
// use the requested connector and selector classes. Platform administrators are
// admitted only through the explicit platform_admin capability.
func ConnectorInvalidationPolicyAllows(actor *Actor, connector string, selectors []string) bool {
	if actor == nil || actor.Kind != KindService || actor.ServiceName == "" {
		return false
	}
	if actor.HasCapability(ConnectorInvalidationCapabilityPlatformAdmin) {
		return true
	}
	if !actor.HasCapability(ConnectorInvalidationCapabilityProduct) || connector == "" || !actor.AllowsConnector(connector) {
		return false
	}
	for _, selector := range selectors {
		if !actor.AllowsSelectorClass(selector) {
			return false
		}
	}
	return len(selectors) > 0
}

// ConnectorInvalidationPrincipalFromContext returns the durable audit identity
// for an authenticated invalidation caller.
func ConnectorInvalidationPrincipalFromContext(ctx context.Context) (string, bool) {
	actor, ok := ActorFromCtx(ctx)
	if !ok || actor.Kind != KindService || actor.ServiceName == "" {
		return "", false
	}
	return actor.ServiceName, true
}
