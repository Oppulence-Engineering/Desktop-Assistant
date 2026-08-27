package oauthrs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

// Config configures a Verifier.
type Config struct {
	// IssuerURL is the expected `iss` claim. If set, tokens with a different
	// issuer are rejected.
	IssuerURL string
	// Audience is the expected `aud` claim (e.g. "rowboat-api", "canvas-api").
	// If set, tokens not addressed to this audience are rejected.
	Audience string
	// JWKSURL is the JSON Web Key Set endpoint used to fetch signing keys.
	// If empty, it is discovered from IssuerURL's OIDC metadata
	// (<issuer>/.well-known/openid-configuration → jwks_uri). One of JWKSURL or
	// IssuerURL is required. Discovery lets callers point at an issuer (e.g.
	// WorkOS AuthKit) without hardcoding its provider-specific JWKS path.
	JWKSURL string
	// AcceptableSkew tolerates small clock differences on exp/nbf/iat.
	// Defaults to 60 seconds.
	AcceptableSkew time.Duration
	// ValidMethods restricts accepted signing algorithms. Defaults to RS256 only.
	// Add methods only when the issuer contract explicitly requires them.
	ValidMethods []string
}

// Verifier validates JWTs against a cached JWKS.
type Verifier struct {
	cfg Config
	kf  keyfunc.Keyfunc
}

// New builds a Verifier and starts background JWKS refresh. The JWKS is fetched
// once eagerly; unknown-kid lookups trigger an on-demand refresh.
func New(ctx context.Context, cfg Config) (*Verifier, error) {
	if cfg.AcceptableSkew < 0 {
		return nil, errors.New("oauthrs: AcceptableSkew must not be negative")
	}
	if len(cfg.ValidMethods) == 0 {
		cfg.ValidMethods = []string{"RS256"}
	}
	if cfg.AcceptableSkew == 0 {
		cfg.AcceptableSkew = 60 * time.Second
	}
	jwksURL := cfg.JWKSURL
	if jwksURL == "" {
		if cfg.IssuerURL == "" {
			return nil, errors.New("oauthrs: JWKSURL or IssuerURL is required")
		}
		// Bound discovery with a derived context: it uses http.DefaultClient,
		// which has no timeout of its own, so an unreachable issuer would
		// otherwise hang startup. The refresh below must NOT use this bounded
		// context.
		dctx, cancel := context.WithTimeout(ctx, 15*time.Second)
		discovered, err := discoverJWKSURL(dctx, cfg.IssuerURL)
		cancel()
		if err != nil {
			return nil, fmt.Errorf("oauthrs: discover jwks_uri from %s: %w", cfg.IssuerURL, err)
		}
		jwksURL = discovered
	}
	// Pass the LONG-LIVED ctx so the periodic + on-demand (unknown-kid) JWKS
	// refresh keeps working for the life of the process. Passing a soon-cancelled
	// context permanently disables refresh, causing a full auth outage the next
	// time the IdP rotates its signing keys (keys then 401 until restart). A
	// timeout-bounded HTTP client keeps every fetch — including the initial one —
	// from hanging startup despite the never-expiring ctx.
	kf, err := keyfunc.NewDefaultOverrideCtx(ctx, []string{jwksURL}, keyfunc.Override{
		Client: &http.Client{Timeout: 15 * time.Second},
	})
	if err != nil {
		return nil, fmt.Errorf("oauthrs: init JWKS from %s: %w", jwksURL, err)
	}
	return &Verifier{cfg: cfg, kf: kf}, nil
}

// discoverJWKSURL fetches the OIDC discovery document at
// <issuer>/.well-known/openid-configuration and returns its jwks_uri.
func discoverJWKSURL(ctx context.Context, issuer string) (string, error) {
	docURL := strings.TrimRight(issuer, "/") + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, docURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("discovery returned %d", resp.StatusCode)
	}
	var doc struct {
		JWKSURI string `json:"jwks_uri"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&doc); err != nil {
		return "", err
	}
	if doc.JWKSURI == "" {
		return "", errors.New("discovery document missing jwks_uri")
	}
	return doc.JWKSURI, nil
}

// Verify validates the token's signature and standard claims and returns the
// normalized Claims. It returns an error for any validation failure.
func (v *Verifier) Verify(tokenString string) (*Claims, error) {
	opts := []jwt.ParserOption{
		jwt.WithValidMethods(v.cfg.ValidMethods),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(v.cfg.AcceptableSkew),
	}
	if v.cfg.IssuerURL != "" {
		opts = append(opts, jwt.WithIssuer(v.cfg.IssuerURL))
	}
	if v.cfg.Audience != "" {
		opts = append(opts, jwt.WithAudience(v.cfg.Audience))
	}
	tok, err := jwt.Parse(tokenString, v.kf.Keyfunc, opts...)
	if err != nil {
		return nil, classifyTokenError(err)
	}
	mc, ok := tok.Claims.(jwt.MapClaims)
	if !ok {
		return nil, classifyTokenError(errors.New("unexpected claims type"))
	}
	return claimsFromMap(mc), nil
}
