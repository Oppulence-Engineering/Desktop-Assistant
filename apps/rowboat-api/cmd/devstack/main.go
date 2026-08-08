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
//	GET  /mint?workos_user_id=...                — shortcut: mint a token directly (curl tests)
//	POST /chat/completions, /v1/chat/completions — mock OpenAI-compatible chat LLM (SSE + usage)
//	POST /completions, /v1/completions           — mock OpenAI-compatible legacy completions
//	POST /embeddings, /v1/embeddings             — mock OpenAI-compatible embeddings
//	POST /v1/google-oauth-mock/token             — mock Google token endpoint (refresh)
//
// All tokens are RS256-signed by an ephemeral key; the JWKS is published so
// rowboat-api (and the desktop's openid-client) can verify them.
package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const kid = "devstack-1"

var (
	signKey  *rsa.PrivateKey
	issuer   string
	audience string

	authCodes sync.Map // code -> authCode
	refreshDB sync.Map // refresh_token -> session
)

var routeTaskIDRe = regexp.MustCompile(`(?m)^\d+\.\s+id:\s+([^\n]+)`)

type authCode struct {
	challenge   string
	redirectURI string
	clientID    string
	scope       string
	sub         string
	email       string
	nonce       string
	expires     time.Time
}

type session struct {
	sub      string
	email    string
	clientID string
	scope    string
}

func main() {
	addr := getenv("ADDR", ":8090")
	issuer = getenv("ISSUER", "http://localhost:8090")
	audience = getenv("AUDIENCE", "rowboat-api")

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		log.Fatal(err)
	}
	signKey = key

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/jwks.json", handleJWKS)
	mux.HandleFunc("/.well-known/openid-configuration", handleDiscovery)
	mux.HandleFunc("/oauth2/register", handleRegister)
	mux.HandleFunc("/authorize", handleAuthorize)
	mux.HandleFunc("/oauth2/token", handleToken)
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

	log.Printf("devstack OIDC+mock listening on %s (issuer=%s aud=%s)", addr, issuer, audience)
	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
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
	code, _ := randomToken(24)
	authCodes.Store(code, authCode{
		challenge:   q.Get("code_challenge"),
		redirectURI: redirectURI,
		clientID:    q.Get("client_id"),
		scope:       def(q.Get("scope"), "openid email profile"),
		sub:         "user_dev_1",
		email:       "dev@solomon-ai.co",
		nonce:       q.Get("nonce"),
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
	refreshDB.Store(rt, session{sub: ac.sub, email: ac.email, clientID: ac.clientID, scope: ac.scope})
	writeTokenResponse(w, ac.sub, ac.email, ac.clientID, ac.scope, ac.nonce, rt)
}

func tokenFromRefresh(w http.ResponseWriter, r *http.Request) {
	rt := r.Form.Get("refresh_token")
	v, ok := refreshDB.Load(rt)
	if !ok {
		tokenError(w, "invalid_grant")
		return
	}
	s := v.(session)
	writeTokenResponse(w, s.sub, s.email, s.clientID, s.scope, "", rt)
}

func writeTokenResponse(w http.ResponseWriter, sub, email, clientID, scope, nonce, refreshToken string) {
	access := signToken(jwt.MapClaims{
		"iss":   issuer,
		"aud":   audience,
		"sub":   sub,
		"iat":   time.Now().Unix(),
		"exp":   time.Now().Add(time.Hour).Unix(),
		"scope": scope,
		"ext":   map[string]any{"workos_user_id": sub, "email": email},
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
	writeJSON(w, map[string]any{
		"access_token":  access,
		"id_token":      signToken(idClaims),
		"refresh_token": refreshToken,
		"token_type":    "Bearer",
		"expires_in":    3600,
		"scope":         scope,
	})
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
		"ext":   map[string]any{"workos_user_id": sub, "email": email},
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
	email := def(r.URL.Query().Get("email"), "dev@solomon-ai.co")
	token := signToken(jwt.MapClaims{
		"iss":   issuer,
		"aud":   audience,
		"sub":   workosID,
		"iat":   time.Now().Unix(),
		"exp":   time.Now().Add(time.Hour).Unix(),
		"scope": "openid email profile offline_access",
		"ext":   map[string]any{"workos_user_id": workosID, "email": email},
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

	dims := req.Dimensions
	if dims <= 0 {
		dims = mockEmbeddingDims(req.Model)
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

// deterministicEmbedding hashes the input into a unit-length vector. Same text
// in, same vector out; different text, different direction.
func deterministicEmbedding(text string, dims int) []float64 {
	sum := sha256.Sum256([]byte(text))
	out := make([]float64, dims)
	var norm float64
	for i := 0; i < dims; i++ {
		// Re-hash per block so the whole vector varies, not just the first 32.
		if i%32 == 0 && i > 0 {
			sum = sha256.Sum256(sum[:])
		}
		v := (float64(sum[i%32]) / 255.0) - 0.5
		out[i] = v
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
