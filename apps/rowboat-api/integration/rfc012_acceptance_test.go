//go:build rfc012acceptance

package integration

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/stretchr/testify/require"
)

// TestRFC012PublicContract intentionally talks only to public HTTP and PostgreSQL.
// It does not replace missing behavior with mocks. The environment must run
// rowboat-api against cmd/devstack and the cmd/dev-product-mcp fixture.
func TestRFC012PublicContract(t *testing.T) {
	api := mustEnv(t, "RFC012_API_URL")
	product := mustEnv(t, "RFC012_PRODUCT_MCP_URL")
	tokenA := mustEnv(t, "RFC012_TENANT_A_JWT")
	tokenB := mustEnv(t, "RFC012_TENANT_B_JWT")
	dsn := mustEnv(t, "DATABASE_URL")
	connector := getenv("RFC012_CONNECTOR", "dev-product")

	db, err := sql.Open("pgx", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	require.NoError(t, db.PingContext(context.Background()))
	c := &client{t: t, http: &http.Client{Timeout: 15 * time.Second}}

	t.Run("entitlement denies before start", func(t *testing.T) {
		deny := mustEnv(t, "RFC012_UNENTITLED_JWT")
		r := c.json("POST", api+"/v1/connections/"+connector+"/start", deny, map[string]any{"requestedScopes": []string{"dev:records.read"}})
		require.Equal(t, http.StatusForbidden, r.status, r.body)
		require.NotEmpty(t, r.code())
	})

	var state string
	t.Run("list and start use hashed state and reject scope escalation", func(t *testing.T) {
		list := c.json("GET", api+"/v1/connectors", tokenA, nil)
		require.Equal(t, 200, list.status, list.body)
		require.NotContains(t, strings.ToLower(list.body), "api_key")
		start := c.json("POST", api+"/v1/connections/"+connector+"/start", tokenA, map[string]any{"requestedScopes": []string{"dev:records.read", "dev:payments.execute"}})
		require.Equal(t, 200, start.status, start.body)
		var body struct {
			AuthorizeURL string `json:"authorize_url"`
		}
		require.NoError(t, json.Unmarshal([]byte(start.body), &body))
		u, err := url.Parse(body.AuthorizeURL)
		require.NoError(t, err)
		state = u.Query().Get("state")
		require.NotEmpty(t, state)
		var rawCount, hashCount int
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM oauth_pendings WHERE state=$1`, state).Scan(&rawCount))
		require.Zero(t, rawCount, "raw OAuth state must never be persisted")
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM oauth_pendings WHERE state_hash=encode(digest($1,'sha256'),'hex')`, state).Scan(&hashCount))
		require.Equal(t, 1, hashCount)
		escalated := c.json("GET", api+"/v1/connections/"+connector+"/callback?state="+url.QueryEscape(state)+"&code=scope-escalation", "", nil)
		require.Equal(t, http.StatusForbidden, escalated.status, escalated.body)
	})

	t.Run("callback claim replay mint and tenant isolation", func(t *testing.T) {
		// Start a fresh flow because the scope-escalation callback must consume/fail
		// its own ticket. devstack's `success` code grants exactly requested scopes.
		start := c.json("POST", api+"/v1/connections/"+connector+"/start", tokenA, map[string]any{"requestedScopes": []string{"dev:records.read", "dev:payments.execute"}})
		require.Equal(t, 200, start.status, start.body)
		var sb struct {
			AuthorizeURL string `json:"authorize_url"`
		}
		require.NoError(t, json.Unmarshal([]byte(start.body), &sb))
		u, _ := url.Parse(sb.AuthorizeURL)
		state = u.Query().Get("state")
		cb := c.json("GET", api+"/v1/connections/"+connector+"/callback?state="+url.QueryEscape(state)+"&code=success", "", nil)
		require.Contains(t, []int{http.StatusFound, http.StatusSeeOther}, cb.status, cb.body)
		claimTicket := queryFromLocation(t, cb.header.Get("Location"), "ticket")
		claim := c.json("POST", api+"/v1/connections/"+connector+"/claim", tokenA, map[string]string{"ticket": claimTicket})
		require.Equal(t, 200, claim.status, claim.body)
		replay := c.json("POST", api+"/v1/connections/"+connector+"/claim", tokenA, map[string]string{"ticket": claimTicket})
		require.NotEqual(t, 200, replay.status, "claim ticket replay succeeded")
		other := c.json("GET", api+"/v1/connectors", tokenB, nil)
		require.Equal(t, 200, other.status, other.body)
		require.NotContains(t, other.body, `"connected":true`, "tenant B observed tenant A connection")
		mint := c.json("POST", api+"/v1/connections/"+connector+"/mcp-token", tokenA, nil)
		require.Equal(t, 200, mint.status, mint.body)
		var mt struct {
			AccessToken string `json:"access_token"`
			ExpiresIn   int64  `json:"expires_in"`
			Scope       string `json:"scope"`
		}
		require.NoError(t, json.Unmarshal([]byte(mint.body), &mt))
		require.NotEmpty(t, mt.AccessToken)
		require.Positive(t, mt.ExpiresIn)
		require.LessOrEqual(t, mt.ExpiresIn, int64(900), "resource token is not short-lived")
		require.Contains(t, mt.Scope, "dev:records.read")
		os.Setenv("RFC012_MINTED_RESOURCE_TOKEN", mt.AccessToken)
	})

	t.Run("product MCP authorization approval retry and one-time use", func(t *testing.T) {
		resourceToken := mustEnv(t, "RFC012_MINTED_RESOURCE_TOKEN")
		wrongAudience := mustEnv(t, "RFC012_WRONG_AUDIENCE_TOKEN")
		expired := mustEnv(t, "RFC012_EXPIRED_RESOURCE_TOKEN")
		missingScope := mustEnv(t, "RFC012_MISSING_SCOPE_TOKEN")
		connectionID := mustEnv(t, "RFC012_CONNECTION_ID")
		tenantID := mustEnv(t, "RFC012_TENANT_A_ORG_ID")
		_, err := db.Exec(`INSERT INTO dev_product_connections(connection_id,tenant_id,active) VALUES($1,$2,true) ON CONFLICT(connection_id) DO UPDATE SET tenant_id=$2,active=true`, connectionID, tenantID)
		require.NoError(t, err)
		require.Equal(t, 401, c.json("POST", product+"/v1/mcp/read", wrongAudience, nil).status)
		require.Equal(t, 401, c.json("POST", product+"/v1/mcp/read", expired, nil).status)
		require.Equal(t, 403, c.json("POST", product+"/v1/mcp/read", missingScope, nil).status)
		challenge := c.json("POST", product+"/v1/mcp/pay?resource_id=payrun-1", resourceToken, nil)
		require.Equal(t, 428, challenge.status, challenge.body)
		require.Equal(t, "approval_required", challenge.code())
		approval := "approval-rfc012-one-time"
		_, err = db.Exec(`INSERT INTO dev_product_approvals(token_hash,connection_id,action,resource_id,expires_at) VALUES(encode(digest($1,'sha256'),'hex'),$2,'pay','payrun-1',now()+interval '5 minutes')`, approval, connectionID)
		require.NoError(t, err)
		retry := c.jsonHeader("POST", product+"/v1/mcp/pay?resource_id=payrun-1", resourceToken, nil, "X-Approval-Token", approval)
		require.Equal(t, 200, retry.status, retry.body)
		reuse := c.jsonHeader("POST", product+"/v1/mcp/pay?resource_id=payrun-1", resourceToken, nil, "X-Approval-Token", approval)
		require.Equal(t, 428, reuse.status, "approval token was reusable")
	})

	t.Run("entitlement downgrade denies mint", func(t *testing.T) {
		downgradeURL := mustEnv(t, "RFC012_ENTITLEMENT_DOWNGRADE_URL")
		restoreURL := mustEnv(t, "RFC012_ENTITLEMENT_RESTORE_URL")
		downgrade := c.json("POST", downgradeURL, tokenA, nil)
		require.Contains(t, []int{200, 204}, downgrade.status, downgrade.body)
		denied := c.json("POST", api+"/v1/connections/"+connector+"/mcp-token", tokenA, nil)
		require.Equal(t, http.StatusForbidden, denied.status, denied.body)
		require.NotEmpty(t, denied.code())
		restore := c.json("POST", restoreURL, tokenA, nil)
		require.Contains(t, []int{200, 204}, restore.status, restore.body)
	})

	t.Run("disconnect revokes upstream tombstones audits and denies product", func(t *testing.T) {
		d := c.json("DELETE", api+"/v1/connections/"+connector, tokenA, nil)
		require.Contains(t, []int{200, 204}, d.status, d.body)
		connectionID := mustEnv(t, "RFC012_CONNECTION_ID")
		var status string
		var revokedAt sql.NullTime
		var revokeOK sql.NullBool
		require.NoError(t, db.QueryRow(`SELECT status,revoked_at,revocation_succeeded FROM mcp_connections WHERE id=$1`, connectionID).Scan(&status, &revokedAt, &revokeOK))
		require.Equal(t, "revoked", status)
		require.True(t, revokedAt.Valid)
		require.True(t, revokeOK.Valid && revokeOK.Bool, "upstream revoke was not recorded successful")
		var audits int
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM connector_audit_events WHERE connection_id=$1 AND event_type LIKE '%revok%'`, connectionID).Scan(&audits))
		require.Positive(t, audits)
		_, err := db.Exec(`UPDATE dev_product_connections SET active=false,revoked_at=now() WHERE connection_id=$1`, connectionID)
		require.NoError(t, err)
		denied := c.json("POST", product+"/v1/mcp/read", mustEnv(t, "RFC012_MINTED_RESOURCE_TOKEN"), nil)
		require.Equal(t, 403, denied.status)
		require.Equal(t, "connection_revoked", denied.code())
		var leaked int
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM connector_audit_events WHERE metadata_json ILIKE '%api_key%' OR metadata_json ILIKE '%access_token%' OR metadata_json ILIKE '%refresh_token%'`).Scan(&leaked))
		require.Zero(t, leaked, "connector audit disclosed credential-shaped fields")
	})
}

type client struct {
	t    *testing.T
	http *http.Client
}
type response struct {
	status int
	body   string
	header http.Header
}

func (r response) code() string {
	var v struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal([]byte(r.body), &v)
	return v.Code
}
func (c *client) json(method, endpoint, bearer string, body any) response {
	return c.jsonHeader(method, endpoint, bearer, body, "", "")
}
func (c *client) jsonHeader(method, endpoint, bearer string, body any, hk, hv string) response {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(c.t, err)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, endpoint, rd)
	require.NoError(c.t, err)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if hk != "" {
		req.Header.Set(hk, hv)
	}
	cl := *c.http
	cl.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := cl.Do(req)
	require.NoError(c.t, err)
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	require.NoError(c.t, err)
	return response{status: resp.StatusCode, body: string(b), header: resp.Header.Clone()}
}
func queryFromLocation(t *testing.T, raw, key string) string {
	t.Helper()
	u, err := url.Parse(raw)
	require.NoError(t, err)
	v := u.Query().Get(key)
	require.NotEmpty(t, v, fmt.Sprintf("%s missing from redirect %s", key, raw))
	return v
}
func mustEnv(t *testing.T, key string) string {
	t.Helper()
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		t.Fatalf("%s is required by the non-weakened RFC 012 contract", key)
	}
	return v
}
func getenv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
