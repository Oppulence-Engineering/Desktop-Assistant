// Command devstack is a DEV-ONLY support service for local end-to-end testing.
// It is NOT for production. It stands in for WorkOS AuthKit (the OIDC IdP the
// desktop signs into — see AUTH.md) and the LLM/Google vendors, so the
// desktop's real OAuth sign-in flow and the LLM gateway can be exercised
// end-to-end without external services. It serves:
//
//	GET  /.well-known/openid-configuration       — OIDC discovery
//	GET  /.well-known/jwks.json                  — JWKS for the signing key
//	POST /oauth2/register                        — Dynamic Client Registration (RFC 7591)
//	GET  /authorize                              — auto-approves, redirects with a code (PKCE)
//	POST /oauth2/token                           — authorization_code + refresh_token grants
//	GET  /mint?workos_user_id=...&workos_org_id=... — shortcut: mint a token directly (curl tests)
//	POST /chat/completions, /v1/chat/completions — mock OpenAI-compatible chat LLM (SSE + usage)
//	POST /completions, /v1/completions           — mock OpenAI-compatible legacy completions
//	POST /embeddings, /v1/embeddings             — mock OpenAI-compatible embeddings
//	POST /v1/google-oauth-mock/token             — mock Google token endpoint (refresh)
//
// All tokens are RS256-signed by an ephemeral key; the JWKS is published so
// rowboat-api (and the desktop's openid-client) can verify them.
package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// kid is derived from the signing key rather than fixed.
//
// devstack mints a fresh RSA key on every start, and a constant kid made that
// invisible to callers: the resource server refreshes its JWKS on an UNKNOWN
// kid, so a stable kid meant it kept using the cached, now-wrong key and
// rejected every freshly minted token until the API itself was restarted.
// Restarting devstack silently logged the whole stack out. Deriving the kid from
// the key means a new key announces itself and the kid-miss refresh fires.
var kid string

var (
	signKey  *rsa.PrivateKey
	issuer   string
	audience string

	authCodes   sync.Map // code -> authCode
	refreshDB   sync.Map // refresh_token -> session
	hydraDB     sync.Map // consent challenge -> hydraConsent
	oauthFaults = newOAuthFaultController()
)

var routeTaskIDRe = regexp.MustCompile(`(?m)^\d+\.\s+id:\s+([^\n]+)`)

type authCode struct {
	challenge   string
	redirectURI string
	clientID    string
	audience    string
	scope       string
	sub         string
	email       string
	nonce       string
	amr         []string
	acr         string
	expires     time.Time
}

type hydraConsent struct {
	challenge   string
	clientID    string
	redirectURI string
	audience    []string
	scopes      []string
	state       string
	subject     string
	email       string
	pkce        string
	expires     time.Time
}

type session struct {
	sub      string
	email    string
	clientID string
	audience string
	scope    string
}

type oauthRefreshFaultPlan struct {
	ID                       string `json:"id"`
	HoldBeforeResponse       bool   `json:"hold_before_response,omitempty"`
	AfterResponseURL         string `json:"after_response_url,omitempty"`
	AfterResponseSecret      string `json:"after_response_secret,omitempty"`
	SignalPID                int    `json:"signal_pid,omitempty"`
	ProviderRefreshSemantics string `json:"provider_refresh_semantics,omitempty"`
}

type oauthRefreshFaultRuntime struct {
	plan           oauthRefreshFaultPlan
	entered        bool
	oldConsumed    bool
	rotatedIssued  bool
	responseSent   bool
	postActionDone bool
	release        chan struct{}
	releaseOnce    sync.Once
}

type oauthFaultController struct {
	mu           sync.Mutex
	plans        []*oauthRefreshFaultRuntime
	refreshCalls int
	revokeCalls  int
	revokeFail   bool
}

type oauthFaultConfig struct {
	Reset        bool                    `json:"reset,omitempty"`
	RevokeFail   *bool                   `json:"revoke_fail,omitempty"`
	RefreshPlans []oauthRefreshFaultPlan `json:"refresh_plans,omitempty"`
}

type oauthRefreshFaultStatus struct {
	ID                       string `json:"id"`
	ProviderRefreshSemantics string `json:"provider_refresh_semantics,omitempty"`
	Entered                  bool   `json:"entered"`
	OldTokenConsumed         bool   `json:"old_token_consumed"`
	RotatedTokenIssued       bool   `json:"rotated_token_issued"`
	ResponseSent             bool   `json:"response_sent"`
	PostActionDone           bool   `json:"post_action_done"`
}

const (
	providerRefreshSemanticsMultiUseRotating    = "multi_use_rotating"
	providerRefreshSemanticsOneUseNonIdempotent = "one_use_non_idempotent"
)

type oauthFaultStatus struct {
	RefreshCalls int                       `json:"refresh_calls"`
	RevokeCalls  int                       `json:"revoke_calls"`
	RevokeFail   bool                      `json:"revoke_fail"`
	Plans        []oauthRefreshFaultStatus `json:"plans"`
}

func newOAuthFaultController() *oauthFaultController {
	return &oauthFaultController{}
}

func main() {
	addr := getenv("ADDR", ":8090")
	issuer = getenv("ISSUER", "http://localhost:8090")
	audience = getenv("AUDIENCE", "rowboat-api")

	key, err := devSigningKey()
	if err != nil {
		log.Fatal(err)
	}
	signKey = key
	kid = keyThumbprint(&key.PublicKey)

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/jwks.json", handleJWKS)
	mux.HandleFunc("/.well-known/openid-configuration", handleDiscovery)
	mux.HandleFunc("/oauth2/register", handleRegister)
	mux.HandleFunc("/authorize", handleAuthorize)
	// Hydra exposes the authorization endpoint at /oauth2/auth. Keep /authorize
	// for OIDC desktop tests and serve the same deterministic fixture behavior
	// at the broker path used by the connector suite.
	mux.HandleFunc("/oauth2/auth", handleAuthorize)
	mux.HandleFunc("/oauth2/token", handleToken)
	mux.HandleFunc("/oauth2/revoke", handleRevoke)
	if strings.TrimSpace(os.Getenv("DEVSTACK_FIXTURE_SECRET")) != "" {
		mux.HandleFunc("/fixture/oauth-faults", handleOAuthFaults)
		mux.HandleFunc("/fixture/oauth-faults/release", handleOAuthFaultRelease)
	}
	mux.HandleFunc("/admin/oauth2/auth/requests/consent", handleHydraConsentRequest)
	mux.HandleFunc("/admin/oauth2/auth/requests/consent/accept", handleHydraConsentAccept)
	mux.HandleFunc("/admin/oauth2/auth/requests/consent/reject", handleHydraConsentReject)
	mux.HandleFunc("/mint", handleMint)
	// WorkOS AuthKit mock (confidential): authorize reuses the OIDC code path;
	// authenticate is WorkOS's proprietary, secret-required token exchange.
	mux.HandleFunc("/user_management/authorize", handleAuthorize)
	mux.HandleFunc("/user_management/authenticate", handleWorkOSAuthenticate)
	mux.HandleFunc("/chat/completions", mockChatCompletions)
	mux.HandleFunc("/v1/chat/completions", mockChatCompletions)
	mux.HandleFunc("/completions", mockCompletions)
	mux.HandleFunc("/v1/completions", mockCompletions)
	mux.HandleFunc("/embeddings", mockEmbeddings)
	mux.HandleFunc("/v1/embeddings", mockEmbeddings)
	mux.HandleFunc("/v1/google-oauth-mock/token", handleGoogleTokenMock)
	// Google OAuth consent mock: auto-approves and redirects back with a code.
	mux.HandleFunc("/o/oauth2/v2/auth", handleGoogleAuthorizeMock)
	// Gmail API mock, reached by pointing the desktop's googleapis client at
	// this origin via its rootUrl option. See gmail.go.
	registerGmailMock(mux)

	log.Printf("devstack OIDC+mock listening on %s (issuer=%s aud=%s)", addr, issuer, audience)
	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	if cert, key := strings.TrimSpace(os.Getenv("TLS_CERT_FILE")), strings.TrimSpace(os.Getenv("TLS_KEY_FILE")); cert != "" || key != "" {
		if cert == "" || key == "" {
			log.Fatal("TLS_CERT_FILE and TLS_KEY_FILE must be configured together")
		}
		log.Fatal(srv.ListenAndServeTLS(cert, key))
	}
	log.Fatal(srv.ListenAndServe())
}

// --- OIDC ------------------------------------------------------------------

func handleJWKS(w http.ResponseWriter, _ *http.Request) {
	n := base64.RawURLEncoding.EncodeToString(signKey.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(signKey.E)).Bytes())
	writeJSON(w, map[string]any{"keys": []map[string]string{
		{"kty": "RSA", "use": "sig", "alg": "RS256", "kid": kid, "n": n, "e": e},
	}})
}

func handleDiscovery(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]any{
		"issuer":                                         issuer,
		"authorization_endpoint":                         issuer + "/authorize",
		"token_endpoint":                                 issuer + "/oauth2/token",
		"jwks_uri":                                       issuer + "/.well-known/jwks.json",
		"registration_endpoint":                          issuer + "/oauth2/register",
		"response_types_supported":                       []string{"code"},
		"grant_types_supported":                          []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":               []string{"S256"},
		"token_endpoint_auth_methods_supported":          []string{"none", "client_secret_post"},
		"scopes_supported":                               []string{"openid", "email", "profile", "offline_access"},
		"subject_types_supported":                        []string{"public"},
		"id_token_signing_alg_values_supported":          []string{"RS256"},
		"claims_supported":                               []string{"sub", "email", "iss", "aud", "exp", "iat"},
		"authorization_response_iss_parameter_supported": true,
	})
}

// handleRegister implements minimal Dynamic Client Registration: it echoes the
// requested metadata with a generated client_id (used only if the desktop is in
// DCR mode; the static-client path skips this).
func handleRegister(w http.ResponseWriter, r *http.Request) {
	var meta map[string]any
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	_ = json.Unmarshal(body, &meta)
	if meta == nil {
		meta = map[string]any{}
	}
	meta["client_id"] = "rowboat-desktop-dcr"
	meta["client_id_issued_at"] = 0
	meta["token_endpoint_auth_method"] = "none"
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(meta)
}

// handleAuthorize auto-approves (no login UI) and redirects back to the client
// with an authorization code bound to the PKCE challenge.
func handleAuthorize(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	redirectURI := q.Get("redirect_uri")
	if redirectURI == "" {
		http.Error(w, "missing redirect_uri", http.StatusBadRequest)
		return
	}
	if r.URL.Path == "/oauth2/auth" && strings.TrimSpace(os.Getenv("HYDRA_CONSENT_URL")) != "" {
		challenge, _ := randomToken(24)
		scope := strings.Fields(def(q.Get("scope"), "openid email profile"))
		aud := strings.Fields(q.Get("audience"))
		if len(aud) == 0 {
			aud = []string{audience}
		}
		hydraDB.Store(challenge, hydraConsent{
			challenge: challenge, clientID: q.Get("client_id"), redirectURI: redirectURI,
			audience: aud, scopes: scope, state: q.Get("state"),
			subject: getenv("FIXTURE_SUBJECT", "user_rfc012_a"), email: getenv("FIXTURE_EMAIL", "a@example.test"),
			pkce: q.Get("code_challenge"), expires: time.Now().Add(5 * time.Minute),
		})
		u, _ := url.Parse(strings.TrimRight(os.Getenv("HYDRA_CONSENT_URL"), "/") + "/consent")
		qq := u.Query()
		qq.Set("consent_challenge", challenge)
		u.RawQuery = qq.Encode()
		http.Redirect(w, r, u.String(), http.StatusFound)
		return
	}
	code, _ := randomToken(24)
	scope := def(q.Get("scope"), "openid email profile")
	if q.Get("fixture_scope_escalation") == "true" {
		scope = strings.TrimSpace(scope + " dev:admin.write")
	}
	authCodes.Store(code, authCode{
		challenge:   q.Get("code_challenge"),
		redirectURI: redirectURI,
		clientID:    q.Get("client_id"),
		audience:    def(q.Get("audience"), audience),
		scope:       scope,
		sub:         getenv("FIXTURE_SUBJECT", "user_dev_1"),
		email:       getenv("FIXTURE_EMAIL", "dev@solomon-ai.co"),
		nonce:       q.Get("nonce"),
		amr:         workOSAMR(q),
		acr:         q.Get("acr_values"),
		expires:     time.Now().Add(5 * time.Minute),
	})

	u, err := url.Parse(redirectURI)
	if err != nil {
		http.Error(w, "bad redirect_uri", http.StatusBadRequest)
		return
	}
	rq := u.Query()
	rq.Set("code", code)
	if s := q.Get("state"); s != "" {
		rq.Set("state", s)
	}
	rq.Set("iss", issuer) // RFC 9207 (advertised in discovery)
	u.RawQuery = rq.Encode()
	http.Redirect(w, r, u.String(), http.StatusFound)
}

func workOSAMR(q url.Values) []string {
	if q.Get("acr_values") != "" || q.Get("prompt") == "login" {
		return []string{"pwd", "mfa"}
	}
	return []string{"pwd"}
}

func handleHydraConsentRequest(w http.ResponseWriter, r *http.Request) {
	challenge := r.URL.Query().Get("consent_challenge")
	v, ok := hydraDB.Load(challenge)
	if !ok {
		http.Error(w, "unknown consent challenge", http.StatusNotFound)
		return
	}
	h := v.(hydraConsent)
	writeJSON(w, map[string]any{"skip": false, "subject": h.subject, "challenge": h.challenge,
		"requested_scope": h.scopes, "requested_access_token_audience": h.audience,
		"client": map[string]string{"client_id": h.clientID}})
}

func handleHydraConsentAccept(w http.ResponseWriter, r *http.Request) {
	challenge := r.URL.Query().Get("consent_challenge")
	v, ok := hydraDB.LoadAndDelete(challenge)
	if !ok {
		http.Error(w, "unknown consent challenge", http.StatusNotFound)
		return
	}
	h := v.(hydraConsent)
	if time.Now().After(h.expires) {
		http.Error(w, "expired consent challenge", http.StatusGone)
		return
	}
	var body struct {
		GrantScope    []string `json:"grant_scope"`
		GrantAudience []string `json:"grant_access_token_audience"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body)
	code, _ := randomToken(24)
	authCodes.Store(code, authCode{challenge: h.pkce, redirectURI: h.redirectURI, clientID: h.clientID,
		audience: strings.Join(body.GrantAudience, " "), scope: strings.Join(body.GrantScope, " "),
		sub: h.subject, email: h.email, expires: time.Now().Add(5 * time.Minute)})
	u, err := url.Parse(h.redirectURI)
	if err != nil {
		http.Error(w, "bad redirect", 500)
		return
	}
	q := u.Query()
	q.Set("code", code)
	q.Set("state", h.state)
	q.Set("iss", issuer)
	u.RawQuery = q.Encode()
	writeJSON(w, map[string]string{"redirect_to": u.String()})
}

func handleHydraConsentReject(w http.ResponseWriter, r *http.Request) {
	challenge := r.URL.Query().Get("consent_challenge")
	v, ok := hydraDB.LoadAndDelete(challenge)
	if !ok {
		http.Error(w, "unknown consent challenge", http.StatusNotFound)
		return
	}
	h := v.(hydraConsent)
	u, _ := url.Parse(h.redirectURI)
	q := u.Query()
	q.Set("error", "access_denied")
	q.Set("state", h.state)
	u.RawQuery = q.Encode()
	writeJSON(w, map[string]string{"redirect_to": u.String()})
}

func handleToken(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	switch r.Form.Get("grant_type") {
	case "authorization_code":
		tokenFromCode(w, r)
	case "refresh_token":
		tokenFromRefresh(w, r)
	default:
		tokenError(w, "unsupported_grant_type")
	}
}

func handleRevoke(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	if oauthFaults.recordRevoke() {
		http.Error(w, "injected provider revoke failure", http.StatusServiceUnavailable)
		return
	}
	if token := strings.TrimSpace(r.Form.Get("token")); token != "" {
		refreshDB.Delete(token)
	}
	w.WriteHeader(http.StatusOK)
}

func tokenFromCode(w http.ResponseWriter, r *http.Request) {
	code := r.Form.Get("code")
	v, ok := authCodes.LoadAndDelete(code)
	if !ok {
		tokenError(w, "invalid_grant")
		return
	}
	ac := v.(authCode)
	if time.Now().After(ac.expires) {
		tokenError(w, "invalid_grant")
		return
	}
	if ac.redirectURI != r.Form.Get("redirect_uri") {
		tokenError(w, "invalid_grant")
		return
	}
	// PKCE S256 verification.
	if ac.challenge != "" {
		sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
		if base64.RawURLEncoding.EncodeToString(sum[:]) != ac.challenge {
			tokenError(w, "invalid_grant")
			return
		}
	}
	rt, _ := randomToken(32)
	refreshDB.Store(rt, session{sub: ac.sub, email: ac.email, clientID: ac.clientID, audience: ac.audience, scope: ac.scope})
	writeTokenResponse(w, ac.sub, ac.email, ac.clientID, ac.audience, ac.scope, ac.nonce, rt, ac.amr, ac.acr)
}

func tokenFromRefresh(w http.ResponseWriter, r *http.Request) {
	rt := r.Form.Get("refresh_token")
	plan := oauthFaults.nextRefresh()
	if plan != nil {
		plan.markEntered()
	}
	if plan != nil && plan.plan.HoldBeforeResponse {
		select {
		case <-plan.release:
		case <-r.Context().Done():
			return
		}
	}
	var s session
	rotated := rt
	switch {
	case plan != nil && plan.plan.ProviderRefreshSemantics == providerRefreshSemanticsOneUseNonIdempotent:
		var ok bool
		s, rotated, ok = rotateRefreshToken(rt)
		if !ok {
			tokenError(w, "invalid_grant")
			return
		}
		plan.markRotated()
	case plan != nil && plan.plan.ProviderRefreshSemantics == providerRefreshSemanticsMultiUseRotating:
		var ok bool
		s, rotated, ok = issueRefreshToken(rt)
		if !ok {
			tokenError(w, "invalid_grant")
			return
		}
		plan.markRotationIssued()
	default:
		value, ok := refreshDB.Load(rt)
		if !ok {
			tokenError(w, "invalid_grant")
			return
		}
		s = value.(session)
	}
	if plan == nil {
		writeTokenResponse(w, s.sub, s.email, s.clientID, s.audience, s.scope, "", rotated, nil, "")
		return
	}
	raw, err := json.Marshal(tokenResponse(s.sub, s.email, s.clientID, s.audience, s.scope, "", rotated, nil, ""))
	if err != nil {
		http.Error(w, "encode token response", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", strconv.Itoa(len(raw)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	plan.markResponseSent()
	plan.runPostAction()
}

func rotateRefreshToken(old string) (session, string, bool) {
	rotated, err := randomToken(32)
	if err != nil {
		return session{}, "", false
	}
	value, ok := refreshDB.LoadAndDelete(old)
	if !ok {
		return session{}, "", false
	}
	s := value.(session)
	refreshDB.Store(rotated, s)
	return s, rotated, true
}

func issueRefreshToken(source string) (session, string, bool) {
	value, ok := refreshDB.Load(source)
	if !ok {
		return session{}, "", false
	}
	rotated, err := randomToken(32)
	if err != nil {
		return session{}, "", false
	}
	s := value.(session)
	refreshDB.Store(rotated, s)
	return s, rotated, true
}

func writeTokenResponse(w http.ResponseWriter, sub, email, clientID, tokenAudience, scope, nonce, refreshToken string, amr []string, acr string) {
	writeJSON(w, tokenResponse(sub, email, clientID, tokenAudience, scope, nonce, refreshToken, amr, acr))
}

func tokenResponse(sub, email, clientID, tokenAudience, scope, nonce, refreshToken string, amr []string, acr string) map[string]any {
	access := signToken(jwt.MapClaims{
		"iss":   issuer,
		"aud":   def(tokenAudience, audience),
		"sub":   sub,
		"iat":   time.Now().Unix(),
		"exp":   time.Now().Add(time.Hour).Unix(),
		"scope": scope,
		"ext":   map[string]any{"workos_user_id": sub, "workos_org_id": "org_dev_1", "email": email},
	})
	idClaims := jwt.MapClaims{
		"iss":   issuer,
		"aud":   clientID,
		"sub":   sub,
		"iat":   time.Now().Unix(),
		"exp":   time.Now().Add(time.Hour).Unix(),
		"email": email,
	}
	if nonce != "" {
		idClaims["nonce"] = nonce
	}
	if len(amr) > 0 {
		idClaims["amr"] = amr
	}
	if acr != "" {
		idClaims["acr"] = acr
	}
	return map[string]any{
		"access_token":  access,
		"id_token":      signToken(idClaims),
		"refresh_token": refreshToken,
		"token_type":    "Bearer",
		"expires_in":    3600,
		"scope":         scope,
	}
}

func handleOAuthFaults(w http.ResponseWriter, r *http.Request) {
	if !authorizedFixtureRequest(w, r) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, oauthFaults.status())
	case http.MethodPost:
		var config oauthFaultConfig
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&config); err != nil {
			http.Error(w, "invalid fault config", http.StatusBadRequest)
			return
		}
		if err := oauthFaults.configure(config); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func handleOAuthFaultRelease(w http.ResponseWriter, r *http.Request) {
	if !authorizedFixtureRequest(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !oauthFaults.release(r.URL.Query().Get("id")) {
		http.Error(w, "unknown refresh plan", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func authorizedFixtureRequest(w http.ResponseWriter, r *http.Request) bool {
	secret := strings.TrimSpace(os.Getenv("DEVSTACK_FIXTURE_SECRET"))
	if secret == "" || r.Header.Get("X-Fixture-Secret") != secret {
		http.Error(w, "forbidden", http.StatusForbidden)
		return false
	}
	return true
}

func (c *oauthFaultController) configure(config oauthFaultConfig) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if config.Reset {
		c.plans = nil
		c.refreshCalls = 0
		c.revokeCalls = 0
		c.revokeFail = false
	}
	if config.RevokeFail != nil {
		c.revokeFail = *config.RevokeFail
	}
	for index, plan := range config.RefreshPlans {
		if plan.SignalPID > 0 && plan.ProviderRefreshSemantics != providerRefreshSemanticsOneUseNonIdempotent {
			return fmt.Errorf("signal_pid refresh plans require provider_refresh_semantics=%q", providerRefreshSemanticsOneUseNonIdempotent)
		}
		if strings.TrimSpace(plan.ID) == "" {
			plan.ID = fmt.Sprintf("refresh-%d", len(c.plans)+index+1)
		}
		c.plans = append(c.plans, &oauthRefreshFaultRuntime{plan: plan, release: make(chan struct{})})
	}
	return nil
}

func (c *oauthFaultController) nextRefresh() *oauthRefreshFaultRuntime {
	c.mu.Lock()
	defer c.mu.Unlock()
	index := c.refreshCalls
	c.refreshCalls++
	if index >= len(c.plans) {
		return nil
	}
	return c.plans[index]
}

func (c *oauthFaultController) recordRevoke() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.revokeCalls++
	return c.revokeFail
}

func (c *oauthFaultController) release(id string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, plan := range c.plans {
		if plan.plan.ID == id {
			plan.releaseOnce.Do(func() { close(plan.release) })
			return true
		}
	}
	return false
}

func (c *oauthFaultController) status() oauthFaultStatus {
	c.mu.Lock()
	defer c.mu.Unlock()
	status := oauthFaultStatus{RefreshCalls: c.refreshCalls, RevokeCalls: c.revokeCalls, RevokeFail: c.revokeFail}
	for _, plan := range c.plans {
		status.Plans = append(status.Plans, oauthRefreshFaultStatus{
			ID: plan.plan.ID, ProviderRefreshSemantics: plan.plan.ProviderRefreshSemantics,
			Entered: plan.entered, OldTokenConsumed: plan.oldConsumed, RotatedTokenIssued: plan.rotatedIssued,
			ResponseSent: plan.responseSent, PostActionDone: plan.postActionDone,
		})
	}
	return status
}

func (p *oauthRefreshFaultRuntime) markEntered() {
	oauthFaults.mu.Lock()
	p.entered = true
	oauthFaults.mu.Unlock()
}

func (p *oauthRefreshFaultRuntime) markRotated() {
	oauthFaults.mu.Lock()
	p.oldConsumed = true
	p.rotatedIssued = true
	oauthFaults.mu.Unlock()
}

func (p *oauthRefreshFaultRuntime) markRotationIssued() {
	oauthFaults.mu.Lock()
	p.rotatedIssued = true
	oauthFaults.mu.Unlock()
}

func (p *oauthRefreshFaultRuntime) markResponseSent() {
	oauthFaults.mu.Lock()
	p.responseSent = true
	oauthFaults.mu.Unlock()
}

func (p *oauthRefreshFaultRuntime) runPostAction() {
	if p.plan.AfterResponseURL != "" {
		req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, p.plan.AfterResponseURL, nil)
		if err == nil {
			req.Header.Set("X-Fixture-Secret", p.plan.AfterResponseSecret)
			client := &http.Client{Timeout: 5 * time.Second}
			if resp, doErr := client.Do(req); doErr == nil {
				_ = resp.Body.Close()
			}
		}
	}
	if p.plan.SignalPID > 0 {
		_ = syscall.Kill(p.plan.SignalPID, syscall.SIGSTOP)
	}
	oauthFaults.mu.Lock()
	p.postActionDone = true
	oauthFaults.mu.Unlock()
}

// handleWorkOSAuthenticate mocks WorkOS's POST /user_management/authenticate:
// a confidential, secret-required code/refresh exchange that returns a
// {user, access_token, refresh_token} bundle. The access_token reuses the
// devstack signing key (verified by rowboat-api against the JWKS).
func handleWorkOSAuthenticate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
		GrantType    string `json:"grant_type"`
		Code         string `json:"code"`
		CodeVerifier string `json:"code_verifier"`
		RefreshToken string `json:"refresh_token"`
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	_ = json.Unmarshal(body, &req)

	if req.ClientSecret == "" { // WorkOS is confidential — the API key is required.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_client", "error_description": "Invalid client secret."})
		return
	}

	var sub, email string
	switch req.GrantType {
	case "authorization_code":
		v, ok := authCodes.LoadAndDelete(req.Code)
		if !ok {
			tokenError(w, "invalid_grant")
			return
		}
		ac := v.(authCode)
		if time.Now().After(ac.expires) {
			tokenError(w, "invalid_grant")
			return
		}
		if ac.challenge != "" {
			sum := sha256.Sum256([]byte(req.CodeVerifier))
			if base64.RawURLEncoding.EncodeToString(sum[:]) != ac.challenge {
				tokenError(w, "invalid_grant")
				return
			}
		}
		sub, email = ac.sub, ac.email
	case "refresh_token":
		v, ok := refreshDB.Load(req.RefreshToken)
		if !ok {
			tokenError(w, "invalid_grant")
			return
		}
		s := v.(session)
		sub, email = s.sub, s.email
	default:
		tokenError(w, "unsupported_grant_type")
		return
	}

	rt, _ := randomToken(32)
	refreshDB.Store(rt, session{sub: sub, email: email, clientID: req.ClientID, scope: "openid email profile"})
	access := signToken(jwt.MapClaims{
		"iss":   issuer,
		"aud":   audience,
		"sub":   sub,
		"iat":   time.Now().Unix(),
		"exp":   time.Now().Add(time.Hour).Unix(),
		"scope": "openid email profile",
		"ext":   map[string]any{"workos_user_id": sub, "workos_org_id": "org_dev_1", "email": email},
	})
	writeJSON(w, map[string]any{
		"user":          map[string]string{"id": sub, "email": email},
		"access_token":  access,
		"refresh_token": rt,
	})
}

// --- mint shortcut (curl tests) -------------------------------------------

func handleMint(w http.ResponseWriter, r *http.Request) {
	workosID := def(r.URL.Query().Get("workos_user_id"), "user_dev_1")
	workosOrgID := def(r.URL.Query().Get("workos_org_id"), "org_dev_1")
	email := def(r.URL.Query().Get("email"), "dev@solomon-ai.co")
	token := signToken(jwt.MapClaims{
		"iss":   issuer,
		"aud":   audience,
		"sub":   workosID,
		"iat":   time.Now().Unix(),
		"exp":   time.Now().Add(time.Hour).Unix(),
		"scope": "openid email profile offline_access",
		"ext":   map[string]any{"workos_user_id": workosID, "workos_org_id": workosOrgID, "email": email},
	})
	writeJSON(w, map[string]string{"token": token})
}

// handleGoogleTokenMock stands in for Google's token endpoint so the backend's
// /v1/google-oauth/refresh + /oauth/google/callback succeed in dev. Returns a
// fake access + refresh token bundle.
func handleGoogleTokenMock(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]any{
		"access_token":  "ya29.mock-" + time.Now().Format("150405"),
		"refresh_token": "1//mock-refresh-" + time.Now().Format("150405"),
		"expires_in":    3600,
		"scope":         "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events.readonly",
		"token_type":    "Bearer",
	})
}

// handleGoogleAuthorizeMock stands in for Google's consent screen: it
// auto-approves and 302s back to redirect_uri with a code + the echoed state.
func handleGoogleAuthorizeMock(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	redirectURI := q.Get("redirect_uri")
	if redirectURI == "" {
		http.Error(w, "missing redirect_uri", http.StatusBadRequest)
		return
	}
	u, err := url.Parse(redirectURI)
	if err != nil {
		http.Error(w, "bad redirect_uri", http.StatusBadRequest)
		return
	}
	code, _ := randomToken(16)
	rq := u.Query()
	rq.Set("code", code)
	if s := q.Get("state"); s != "" {
		rq.Set("state", s)
	}
	u.RawQuery = rq.Encode()
	http.Redirect(w, r, u.String(), http.StatusFound)
}

// --- mock LLM --------------------------------------------------------------

func mockChatCompletions(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	var req struct {
		Model    string `json:"model"`
		Stream   bool   `json:"stream"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
		ResponseFormat *struct {
			Type string `json:"type"`
		} `json:"response_format"`
	}
	_ = json.Unmarshal(body, &req)
	usage := map[string]int{"prompt_tokens": 1200, "completion_tokens": 8, "total_tokens": 1208}
	content := "Hello from the mock LLM."
	if req.ResponseFormat != nil && req.ResponseFormat.Type == "json_object" {
		content = mockJSONCompletion(req.Messages)
	}

	if req.Stream {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flush, _ := w.(http.Flusher)
		for _, c := range []string{"Hello", " from", " the", " mock", " LLM."} {
			_, _ = io.WriteString(w, `data: {"id":"mock","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":`+jsonStr(c)+`}}]}`+"\n\n")
			if flush != nil {
				flush.Flush()
			}
		}
		final := map[string]any{
			"id": "mock", "object": "chat.completion.chunk",
			"choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": "stop"}},
			"usage":   usage,
		}
		fb, _ := json.Marshal(final)
		_, _ = io.WriteString(w, "data: "+string(fb)+"\n\ndata: [DONE]\n\n")
		if flush != nil {
			flush.Flush()
		}
		return
	}
	writeJSON(w, map[string]any{
		"id": "mock", "object": "chat.completion", "model": req.Model,
		"choices": []any{map[string]any{
			"index": 0, "finish_reason": "stop",
			"message": map[string]any{"role": "assistant", "content": content},
		}},
		"usage": usage,
	})
}

func mockCompletions(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	var req struct {
		Model  string `json:"model"`
		Prompt any    `json:"prompt"`
	}
	_ = json.Unmarshal(body, &req)
	writeJSON(w, map[string]any{
		"id":      "mock-completion",
		"object":  "text_completion",
		"created": time.Now().Unix(),
		"model":   req.Model,
		"choices": []any{map[string]any{
			"index":         0,
			"text":          "Hello from the mock completion.",
			"finish_reason": "stop",
		}},
		"usage": map[string]int{"prompt_tokens": 1200, "completion_tokens": 8, "total_tokens": 1208},
	})
}

// mockEmbeddings returns deterministic pseudo-embeddings.
//
// It used to answer every request with the same four numbers. That made the
// vector half of hybrid search inert locally — cosine similarity between any
// query and any document was exactly 1.0, so ranking fell back entirely to the
// text score and nobody could tell. It also returned 4 dimensions where callers
// expect the model's width, so a dimension bug would not show up either.
//
// These vectors carry no semantic meaning — a mock cannot — but they are
// DISCRIMINATIVE and STABLE: derived from the input bytes, so the same text
// always embeds the same way and different text embeds differently. That is
// enough to exercise ranking, dedup, cache hits, and the dimension contract.
func mockEmbeddings(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	var req struct {
		Model      string `json:"model"`
		Input      any    `json:"input"`
		Dimensions int    `json:"dimensions"`
	}
	_ = json.Unmarshal(body, &req)

	inputs := []string{""}
	switch v := req.Input.(type) {
	case string:
		inputs = []string{v}
	case []any:
		inputs = make([]string, 0, len(v))
		for _, item := range v {
			text, _ := item.(string)
			inputs = append(inputs, text)
		}
	}
	if len(inputs) == 0 {
		inputs = []string{""}
	}

	// dims is clamped to the model's native width, never taken on trust. It
	// arrives straight off the request body and sizes an allocation, so an
	// unbounded value ("dimensions": 1e9) would let any caller on the cluster
	// OOM devstack with one request. The real API also refuses to expand a
	// model past its own width, so clamping is the faithful behaviour rather
	// than a defensive deviation.
	width := mockEmbeddingDims(req.Model)
	dims := req.Dimensions
	if dims <= 0 || dims > width {
		dims = width
	}

	data := make([]any, 0, len(inputs))
	totalTokens := 0
	for i, text := range inputs {
		totalTokens += len(text)/4 + 1
		data = append(data, map[string]any{
			"object":    "embedding",
			"index":     i,
			"embedding": deterministicEmbedding(text, dims),
		})
	}
	writeJSON(w, map[string]any{
		"object": "list",
		"model":  req.Model,
		"data":   data,
		"usage":  map[string]int{"prompt_tokens": totalTokens, "total_tokens": totalTokens},
	})
}

// mockEmbeddingDims mirrors the real widths so a caller that hardcodes one
// notices a mismatch here rather than in production.
func mockEmbeddingDims(model string) int {
	switch {
	case strings.Contains(model, "text-embedding-3-large"):
		return 3072
	case strings.Contains(model, "embedding"):
		return 1536
	default:
		return 1536
	}
}

// maxEmbeddingDims is the widest vector this mock will allocate, a little above
// the widest real model (3072). It exists so the bound lives next to the
// allocation instead of only in the caller: dims originates in a request body,
// and a function that sizes a slice from a parameter should not depend on every
// present and future caller having checked it first.
const maxEmbeddingDims = 4096

// deterministicEmbedding hashes the input into a unit-length vector. Same text
// in, same vector out; different text, different direction.
func deterministicEmbedding(text string, dims int) []float64 {
	if dims < 0 {
		dims = 0
	}
	if dims > maxEmbeddingDims {
		dims = maxEmbeddingDims
	}
	sum := sha256.Sum256([]byte(text))
	// Capacity is the constant, not dims. Clamping dims first is enough to be
	// correct, but it leaves the allocation textually sized by a value that
	// began life in a request body — which static analysis flags, and which is
	// only safe for as long as the clamp above stays put. Sizing on the
	// constant makes the bound structural instead of a thing to remember.
	out := make([]float64, 0, maxEmbeddingDims)
	var norm float64
	for i := 0; i < dims; i++ {
		// Re-hash per block so the whole vector varies, not just the first 32.
		if i%32 == 0 && i > 0 {
			sum = sha256.Sum256(sum[:])
		}
		v := (float64(sum[i%32]) / 255.0) - 0.5
		out = append(out, v)
		norm += v * v
	}
	if norm > 0 {
		norm = math.Sqrt(norm)
		for i := range out {
			out[i] /= norm
		}
	}
	return out
}

func mockJSONCompletion(messages []struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}) string {
	var prompt strings.Builder
	for _, msg := range messages {
		if msg.Content == "" {
			continue
		}
		prompt.WriteString(msg.Content)
		prompt.WriteByte('\n')
	}
	joined := prompt.String()
	if strings.Contains(joined, "## Background tasks") {
		matches := routeTaskIDRe.FindAllStringSubmatch(joined, -1)
		ids := make([]string, 0, len(matches))
		for _, match := range matches {
			if len(match) > 1 {
				ids = append(ids, strings.TrimSpace(match[1]))
			}
		}
		raw, _ := json.Marshal(map[string]any{"ids": ids})
		return string(raw)
	}
	if strings.Contains(joined, "## Task") && strings.Contains(joined, "## Event") {
		raw, _ := json.Marshal(map[string]any{
			"match":       true,
			"confidence":  0.95,
			"explanation": "The devstack JSON-mode mock deterministically routes matching smoke-test events.",
		})
		return string(raw)
	}
	return `{}`
}

// --- helpers ---------------------------------------------------------------

// devSigningKey returns the fixed dev key (see devkey.go), or a throwaway one
// when DEVSTACK_EPHEMERAL_KEY is set.
func devSigningKey() (*rsa.PrivateKey, error) {
	if os.Getenv("DEVSTACK_EPHEMERAL_KEY") != "" {
		return rsa.GenerateKey(rand.Reader, 2048)
	}
	block, _ := pem.Decode([]byte(devSigningKeyPEM))
	if block == nil {
		return nil, errors.New("devstack: embedded signing key is not valid PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("devstack: parse embedded signing key: %w", err)
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("devstack: embedded signing key is %T, want RSA", parsed)
	}
	return key, nil
}

// keyThumbprint is a stable fingerprint of the public key, in the spirit of the
// RFC 7638 JWK thumbprint. It only has to change when the key does.
func keyThumbprint(pub *rsa.PublicKey) string {
	sum := sha256.Sum256(append(pub.N.Bytes(), byte(pub.E)))
	return "devstack-" + base64.RawURLEncoding.EncodeToString(sum[:8])
}

func signToken(claims jwt.MapClaims) string {
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = kid
	s, err := tok.SignedString(signKey)
	if err != nil {
		log.Printf("sign error: %v", err)
		return ""
	}
	return s
}

func tokenError(w http.ResponseWriter, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}

func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func jsonStr(s string) string { b, _ := json.Marshal(s); return string(b) }

func getenv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func def(v, d string) string {
	if v != "" {
		return v
	}
	return d
}
