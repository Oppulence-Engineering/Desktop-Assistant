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
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type server struct {
	db                  *sql.DB
	entitlementVerifier *oauthrs.EntitlementRequestVerifier
}

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
 token_hash text PRIMARY KEY, connection_id text NOT NULL, action text NOT NULL,
 resource_id text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS dev_product_approval_codes (
 code_hash text PRIMARY KEY, product_origin text NOT NULL, approval_id text NOT NULL,
 desktop_challenge_id text NOT NULL, connection_id text NOT NULL, action text NOT NULL,
 input_digest text NOT NULL, approver text NOT NULL, verifier_challenge text NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz
);
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
		ProductOrigin      string `json:"product_origin"`
		ApprovalID         string `json:"approval_id"`
		DesktopChallengeID string `json:"desktop_challenge_id"`
		ConnectionID       string `json:"connection_id"`
		Action             string `json:"action"`
		InputDigest        string `json:"input_digest"`
		Approver           string `json:"approver"`
		VerifierChallenge  string `json:"code_challenge"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil ||
		body.ProductOrigin == "" || body.ApprovalID == "" || body.DesktopChallengeID == "" || body.ConnectionID == "" ||
		body.Action == "" || body.InputDigest == "" || body.Approver == "" || body.VerifierChallenge == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_approval"})
		return
	}
	code := opaque(32)
	_, err := s.db.ExecContext(r.Context(), `INSERT INTO dev_product_approval_codes
	 (code_hash,product_origin,approval_id,desktop_challenge_id,connection_id,action,input_digest,approver,verifier_challenge,expires_at)
	 VALUES(encode(digest($1,'sha256'),'hex'),$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '5 minutes')`,
		code, body.ProductOrigin, body.ApprovalID, body.DesktopChallengeID, body.ConnectionID, body.Action, body.InputDigest, body.Approver, body.VerifierChallenge)
	if err != nil {
		writeJSON(w, 500, map[string]string{"code": "approval_failed"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"completion_code": code, "desktop_challenge_id": body.DesktopChallengeID})
}

func (s *server) redeemApproval(w http.ResponseWriter, r *http.Request) {
	c, _ := oauthrs.ClaimsFromContext(r.Context())
	var body struct {
		Code               string `json:"code"`
		Verifier           string `json:"code_verifier"`
		DesktopChallengeID string `json:"desktop_challenge_id"`
		ConnectionID       string `json:"connection_id"`
		Tool               string `json:"tool"`
		ArgumentsDigest    string `json:"arguments_digest"`
		Actor              string `json:"actor"`
		Action             string `json:"action"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if dec.Decode(&body) != nil || body.Code == "" || body.Verifier == "" || body.DesktopChallengeID == "" || body.ConnectionID == "" || body.ArgumentsDigest == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_completion_code"})
		return
	}
	if body.ConnectionID != c.ConnectionID {
		writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_completion_code"})
		return
	}
	scheme := "https"
	if r.TLS == nil {
		scheme = "http"
	}
	origin := scheme + "://" + r.Host
	challenge := sha256.Sum256([]byte(body.Verifier))
	verifierChallenge := base64.RawURLEncoding.EncodeToString(challenge[:])
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, 500, map[string]string{"code": "redemption_failed"})
		return
	}
	defer func() { _ = tx.Rollback() }()
	var approvalID string
	err = tx.QueryRowContext(r.Context(), `UPDATE dev_product_approval_codes SET consumed_at=now()
	 WHERE code_hash=encode(digest($1,'sha256'),'hex') AND product_origin=$2 AND desktop_challenge_id=$3
	 AND connection_id=$4 AND action=$5 AND input_digest=$6 AND approver=$7 AND verifier_challenge=$8
	 AND expires_at>now() AND consumed_at IS NULL RETURNING approval_id`, body.Code, origin,
		body.DesktopChallengeID, c.ConnectionID, body.Action, body.ArgumentsDigest, body.Actor, verifierChallenge).Scan(&approvalID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_completion_code"})
		return
	}
	token := opaque(32)
	_, err = tx.ExecContext(r.Context(), `INSERT INTO dev_product_approvals(token_hash,connection_id,action,resource_id,expires_at)
	 VALUES(encode(digest($1,'sha256'),'hex'),$2,'pay',$3,now()+interval '5 minutes')`, token, c.ConnectionID, approvalID)
	if err != nil || tx.Commit() != nil {
		writeJSON(w, 500, map[string]string{"code": "redemption_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"approval_token": token})
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
	if resource == "" {
		return false, nil
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(r.Context(), `UPDATE dev_product_approvals SET consumed_at=now()
 WHERE token_hash=encode(digest($1,'sha256'),'hex') AND connection_id=$2 AND action='pay'
 AND resource_id=$3 AND expires_at>now() AND consumed_at IS NULL`, raw, c.ConnectionID, resource)
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
