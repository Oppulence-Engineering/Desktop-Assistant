// dev-product-mcp is a deliberately small RFC 012 product resource server.
// It is intended for local conformance and acceptance tests, not production.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type server struct {
	db                  *sql.DB
	entitlementVerifier *oauthrs.EntitlementRequestVerifier
}

const (
	paymentTool   = "payments.execute"
	paymentAction = "payment.release"
)

var errAmbiguousApprovalCommit = errors.New("fixture: approval commit acknowledgement lost")

func main() {
	ctx := context.Background()
	dsn := required("DATABASE_URL")
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		log.Fatal(err)
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		log.Fatalf("postgres: %v", err)
	}
	if err := migrate(ctx, db); err != nil {
		_ = db.Close()
		log.Fatal(err)
	}

	audience := getenv("PRODUCT_MCP_AUDIENCE", "dev-product-api")
	verifier, err := oauthrs.New(ctx, oauthrs.Config{
		IssuerURL: required("PRODUCT_MCP_ISSUER"), JWKSURL: required("PRODUCT_MCP_JWKS_URL"),
		Audience: audience, AcceptableSkew: time.Second, AllowLocalhostDevelopment: true,
	})
	if err != nil {
		_ = db.Close()
		log.Fatal(err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			log.Printf("close postgres: %v", err)
		}
	}()
	replayStore := oauthrs.PostgresEntitlementReplayStore{DB: db}
	if err := replayStore.EnsureSchema(ctx); err != nil {
		log.Printf("entitlement replay schema: %v", err)
		return
	}
	entitlementVerifier, err := oauthrs.NewEntitlementRequestVerifier(oauthrs.EntitlementRequestVerifierConfig{
		SigningKey: []byte(required("PRODUCT_ENTITLEMENT_HMAC_KEY")), Connector: "dev", ReplayStore: replayStore,
	})
	if err != nil {
		log.Printf("entitlement verifier: %v", err)
		return
	}
	s := &server{db: db, entitlementVerifier: entitlementVerifier}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]any{"ok": true}) })
	mux.HandleFunc("POST /v1/entitlements", s.entitlement)
	mux.HandleFunc("POST /fixture/entitlements", s.setEntitlement)
	mux.HandleFunc("POST /v1/approvals", s.issueApproval)
	mux.Handle("POST /v1/approvals/redeem", verifier.RequireMCPToken(oauthrs.MCPTokenOptions{
		Audience: audience, RequiredScopes: []string{"dev:payments.execute"}, ConnectionValidator: s.active,
	})(http.HandlerFunc(s.redeemApproval)))
	mux.Handle("POST /v1/mcp/read", verifier.RequireMCPToken(oauthrs.MCPTokenOptions{
		Audience: audience, RequiredScopes: []string{"dev:records.read"}, ConnectionValidator: s.active,
	})(http.HandlerFunc(s.read)))
	mux.Handle("POST /v1/mcp/pay", verifier.RequireMCPToken(oauthrs.MCPTokenOptions{
		Audience: audience, RequiredScopes: []string{"dev:payments.execute"}, ConnectionValidator: s.active,
		ApprovalValidator: s.approve,
	})(http.HandlerFunc(s.pay)))
	addr := getenv("PRODUCT_MCP_ADDR", "127.0.0.1:18082")
	log.Printf("dev product MCP listening on %s", addr)
	httpServer := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	var serveErr error
	if cert, key := strings.TrimSpace(os.Getenv("PRODUCT_MCP_TLS_CERT")), strings.TrimSpace(os.Getenv("PRODUCT_MCP_TLS_KEY")); cert != "" && key != "" {
		serveErr = httpServer.ListenAndServeTLS(cert, key)
	} else {
		serveErr = httpServer.ListenAndServe()
	}
	if serveErr != nil {
		log.Printf("dev product MCP stopped: %v", serveErr)
	}
}

func migrate(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS dev_product_connections (
 connection_id text PRIMARY KEY, tenant_id text NOT NULL, active boolean NOT NULL DEFAULT true,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dev_product_approvals (
 token_hash text PRIMARY KEY, source_code_hash text UNIQUE, connection_id text NOT NULL, action text NOT NULL,
 resource_id text NOT NULL, tool text NOT NULL DEFAULT '', approval_action text NOT NULL DEFAULT '',
 input_digest text NOT NULL DEFAULT '', approver text NOT NULL DEFAULT '', product_origin text NOT NULL DEFAULT '',
 product_session_id text NOT NULL DEFAULT '', product_config_digest text NOT NULL DEFAULT '',
 expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS dev_product_approval_codes (
 code_hash text PRIMARY KEY, product_origin text NOT NULL, approval_id text NOT NULL,
 desktop_challenge_id text NOT NULL, connection_id text NOT NULL, action text NOT NULL,
 tool text NOT NULL DEFAULT '', input_digest text NOT NULL, approver text NOT NULL, verifier_challenge text NOT NULL,
 product_session_id text NOT NULL DEFAULT '', product_config_digest text NOT NULL DEFAULT '',
 approval_token_hash text, expires_at timestamptz NOT NULL, consumed_at timestamptz
);
ALTER TABLE dev_product_approvals ADD COLUMN IF NOT EXISTS source_code_hash text;
ALTER TABLE dev_product_approvals ADD COLUMN IF NOT EXISTS tool text NOT NULL DEFAULT '';
ALTER TABLE dev_product_approvals ADD COLUMN IF NOT EXISTS approval_action text NOT NULL DEFAULT '';
ALTER TABLE dev_product_approvals ADD COLUMN IF NOT EXISTS input_digest text NOT NULL DEFAULT '';
ALTER TABLE dev_product_approvals ADD COLUMN IF NOT EXISTS approver text NOT NULL DEFAULT '';
ALTER TABLE dev_product_approvals ADD COLUMN IF NOT EXISTS product_origin text NOT NULL DEFAULT '';
ALTER TABLE dev_product_approvals ADD COLUMN IF NOT EXISTS product_session_id text NOT NULL DEFAULT '';
ALTER TABLE dev_product_approvals ADD COLUMN IF NOT EXISTS product_config_digest text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS dev_product_approvals_source_code_hash_key ON dev_product_approvals(source_code_hash);
ALTER TABLE dev_product_approval_codes ADD COLUMN IF NOT EXISTS tool text NOT NULL DEFAULT '';
ALTER TABLE dev_product_approval_codes ADD COLUMN IF NOT EXISTS product_session_id text NOT NULL DEFAULT '';
ALTER TABLE dev_product_approval_codes ADD COLUMN IF NOT EXISTS product_config_digest text NOT NULL DEFAULT '';
ALTER TABLE dev_product_approval_codes ADD COLUMN IF NOT EXISTS approval_token_hash text;
CREATE TABLE IF NOT EXISTS dev_product_audit (
 id bigserial PRIMARY KEY, tenant_id text NOT NULL, connection_id text NOT NULL,
 event_type text NOT NULL, resource_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dev_product_entitlements (
 user_id text PRIMARY KEY, allowed boolean NOT NULL, reason text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
);`)
	return err
}

func (s *server) entitlement(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<10))
	if err != nil || s.entitlementVerifier.Verify(r.Context(), r.Header, body) != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "entitlement_unauthorized"})
		return
	}
	var request struct {
		Connector string   `json:"connector"`
		UserID    string   `json:"user_id"`
		OrgID     string   `json:"org_id,omitempty"`
		Scopes    []string `json:"scopes"`
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&request); err != nil || request.Connector != "dev" || strings.TrimSpace(request.UserID) == "" || len(request.Scopes) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_entitlement_request"})
		return
	}
	var allowed bool
	var reason string
	err = s.db.QueryRowContext(r.Context(), `SELECT allowed,reason FROM dev_product_entitlements WHERE user_id=$1`, request.UserID).Scan(&allowed, &reason)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusOK, map[string]any{"allowed": false, "reason": "no_subscription"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"code": "entitlement_failed"})
		return
	}
	if allowed {
		writeJSON(w, http.StatusOK, map[string]any{"allowed": true})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"allowed": false, "reason": reason})
}

func (s *server) setEntitlement(w http.ResponseWriter, r *http.Request) {
	if required("PRODUCT_MCP_FIXTURE_SECRET") != r.Header.Get("X-Fixture-Secret") {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "fixture_unauthorized"})
		return
	}
	var body struct {
		UserID  string `json:"user_id"`
		Allowed bool   `json:"allowed"`
		Reason  string `json:"reason"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil || strings.TrimSpace(body.UserID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_entitlement"})
		return
	}
	if body.Allowed {
		body.Reason = ""
	}
	if !body.Allowed {
		valid := map[string]bool{"no_subscription": true, "scope_not_in_plan": true, "user_banned": true, "org_mismatch": true, "connector_disabled": true}
		if !valid[body.Reason] {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_reason"})
			return
		}
	}
	_, err := s.db.ExecContext(r.Context(), `INSERT INTO dev_product_entitlements(user_id,allowed,reason) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET allowed=$2,reason=$3,updated_at=now()`, body.UserID, body.Allowed, body.Reason)
	if err != nil {
		writeJSON(w, 500, map[string]string{"code": "entitlement_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"updated": true})
}

func (s *server) issueApproval(w http.ResponseWriter, r *http.Request) {
	if required("PRODUCT_MCP_FIXTURE_SECRET") != r.Header.Get("X-Fixture-Secret") {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "fixture_unauthorized"})
		return
	}
	var body struct {
		ProductOrigin       string `json:"product_origin"`
		ApprovalID          string `json:"approval_id"`
		DesktopChallengeID  string `json:"desktop_challenge_id"`
		ConnectionID        string `json:"connection_id"`
		Tool                string `json:"tool"`
		Action              string `json:"action"`
		InputDigest         string `json:"input_digest"`
		Approver            string `json:"approver"`
		VerifierChallenge   string `json:"code_challenge"`
		ProductSessionID    string `json:"product_session_id"`
		ProductConfigDigest string `json:"product_config_digest"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_approval"})
		return
	}
	origin, originErr := canonicalProductOrigin(body.ProductOrigin)
	requestOrigin, requestOriginErr := requestProductOrigin(r)
	tool, toolErr := canonicalToolIdentity(body.Tool)
	if originErr != nil || toolErr != nil || body.ApprovalID == "" || body.DesktopChallengeID == "" || body.ConnectionID == "" ||
		requestOriginErr != nil || origin != requestOrigin || tool != paymentTool || body.Action != paymentAction ||
		!isCanonicalArgumentsDigest(body.InputDigest) || body.Approver == "" || !isCanonicalArgumentsDigest(body.VerifierChallenge) ||
		body.ProductSessionID == "" || !isCanonicalArgumentsDigest(body.ProductConfigDigest) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_approval"})
		return
	}
	code := opaque(32)
	_, err := s.db.ExecContext(r.Context(), `INSERT INTO dev_product_approval_codes
		 (code_hash,product_origin,approval_id,desktop_challenge_id,connection_id,tool,action,input_digest,approver,verifier_challenge,product_session_id,product_config_digest,expires_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+interval '5 minutes')`,
		sha256Hex(code), origin, body.ApprovalID, body.DesktopChallengeID, body.ConnectionID, tool, body.Action, body.InputDigest,
		body.Approver, body.VerifierChallenge, body.ProductSessionID, body.ProductConfigDigest)
	if err != nil {
		writeJSON(w, 500, map[string]string{"code": "approval_failed"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"completion_code": code, "desktop_challenge_id": body.DesktopChallengeID})
}

func (s *server) redeemApproval(w http.ResponseWriter, r *http.Request) {
	c, _ := oauthrs.ClaimsFromContext(r.Context())
	var body approvalRedemptionRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if dec.Decode(&body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_completion_code"})
		return
	}
	binding, err := approvalRedemptionBindingFor(r, c, body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_completion_code"})
		return
	}
	codeHash := sha256Hex(body.Code)
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"code": "redemption_failed"})
		return
	}
	defer func() { _ = tx.Rollback() }()
	var approvalID string
	var consumedAt sql.NullTime
	var storedTokenHash sql.NullString
	err = tx.QueryRowContext(r.Context(), `SELECT approval_id,consumed_at,approval_token_hash
		 FROM dev_product_approval_codes
		 WHERE code_hash=$1 AND product_origin=$2 AND desktop_challenge_id=$3 AND connection_id=$4
		 AND tool=$5 AND action=$6 AND input_digest=$7 AND approver=$8 AND verifier_challenge=$9
		 AND product_session_id=$10 AND product_config_digest=$11 AND expires_at>now()
		 FOR UPDATE`, codeHash, binding.ProductOrigin, body.DesktopChallengeID, c.ConnectionID, binding.Tool,
		body.Action, body.ArgumentsDigest, c.UserID, binding.VerifierChallenge, binding.ProductSessionID,
		binding.ProductConfigDigest).Scan(&approvalID, &consumedAt, &storedTokenHash)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_completion_code"})
		return
	}
	token := approvalBearer(body.Code, body.Verifier, approvalID, binding)
	tokenHash := sha256Hex(token)
	if consumedAt.Valid {
		if !storedTokenHash.Valid || storedTokenHash.String != tokenHash || !approvalExists(r.Context(), tx, codeHash, tokenHash, approvalID, binding) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_completion_code"})
			return
		}
		_ = tx.Rollback()
		writeJSON(w, http.StatusOK, map[string]string{"approval_token": token})
		return
	}
	_, err = tx.ExecContext(r.Context(), `INSERT INTO dev_product_approvals
		 (token_hash,source_code_hash,connection_id,action,resource_id,tool,approval_action,input_digest,approver,product_origin,product_session_id,product_config_digest,expires_at)
		 VALUES($1,$2,$3,'pay',$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '5 minutes')`, tokenHash, codeHash,
		c.ConnectionID, approvalID, binding.Tool, body.Action, body.ArgumentsDigest, c.UserID, binding.ProductOrigin,
		binding.ProductSessionID, binding.ProductConfigDigest)
	if err != nil {
		writeJSON(w, 500, map[string]string{"code": "redemption_failed"})
		return
	}
	res, err := tx.ExecContext(r.Context(), `UPDATE dev_product_approval_codes SET consumed_at=now(),approval_token_hash=$2
		 WHERE code_hash=$1 AND consumed_at IS NULL`, codeHash, tokenHash)
	if err != nil {
		writeJSON(w, 500, map[string]string{"code": "redemption_failed"})
		return
	}
	if n, rowsErr := res.RowsAffected(); rowsErr != nil || n != 1 {
		writeJSON(w, 500, map[string]string{"code": "redemption_failed"})
		return
	}
	commitErr := tx.Commit()
	if commitErr == nil && fixtureAmbiguousApprovalCommit(r) {
		commitErr = errAmbiguousApprovalCommit
	}
	if commitErr != nil {
		recoveryCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
		defer cancel()
		if !s.approvalRedemptionCommitted(recoveryCtx, codeHash, tokenHash, approvalID, binding) {
			writeJSON(w, 500, map[string]string{"code": "redemption_failed"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"approval_token": token})
}

type approvalRedemptionRequest struct {
	Code                string `json:"code"`
	Verifier            string `json:"code_verifier"`
	DesktopChallengeID  string `json:"desktop_challenge_id"`
	ConnectionID        string `json:"connection_id"`
	Tool                string `json:"tool"`
	ArgumentsDigest     string `json:"arguments_digest"`
	Actor               string `json:"actor"`
	Action              string `json:"action"`
	ProductSessionID    string `json:"product_session_id,omitempty"`
	ProductConfigDigest string `json:"product_config_digest,omitempty"`
}

type approvalRedemptionBinding struct {
	ProductOrigin       string
	DesktopChallengeID  string
	ConnectionID        string
	Tool                string
	ArgumentsDigest     string
	Actor               string
	Action              string
	ProductSessionID    string
	ProductConfigDigest string
	VerifierChallenge   string
}

func approvalRedemptionBindingFor(r *http.Request, c *oauthrs.Claims, body approvalRedemptionRequest) (approvalRedemptionBinding, error) {
	if c == nil || body.Code == "" || body.Verifier == "" || body.DesktopChallengeID == "" || body.ConnectionID == "" ||
		body.Actor == "" || body.Action == "" || body.ConnectionID != c.ConnectionID || body.Actor != c.UserID || c.TokenID == "" {
		return approvalRedemptionBinding{}, errors.New("missing or unauthenticated approval binding")
	}
	tool, err := canonicalToolIdentity(body.Tool)
	if err != nil || tool != paymentTool || body.Action != paymentAction || !isCanonicalArgumentsDigest(body.ArgumentsDigest) {
		return approvalRedemptionBinding{}, errors.New("non-canonical approval binding")
	}
	origin, err := requestProductOrigin(r)
	if err != nil {
		return approvalRedemptionBinding{}, err
	}
	sessionID := c.TokenID
	if body.ProductSessionID != "" && body.ProductSessionID != sessionID {
		return approvalRedemptionBinding{}, errors.New("product session mismatch")
	}
	configDigest := claimsProductConfigDigest(c)
	if body.ProductConfigDigest != "" && body.ProductConfigDigest != configDigest {
		return approvalRedemptionBinding{}, errors.New("product configuration mismatch")
	}
	challenge := sha256.Sum256([]byte(body.Verifier))
	return approvalRedemptionBinding{
		ProductOrigin: origin, DesktopChallengeID: body.DesktopChallengeID, ConnectionID: c.ConnectionID,
		Tool: tool, ArgumentsDigest: body.ArgumentsDigest, Actor: c.UserID, Action: body.Action,
		ProductSessionID: sessionID, ProductConfigDigest: configDigest,
		VerifierChallenge: base64.RawURLEncoding.EncodeToString(challenge[:]),
	}, nil
}

func approvalExists(ctx context.Context, tx *sql.Tx, codeHash, tokenHash, approvalID string, binding approvalRedemptionBinding) bool {
	var exists bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dev_product_approvals WHERE source_code_hash=$1 AND token_hash=$2
		 AND connection_id=$3 AND resource_id=$4 AND tool=$5 AND approval_action=$6 AND input_digest=$7 AND approver=$8
		 AND product_origin=$9 AND product_session_id=$10 AND product_config_digest=$11 AND action='pay')`, codeHash, tokenHash,
		binding.ConnectionID, approvalID, binding.Tool, binding.Action, binding.ArgumentsDigest, binding.Actor,
		binding.ProductOrigin, binding.ProductSessionID, binding.ProductConfigDigest).Scan(&exists)
	return err == nil && exists
}

func (s *server) approvalRedemptionCommitted(ctx context.Context, codeHash, tokenHash, approvalID string, binding approvalRedemptionBinding) bool {
	var exists bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dev_product_approval_codes c
		 JOIN dev_product_approvals a ON a.source_code_hash=c.code_hash
		 WHERE c.code_hash=$1 AND c.consumed_at IS NOT NULL AND c.approval_token_hash=$2 AND c.approval_id=$3
		 AND c.product_origin=$4 AND c.desktop_challenge_id=$5 AND c.connection_id=$6 AND c.tool=$7 AND c.action=$8
		 AND c.input_digest=$9 AND c.approver=$10 AND c.product_session_id=$11 AND c.product_config_digest=$12
		 AND c.verifier_challenge=$13 AND c.expires_at>now() AND a.token_hash=$2 AND a.connection_id=$6
		 AND a.expires_at>now())`, codeHash, tokenHash, approvalID, binding.ProductOrigin,
		binding.DesktopChallengeID, binding.ConnectionID, binding.Tool, binding.Action, binding.ArgumentsDigest, binding.Actor,
		binding.ProductSessionID, binding.ProductConfigDigest, binding.VerifierChallenge).Scan(&exists)
	return err == nil && exists
}

func canonicalProductOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("invalid product origin")
	}
	if u.Path != "" && u.Path != "/" {
		return "", errors.New("product origin must not contain a path")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "https" && scheme != "http" {
		return "", errors.New("invalid product origin scheme")
	}
	return scheme + "://" + strings.ToLower(u.Host), nil
}

func requestProductOrigin(r *http.Request) (string, error) {
	scheme := "https"
	if r.TLS == nil {
		scheme = "http"
	}
	return canonicalProductOrigin(scheme + "://" + r.Host)
}

func canonicalToolIdentity(raw string) (string, error) {
	if raw == "" || raw != strings.TrimSpace(raw) || len(raw) > 128 {
		return "", errors.New("invalid tool identity")
	}
	for i, r := range raw {
		valid := r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || (i > 0 && strings.ContainsRune("._:-", r))
		if !valid {
			return "", errors.New("invalid tool identity")
		}
	}
	return raw, nil
}

func isCanonicalArgumentsDigest(raw string) bool {
	b, err := base64.RawURLEncoding.DecodeString(raw)
	return err == nil && len(b) == sha256.Size && base64.RawURLEncoding.EncodeToString(b) == raw
}

func canonicalArgumentsDigest(value any) (string, error) {
	canonical, err := canonicalJSON(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(canonical))
	return base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

func canonicalJSON(value any) (string, error) {
	switch typed := value.(type) {
	case nil, bool, string, float64, json.Number:
		b, err := json.Marshal(typed)
		return string(b), err
	case []any:
		parts := make([]string, len(typed))
		for i, item := range typed {
			part, err := canonicalJSON(item)
			if err != nil {
				return "", err
			}
			parts[i] = part
		}
		return "[" + strings.Join(parts, ",") + "]", nil
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			keyJSON, _ := json.Marshal(key)
			valueJSON, err := canonicalJSON(typed[key])
			if err != nil {
				return "", err
			}
			parts = append(parts, string(keyJSON)+":"+valueJSON)
		}
		return "{" + strings.Join(parts, ",") + "}", nil
	default:
		b, err := json.Marshal(value)
		if err != nil {
			return "", err
		}
		var normalized any
		dec := json.NewDecoder(strings.NewReader(string(b)))
		dec.UseNumber()
		if err := dec.Decode(&normalized); err != nil {
			return "", err
		}
		return canonicalJSON(normalized)
	}
}

func claimsProductConfigDigest(c *oauthrs.Claims) string {
	audience := append([]string(nil), c.Audience...)
	sort.Strings(audience)
	return digestParts("product-config-v1", c.Issuer, strings.Join(audience, "\x00"), c.ConnectorID, c.ConnectionID)
}

func approvalBearer(code, verifier, approvalID string, binding approvalRedemptionBinding) string {
	return digestParts("approval-bearer-v1", code, verifier, approvalID, binding.ProductOrigin, binding.DesktopChallengeID,
		binding.ConnectionID, binding.Tool, binding.Action, binding.ArgumentsDigest, binding.Actor,
		binding.ProductSessionID, binding.ProductConfigDigest)
}

func digestParts(label string, parts ...string) string {
	h := sha256.New()
	_, _ = io.WriteString(h, label)
	for _, part := range parts {
		_, _ = io.WriteString(h, "\x00"+part)
	}
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

func sha256Hex(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func fixtureAmbiguousApprovalCommit(r *http.Request) bool {
	secret := strings.TrimSpace(os.Getenv("PRODUCT_MCP_FIXTURE_SECRET"))
	return secret != "" && r.Header.Get("X-Fixture-Secret") == secret &&
		r.Header.Get("X-Fixture-Approval-Commit") == "committed-without-ack"
}

func opaque(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func (s *server) active(ctx context.Context, c *oauthrs.Claims) (bool, error) {
	var active bool
	err := s.db.QueryRowContext(ctx, `SELECT active FROM dev_product_connections WHERE connection_id=$1 AND tenant_id=$2`, c.ConnectionID, c.OrganizationID).Scan(&active)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return active, err
}

func (s *server) approve(r *http.Request, raw string, c *oauthrs.Claims) (bool, error) {
	resource := strings.TrimSpace(r.URL.Query().Get("resource_id"))
	origin, originErr := requestProductOrigin(r)
	argumentsDigest, digestErr := canonicalArgumentsDigest(map[string]any{"resource_id": resource})
	if resource == "" || c == nil || c.UserID == "" || c.TokenID == "" || originErr != nil || digestErr != nil {
		return false, nil
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(r.Context(), `UPDATE dev_product_approvals SET consumed_at=now()
	 WHERE token_hash=$1 AND connection_id=$2 AND action='pay' AND resource_id=$3 AND tool=$4
	 AND approval_action=$5 AND input_digest=$6 AND approver=$7 AND product_origin=$8
	 AND product_session_id=$9 AND product_config_digest=$10 AND expires_at>now() AND consumed_at IS NULL`,
		sha256Hex(raw), c.ConnectionID, resource, paymentTool, paymentAction, argumentsDigest, c.UserID, origin,
		c.TokenID, claimsProductConfigDigest(c))
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil || n != 1 {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func (s *server) read(w http.ResponseWriter, r *http.Request) {
	c, _ := oauthrs.ClaimsFromContext(r.Context())
	_ = s.audit(r.Context(), c, "records_read", "")
	writeJSON(w, 200, map[string]any{"records": []any{}, "tenant_id": c.OrganizationID})
}

func (s *server) pay(w http.ResponseWriter, r *http.Request) {
	c, _ := oauthrs.ClaimsFromContext(r.Context())
	resource := r.URL.Query().Get("resource_id")
	if err := s.audit(r.Context(), c, "payment_executed", resource); err != nil {
		writeJSON(w, 500, map[string]string{"code": "audit_failed", "error": "audit write failed"})
		return
	}
	writeJSON(w, 200, map[string]any{"executed": true, "resource_id": resource})
}

func (s *server) audit(ctx context.Context, c *oauthrs.Claims, event, resource string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO dev_product_audit(tenant_id,connection_id,event_type,resource_id) VALUES($1,$2,$3,$4)`, c.OrganizationID, c.ConnectionID, event, resource)
	return err
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func required(k string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	log.Fatalf("%s is required", k)
	return ""
}
func getenv(k, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return fallback
}
