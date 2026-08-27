// dev-product-mcp is a deliberately small RFC 012 product resource server.
// It is intended for local conformance and acceptance tests, not production.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type server struct{ db *sql.DB }

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
		Audience: audience, AcceptableSkew: time.Second,
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
	s := &server{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]any{"ok": true}) })
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
);`)
	return err
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
