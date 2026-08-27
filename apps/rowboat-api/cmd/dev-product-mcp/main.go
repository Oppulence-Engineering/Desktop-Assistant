// dev-product-mcp is a deliberately small RFC 012 product resource server.
// It is intended for local conformance and acceptance tests, not production.
package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
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
	db             *sql.DB
	entitlementKey []byte
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
	s := &server{db: db, entitlementKey: []byte(required("PRODUCT_ENTITLEMENT_HMAC_KEY"))}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]any{"ok": true}) })
	mux.HandleFunc("POST /v1/entitlements", s.entitlement)
	mux.HandleFunc("POST /fixture/entitlements", s.setEntitlement)
	mux.HandleFunc("POST /v1/approvals", s.issueApproval)
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
	if err := httpServer.ListenAndServe(); err != nil {
		log.Printf("dev product MCP stopped: %v", err)
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
	if err != nil || !s.validEntitlementSignature(r, body) {
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

func (s *server) validEntitlementSignature(r *http.Request, body []byte) bool {
	rawTimestamp := r.Header.Get("X-Rowboat-Timestamp")
	timestamp, err := time.Parse(time.RFC3339, rawTimestamp)
	if err != nil || time.Since(timestamp) > 5*time.Minute || time.Until(timestamp) > time.Minute {
		return false
	}
	rawSignature := strings.TrimPrefix(r.Header.Get("X-Rowboat-Signature"), "sha256=")
	signature, err := hex.DecodeString(rawSignature)
	if err != nil || r.Header.Get("X-Rowboat-Connector") != "dev" {
		return false
	}
	mac := hmac.New(sha256.New, s.entitlementKey)
	_, _ = mac.Write([]byte(rawTimestamp))
	_, _ = mac.Write([]byte("\n"))
	_, _ = mac.Write(body)
	return hmac.Equal(signature, mac.Sum(nil))
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
		ConnectionID string `json:"connection_id"`
		ResourceID   string `json:"resource_id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil || body.ConnectionID == "" || body.ResourceID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_approval"})
		return
	}
	token := "approval-" + body.ConnectionID + "-" + body.ResourceID + "-" + time.Now().UTC().Format("150405.000000000")
	_, err := s.db.ExecContext(r.Context(), `INSERT INTO dev_product_approvals(token_hash,connection_id,action,resource_id,expires_at) VALUES(encode(digest($1,'sha256'),'hex'),$2,'pay',$3,now()+interval '5 minutes')`, token, body.ConnectionID, body.ResourceID)
	if err != nil {
		writeJSON(w, 500, map[string]string{"code": "approval_failed"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"approval_token": token})
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
