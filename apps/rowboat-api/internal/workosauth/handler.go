// Package workosauth brokers the desktop's sign-in against WorkOS AuthKit.
//
// WorkOS is a confidential OAuth client: the authorization-code → token
// exchange must be presented with the WorkOS API key as the client secret,
// which a desktop app cannot hold. So the desktop performs the browser
// authorize + PKCE itself, then hands the resulting code to this broker, which
// completes the exchange server-side (holding the key) and returns the token
// bundle. Refresh is brokered the same way. This folds the old Ory-Hydra +
// oauth-consent broker into rowboat-api. See apps/rowboat-api/AUTH.md.
package workosauth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
	"golang.org/x/sync/singleflight"
)

// Handler serves the WorkOS sign-in broker endpoints. All endpoints are public
// (the caller has no bearer yet); the credential is the WorkOS code/refresh
// token plus the server-held API key.
type Handler struct {
	clientID string
	apiKey   string // WorkOS API key — presented to WorkOS as the client secret
	baseURL  string // WorkOS API base for server-side calls (https://api.workos.com)
	authBase string // base for the browser authorize URL; usually == baseURL
	http     *outbound.Client
	log      *zap.Logger

	// Refresh dedup (optional, via SetRefreshDedup). WorkOS refresh tokens are
	// rotating and single-use: without dedup, a duplicate or replayed refresh
	// (concurrent caller, retry after a 429, lost response) consumes the
	// rotated token upstream and permanently burns the desktop session.
	cache  RefreshCache
	sealer *crypto.Sealer
	sf     singleflight.Group
}

// New builds the broker. baseURL empty → https://api.workos.com. authorizeBaseURL
// empty → baseURL; it differs from baseURL only when the browser-reachable host
// differs from the server-reachable host (e.g. the local docker devstack split).
func New(clientID, apiKey, baseURL, authorizeBaseURL string, log *zap.Logger) *Handler {
	if baseURL == "" {
		baseURL = "https://api.workos.com"
	}
	if authorizeBaseURL == "" {
		authorizeBaseURL = baseURL
	}
	return &Handler{
		clientID: clientID,
		apiKey:   apiKey,
		baseURL:  strings.TrimRight(baseURL, "/"),
		authBase: strings.TrimRight(authorizeBaseURL, "/"),
		http: outbound.NewClient(outbound.Policy{
			Name:                  "workos",
			Timeout:               15 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
			MaxConcurrent:         64,
			MaxResponseBytes:      1 << 20,
		}),
		log: log,
	}
}

// SetOutboundPolicy applies the shared outbound vendor policy.
func (h *Handler) SetOutboundPolicy(policy outbound.Policy) {
	policy.Name = "workos"
	h.http = outbound.NewClient(policy)
}

// SetRefreshDedup enables idempotent refresh: results are cached for a short
// TTL keyed by SHA-256 of the refresh token, concurrent refreshes of the same
// token are collapsed (in-process singleflight + cross-replica lock), and
// replays of a consumed token return the cached rotated bundle instead of
// burning the session with invalid_grant.
//
// The sealer is mandatory for any shared (Redis) cache: cached values contain
// live rotated tokens and are AES-GCM sealed with the same key protecting
// OAuth tokens in Postgres. Passing a nil sealer disables result caching but
// keeps the concurrency collapse.
func (h *Handler) SetRefreshDedup(cache RefreshCache, sealer *crypto.Sealer) {
	h.cache = cache
	h.sealer = sealer
}

// configured reports whether WorkOS credentials are present.
func (h *Handler) configured() bool { return h.clientID != "" && h.apiKey != "" }

// tokenBundle is the desktop-facing token shape (snake_case to match the
// desktop's stored OAuthTokens). expires_at is seconds-since-epoch.
type tokenBundle struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresAt    int64  `json:"expires_at"`
	TokenType    string `json:"token_type"`
	UserID       string `json:"user_id,omitempty"`
	Email        string `json:"email,omitempty"`
}

// knownAuthKitProviders are the AuthKit `provider` values we allow callers to
// request. "authkit" is the hosted picker; the rest jump straight to that
// social identity provider (the connection must be enabled in WorkOS).
var knownAuthKitProviders = map[string]bool{
	"authkit":        true,
	"GoogleOAuth":    true,
	"MicrosoftOAuth": true,
	"GitHubOAuth":    true,
	"AppleOAuth":     true,
}

// resolveProvider validates a requested provider, defaulting to the hosted
// AuthKit picker for empty or unrecognized values.
func resolveProvider(requested string) string {
	if knownAuthKitProviders[requested] {
		return requested
	}
	return "authkit"
}

// LoginURL handles GET /v1/auth/workos/login-url. It returns the WorkOS AuthKit
// authorization URL for the desktop to open in the browser, keeping WorkOS's
// endpoint layout server-side. Required query params: redirect_uri, state.
// Optional: code_challenge (PKCE S256), provider (AuthKit provider, default
// "authkit").
func (h *Handler) LoginURL(w http.ResponseWriter, r *http.Request) {
	if !h.configured() {
		httpx.Error(w, http.StatusBadGateway, "Sign-in is not available right now.", "provider_unconfigured")
		return
	}
	q := r.URL.Query()
	redirectURI := q.Get("redirect_uri")
	state := q.Get("state")
	if redirectURI == "" || state == "" {
		httpx.Error(w, http.StatusBadRequest, "redirect_uri and state are required", "bad_request")
		return
	}
	v := url.Values{}
	v.Set("response_type", "code")
	v.Set("client_id", h.clientID)
	v.Set("redirect_uri", redirectURI)
	v.Set("state", state)
	// provider selects the AuthKit experience: "authkit" (default) opens the
	// hosted picker; a specific value like "GoogleOAuth" jumps straight to that
	// identity provider. Callers opt in via ?provider=; unknown values fall back
	// to the hosted picker so a bad param can never wedge sign-in.
	v.Set("provider", resolveProvider(q.Get("provider")))
	if cc := q.Get("code_challenge"); cc != "" {
		v.Set("code_challenge", cc)
		v.Set("code_challenge_method", "S256")
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"url": h.authBase + "/user_management/authorize?" + v.Encode(),
	})
}

// Exchange handles POST /v1/auth/workos/exchange: it completes the
// authorization-code exchange with WorkOS using the server-held API key.
func (h *Handler) Exchange(w http.ResponseWriter, r *http.Request) {
	if !h.configured() {
		httpx.Error(w, http.StatusBadGateway, "Sign-in is not available right now.", "provider_unconfigured")
		return
	}
	var req struct {
		Code         string `json:"code"`
		CodeVerifier string `json:"codeVerifier"`
	}
	if !httpx.DecodeJSON(w, r, 1<<16, &req) {
		return // DecodeJSON already wrote the error response
	}
	if req.Code == "" {
		httpx.Error(w, http.StatusBadRequest, "missing code", "bad_request")
		return
	}
	payload := map[string]string{
		"client_id":     h.clientID,
		"client_secret": h.apiKey,
		"grant_type":    "authorization_code",
		"code":          req.Code,
	}
	if req.CodeVerifier != "" {
		payload["code_verifier"] = req.CodeVerifier
	}
	h.authenticate(w, r, payload)
}

// Refresh dedup tuning. The result TTL must cover a client retry after the
// rate-limit window (Retry-After tops out around 60s) and an app-restart
// replay, while bounding how long a live rotated bundle sits in the cache.
const (
	refreshResultTTL  = 90 * time.Second
	refreshInvalidTTL = 30 * time.Second
	refreshLockTTL    = 15 * time.Second
	refreshPollWait   = 5 * time.Second
)

// Refresh handles POST /v1/auth/workos/refresh.
func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	if !h.configured() {
		httpx.Error(w, http.StatusBadGateway, "Sign-in is not available right now.", "provider_unconfigured")
		return
	}
	var req struct {
		RefreshToken string `json:"refreshToken"`
	}
	if !httpx.DecodeJSON(w, r, 1<<16, &req) {
		return // DecodeJSON already wrote the error response
	}
	if req.RefreshToken == "" {
		httpx.Error(w, http.StatusBadRequest, "missing refreshToken", "bad_request")
		return
	}
	payload := map[string]string{
		"client_id":     h.clientID,
		"client_secret": h.apiKey,
		"grant_type":    "refresh_token",
		"refresh_token": req.RefreshToken,
	}
	if h.cache == nil {
		h.authenticate(w, r, payload)
		return
	}
	h.refreshDeduped(w, r, req.RefreshToken, payload)
}

type refreshResult struct {
	bundle *tokenBundle
	ae     *authError
	// inProgress: another replica holds the refresh lock and its result did
	// not appear within the poll window — caller should retry shortly.
	inProgress bool
}

func (h *Handler) refreshDeduped(w http.ResponseWriter, r *http.Request, refreshToken string, payload map[string]string) {
	sum := sha256.Sum256([]byte(refreshToken))
	key := hex.EncodeToString(sum[:])
	resultKey := "workos:refresh:result:v1:" + key
	invalidKey := "workos:refresh:invalid:v1:" + key
	lockKey := "workos:refresh:lock:v1:" + key

	// Fast path: a completed refresh of this exact token within the TTL.
	if b, ok := h.cachedBundle(r.Context(), resultKey); ok {
		httpx.WriteJSON(w, http.StatusOK, *b)
		return
	}
	if h.cachedInvalid(r.Context(), invalidKey) {
		h.writeAuthError(w, &authError{kind: authErrInvalidGrant})
		return
	}

	v, _, _ := h.sf.Do(key, func() (any, error) {
		// Decoupled from the first caller's request context: a caller that
		// disconnects mid-flight must not abort the WorkOS rotation for the
		// waiters sharing this flight (a lost rotation is exactly the burn
		// this code exists to prevent).
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()

		owner, locked, err := h.cache.TryLock(ctx, lockKey, refreshLockTTL)
		if err != nil {
			h.log.Warn("workos refresh lock unavailable; proceeding uncoordinated", zap.Error(err))
		} else if locked {
			stopRenewal := keepRefreshLease(ctx, cancel, h.cache, lockKey, owner, refreshLockTTL, h.log)
			defer stopRenewal()
			defer func() { _ = h.cache.Unlock(context.Background(), lockKey, owner) }()
		}

		if err == nil && !locked {
			// Another replica is refreshing this token: wait for its result.
			deadline := time.Now().Add(refreshPollWait)
			for time.Now().Before(deadline) {
				if b, ok := h.cachedBundle(ctx, resultKey); ok {
					return refreshResult{bundle: b}, nil
				}
				if h.cachedInvalid(ctx, invalidKey) {
					return refreshResult{ae: &authError{kind: authErrInvalidGrant}}, nil
				}
				select {
				case <-ctx.Done():
					return refreshResult{inProgress: true}, nil
				case <-time.After(100 * time.Millisecond):
				}
			}
			return refreshResult{inProgress: true}, nil
		}

		// Re-check after acquiring the lock: a sibling may have completed
		// between our cache miss and the lock grant.
		if b, ok := h.cachedBundle(ctx, resultKey); ok {
			return refreshResult{bundle: b}, nil
		}
		if h.cachedInvalid(ctx, invalidKey) {
			return refreshResult{ae: &authError{kind: authErrInvalidGrant}}, nil
		}
		if locked && !h.refreshLeaseOwned(ctx, lockKey, owner) {
			return refreshResult{inProgress: true}, nil
		}

		bundle, ae := h.callWorkOS(ctx, payload)
		if locked && !h.refreshLeaseOwned(ctx, lockKey, owner) {
			return refreshResult{inProgress: true}, nil
		}
		switch {
		case ae == nil:
			h.storeBundle(ctx, resultKey, bundle)
		case ae.kind == authErrInvalidGrant:
			// Negative marker (no secret material): replays short-circuit
			// without another WorkOS round-trip.
			if err := h.cache.Set(ctx, invalidKey, []byte("1"), refreshInvalidTTL); err != nil {
				h.log.Warn("workos refresh negative-cache write failed", zap.Error(err))
			}
		}
		return refreshResult{bundle: bundle, ae: ae}, nil
	})

	res, ok := v.(refreshResult)
	if !ok {
		httpx.Error(w, http.StatusInternalServerError, "refresh dedup failed", "internal_error")
		return
	}
	switch {
	case res.inProgress:
		w.Header().Set("Retry-After", "2")
		httpx.Error(w, http.StatusTooManyRequests, "refresh in progress; retry shortly", "refresh_in_progress")
	case res.ae != nil:
		h.writeAuthError(w, res.ae)
	default:
		httpx.WriteJSON(w, http.StatusOK, *res.bundle)
	}
}

func (h *Handler) refreshLeaseOwned(ctx context.Context, key, owner string) bool {
	owned, err := h.cache.Renew(ctx, key, owner, refreshLockTTL)
	if err != nil || !owned {
		h.log.Warn("workos refresh lock ownership lost", zap.Bool("still_owner", owned), zap.Error(err))
		return false
	}
	return true
}

func keepRefreshLease(ctx context.Context, cancel context.CancelFunc, cache RefreshCache, key, owner string, ttl time.Duration, log *zap.Logger) func() {
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(ttl / 3)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				owned, err := cache.Renew(ctx, key, owner, ttl)
				if err != nil || !owned {
					log.Warn("workos refresh lock renewal failed", zap.Bool("still_owner", owned), zap.Error(err))
					cancel()
					return
				}
			}
		}
	}()
	return func() {
		close(stop)
		<-done
	}
}

// cachedBundle returns a previously sealed+cached bundle, treating any unseal
// or decode failure as a miss.
func (h *Handler) cachedBundle(ctx context.Context, resultKey string) (*tokenBundle, bool) {
	if h.sealer == nil {
		return nil, false
	}
	sealed, ok, err := h.cache.Get(ctx, resultKey)
	if err != nil || !ok {
		return nil, false
	}
	raw, err := h.sealer.Open(sealed)
	if err != nil {
		return nil, false
	}
	var b tokenBundle
	if err := json.Unmarshal(raw, &b); err != nil {
		return nil, false
	}
	return &b, true
}

func (h *Handler) cachedInvalid(ctx context.Context, invalidKey string) bool {
	_, ok, err := h.cache.Get(ctx, invalidKey)
	return err == nil && ok
}

// storeBundle seals and caches a successful refresh result. Never written in
// plaintext: the bundle holds a live rotated refresh token.
func (h *Handler) storeBundle(ctx context.Context, resultKey string, b *tokenBundle) {
	if h.sealer == nil {
		return
	}
	raw, err := json.Marshal(b)
	if err != nil {
		return
	}
	sealed, err := h.sealer.Seal(raw)
	if err != nil {
		h.log.Warn("workos refresh result seal failed; not caching", zap.Error(err))
		return
	}
	if err := h.cache.Set(ctx, resultKey, sealed, refreshResultTTL); err != nil {
		h.log.Warn("workos refresh result cache write failed", zap.Error(err))
	}
}

type authErrKind int

const (
	authErrUpstream authErrKind = iota
	authErrInvalidGrant
	authErrInternal
)

type authError struct {
	kind authErrKind
	msg  string
}

// authenticate posts to WorkOS and writes the bundle or the mapped error —
// the direct (non-deduped) path used by Exchange and cache-less Refresh.
func (h *Handler) authenticate(w http.ResponseWriter, r *http.Request, payload map[string]string) {
	bundle, ae := h.callWorkOS(r.Context(), payload)
	if ae != nil {
		h.writeAuthError(w, ae)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, *bundle)
}

func (h *Handler) writeAuthError(w http.ResponseWriter, ae *authError) {
	switch ae.kind {
	case authErrInvalidGrant:
		// This string is rendered verbatim to the user by the desktop. It must
		// name neither the identity provider nor the OAuth error that produced
		// it: "WorkOS reports invalid_grant" told people which vendor we use and
		// nothing they could act on. The machine-readable code carries the
		// meaning for clients; the prose carries it for humans.
		httpx.ErrorWith(w, http.StatusConflict,
			"Your session expired. Please sign in again.",
			"reconnect_required",
			map[string]any{"reconnectRequired": true})
	case authErrInternal:
		msg := ae.msg
		if msg == "" {
			msg = "internal error"
		}
		httpx.Error(w, http.StatusInternalServerError, msg, "internal_error")
	default:
		msg := ae.msg
		if msg == "" {
			msg = "workos authenticate failed"
		}
		httpx.Error(w, http.StatusBadGateway, msg, "upstream_error")
	}
}

// callWorkOS posts to WorkOS's /user_management/authenticate and translates
// the response into the desktop token bundle or a classified error.
func (h *Handler) callWorkOS(ctx context.Context, payload map[string]string) (*tokenBundle, *authError) {
	body, _ := json.Marshal(payload)
	upReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		h.baseURL+"/user_management/authenticate", strings.NewReader(string(body)))
	if err != nil {
		return nil, &authError{kind: authErrInternal, msg: "could not build request"}
	}
	upReq.Header.Set("Content-Type", "application/json")

	resp, err := h.http.Do(upReq)
	if err != nil {
		h.log.Warn("workos authenticate upstream error", zap.Error(err))
		return nil, &authError{kind: authErrUpstream, msg: "workos authenticate failed"}
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := outbound.ReadAll(resp.Body, h.http.MaxResponseBytes())
	if err != nil {
		h.log.Warn("workos authenticate response read failed", zap.Error(err))
		return nil, &authError{kind: authErrUpstream, msg: "workos authenticate failed"}
	}

	if resp.StatusCode != http.StatusOK {
		var werr struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(raw, &werr)
		if werr.Error == "invalid_grant" {
			return nil, &authError{kind: authErrInvalidGrant}
		}
		h.log.Warn("workos authenticate non-200", zap.Int("status", resp.StatusCode))
		return nil, &authError{kind: authErrUpstream, msg: "workos authenticate failed"}
	}

	var wr struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		User         struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"user"`
	}
	if err := json.Unmarshal(raw, &wr); err != nil || wr.AccessToken == "" {
		return nil, &authError{kind: authErrUpstream, msg: "malformed workos response"}
	}

	return &tokenBundle{
		AccessToken:  wr.AccessToken,
		RefreshToken: wr.RefreshToken,
		ExpiresAt:    accessTokenExpiry(wr.AccessToken),
		TokenType:    "Bearer",
		UserID:       wr.User.ID,
		Email:        wr.User.Email,
	}, nil
}

// accessTokenExpiry reads the `exp` claim from a WorkOS access token (a JWT)
// without verifying it — verification happens on every API call via the JWKS.
// Falls back to a conservative 5 minutes if the token can't be parsed.
func accessTokenExpiry(token string) int64 {
	parser := jwt.NewParser()
	var claims jwt.RegisteredClaims
	if _, _, err := parser.ParseUnverified(token, &claims); err == nil && claims.ExpiresAt != nil {
		return claims.ExpiresAt.Unix()
	}
	return time.Now().Add(5 * time.Minute).Unix()
}
