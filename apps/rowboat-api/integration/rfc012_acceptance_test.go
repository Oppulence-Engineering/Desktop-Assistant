//go:build rfc012acceptance

package integration

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
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
	c := &client{t: t, http: fixtureHTTPClient(t)}

	// Materialize each authenticated tenant through the real middleware, then
	// grant only tenant A the disposable intelligence subscription required by
	// the dev-product money-moving scope.
	require.Equal(t, 200, c.json("GET", api+"/v1/connectors", tokenA, nil).status)
	require.Equal(t, 200, c.json("GET", api+"/v1/connectors", tokenB, nil).status)
	_, err = db.Exec(`INSERT INTO subscriptions(id,created_at,updated_at,plan,status,sanctioned_credits,stripe_customer_id,stripe_subscription_id,user_subscription)
		SELECT gen_random_uuid(),now(),now(),'intelligence','active',10000,'','',id FROM users WHERE workos_user_id='user_rfc012_a'
		ON CONFLICT(user_subscription) DO UPDATE SET plan='intelligence',status='active',updated_at=now()`)
	require.NoError(t, err)
	fixtureSecret := mustEnv(t, "RFC012_FIXTURE_SECRET")
	require.Equal(t, http.StatusOK, c.jsonHeader("POST", product+"/fixture/entitlements", "", map[string]any{"user_id": "user_rfc012_a", "allowed": true}, "X-Fixture-Secret", fixtureSecret).status)

	t.Run("product deny overrides local allow", func(t *testing.T) {
		var plan, status string
		require.NoError(t, db.QueryRow(`SELECT plan,status FROM subscriptions WHERE user_subscription=(SELECT id FROM users WHERE workos_user_id='user_rfc012_a')`).Scan(&plan, &status))
		require.Equal(t, "intelligence", plan)
		require.Equal(t, "active", status)
		require.Equal(t, http.StatusOK, c.jsonHeader("POST", product+"/fixture/entitlements", "", map[string]any{"user_id": "user_rfc012_a", "allowed": false, "reason": "connector_disabled"}, "X-Fixture-Secret", fixtureSecret).status)
		denied := c.json("POST", api+"/v1/connections/"+connector+"/start", tokenA, map[string]any{"requestedScopes": []string{"dev:records.read"}})
		require.Equal(t, http.StatusForbidden, denied.status, denied.body)
		require.Equal(t, http.StatusOK, c.jsonHeader("POST", product+"/fixture/entitlements", "", map[string]any{"user_id": "user_rfc012_a", "allowed": true}, "X-Fixture-Secret", fixtureSecret).status)
	})

	t.Run("entitlement denies before start", func(t *testing.T) {
		deny := mustEnv(t, "RFC012_UNENTITLED_JWT")
		r := c.json("POST", api+"/v1/connections/"+connector+"/start", deny, map[string]any{"requestedScopes": []string{"dev:records.read"}})
		require.Equal(t, http.StatusForbidden, r.status, r.body)
		require.NotEmpty(t, r.code())
	})

	t.Run("list and start use hashed state and route consent across instances", func(t *testing.T) {
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
		state := u.Query().Get("state")
		require.NotEmpty(t, state)
		var rawCount, hashCount int
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM oauth_pendings WHERE state=$1`, state).Scan(&rawCount))
		require.Zero(t, rawCount, "raw OAuth state must never be persisted")
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM oauth_pendings WHERE state_hash=encode(digest($1,'sha256'),'hex')`, state).Scan(&hashCount))
		require.Equal(t, 1, hashCount)
		callback := completeConsent(t, u.String(), []string{"dev:records.read", "dev:payments.execute"})
		require.Contains(t, []int{http.StatusFound, http.StatusSeeOther}, callback.status, callback.body)
		require.Equal(t, "success", queryFromLocation(t, callback.header.Get("Location"), "status"))
	})

	var connectionID string
	var resourceToken string
	t.Run("callback claim replay mint and tenant isolation", func(t *testing.T) {
		// Start a fresh flow and finish it through the real consent UI. The browser
		// deliberately reads from consent instance one and posts to instance two.
		start := c.json("POST", api+"/v1/connections/"+connector+"/start", tokenA, map[string]any{"requestedScopes": []string{"dev:records.read", "dev:payments.execute"}})
		require.Equal(t, 200, start.status, start.body)
		var sb struct {
			AuthorizeURL string `json:"authorize_url"`
		}
		require.NoError(t, json.Unmarshal([]byte(start.body), &sb))
		u, _ := url.Parse(sb.AuthorizeURL)
		state := u.Query().Get("state")
		cb := completeConsent(t, sb.AuthorizeURL, []string{"dev:records.read", "dev:payments.execute"})
		require.Contains(t, []int{http.StatusFound, http.StatusSeeOther}, cb.status, cb.body)
		claimTicket := queryFromLocation(t, cb.header.Get("Location"), "session")
		require.Equal(t, state, claimTicket)
		claims := make([]response, 2)
		var wg sync.WaitGroup
		for i := range claims {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				claims[i] = c.json("POST", api+"/v1/connections/"+connector+"/claim", tokenA, map[string]string{"state": claimTicket})
			}(i)
		}
		wg.Wait()
		claim := claims[0]
		if claim.status != http.StatusOK {
			claim = claims[1]
		}
		require.Equal(t, 200, claim.status, fmt.Sprintf("first=%d %s second=%d %s", claims[0].status, claims[0].body, claims[1].status, claims[1].body))
		require.NotEqual(t, http.StatusOK, claims[0].status+claims[1].status-http.StatusOK, "both concurrent claims succeeded")
		var claimed struct {
			ConnectionID string `json:"connectionId"`
		}
		require.NoError(t, json.Unmarshal([]byte(claim.body), &claimed))
		connectionID = claimed.ConnectionID
		require.NotEmpty(t, connectionID)
		replay := c.json("POST", mustEnv(t, "RFC012_API2_URL")+"/v1/connections/"+connector+"/claim", tokenA, map[string]string{"state": claimTicket})
		require.Equal(t, http.StatusOK, replay.status, replay.body)
		var replayedClaim struct {
			ConnectionID string `json:"connectionId"`
		}
		require.NoError(t, json.Unmarshal([]byte(replay.body), &replayedClaim))
		require.Equal(t, connectionID, replayedClaim.ConnectionID, "exact claim replay returned a different connection")
		var connectionRows int
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM mcp_connections WHERE id=$1`, connectionID).Scan(&connectionRows))
		require.Equal(t, 1, connectionRows, "exact claim replay created duplicate connection state")
		other := c.json("GET", api+"/v1/connectors", tokenB, nil)
		require.Equal(t, 200, other.status, other.body)
		require.NotContains(t, other.body, `"connected":true`, "tenant B observed tenant A connection")
		// Start, callback, concurrent claim, replay, and tenant-isolation checks all
		// intentionally share the production connector burst bucket. Let that real
		// eight-request window roll before testing the independent cross-replica
		// refresh path instead of weakening or bypassing the limiter.
		time.Sleep(11 * time.Second)
		// Two replicas refresh the same grant concurrently. Shared Redis must
		// serialize the provider refresh while both public requests succeed.
		mints := make([]response, 2)
		var mintWG sync.WaitGroup
		for i, base := range []string{api, mustEnv(t, "RFC012_API2_URL")} {
			mintWG.Add(1)
			go func(i int, base string) {
				defer mintWG.Done()
				mints[i] = c.json("POST", base+"/v1/connections/"+connector+"/mcp-token", tokenA, nil)
			}(i, base)
		}
		mintWG.Wait()
		require.Equal(t, 200, mints[0].status, mints[0].body)
		require.Equal(t, 200, mints[1].status, mints[1].body)
		mint := mints[0]
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
		resourceToken = mt.AccessToken
		var mt2 struct {
			AccessToken string `json:"access_token"`
		}
		require.NoError(t, json.Unmarshal([]byte(mints[1].body), &mt2))
		require.Equal(t, "rfc012-broker-key", jwtKeyID(t, mt.AccessToken))
		require.Equal(t, "rfc012-broker-next", jwtKeyID(t, mt2.AccessToken))
		tenantID := mustEnv(t, "RFC012_TENANT_A_ORG_ID")
		require.Equal(t, http.StatusOK, c.jsonHeader("POST", product+"/fixture/connections", "", map[string]any{"connection_id": connectionID, "tenant_id": tenantID, "active": true}, "X-Fixture-Secret", fixtureSecret).status)
		oldSigner := c.json("POST", product+"/v1/mcp/read", mt.AccessToken, nil)
		require.Equal(t, 200, oldSigner.status, "old signer token rejected during overlap: %s", oldSigner.body)
		newSigner := c.json("POST", product+"/v1/mcp/read", mt2.AccessToken, nil)
		require.Equal(t, 200, newSigner.status, "new signer token rejected during overlap: %s", newSigner.body)
	})

	t.Run("product MCP authorization approval retry and one-time use", func(t *testing.T) {
		tenantID := mustEnv(t, "RFC012_TENANT_A_ORG_ID")
		wrongAudience := fixtureResourceToken(t, connectionID, tenantID, "wrong-audience", []string{"dev:records.read"}, time.Now().Add(5*time.Minute))
		expired := fixtureResourceToken(t, connectionID, tenantID, "dev-product-api", []string{"dev:records.read"}, time.Now().Add(-time.Minute))
		missingScope := fixtureResourceToken(t, connectionID, tenantID, "dev-product-api", []string{"dev:payments.execute"}, time.Now().Add(5*time.Minute))
		require.Equal(t, http.StatusOK, c.jsonHeader("POST", product+"/fixture/connections", "", map[string]any{"connection_id": connectionID, "tenant_id": tenantID, "active": true}, "X-Fixture-Secret", fixtureSecret).status)
		require.Equal(t, 401, c.json("POST", product+"/v1/mcp/read", wrongAudience, nil).status)
		require.Equal(t, 401, c.json("POST", product+"/v1/mcp/read", expired, nil).status)
		require.Equal(t, 403, c.json("POST", product+"/v1/mcp/read", missingScope, nil).status)
		challenge := c.json("POST", product+"/v1/mcp/pay?resource_id=payrun-1", resourceToken, nil)
		require.Equal(t, 428, challenge.status, challenge.body)
		require.Equal(t, "approval_required", challenge.code())
		verifier := "rfc012-desktop-pkce-verifier-with-sufficient-entropy"
		sum := sha256.Sum256([]byte(verifier))
		inputDigest := approvalArgumentsDigest(t, map[string]any{"resource_id": "payrun-1"})
		desktopChallenge := "desktop-challenge-rfc012"
		actor := "user_rfc012_a"
		productSessionID, productConfigDigest := approvalResourceBinding(t, resourceToken)
		issueBody := map[string]any{
			"product_origin": product, "approval_id": "payrun-1", "desktop_challenge_id": desktopChallenge,
			"connection_id": connectionID, "tool": "payments.execute", "action": "payment.release", "input_digest": inputDigest,
			"approver": actor, "code_challenge": base64.RawURLEncoding.EncodeToString(sum[:]),
			"product_session_id": productSessionID, "product_config_digest": productConfigDigest,
		}
		issued := c.jsonHeader("POST", product+"/v1/approvals", "", issueBody, "X-Fixture-Secret", fixtureSecret)
		require.Equal(t, http.StatusCreated, issued.status, issued.body)
		require.NotContains(t, strings.ToLower(issued.body), "approval_token")
		var issuedBody struct {
			CompletionCode string `json:"completion_code"`
		}
		require.NoError(t, json.Unmarshal([]byte(issued.body), &issuedBody))
		require.NotEmpty(t, issuedBody.CompletionCode)
		redeemBody := map[string]any{
			"code": issuedBody.CompletionCode, "code_verifier": verifier, "desktop_challenge_id": desktopChallenge,
			"connection_id": connectionID, "tool": "payments.execute", "arguments_digest": inputDigest,
			"actor": actor, "action": "payment.release", "product_session_id": productSessionID,
			"product_config_digest": productConfigDigest,
		}
		for label, mutation := range map[string]map[string]any{
			"wrong verifier":        {"code_verifier": "wrong-verifier"},
			"wrong connection":      {"connection_id": "wrong-connection"},
			"wrong tool":            {"tool": "payments.cancel"},
			"empty tool":            {"tool": ""},
			"wrong action":          {"action": "payment.cancel"},
			"wrong arguments":       {"arguments_digest": approvalArgumentsDigest(t, map[string]any{"resource_id": "payrun-2"})},
			"wrong actor assertion": {"actor": "user_rfc012_b"},
			"wrong product session": {"product_session_id": "wrong-session"},
			"wrong product config":  {"product_config_digest": approvalArgumentsDigest(t, map[string]any{"config": "wrong"})},
		} {
			attempt := mapsClone(redeemBody)
			for key, value := range mutation {
				attempt[key] = value
			}
			failed := c.json("POST", product+"/v1/approvals/redeem", resourceToken, attempt)
			require.Equal(t, http.StatusBadRequest, failed.status, label+": "+failed.body)
			require.NotContains(t, failed.body, issuedBody.CompletionCode)
		}
		wrongActorToken := fixtureResourceTokenForUser(t, "user_rfc012_b", connectionID, tenantID, "dev-product-api", []string{"dev:payments.execute"}, time.Now().Add(5*time.Minute))
		wrongActorRedeem := mapsClone(redeemBody)
		wrongActorRedeem["actor"] = "user_rfc012_b"
		wrongActorSession, wrongActorConfig := approvalResourceBinding(t, wrongActorToken)
		wrongActorRedeem["product_session_id"] = wrongActorSession
		wrongActorRedeem["product_config_digest"] = wrongActorConfig
		require.Equal(t, http.StatusForbidden, c.json("POST", product+"/v1/approvals/redeem", wrongActorToken, wrongActorRedeem).status, "authenticated wrong actor redeemed approval")
		wrongOriginBody := mapsClone(issueBody)
		wrongOriginBody["desktop_challenge_id"] = "wrong-origin-challenge"
		wrongOriginBody["product_origin"] = "https://wrong-origin.example"
		wrongOrigin := c.jsonHeader("POST", product+"/v1/approvals", "", wrongOriginBody, "X-Fixture-Secret", fixtureSecret)
		require.Equal(t, http.StatusBadRequest, wrongOrigin.status, wrongOrigin.body)

		redeemed := c.json("POST", product+"/v1/approvals/redeem", resourceToken, redeemBody)
		require.Equal(t, http.StatusOK, redeemed.status, redeemed.body)
		var redemption struct {
			ApprovalToken string `json:"approval_token"`
		}
		require.NoError(t, json.Unmarshal([]byte(redeemed.body), &redemption))
		require.NotEmpty(t, redemption.ApprovalToken)
		idempotentReplay := c.json("POST", product+"/v1/approvals/redeem", resourceToken, redeemBody)
		require.Equal(t, http.StatusOK, idempotentReplay.status, idempotentReplay.body)
		var replayed struct {
			ApprovalToken string `json:"approval_token"`
		}
		require.NoError(t, json.Unmarshal([]byte(idempotentReplay.body), &replayed))
		require.Equal(t, redemption.ApprovalToken, replayed.ApprovalToken, "completion replay minted a second bearer")
		var approvalRows int
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM dev_product_approvals WHERE source_code_hash=encode(digest($1,'sha256'),'hex')`, issuedBody.CompletionCode).Scan(&approvalRows))
		require.Equal(t, 1, approvalRows, "completion replay created duplicate bearer state")
		approval := redemption.ApprovalToken
		retry := c.jsonHeader("POST", product+"/v1/mcp/pay?resource_id=payrun-1", resourceToken, nil, "X-Approval-Token", approval)
		require.Equal(t, 200, retry.status, retry.body)
		reuse := c.jsonHeader("POST", product+"/v1/mcp/pay?resource_id=payrun-1", resourceToken, nil, "X-Approval-Token", approval)
		require.Equal(t, 428, reuse.status, "approval token was reusable")

		ambiguousIssueBody := mapsClone(issueBody)
		ambiguousIssueBody["approval_id"] = "payrun-ambiguous"
		ambiguousIssueBody["desktop_challenge_id"] = "desktop-challenge-ambiguous"
		ambiguousIssueBody["input_digest"] = approvalArgumentsDigest(t, map[string]any{"resource_id": "payrun-ambiguous"})
		ambiguousIssued := c.jsonHeader("POST", product+"/v1/approvals", "", ambiguousIssueBody, "X-Fixture-Secret", fixtureSecret)
		require.Equal(t, http.StatusCreated, ambiguousIssued.status, ambiguousIssued.body)
		var ambiguousCode struct {
			CompletionCode string `json:"completion_code"`
		}
		require.NoError(t, json.Unmarshal([]byte(ambiguousIssued.body), &ambiguousCode))
		ambiguousRedeem := mapsClone(redeemBody)
		ambiguousRedeem["code"] = ambiguousCode.CompletionCode
		ambiguousRedeem["desktop_challenge_id"] = ambiguousIssueBody["desktop_challenge_id"]
		ambiguousRedeem["arguments_digest"] = ambiguousIssueBody["input_digest"]
		ambiguous := c.jsonHeaders("POST", product+"/v1/approvals/redeem", resourceToken, ambiguousRedeem, map[string]string{
			"X-Fixture-Secret": fixtureSecret, "X-Fixture-Approval-Commit": "committed-without-ack",
		})
		require.Equal(t, http.StatusOK, ambiguous.status, ambiguous.body)
		var ambiguousRedemption struct {
			ApprovalToken string `json:"approval_token"`
		}
		require.NoError(t, json.Unmarshal([]byte(ambiguous.body), &ambiguousRedemption))
		require.NotEmpty(t, ambiguousRedemption.ApprovalToken)
		ambiguousRetry := c.json("POST", product+"/v1/approvals/redeem", resourceToken, ambiguousRedeem)
		require.Equal(t, http.StatusOK, ambiguousRetry.status, ambiguousRetry.body)
		var ambiguousRetryBody struct {
			ApprovalToken string `json:"approval_token"`
		}
		require.NoError(t, json.Unmarshal([]byte(ambiguousRetry.body), &ambiguousRetryBody))
		require.Equal(t, ambiguousRedemption.ApprovalToken, ambiguousRetryBody.ApprovalToken, "ambiguous commit retry minted a duplicate bearer")
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM dev_product_approvals WHERE source_code_hash=encode(digest($1,'sha256'),'hex')`, ambiguousCode.CompletionCode).Scan(&approvalRows))
		require.Equal(t, 1, approvalRows, "ambiguous commit did not converge to one approval row")
		ambiguousPay := c.jsonHeader("POST", product+"/v1/mcp/pay?resource_id=payrun-ambiguous", resourceToken, nil, "X-Approval-Token", ambiguousRedemption.ApprovalToken)
		require.Equal(t, http.StatusOK, ambiguousPay.status, ambiguousPay.body)
		ambiguousPayReplay := c.jsonHeader("POST", product+"/v1/mcp/pay?resource_id=payrun-ambiguous", resourceToken, nil, "X-Approval-Token", ambiguousRedemption.ApprovalToken)
		require.Equal(t, http.StatusPreconditionRequired, ambiguousPayReplay.status, "ambiguously committed approval bearer was reusable")
	})

	t.Run("already-issued tokens fail closed across live lifecycle changes", func(t *testing.T) {
		tenantID := mustEnv(t, "RFC012_TENANT_A_ORG_ID")
		// Product-side disconnect is enforced before the product invokes the broker.
		require.Equal(t, http.StatusOK, c.jsonHeader("POST", product+"/fixture/connections", "", map[string]any{"connection_id": connectionID, "tenant_id": tenantID, "active": false}, "X-Fixture-Secret", fixtureSecret).status)
		require.Equal(t, http.StatusForbidden, c.json("POST", product+"/v1/mcp/read", resourceToken, nil).status)
		require.Equal(t, http.StatusOK, c.jsonHeader("POST", product+"/fixture/connections", "", map[string]any{"connection_id": connectionID, "tenant_id": tenantID, "active": true}, "X-Fixture-Secret", fixtureSecret).status)

		// A new product entitlement generation denies the already-issued token on
		// the next request without waiting for token expiry or another broker mint.
		require.Equal(t, http.StatusOK, c.jsonHeader("POST", product+"/fixture/entitlements", "", map[string]any{"user_id": "user_rfc012_a", "allowed": false, "reason": "user_banned"}, "X-Fixture-Secret", fixtureSecret).status)
		require.Equal(t, http.StatusForbidden, c.json("POST", product+"/v1/mcp/read", resourceToken, nil).status)
		require.Equal(t, http.StatusOK, c.jsonHeader("POST", product+"/fixture/entitlements", "", map[string]any{"user_id": "user_rfc012_a", "allowed": true}, "X-Fixture-Secret", fixtureSecret).status)

		// Re-consent replaces the credential generation. The original token remains
		// cryptographically valid but its live generation binding is stale.
		start := c.json("POST", api+"/v1/connections/"+connector+"/start", tokenA, map[string]any{"requestedScopes": []string{"dev:records.read", "dev:payments.execute"}})
		require.Equal(t, http.StatusOK, start.status, start.body)
		var started struct {
			AuthorizeURL string `json:"authorize_url"`
		}
		require.NoError(t, json.Unmarshal([]byte(start.body), &started))
		callback := completeConsent(t, started.AuthorizeURL, []string{"dev:records.read", "dev:payments.execute"})
		claim := c.json("POST", api+"/v1/connections/"+connector+"/claim", tokenA, map[string]string{"state": queryFromLocation(t, callback.header.Get("Location"), "session")})
		require.Equal(t, http.StatusOK, claim.status, claim.body)
		require.Equal(t, http.StatusForbidden, c.json("POST", product+"/v1/mcp/read", resourceToken, nil).status)
		mint := c.json("POST", api+"/v1/connections/"+connector+"/mcp-token", tokenA, nil)
		require.Equal(t, http.StatusOK, mint.status, mint.body)
		var minted struct {
			AccessToken string `json:"access_token"`
		}
		require.NoError(t, json.Unmarshal([]byte(mint.body), &minted))
		resourceToken = minted.AccessToken

		// Product-scoped organization invalidation immediately denies the new token.
		invalidated := signedProductRequest(t, c, api+"/v1/internal/connections/invalidate", map[string]any{"org_id": tenantID, "connector": connector, "reason": "organization_membership_removed"})
		require.Equal(t, http.StatusOK, invalidated.status, invalidated.body)
		require.Equal(t, http.StatusForbidden, c.json("POST", product+"/v1/mcp/read", resourceToken, nil).status)
	})

	t.Run("entitlement downgrade denies mint", func(t *testing.T) {
		// The public connection routes intentionally enforce an eight-request burst
		// window. Earlier subtests exercise concurrent claims and mints against that
		// same authenticated principal, so wait for the production bucket to roll
		// rather than weakening or bypassing the limiter in acceptance.
		time.Sleep(11 * time.Second)

		// The preceding lifecycle test intentionally invalidates the current grant.
		// Establish an independent active grant before downgrading the subscription so
		// this subtest proves entitlement enforcement rather than merely observing the
		// earlier tombstone.
		start := c.json("POST", api+"/v1/connections/"+connector+"/start", tokenA, map[string]any{"requestedScopes": []string{"dev:records.read", "dev:payments.execute"}})
		require.Equal(t, http.StatusOK, start.status, start.body)
		var started struct {
			AuthorizeURL string `json:"authorize_url"`
		}
		require.NoError(t, json.Unmarshal([]byte(start.body), &started))
		callback := completeConsent(t, started.AuthorizeURL, []string{"dev:records.read", "dev:payments.execute"})
		claim := c.json("POST", api+"/v1/connections/"+connector+"/claim", tokenA, map[string]string{"state": queryFromLocation(t, callback.header.Get("Location"), "session")})
		require.Equal(t, http.StatusOK, claim.status, claim.body)

		_, err := db.Exec(`UPDATE subscriptions SET status='past_due',updated_at=now() WHERE user_subscription=(SELECT id FROM users WHERE workos_user_id='user_rfc012_a')`)
		require.NoError(t, err)
		denied := c.json("POST", api+"/v1/connections/"+connector+"/mcp-token", tokenA, nil)
		require.Equal(t, http.StatusForbidden, denied.status, denied.body)
		require.NotEmpty(t, denied.code())
		var status string
		var refreshBytes, apiKeyBytes int
		require.NoError(t, db.QueryRow(`SELECT status,COALESCE(octet_length(refresh_token_encrypted),0),COALESCE(octet_length(api_key_encrypted),0) FROM mcp_connections WHERE id=$1`, connectionID).Scan(&status, &refreshBytes, &apiKeyBytes))
		require.Equal(t, "invalidated", status)
		require.Zero(t, refreshBytes, "entitlement invalidation retained the refresh grant")
		require.Zero(t, apiKeyBytes, "entitlement invalidation retained the API key")
		_, err = db.Exec(`UPDATE subscriptions SET status='active',updated_at=now() WHERE user_subscription=(SELECT id FROM users WHERE workos_user_id='user_rfc012_a')`)
		require.NoError(t, err)
	})

	t.Run("disconnect revokes upstream tombstones audits and denies product", func(t *testing.T) {
		// Restoring entitlement must not resurrect an invalidated grant. Re-consent
		// explicitly before exercising the independent user-disconnect transition.
		start := c.json("POST", api+"/v1/connections/"+connector+"/start", tokenA, map[string]any{"requestedScopes": []string{"dev:records.read", "dev:payments.execute"}})
		require.Equal(t, http.StatusOK, start.status, start.body)
		var started struct {
			AuthorizeURL string `json:"authorize_url"`
		}
		require.NoError(t, json.Unmarshal([]byte(start.body), &started))
		callback := completeConsent(t, started.AuthorizeURL, []string{"dev:records.read", "dev:payments.execute"})
		claimTicket := queryFromLocation(t, callback.header.Get("Location"), "session")
		claim := c.json("POST", api+"/v1/connections/"+connector+"/claim", tokenA, map[string]string{"state": claimTicket})
		require.Equal(t, http.StatusOK, claim.status, claim.body)
		mint := c.json("POST", api+"/v1/connections/"+connector+"/mcp-token", tokenA, nil)
		require.Equal(t, http.StatusOK, mint.status, mint.body)
		var fresh struct {
			AccessToken string `json:"access_token"`
		}
		require.NoError(t, json.Unmarshal([]byte(mint.body), &fresh))
		resourceToken = fresh.AccessToken
		require.Equal(t, http.StatusOK, c.jsonHeader("POST", product+"/fixture/connections", "", map[string]any{"connection_id": connectionID, "tenant_id": mustEnv(t, "RFC012_TENANT_A_ORG_ID"), "active": true}, "X-Fixture-Secret", fixtureSecret).status)
		require.Equal(t, http.StatusOK, c.json("POST", product+"/v1/mcp/read", resourceToken, nil).status)

		d := c.json("DELETE", mustEnv(t, "RFC012_API2_URL")+"/v1/connections/"+connector, tokenA, nil)
		require.Contains(t, []int{200, 204}, d.status, d.body)
		var status string
		var revokedAt sql.NullTime
		var revokeOK sql.NullBool
		require.NoError(t, db.QueryRow(`SELECT status,revoked_at,revocation_succeeded FROM mcp_connections WHERE id=$1`, connectionID).Scan(&status, &revokedAt, &revokeOK))
		require.Equal(t, "revoked", status)
		require.True(t, revokedAt.Valid)
		require.True(t, revokeOK.Valid && revokeOK.Bool, "upstream revoke was not recorded successful")
		var audits int
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM connector_audit_events WHERE connection_id=$1 AND event_type='token.revoked'`, connectionID).Scan(&audits))
		require.Positive(t, audits, "semantic token.revoked audit event missing")
		denied := c.json("POST", product+"/v1/mcp/read", resourceToken, nil)
		require.Equal(t, 403, denied.status)
		require.Equal(t, "connection_revoked", denied.code())
		var leaked int
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM connector_audit_events WHERE metadata_json ILIKE '%api_key%' OR metadata_json ILIKE '%access_token%' OR metadata_json ILIKE '%refresh_token%'`).Scan(&leaked))
		require.Zero(t, leaked, "connector audit disclosed credential-shaped fields")
	})

	t.Run("semantic durable audit contract", func(t *testing.T) {
		for _, eventType := range []string{"entitlement.check", "token.refreshed", "token.revoked"} {
			var count int
			require.NoError(t, db.QueryRow(`SELECT count(*) FROM connector_audit_events WHERE event_type=$1`, eventType).Scan(&count))
			require.Positive(t, count, "missing durable semantic event %s", eventType)
		}
	})
}

func jwtKeyID(t *testing.T, raw string) string {
	t.Helper()
	tok, _, err := new(jwt.Parser).ParseUnverified(raw, jwt.MapClaims{})
	require.NoError(t, err)
	kid, _ := tok.Header["kid"].(string)
	require.NotEmpty(t, kid)
	return kid
}

func signedProductRequest(t *testing.T, c *client, endpoint string, body any) response {
	t.Helper()
	raw, err := json.Marshal(body)
	require.NoError(t, err)
	u, err := url.Parse(endpoint)
	require.NoError(t, err)
	principal := mustEnv(t, "RFC012_PRODUCT_SERVICE_PRINCIPAL")
	secret := mustEnv(t, "RFC012_PRODUCT_SERVICE_HMAC_SECRET")
	timestamp := strconv.FormatInt(time.Now().UTC().UnixMilli(), 10)
	nonceBytes := sha256.Sum256([]byte(timestamp + endpoint + fmt.Sprint(time.Now().UnixNano())))
	nonce := base64.RawURLEncoding.EncodeToString(nonceBytes[:24])
	bodyHash := sha256.Sum256(raw)
	canonical := strings.Join([]string{"v1", http.MethodPost, u.EscapedPath(), principal, timestamp, nonce, fmt.Sprintf("%x", bodyHash)}, "\n")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonical))
	return c.jsonHeaders("POST", endpoint, "", body, map[string]string{
		"X-Connector-Principal": principal, "X-Connector-Timestamp": timestamp,
		"X-Connector-Nonce": nonce, "X-Connector-Signature": "sha256=" + fmt.Sprintf("%x", mac.Sum(nil)),
	})
}

func mapsClone(input map[string]any) map[string]any {
	result := make(map[string]any, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}

func fixtureHTTPClient(t *testing.T) *http.Client {
	t.Helper()
	pemBytes, err := os.ReadFile(mustEnv(t, "RFC012_TLS_CA"))
	require.NoError(t, err)
	roots := x509.NewCertPool()
	require.True(t, roots.AppendCertsFromPEM(pemBytes))
	return &http.Client{Timeout: 15 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}}}
}

var csrfPattern = regexp.MustCompile(`name="csrf" value="([^"]+)"`)

// completeConsent models the desktop protocol driver. It keeps browser cookies,
// refuses implicit redirects, posts the consent decision to the second consent
// replica, completes WorkOS MFA when requested, and stops at the native desktop
// deep link returned by the public callback.
func completeConsent(t *testing.T, authorizeURL string, scopes []string) response {
	t.Helper()
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	h := &http.Client{Timeout: 15 * time.Second, Jar: jar, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	do := func(method, endpoint string, body io.Reader, contentType string) response {
		req, err := http.NewRequest(method, endpoint, body)
		require.NoError(t, err)
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		resp, err := h.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		require.NoError(t, err)
		return response{status: resp.StatusCode, body: string(b), header: resp.Header.Clone()}
	}
	next := do(http.MethodGet, authorizeURL, nil, "")
	require.Contains(t, []int{http.StatusFound, http.StatusSeeOther}, next.status, next.body)
	page := do(http.MethodGet, next.header.Get("Location"), nil, "")
	require.Equal(t, http.StatusOK, page.status, page.body)
	match := csrfPattern.FindStringSubmatch(page.body)
	require.Len(t, match, 2, page.body)
	form := url.Values{"csrf": {match[1]}, "decision": {"approve"}, "confirm_high": {"yes"}}
	for _, scope := range scopes {
		form.Add("scope", scope)
	}
	next = do(http.MethodPost, strings.TrimRight(mustEnv(t, "RFC012_CONSENT2_URL"), "/")+"/consent/decision", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded")
	require.Contains(t, []int{http.StatusFound, http.StatusSeeOther}, next.status, next.body)
	for i := 0; i < 5; i++ {
		location := next.header.Get("Location")
		require.NotEmpty(t, location)
		redirectURL, err := url.Parse(location)
		require.NoError(t, err)
		if redirectURL.Scheme != "http" && redirectURL.Scheme != "https" {
			return next
		}
		next = do(http.MethodGet, location, nil, "")
		require.Contains(t, []int{http.StatusFound, http.StatusSeeOther}, next.status, next.body)
	}
	t.Fatalf("desktop protocol driver exceeded redirect budget: %+v", next.header)
	return response{}
}

func fixtureResourceToken(t *testing.T, connectionID, organizationID, audience string, scopes []string, expiresAt time.Time) string {
	return fixtureResourceTokenForUser(t, "user_rfc012_a", connectionID, organizationID, audience, scopes, expiresAt)
}

func fixtureResourceTokenForUser(t *testing.T, userID, connectionID, organizationID, audience string, scopes []string, expiresAt time.Time) string {
	t.Helper()
	block, _ := pem.Decode([]byte(mustEnv(t, "RFC012_BROKER_PRIVATE_KEY_PEM")))
	require.NotNil(t, block)
	var key *rsa.PrivateKey
	if parsed, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		key = parsed
	} else {
		parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		require.NoError(t, err)
		var ok bool
		key, ok = parsed.(*rsa.PrivateKey)
		require.True(t, ok)
	}
	now := time.Now().UTC()
	claims := jwt.MapClaims{
		"iss": mustEnv(t, "RFC012_BROKER_TOKEN_ISSUER"), "aud": []string{audience}, "sub": userID,
		"iat": now.Unix(), "nbf": now.Add(-time.Minute).Unix(), "exp": expiresAt.Unix(), "jti": "fixture-" + fmt.Sprint(now.UnixNano()),
		"scope": strings.Join(scopes, " "),
		"ext":   map[string]any{"user_id": userID, "organization_id": organizationID, "connection_id": connectionID, "connector_id": getenv("RFC012_CONNECTOR", "dev-product"), "credential_generation": 1, "trust_tier": "low"},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = mustEnv(t, "RFC012_BROKER_TOKEN_KEY_ID")
	signed, err := token.SignedString(key)
	require.NoError(t, err)
	return signed
}

func approvalResourceBinding(t *testing.T, raw string) (string, string) {
	t.Helper()
	claims := jwt.MapClaims{}
	_, _, err := new(jwt.Parser).ParseUnverified(raw, claims)
	require.NoError(t, err)
	sessionID, _ := claims["jti"].(string)
	issuer, _ := claims["iss"].(string)
	ext, _ := claims["ext"].(map[string]any)
	connectorID, _ := ext["connector_id"].(string)
	connectionID, _ := ext["connection_id"].(string)
	audience := claimStrings(claims["aud"])
	sort.Strings(audience)
	require.NotEmpty(t, sessionID)
	require.NotEmpty(t, connectionID)
	return sessionID, approvalDigestParts("product-config-v1", issuer, strings.Join(audience, "\x00"), connectorID, connectionID)
}

func claimStrings(raw any) []string {
	switch value := raw.(type) {
	case string:
		return []string{value}
	case []string:
		return append([]string(nil), value...)
	case []any:
		out := make([]string, 0, len(value))
		for _, item := range value {
			if text, ok := item.(string); ok {
				out = append(out, text)
			}
		}
		return out
	default:
		return nil
	}
}

func approvalArgumentsDigest(t *testing.T, value any) string {
	t.Helper()
	canonical, err := approvalCanonicalJSON(value)
	require.NoError(t, err)
	sum := sha256.Sum256([]byte(canonical))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func approvalCanonicalJSON(value any) (string, error) {
	switch typed := value.(type) {
	case nil, bool, string, float64, json.Number:
		b, err := json.Marshal(typed)
		return string(b), err
	case []any:
		parts := make([]string, len(typed))
		for i, item := range typed {
			part, err := approvalCanonicalJSON(item)
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
			valueJSON, err := approvalCanonicalJSON(typed[key])
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
		dec := json.NewDecoder(bytes.NewReader(b))
		dec.UseNumber()
		if err := dec.Decode(&normalized); err != nil {
			return "", err
		}
		return approvalCanonicalJSON(normalized)
	}
}

func approvalDigestParts(label string, parts ...string) string {
	h := sha256.New()
	_, _ = io.WriteString(h, label)
	for _, part := range parts {
		_, _ = io.WriteString(h, "\x00"+part)
	}
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
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
	headers := map[string]string{}
	if hk != "" {
		headers[hk] = hv
	}
	return c.jsonHeaders(method, endpoint, bearer, body, headers)
}
func (c *client) jsonHeaders(method, endpoint, bearer string, body any, headers map[string]string) response {
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
	for name, value := range headers {
		req.Header.Set(name, value)
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
