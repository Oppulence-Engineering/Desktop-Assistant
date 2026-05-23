# Oppulence Connector Suite — OAuth 2.0 Authorization for Cross-Product Access

> Companion to [BACKEND_API_SPEC.md](./BACKEND_API_SPEC.md) and [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md). This doc defines the cross-product OAuth 2.0 protocol that lets the Rowboat desktop (and any future client) connect to user-owned data in Canvas, Corinthian, Billflow, and future Oppulence products.

## 1. Goal

A single OAuth 2.0 flow that connects the Rowboat desktop to a user's account in any Oppulence product. One protocol, one consent screen pattern, one library per language. New products plug in by implementing one interface; new clients plug in by following the standard PKCE flow.

This is what Google does with `accounts.google.com` for Gmail / Calendar / Drive. We're doing the same shape for `oauth.solomon-ai.co` across Canvas / Corinthian / Billflow.

## 2. Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                  Identity & Authorization Plane                     │
│                                                                     │
│   WorkOS (user identity)         Ory Hydra (OAuth 2.0 issuer,       │
│   AuthKit, sign-in/up   ◄──IDP── Helm on Hetzner k3s, US-East)      │
│                                  /oauth2/auth, /oauth2/token        │
│                                  /oauth2/introspect, /jwks          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ issues scoped, audience-bound JWTs
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Resource Server Plane                         │
│                                                                     │
│   Canvas API + MCP    Corinthian API + MCP    Billflow API + MCP    │
│   (audience:          (audience:              (audience:            │
│   canvas-api)         corinthian-api)         billflow-api)         │
│                                                                     │
│   Each verifies JWT → checks audience → enforces scope per route.   │
└─────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │ uses tokens
                                  │
┌─────────────────────────────────────────────────────────────────────┐
│                        Client Plane                                 │
│                                                                     │
│   Rowboat Desktop (apps/x) — public OAuth client, PKCE, no secret.  │
│   Holds refresh tokens in OS keychain.                              │
│                                                                     │
│   rowboat-api brokers the exchange (server-side code/token swap),   │
│   so the desktop never sees the upstream auth code or refresh       │
│   token directly.                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

## 3. Architectural decisions

| Concern | Choice |
|---|---|
| OAuth 2.0 authorization server | **Self-hosted Ory Hydra** via the official Ory Helm chart, deployed onto the org's existing Hetzner k3s clusters (`oppulence-infrastructure-as-code`). Same software as Ory Network, operated by us. Apache 2.0 license. Avoids Ory's $99–$999/mo managed pricing. See §17 for ops. |
| User identity provider | **WorkOS AuthKit** — federated into Ory via OIDC. Ory delegates login to WorkOS. |
| Token format | **JWT access tokens** signed by Ory (RS256). JWKS published at `<issuer>/.well-known/jwks.json`. |
| Client model | One OAuth client per first-party application. Rowboat desktop is one public client (`rowboat-desktop`) with PKCE, no client secret. |
| Audience model | One audience per resource server: `canvas-api`, `corinthian-api`, `billflow-api`. The desktop requests tokens scoped to one audience at a time. |
| Code & token storage | Codes ephemeral in Ory (max 60s). Refresh tokens stored encrypted in `rowboat-api`'s Postgres (`MCPConnection.refresh_token_encrypted`). Desktop never sees the refresh token. |
| Consent UI hosting | New Next.js app: `apps/oauth-consent`, deployed to `consent.solomon-ai.co`. |
| Scope vocabulary owner | This document. Versioned. Adding scopes is a one-doc-PR + per-product-update. |

## 3a. Why self-host Hydra (and not Ory Network)

Ory's hosted pricing (per ory.com/pricing):

| Tier | Cost | Limit |
|------|------|-------|
| Free | $0 | 3k MAUs, shared subdomain only — no custom domain |
| Starter | $29/mo | 5k MAUs, still no full custom domain features |
| Growth | $99/mo | Custom domain, 10k MAUs |
| Scale | $999/mo | Higher MAU caps, audit log retention |

Custom domain (`oauth.solomon-ai.co`) is non-negotiable for a real OAuth server — both for users' trust and to avoid lock-in. That puts us at $99/mo minimum, scaling up. Pre-revenue that's hard to justify.

Self-hosting is cheap and operationally light **because we already run multi-region k3s clusters** (`oppulence-infrastructure-as-code/clusters/{us-east,us-west,eu-central}`):

- Official Ory Helm chart (`ory/hydra` from the [ory/k8s repo](https://github.com/ory/k8s)) — production-tested, versioned, configurable.
- Deploys onto the existing Hetzner clusters — no new infrastructure to provision.
- Uses the existing NGINX ingress + cert-manager for `oauth.solomon-ai.co`.
- One Postgres dependency — Hydra uses its own database in our managed Postgres (Hetzner or DO, see §17.1).
- No user management to run — Hydra delegates login to WorkOS via OIDC. We don't touch passwords.
- Upgrades: bump `Chart.yaml` version, `helm upgrade`. Hydra is semver-disciplined; minor versions every 2–3 months.
- Resource footprint: 2 replicas × 100m CPU, 128Mi memory for the public deployment; same for admin. Negligible against existing cluster capacity.

Migration path: if we grow past hand-rolling ops, Ory Network supports importing a self-hosted Hydra config. Not locked in.

## 4. Identity vs authorization — keep them separate

Two different jobs, two different services:

| Concern | Owner | Notes |
|---|---|---|
| Who is this user? Sign-up, sign-in, MFA, password reset, magic links, SSO. | **WorkOS** | One user identity per human. The user signs in once. |
| What is this user authorized to do across Oppulence products, in this session, for this client app? | **Ory** | Issues scoped tokens. Knows nothing about passwords. |

Ory is configured to delegate authentication to WorkOS via OIDC: Ory's `/oauth2/auth` will, when the user has no Ory session, redirect to WorkOS's `/authorize`. After WorkOS sign-in, Ory continues the OAuth dance and issues product-scoped tokens.

This split means:
- A user has one identity (WorkOS) across all products forever.
- The desktop's connection to Canvas can be revoked without revoking the user's Canvas subscription.
- The user can have many active connections (Robo + future clients) without affecting their identity.

## 5. Scope vocabulary

Scopes are namespaced `{product}:{resource}.{action}`. Read scopes are low-trust; write scopes are medium-trust; execute scopes are high-trust (money-moving or external-effect).

### Canvas

| Scope | Trust | What it grants |
|-------|-------|----------------|
| `canvas:invoices.read` | low | List + read invoices |
| `canvas:invoices.write` | med | Draft + edit + delete invoices |
| `canvas:invoices.send` | high | Send an invoice to a customer (external email) |
| `canvas:customers.read` | low | List + read customer records |
| `canvas:customers.write` | med | Create + edit customers |
| `canvas:bank-accounts.read` | low | Read bank account list + balances |
| `canvas:transactions.read` | low | Read bank transactions |
| `canvas:transactions.categorize` | med | Apply categories + tags |
| `canvas:documents.read` | low | Read uploaded documents |
| `canvas:documents.upload` | med | Upload new documents |
| `canvas:reports.read` | low | Read forecasts + reports |
| `canvas:dunning.read` | low | Read dunning policies + queues |
| `canvas:dunning.execute` | high | Trigger dunning actions (sends customer comms) |

### Corinthian

| Scope | Trust | What it grants |
|-------|-------|----------------|
| `corinthian:cases.read` | low | Read AR / collections cases |
| `corinthian:cases.write` | med | Create + edit cases, log notes |
| `corinthian:communications.read` | low | Read communication threads |
| `corinthian:communications.send` | high | Send a customer-facing message |
| `corinthian:payments.read` | low | Read payment intents + promises-to-pay |
| `corinthian:payments.execute` | **money-moving** | Initiate refunds, settlements, charges |
| `corinthian:reports.read` | low | Read AR reports + analytics |

### Billflow

| Scope | Trust | What it grants |
|-------|-------|----------------|
| `billflow:invoices.read` | low | Read AP invoice queue |
| `billflow:invoices.write` | med | Edit + categorize AP invoices |
| `billflow:approvals.read` | low | Read approval workflow state |
| `billflow:approvals.execute` | **money-moving** | Approve or reject an AP invoice |
| `billflow:vendors.read` | low | Read vendor records |
| `billflow:vendors.write` | med | Create + edit vendors |
| `billflow:payments.execute` | **money-moving** | Initiate a vendor payment |

### Trust tiers — what they imply

- **low** — granted in the standard consent flow. No extra warnings.
- **med** — granted in the standard consent flow with explicit visual emphasis ("This allows Rowboat to modify your records").
- **high** — granted in the standard consent flow but with an extra confirmation step ("Rowboat will be able to send emails to your customers").
- **money-moving** — granted only after a **step-up authentication** at the consent screen (re-enter WorkOS MFA), and require per-invocation approval tokens at the MCP layer for the actual money-moving call. See §10.

## 6. Token shape

Ory issues RS256 JWTs. The claim set:

```json
{
  "iss": "https://oauth.solomon-ai.co",
  "sub": "user_01HABCXXXXXXXXXXXXXXXXX",
  "aud": "canvas-api",
  "client_id": "rowboat-desktop",
  "scope": "canvas:invoices.read canvas:transactions.read canvas:customers.read",
  "exp": 1735693200,
  "iat": 1735689600,
  "jti": "tok_01HABCXXXXXXXXXXXXXXXXX",
  "ext": {
    "workos_user_id": "user_01HABCXXXXXXXXXXXXXXXXX",
    "workos_org_id":  "org_01HABCXXXXXXXXXXXXXXXXX",
    "email":          "user@example.com"
  }
}
```

- `sub` and `ext.workos_user_id` are the same string — Ory populates this from the WorkOS upstream session.
- `aud` is single-valued — one token per resource server. Multi-audience tokens are an anti-pattern (a stolen token shouldn't let an attacker pivot products).
- `ext.workos_org_id` is present only for B2B WorkOS organizations.
- Access tokens are short-lived (15 min default). Refresh tokens are 30 days, rotated on each use, with reuse detection.

## 7. The protocol — end-to-end

This is the **only** flow. Robo connecting Canvas, Corinthian, or Billflow is the same code path with different `product` values and scope sets.

```
1. Desktop reads /v1/connectors from rowboat-api.
2. User clicks "Connect Canvas". Desktop calls:

   POST https://api.x.solomon-ai.co/v1/connections/canvas/start
   Headers: Authorization: Bearer <user's Ory access token for rowboat-api>
   Body:    { scopes: ["canvas:invoices.read", "canvas:transactions.read",
                       "canvas:customers.read"] }

3. rowboat-api generates state + PKCE pair, stores them in OAuthPending,
   returns:

   {
     authorize_url: "https://oauth.solomon-ai.co/oauth2/auth
                     ?client_id=rowboat-desktop
                     &response_type=code
                     &scope=canvas:invoices.read+canvas:transactions.read+
                            canvas:customers.read
                     &audience=canvas-api
                     &state=<csrf-state>
                     &code_challenge=<pkce-s256>
                     &code_challenge_method=S256
                     &redirect_uri=https://api.x.solomon-ai.co/v1/connections/
                                   canvas/callback"
   }

4. Desktop opens the browser to authorize_url.

5. Ory checks if the user has an Ory session.
   - No → Ory redirects to WorkOS AuthKit's /authorize. User signs in.
     WorkOS redirects back to Ory's /oauth2/callback. Ory establishes its session.
   - Yes → continue.

6. Ory pre-consent hook (configured on the Ory project) fires.
   It hits a webhook on rowboat-api:

   POST https://api.x.solomon-ai.co/oauth-hooks/pre-consent
   Body: { user_id, client_id: "rowboat-desktop", audience: "canvas-api",
           scopes: [...] }

   rowboat-api checks:
     - User has an active Canvas subscription? (asks Canvas API: GET
       /v1/internal/entitlements?user_id=...)
     - If no: return { allow: false, reason: "no_subscription",
                       upsell_url: ".../canvas/subscribe" }
     - If yes: return { allow: true }

7. If allowed, Ory redirects to the consent UI:
   https://consent.solomon-ai.co/consent?login_challenge=<challenge>

   Consent UI fetches challenge details from Ory's admin API, shows the
   user-facing screen with scope descriptions, gets approve/deny.
   If money-moving scopes are requested, requires MFA re-entry.

   On approve: POST back to Ory's /oauth2/auth/requests/consent/accept
               with granted scopes.

8. Ory redirects user's browser to:
   https://api.x.solomon-ai.co/v1/connections/canvas/callback?
       code=<one-time-code>&state=<csrf-state>

9. rowboat-api validates state, exchanges code at Ory's /oauth2/token:

   POST https://oauth.solomon-ai.co/oauth2/token
   Body: grant_type=authorization_code, code=..., code_verifier=<pkce>,
         client_id=rowboat-desktop, redirect_uri=...

   → { access_token, refresh_token, expires_in: 900, token_type: "Bearer",
       scope: "canvas:invoices.read canvas:transactions.read canvas:customers.read" }

10. rowboat-api stores the refresh_token encrypted in MCPConnection.

11. rowboat-api responds to the original /callback request by closing the
    browser tab and deep-linking the desktop:
    rowboat://connection-complete?connector=canvas&status=ok

12. Desktop now calls POST /v1/connections/canvas/mcp-token whenever it
    needs to make a Canvas MCP call. rowboat-api either:
      - returns the cached access_token if still valid, or
      - calls Ory's /oauth2/token with grant_type=refresh_token, stores
        the new refresh token, returns the new access token.

13. Desktop opens MCP HTTP transport to api.canvas.solomon-ai.co/v1/mcp
    with Authorization: Bearer <access_token>.

14. Canvas's MCP middleware verifies:
      - JWT signature against Ory JWKS (cached)
      - iss == oauth.solomon-ai.co
      - aud == canvas-api
      - exp not passed
    Extracts scope claim. For each MCP tool call, checks that the
    required scope is present. 403 otherwise.
```

For Corinthian and Billflow, every step is identical — only the `product`, `audience`, and scope values change.

## 8. Consent UI requirements

A small Next.js app at `consent.solomon-ai.co`. Lives in `apps/oauth-consent`. Mounted on Fly.io.

### Routes

| Path | Purpose |
|------|---------|
| `GET /consent?login_challenge=<id>` | Render the consent screen |
| `POST /consent/accept` | Forward acceptance to Ory |
| `POST /consent/deny` | Forward denial to Ory |
| `GET /logout?logout_challenge=<id>` | Render the logout confirmation (for completeness) |

### Visual requirements

- **Product context** — Canvas / Corinthian / Billflow icon and name based on `audience`.
- **Client context** — "Rowboat Desktop" name and icon based on `client_id`.
- **Scope grouping** — group by trust tier. Low scopes collapsed by default, high/money-moving scopes always expanded.
- **Trust-tier visual treatment**:
  - low: gray bullet
  - med: amber dot + "Modify"
  - high: orange dot + "Send / Trigger"
  - money-moving: red dot + "Move money" + lock icon + step-up MFA prompt before approve
- **Optional vs required scopes** — show separately. User can toggle off optional scopes before approving.
- **"Why this product needs access"** — short copy per scope. Source from a JSON catalog in this repo so the protocol owner (this doc) and the UI stay in sync.
- **Upsell mode** — when the pre-consent hook returns `allow: false, reason: "no_subscription"`, the consent UI shows the upsell instead of the approve screen.

### Scope catalog

```ts
// apps/oauth-consent/src/scopes.json
{
  "canvas:invoices.read": {
    "displayName": "Read invoices",
    "description": "Rowboat will be able to see your invoice list and details.",
    "trust": "low"
  },
  "canvas:invoices.send": {
    "displayName": "Send invoices",
    "description": "Rowboat will be able to email invoices to your customers on your behalf.",
    "trust": "high"
  },
  "corinthian:payments.execute": {
    "displayName": "Initiate refunds and settlements",
    "description": "Rowboat will be able to issue refunds or accept settlements that move money.",
    "trust": "money-moving"
  }
  ...
}
```

Single source of truth — the libraries below also import this catalog for validation.

## 9. The `oauth-resource-server` libraries

Two thin libraries that each resource server embeds. Each one is small — under 500 LOC. The libraries do not contain product logic; they verify tokens and check scopes.

### Go: `packages/oauth-resource-server-go`

```go
package oauthrs

type Config struct {
    Issuer    string        // "https://oauth.solomon-ai.co"
    Audience  string        // "canvas-api"
    JWKSCacheTTL time.Duration  // default 1h
}

type Claims struct {
    Subject       string
    ClientID      string
    Scopes        []string
    WorkOSUserID  string
    WorkOSOrgID   string
    Email         string
    Raw           jwt.MapClaims
}

// Require returns chi/net-http middleware that verifies the bearer.
// Attaches *Claims to ctx; handlers retrieve with ClaimsFromCtx(ctx).
func Require(cfg Config) func(http.Handler) http.Handler { ... }

// Scope returns middleware that enforces required scopes.
// Use AllOf for AND, AnyOf for OR.
func Scope(allOf ...string) func(http.Handler) http.Handler { ... }
func AnyOf(scopes ...string) func(http.Handler) http.Handler { ... }

func ClaimsFromCtx(ctx context.Context) (*Claims, bool) { ... }
```

Usage in Canvas's Go-side MCP (if/when Canvas ports to Go) or in Corinthian's MCP if it gains Go components:

```go
r := chi.NewRouter()
r.Use(oauthrs.Require(oauthrs.Config{
    Issuer:   "https://oauth.solomon-ai.co",
    Audience: "canvas-api",
}))

r.Group(func(r chi.Router) {
    r.Use(oauthrs.Scope("canvas:invoices.read"))
    r.Get("/v1/mcp/tools/invoices_list", invoicesListHandler)
})
```

### TypeScript: `packages/oauth-resource-server-ts`

```ts
// packages/oauth-resource-server/src/index.ts
export interface Config {
  issuer: string;            // "https://oauth.solomon-ai.co"
  audience: string;          // "canvas-api"
  jwksCacheTTLSeconds?: number;
}

export interface Claims {
  subject: string;
  clientId: string;
  scopes: string[];
  workosUserId: string;
  workosOrgId?: string;
  email: string;
  raw: Record<string, unknown>;
}

// Hono middleware
export function requireToken(cfg: Config): MiddlewareHandler;

// Scope enforcement — chain after requireToken
export function requireScopes(opts: {
  allOf?: string[];
  anyOf?: string[];
}): MiddlewareHandler;

// Read claims from c.var
export function claims(c: Context): Claims;
```

Usage in Canvas API (the actual file is `oppulence-canvas/packages/api/src/mcp/server.ts`):

```ts
import { requireToken, requireScopes } from "@oppulence/oauth-resource-server";

const mcp = new Hono();

// Verify all tokens on the MCP routes.
mcp.use("/*", requireToken({
  issuer:   "https://oauth.solomon-ai.co",
  audience: "canvas-api",
}));

// Per-tool scope checks (the MCP server's tool dispatcher reads required
// scopes from a tool→scope map and calls requireScopes inline).
const TOOL_SCOPES: Record<string, string[]> = {
  "invoices_list":   ["canvas:invoices.read"],
  "invoices_create": ["canvas:invoices.write"],
  "invoices_send":   ["canvas:invoices.send"],
  ...
};
```

### What the libraries do, in detail

1. **JWKS fetch + cache** — first request fetches `<issuer>/.well-known/jwks.json`, caches by `kid`. On `kid` miss (key rotation), refetches once.
2. **Standard claim validation** — `iss`, `aud`, `exp`, `nbf`, `iat`. Reject anything else.
3. **Scope parsing** — `scope` claim is a space-delimited string. Parse to set. Required scopes must all (or any-of) be present.
4. **Algorithm enforcement** — only RS256 accepted. Never accept `alg: none` or HS256.
5. **Clock skew** — 60s leeway on `exp` and `nbf`.
6. **No introspection by default** — JWT verification is local for speed. Introspection (calling Ory to ask "is this token still valid?") is optional, gated behind a `WithIntrospection(true)` config, used only on money-moving scopes.

## 10. Money-moving scopes — step-up and approval tokens

For money-moving scopes (`corinthian:payments.execute`, `billflow:approvals.execute`, `billflow:payments.execute`), two extra controls apply:

### Step-up at consent

If any requested scope is money-moving, the consent UI requires the user to complete a WorkOS MFA challenge before the "Approve" button enables. WorkOS issues a transient `acr` claim that flows into Ory and shows up in the consent decision; if absent for a money-moving grant, Ory denies.

### Per-invocation approval token

Holding a money-moving scope is necessary but not sufficient — each individual money-moving MCP tool call also requires a one-time approval token. The flow:

```
1. Desktop calls Corinthian MCP tool "payments_refund" with the OAuth token.
2. Canvas/Corinthian MCP server inspects the scope, sees corinthian:payments.execute,
   sees the tool is flagged "requires_approval".
3. Server returns 428 Precondition Required with body:
   { approval_required: true, approval_challenge_url:
     "https://api.corinthian.solomon-ai.co/v1/approvals/<approval_id>" }
4. Desktop opens the approval URL in the user's browser.
5. User sees the specific action ("Refund $4,200 to John Doe?"), approves.
6. Server issues a one-time approval token, returned to the desktop.
7. Desktop retries the original MCP call with X-Approval-Token: <token>.
8. Server verifies the approval matches the action; executes.
```

This is the same pattern Corinthian's existing MCP server uses (per `corinthian-mcp` README: "approval tokens gate money-moving actions"). We standardize and document it here.

## 11. Per-product integration playbook

The work to add a new product (or to bring Canvas / Corinthian / Billflow onto this protocol):

| Task | Effort | Notes |
|------|--------|-------|
| 1. Embed `oauth-resource-server` middleware on the product's MCP routes | 0.5 day | One config: issuer + audience |
| 2. Tag each MCP tool with required scopes | 1 day | Tool→scope map; lives in the MCP server's tool registry |
| 3. Add scopes to non-MCP API routes (if Robo also calls REST) | 1–2 days | Depends on route count |
| 4. Implement `GET /v1/internal/entitlements` | 1 day | Returns whether `user_id` has an active subscription to this product. Used by rowboat-api's pre-consent hook. |
| 5. Wire money-moving approval flow | 2–3 days | Issue + verify approval tokens, expose approval UI |
| 6. Register the audience + scope catalog with Ory | 0.5 day | Ory admin API call once per product |
| 7. Wire `POST /oauth2/revoke` calls when a user revokes a connection from the product side | 0.5 day | Optional — Ory revoke happens by default via desktop's revoke button |

Total per product: roughly **1 week** of focused work after the shared libraries exist.

## 12. Entitlement / subscription gating

The pre-consent hook is the single gate. When a user tries to connect a product they don't have an active subscription for, the consent UI shows an upsell instead of the approve screen. This is high-intent — they're already trying to grant access.

Hook contract:

```
POST https://api.x.solomon-ai.co/oauth-hooks/pre-consent
Headers: X-Hook-Signature: <hmac>   (shared secret with Ory)
Body:
  {
    "user_id": "user_01...",
    "client_id": "rowboat-desktop",
    "audience": "canvas-api",
    "scopes": ["canvas:invoices.read", "canvas:invoices.send"],
    "session": { "workos_org_id": "org_01...", "acr": "mfa" }
  }

Response:
  { "allow": true }
  or
  {
    "allow": false,
    "reason": "no_subscription" | "scope_not_in_plan" | "user_banned",
    "upsell": {
      "title": "Connect Canvas",
      "description": "Subscribe to Canvas to give Rowboat access to your invoices.",
      "cta_url": "https://canvas.solomon-ai.co/subscribe?return_to=...",
      "cta_label": "Subscribe to Canvas"
    }
  }
```

rowboat-api implements this hook by:
1. Calling the target product's `/v1/internal/entitlements?user_id=...` endpoint (server-to-server, internal API key).
2. Checking that the requested scopes are within the user's plan tier (some scopes might be Pro-tier only).
3. Returning the upsell payload if no.

The consent UI renders the upsell using the `upsell` field. When the user clicks "Subscribe to Canvas," the product runs its checkout flow with `return_to` set so the user lands back at consent after subscribing.

## 13. Revocation & lifecycle

### Active connections UI in the desktop

The desktop's settings screen has a "Connected Accounts" section: each entry shows product name, scopes granted, connected date, last-used date, and a "Disconnect" button.

```
Disconnect → DELETE /v1/connections/canvas
  rowboat-api:
    1. Calls Ory /oauth2/revoke with the refresh token
    2. Deletes MCPConnection row
    3. Returns 204
```

### Connection auto-expiry

Refresh tokens are 30 days, rotated on each use, with reuse detection. If a user doesn't use Robo for 30 days, the connection silently expires and re-prompts on next use.

### Connection invalidation by the product

If a product determines a user should be disconnected (subscription canceled, account banned, security incident), it calls:

```
POST https://api.x.solomon-ai.co/v1/internal/connections/invalidate
Headers: X-Internal-Key: <shared secret>
Body: { user_id: "...", product: "canvas", reason: "subscription_canceled" }
```

rowboat-api revokes the Ory tokens, deletes the MCPConnection row, and pushes a desktop notification on next launch.

## 14. Audit & observability

Every authorization event is logged:

| Event | Where | Fields |
|-------|-------|--------|
| `connection.start` | rowboat-api | user_id, product, requested_scopes |
| `consent.shown` | consent UI | user_id, product, scopes, money_moving |
| `consent.granted` | consent UI | user_id, product, granted_scopes, denied_scopes |
| `consent.denied` | consent UI | user_id, product, reason |
| `token.exchanged` | rowboat-api | user_id, product, scopes, jti |
| `token.refreshed` | rowboat-api | user_id, product, old_jti, new_jti |
| `token.revoked` | rowboat-api | user_id, product, reason |
| `mcp.tool.invoked` | each product's MCP | user_id, tool, scopes_used, latency_ms, status |
| `mcp.tool.denied` | each product's MCP | user_id, tool, required_scope, missing_scope |
| `approval.requested` | each product | user_id, tool, action_summary |
| `approval.granted` / `approval.denied` | each product | user_id, tool, decision |
| `entitlement.check` | rowboat-api | user_id, product, allow, reason |

All events go through OTel + a single `audit` channel in the org's observability stack. Money-moving events are also written to an append-only `audit_log` table in each product's Postgres for compliance.

## 15. Build order (extends IMPLEMENTATION_PLAN.md milestones)

| Milestone | What ships |
|---|---|
| **8** (was: Connector registry skeleton) | Ory Network project provisioned. WorkOS configured as the OIDC IDP in Ory. Single OAuth client `rowboat-desktop` created. Consent UI app scaffolded at `apps/oauth-consent` and deployed to `consent.solomon-ai.co`. rowboat-api gains `/v1/connections/{name}/{start,callback}`, the pre-consent webhook, and `/v1/internal/connections/invalidate`. |
| **8.5** (new) | `oauth-resource-server` libraries shipped (Go + TS). Scope catalog JSON + this doc are the single source of truth. |
| **9** (was: Canvas connector) | Canvas API embeds the TS resource-server middleware. Canvas's MCP tools tagged with scopes. Canvas's `/v1/internal/entitlements` endpoint live. Desktop end-to-end works against Canvas. |
| **10** (was: Corinthian connector) | Same for Corinthian, plus its approval-token flow standardized per §10. |
| **10.5** (new) | Same for Billflow. Approval-token flow for money-moving AP scopes. |
| **11** (was: Wispr Flow) | If Wispr Flow has a public API, build an MCP server for it and integrate it into the same connector protocol. If not, defer. |

## 17. Operating self-hosted Hydra (Helm on Hetzner k3s)

### 17.1 Where it lives

**Use Ory's official upstream Helm chart directly** — no wrapper chart, no fork. The chart is published at `https://k8s.ory.sh/helm/charts` (source: [ory/k8s](https://github.com/ory/k8s)). It is production-tested and the canonical way to run Hydra.

Our only artifacts are a values file per environment and a `clients/` directory holding the standalone OAuth-client-provisioning manifests, all committed alongside the other deploy configs:

```
charts/hydra/
├── values.yaml                         # baseline config (commented, env-agnostic)
├── values-production.yaml              # production overrides
├── values-staging.yaml                 # staging overrides
├── clients/
│   └── rowboat-desktop.yaml            # OAuth client provisioning Job (kubectl apply, see §17.6)
└── README.md                           # `helm install` invocation + secrets list
```

Add Ory's repo once per workstation/CI runner:

```bash
helm repo add ory https://k8s.ory.sh/helm/charts
helm repo update
```

Install / upgrade:

```bash
helm upgrade --install hydra ory/hydra \
  --version 0.43.0 \
  --namespace hydra --create-namespace \
  -f charts/hydra/values-production.yaml \
  --kube-context us-east-prod
```

Pin the chart version (`--version`) so deploys are reproducible. Bumping the chart version is a tracked change in the values directory.

Deployed to **US-East cluster** as the primary region (Ashburn). The other two clusters get the consumer side (`oauth-resource-server` middleware), but the issuer itself is single-region — auth flows are infrequent compared to token verification, and JWT verification is local so consumer regions don't need a colocated issuer.

### 17.2 Postgres

Hydra needs a Postgres database for state (registered clients, refresh tokens, consent records).

The existing org pattern points at a managed Postgres instance — see `oppulence-infrastructure-as-code` for which provider is currently authoritative (the rest of this plan referred to "DO Postgres" but the IaC repo is the source of truth — if it's actually Hetzner Managed Postgres or in-cluster CloudNativePG, Hydra connects there instead). Same instance, separate database:

```sql
CREATE DATABASE hydra;
```

Hydra runs its own migrations on first boot (`hydra migrate sql up`) via an init container the chart provides.

### 17.3 Values (`charts/hydra/values-production.yaml`)

These are the top-level keys of the **upstream `ory/hydra` chart** — see its [`values.yaml`](https://github.com/ory/k8s/blob/master/helm/charts/hydra/values.yaml) for the full reference. We only override what we care about.

```yaml
image:
  tag: v2.2.0                           # pin Hydra version

hydra:
  config:
    dsn: ${HYDRA_DSN}                   # injected from Infisical secret
    urls:
      self:
        issuer: https://oauth.solomon-ai.co
        public: https://oauth.solomon-ai.co
      consent: https://consent.solomon-ai.co/consent
      login:   https://consent.solomon-ai.co/login
      logout:  https://consent.solomon-ai.co/logout
      error:   https://consent.solomon-ai.co/error
    oauth2:
      expose_internal_errors: false
      pkce:
        enforced_for_public_clients: true
    strategies:
      access_token: jwt
      refresh_token: opaque
    ttl:
      access_token: 15m
      refresh_token: 720h               # 30 days
      authorization_code: 60s
      id_token: 1h
    secrets:
      system: [ "${HYDRA_SYSTEM_SECRET}" ]
    log:
      level: info
      format: json

deployment:
  replicaCount: 2                       # HA
  resources:
    requests: { cpu: 100m, memory: 128Mi }
    limits:   { cpu: 500m, memory: 256Mi }
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 6
    targetCPUUtilizationPercentage: 70

ingress:
  public:
    enabled: true
    className: nginx
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
    hosts:
      - host: oauth.solomon-ai.co
        paths: [{ path: /, pathType: Prefix }]
    tls:
      - secretName: hydra-public-tls
        hosts: [ oauth.solomon-ai.co ]
  admin:
    enabled: false                      # admin API never exposed externally

service:
  admin:
    enabled: true                       # ClusterIP only, reached via in-cluster DNS
```

The admin API is **not** ingress-exposed. Other in-cluster services (rowboat-api, the consent UI, the client provisioner job) reach it at `http://hydra-admin.hydra.svc.cluster.local:4445`.

### 17.4 Secrets

Two secrets injected via the org's existing Infisical pattern (the `infisical-secrets` chart already in `oppulence-canvas/charts/`):

| Secret | Purpose |
|--------|---------|
| `HYDRA_DSN` | Postgres connection string for the `hydra` database |
| `HYDRA_SYSTEM_SECRET` | 32+ byte system secret used to encrypt sensitive state at rest |

Rotating `HYDRA_SYSTEM_SECRET` invalidates all issued tokens, so it's a break-glass operation, not a routine one.

### 17.5 Federation to WorkOS

WorkOS is the upstream IDP. Federation happens at the **consent UI** layer — the consent app at `consent.solomon-ai.co/login` performs the WorkOS OIDC dance and then tells Hydra "this user is logged in" via the admin API. This is the standard Hydra pattern.

### 17.6 Client provisioning

OAuth client provisioning is **not** part of the upstream chart — it's our own concern. Ship it as a standalone Kubernetes Job manifest at `charts/hydra/clients/rowboat-desktop.yaml`, applied separately after the Hydra install:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: hydra-provision-rowboat-desktop
  namespace: hydra
spec:
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: provision
          image: oryd/hydra:v2.2.0
          command:
            - /bin/sh
            - -c
            - |
              hydra create client \
                --endpoint http://hydra-admin.hydra.svc.cluster.local:4445 \
                --name "Rowboat Desktop" \
                --id rowboat-desktop \
                --grant-type authorization_code,refresh_token \
                --response-type code \
                --scope "canvas:invoices.read canvas:invoices.write canvas:customers.read corinthian:cases.read ..." \
                --audience canvas-api,corinthian-api,billflow-api \
                --redirect-uri https://api.x.solomon-ai.co/v1/connections/canvas/callback \
                --redirect-uri https://api.x.solomon-ai.co/v1/connections/corinthian/callback \
                --redirect-uri https://api.x.solomon-ai.co/v1/connections/billflow/callback \
                --token-endpoint-auth-method none
```

Apply:

```bash
kubectl apply -f charts/hydra/clients/rowboat-desktop.yaml
```

Idempotent: re-uses `hydra update client` semantics if `rowboat-desktop` already exists. Re-run whenever scopes or redirect URIs change.

If/when the org adopts Argo CD or Flux for declarative state, this Job becomes an Argo Application synced from git. Until then, kubectl apply is fine.

### 17.7 Backup and DR

- **Postgres** — managed-Postgres provider's daily backups + PITR. Hydra's state (registered clients, issued tokens, consent decisions) is recoverable.
- **System secret** — Infisical entry, with backup in 1Password.
- **Key rotation** — Hydra rotates its signing keys automatically; old keys stay in JWKS until referenced tokens expire. No manual intervention.
- **Cluster loss** — Argo/Flux re-applies the chart against a fresh cluster; Postgres restore brings state back.

### 17.8 Monitoring

- **Health** — `GET /health/ready` and `/health/alive` on both deployments; readiness probes already wired in the upstream chart.
- **Metrics** — Hydra exposes Prometheus metrics at the admin port. The org's Prometheus already scrapes annotated pods; add the standard `prometheus.io/scrape` annotations.
- **Logs** — JSON to stdout → existing log aggregation pipeline.
- **Tracing** — Hydra speaks OTLP. Point at the existing OTel collector.

### 17.9 Upgrade cadence

Hydra ships minor versions every 2–3 months.

```bash
# Refresh local Ory repo metadata
helm repo update ory

# Test on staging cluster — bump the --version flag
helm upgrade --install hydra ory/hydra \
  --version 0.44.0 \
  -n hydra \
  -f charts/hydra/values-staging.yaml \
  --kube-context staging

# Migration runs automatically via the upstream chart's pre-upgrade Job hook.
# If a major version, read the changelog first.

# Production
helm upgrade --install hydra ory/hydra \
  --version 0.44.0 \
  -n hydra \
  -f charts/hydra/values-production.yaml \
  --kube-context us-east-prod
```

Schedule a 30-min quarterly upgrade window. The `--version` pin in deploy commands is the audit trail.

## 18. Open decisions

1. **Audience naming convention.** `canvas-api` vs `urn:oppulence:canvas` vs `https://api.canvas.solomon-ai.co`. URN-style is most spec-aligned; bare strings are simpler. Recommend bare strings (`canvas-api`).
2. **Single OAuth client vs per-platform clients.** One `rowboat-desktop` for all OS builds, vs `rowboat-macos`, `rowboat-windows`, `rowboat-linux`. Single client is simpler; per-platform lets us revoke by platform in a security incident. Recommend single client to start.
3. **Token expiry tuning.** 15 min access + 30 day refresh is standard. If background tasks in the desktop run longer than 15 min, they'll need to refresh mid-flight — fine, both libraries auto-refresh. No change needed.
4. **Consent UI / Hydra custom domains.** `oauth.solomon-ai.co` for Hydra, `consent.solomon-ai.co` for the consent UI. Both via Fly.io certificate management (Let's Encrypt). DNS records are CNAMEs on Cloudflare or whatever DNS provider Solomon uses.
5. **Per-scope MFA.** Right now: MFA at consent for money-moving scopes only. Alternative: MFA for any write or higher. More secure, more friction.
6. **B2B teams.** When a WorkOS user is in an `org`, do we issue user-level tokens or org-level tokens? Current plan: user-level. Means each member of an org connects Robo to their own account. Could be revisited if customers want a team-level Robo connection.
7. **Webhook delivery for `connection.invalidated`.** Currently a single retry on failure. Should we durable-queue these? Probably yes — drop into the existing job worker pattern.
8. **Hydra DB co-tenancy.** Hydra's schema lives in the same DO Postgres instance as rowboat-api but in its own database (`hydra`). Acceptable for now; if the credentials surface ever becomes a multi-region concern we can split. Not a Milestone-0 decision.

---

## Quick reference

| URL | Purpose |
|-----|---------|
| `https://oauth.solomon-ai.co` | Ory Network issuer base |
| `https://oauth.solomon-ai.co/oauth2/auth` | Authorization endpoint |
| `https://oauth.solomon-ai.co/oauth2/token` | Token endpoint |
| `https://oauth.solomon-ai.co/oauth2/revoke` | Revocation endpoint |
| `https://oauth.solomon-ai.co/oauth2/introspect` | Introspection endpoint (admin) |
| `https://oauth.solomon-ai.co/.well-known/jwks.json` | JWKS |
| `https://oauth.solomon-ai.co/.well-known/openid-configuration` | OIDC discovery |
| `https://consent.solomon-ai.co/consent` | Hosted consent UI |
| `https://api.x.solomon-ai.co/oauth-hooks/pre-consent` | rowboat-api pre-consent hook |
| `https://api.x.solomon-ai.co/v1/connections/{name}/start` | Begin connection |
| `https://api.x.solomon-ai.co/v1/connections/{name}/callback` | OAuth callback |
| `https://api.x.solomon-ai.co/v1/connections/{name}/mcp-token` | Mint fresh MCP bearer |
| `https://api.x.solomon-ai.co/v1/internal/connections/invalidate` | Product → broker revoke |
| `https://api.{product}.solomon-ai.co/v1/internal/entitlements` | Per-product entitlement check |
