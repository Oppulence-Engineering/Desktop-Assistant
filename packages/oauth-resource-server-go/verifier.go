package oauthrs

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	defaultHTTPTimeout        = 10 * time.Second
	defaultMaxJWKSBytes       = int64(1 << 20)
	defaultKidMissTTL         = 30 * time.Second
	defaultKidRefreshCooldown = 30 * time.Second
)

// Config configures the fail-closed RFC 012 connector-token verifier.
type Config struct {
	IssuerURL                 string
	Audience                  string
	JWKSURL                   string
	RequiredOrganizationID    string
	AcceptableSkew            time.Duration
	ValidMethods              []string
	AllowedJWKSOrigins        []string
	AllowLocalhostDevelopment bool
	HTTPTimeout               time.Duration
	MaxJWKSResponseBytes      int64
	UnknownKIDCacheTTL        time.Duration
	UnknownKIDRefreshCooldown time.Duration
	// Now overrides the verifier clock. It is intended for deterministic tests.
	Now func() time.Time
}

// GenericConfig configures an explicitly generic JWT verifier. Unlike Config,
// actor claims are not required. IssuerURL and Audience are still mandatory.
type GenericConfig Config

type Verifier struct {
	cfg            Config
	requireActor   bool
	jwksURL        *url.URL
	client         *http.Client
	mu             sync.Mutex
	keys           map[string]any
	negative       map[string]time.Time
	refreshing     chan struct{}
	nextKidRefresh time.Time
	now            func() time.Time
}

// New builds the primary RFC 012 verifier. It fails closed unless exact issuer
// and audience values are configured and requires sub/user, connection_id,
// connector_id, and jti in every verified token.
func New(ctx context.Context, cfg Config) (*Verifier, error) { return newVerifier(ctx, cfg, true) }

// NewGeneric builds an explicitly generic verifier that does not require RFC 012
// actor claims. Exact issuer and audience validation remains mandatory.
func NewGeneric(ctx context.Context, cfg GenericConfig) (*Verifier, error) {
	return newVerifier(ctx, Config(cfg), false)
}

func newVerifier(ctx context.Context, cfg Config, requireActor bool) (*Verifier, error) {
	if strings.TrimSpace(cfg.IssuerURL) == "" || strings.TrimSpace(cfg.Audience) == "" {
		return nil, errors.New("oauthrs: exact IssuerURL and Audience are required")
	}
	if cfg.AcceptableSkew < 0 || cfg.HTTPTimeout < 0 || cfg.MaxJWKSResponseBytes < 0 || cfg.UnknownKIDCacheTTL < 0 || cfg.UnknownKIDRefreshCooldown < 0 {
		return nil, errors.New("oauthrs: durations and response limits must not be negative")
	}
	if cfg.AcceptableSkew == 0 {
		cfg.AcceptableSkew = 60 * time.Second
	}
	if cfg.HTTPTimeout == 0 {
		cfg.HTTPTimeout = defaultHTTPTimeout
	}
	if cfg.MaxJWKSResponseBytes == 0 {
		cfg.MaxJWKSResponseBytes = defaultMaxJWKSBytes
	}
	if cfg.UnknownKIDCacheTTL == 0 {
		cfg.UnknownKIDCacheTTL = defaultKidMissTTL
	}
	if cfg.UnknownKIDRefreshCooldown == 0 {
		cfg.UnknownKIDRefreshCooldown = defaultKidRefreshCooldown
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if len(cfg.ValidMethods) == 0 {
		cfg.ValidMethods = []string{"RS256"}
	}

	issuer, err := validateRemoteURL(cfg.IssuerURL, cfg.AllowLocalhostDevelopment)
	if err != nil {
		return nil, fmt.Errorf("oauthrs: invalid issuer URL: %w", err)
	}
	allowed, err := allowedOrigins(issuer, cfg.AllowedJWKSOrigins, cfg.AllowLocalhostDevelopment)
	if err != nil {
		return nil, err
	}

	jwksRaw := cfg.JWKSURL
	client := secureHTTPClient(cfg.HTTPTimeout, cfg.MaxJWKSResponseBytes, allowed, cfg.AllowLocalhostDevelopment)
	if jwksRaw == "" {
		discovery := strings.TrimRight(issuer.String(), "/") + "/.well-known/openid-configuration"
		var doc struct {
			JWKSURI string `json:"jwks_uri"`
		}
		if err := fetchJSON(ctx, client, discovery, cfg.MaxJWKSResponseBytes, &doc); err != nil {
			return nil, fmt.Errorf("oauthrs: discover jwks_uri: %w", err)
		}
		jwksRaw = doc.JWKSURI
	}
	jwksURL, err := validateRemoteURL(jwksRaw, cfg.AllowLocalhostDevelopment)
	if err != nil {
		return nil, fmt.Errorf("oauthrs: invalid JWKS URL: %w", err)
	}
	if !allowed[origin(jwksURL)] {
		return nil, fmt.Errorf("oauthrs: JWKS origin %q is not allowlisted", origin(jwksURL))
	}

	v := &Verifier{cfg: cfg, requireActor: requireActor, jwksURL: jwksURL, client: client, keys: map[string]any{}, negative: map[string]time.Time{}, now: cfg.Now}
	if err := v.refresh(ctx); err != nil {
		return nil, fmt.Errorf("oauthrs: init JWKS: %w", err)
	}
	return v, nil
}

func (v *Verifier) Verify(tokenString string) (*Claims, error) {
	opts := []jwt.ParserOption{jwt.WithValidMethods(v.cfg.ValidMethods), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithLeeway(v.cfg.AcceptableSkew), jwt.WithIssuer(v.cfg.IssuerURL), jwt.WithAudience(v.cfg.Audience)}
	tok, err := jwt.Parse(tokenString, v.keyfunc, opts...)
	if err != nil {
		return nil, classifyTokenError(err)
	}
	mc, ok := tok.Claims.(jwt.MapClaims)
	if !ok {
		return nil, classifyTokenError(errors.New("unexpected claims type"))
	}
	claims := claimsFromMap(mc)
	if v.requireActor {
		if claims.Subject == "" || claims.UserID == "" || claims.ConnectionID == "" || claims.ConnectorID == "" || claims.TokenID == "" {
			return nil, classifyTokenError(errors.New("required RFC 012 actor claim missing"))
		}
		if v.cfg.RequiredOrganizationID != "" && claims.OrganizationID != v.cfg.RequiredOrganizationID {
			return nil, classifyTokenError(errors.New("required organization claim missing or mismatched"))
		}
	}
	return claims, nil
}

func (v *Verifier) keyfunc(token *jwt.Token) (any, error) {
	kid, _ := token.Header["kid"].(string)
	if kid == "" {
		return nil, errors.New("token missing kid")
	}
	v.mu.Lock()
	now := v.now()
	if key := v.keys[kid]; key != nil {
		v.mu.Unlock()
		return key, nil
	}
	if until := v.negative[kid]; now.Before(until) {
		v.mu.Unlock()
		return nil, errors.New("unknown kid (negative cached)")
	}
	if wait := v.refreshing; wait != nil {
		v.mu.Unlock()
		<-wait
		v.mu.Lock()
		key := v.keys[kid]
		if key == nil {
			v.negative[kid] = v.now().Add(v.cfg.UnknownKIDCacheTTL)
		}
		v.mu.Unlock()
		if key == nil {
			return nil, errors.New("unknown kid")
		}
		return key, nil
	}
	if now.Before(v.nextKidRefresh) {
		v.negative[kid] = now.Add(v.cfg.UnknownKIDCacheTTL)
		v.mu.Unlock()
		return nil, errors.New("unknown kid (refresh cooldown)")
	}
	wait := make(chan struct{})
	v.refreshing = wait
	v.nextKidRefresh = now.Add(v.cfg.UnknownKIDRefreshCooldown)
	v.mu.Unlock()
	err := v.refresh(context.Background())
	v.mu.Lock()
	key := v.keys[kid]
	if key == nil {
		v.negative[kid] = v.now().Add(v.cfg.UnknownKIDCacheTTL)
	}
	v.refreshing = nil
	close(wait)
	v.mu.Unlock()
	if err != nil {
		return nil, err
	}
	if key == nil {
		return nil, errors.New("unknown kid")
	}
	return key, nil
}

func (v *Verifier) refresh(ctx context.Context) error {
	var set struct {
		Keys []struct{ Kty, Kid, N, E, Alg, Use string } `json:"keys"`
	}
	if err := fetchJSON(ctx, v.client, v.jwksURL.String(), v.cfg.MaxJWKSResponseBytes, &set); err != nil {
		return err
	}
	keys := make(map[string]any, len(set.Keys))
	for _, k := range set.Keys {
		if k.Kty != "RSA" || k.Kid == "" || k.N == "" || k.E == "" || (k.Use != "" && k.Use != "sig") {
			continue
		}
		nb, err1 := base64.RawURLEncoding.DecodeString(k.N)
		eb, err2 := base64.RawURLEncoding.DecodeString(k.E)
		if err1 != nil || err2 != nil || len(eb) == 0 || len(eb) > 4 {
			continue
		}
		e := 0
		for _, b := range eb {
			e = e<<8 + int(b)
		}
		if e < 3 {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(nb), E: e}
	}
	if len(keys) == 0 {
		return errors.New("JWKS contains no usable RSA signing keys")
	}
	v.mu.Lock()
	v.keys = keys
	for kid := range keys {
		delete(v.negative, kid)
	}
	v.mu.Unlock()
	return nil
}

func fetchJSON(ctx context.Context, client *http.Client, raw string, limit int64, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("remote returned %d", resp.StatusCode)
	}
	reader := io.LimitReader(resp.Body, limit+1)
	data, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	if int64(len(data)) > limit {
		return errors.New("remote response exceeds configured limit")
	}
	return json.Unmarshal(data, dst)
}

func validateRemoteURL(raw string, dev bool) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if u.User != nil || u.Fragment != "" || u.Hostname() == "" {
		return nil, errors.New("URL must have host and no userinfo or fragment")
	}
	if u.Scheme != "https" && !(dev && u.Scheme == "http" && isLocalhost(u.Hostname())) {
		return nil, errors.New("HTTPS is required (HTTP localhost requires explicit development option)")
	}
	return u, nil
}
func origin(u *url.URL) string { return strings.ToLower(u.Scheme + "://" + u.Host) }
func allowedOrigins(issuer *url.URL, extras []string, dev bool) (map[string]bool, error) {
	out := map[string]bool{origin(issuer): true}
	for _, raw := range extras {
		u, err := validateRemoteURL(raw, dev)
		if err != nil {
			return nil, fmt.Errorf("oauthrs: invalid allowed JWKS origin: %w", err)
		}
		if u.Path != "" && u.Path != "/" {
			return nil, errors.New("oauthrs: allowed JWKS origins must not contain paths")
		}
		out[origin(u)] = true
	}
	return out, nil
}
func isLocalhost(host string) bool {
	return strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".localhost") || net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback()
}
func forbiddenIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified()
}

func secureHTTPClient(timeout time.Duration, _ int64, allow map[string]bool, dev bool) *http.Client {
	dialer := &net.Dialer{Timeout: timeout}
	tr := &http.Transport{DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if forbiddenIP(ip) && !(dev && isLocalhost(host) && ip.IsLoopback()) {
				return nil, fmt.Errorf("blocked non-public address for %s", host)
			}
		}
		if len(ips) == 0 {
			return nil, errors.New("host resolved to no addresses")
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}}
	return &http.Client{Timeout: timeout, Transport: tr, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errors.New("too many redirects")
		}
		u, err := validateRemoteURL(req.URL.String(), dev)
		if err != nil {
			return err
		}
		if !allow[origin(u)] {
			return errors.New("redirect target origin is not allowlisted")
		}
		return nil
	}}
}
