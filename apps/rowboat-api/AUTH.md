# Authentication architecture

> **Decision (active): WorkOS via a rowboat-api broker.** The desktop signs in
> with **WorkOS AuthKit**; rowboat-api completes the confidential code exchange
> server-side. Ory Hydra and the `oauth-consent` app are **deferred** (kept for
> the cross-portfolio brokering / self-hosted-tier futures), not in the live
> sign-in path.

## Why a broker (and not desktop-direct)

WorkOS AuthKit is a **confidential** OAuth client: the authorization-code →
token exchange (`POST /user_management/authenticate`) must present the WorkOS
**API key** as the client secret. We verified this against the live account — a
token request without the key returns `invalid_client`; with it, a bad code
returns `invalid_grant` (auth passed). A desktop app must not ship that key, so
"desktop talks straight to WorkOS" is not possible.

So the exchange is **folded into rowboat-api** (`internal/workosauth`),
replacing the old 3-layer Hydra + `oauth-consent` design with a single backend
endpoint. The desktop still runs the browser login + PKCE; only the secret-
bearing exchange moves server-side.

## The flow

```
Desktop ─ GET /v1/auth/workos/login-url ─► rowboat-api  (builds the AuthKit authorize URL)
   │ open in browser
   ▼
WorkOS AuthKit hosted login ─ redirect ─► http://localhost:8080/oauth/callback?code=…  (desktop loopback)
   │ POST {code, codeVerifier}
   ▼
rowboat-api  POST /v1/auth/workos/exchange ─► WorkOS /user_management/authenticate (+ API key)
   │ returns {access_token, refresh_token, user}
   ▼
Desktop stores tokens; uses access_token as Bearer. rowboat-api verifies it on every call (WorkOS JWKS).
```

Refresh is brokered the same way (`POST /v1/auth/workos/refresh`). The desktop
code lives in `apps/x/.../auth/workos-backend.ts` + `oauth-handler.ts`
(`connectRowboatViaBroker`); the rowboat token refresh is in `auth/tokens.ts`.

## rowboat-api endpoints (`internal/workosauth`, public — pre-bearer)

| Endpoint | Purpose |
|----------|---------|
| `GET  /v1/auth/workos/login-url` | Build the WorkOS AuthKit authorize URL (keeps WorkOS's layout server-side). |
| `POST /v1/auth/workos/exchange`  | Authorization-code → tokens, presenting the API key. |
| `POST /v1/auth/workos/refresh`   | Refresh-token → tokens, presenting the API key. |

## Configuration

**Auth always uses real WorkOS** — both locally and in production. The only
difference is where the secret API key comes from.

| Env | Value | Notes |
|-----|-------|-------|
| `WORKOS_CLIENT_ID` | `client_01JS1THN6FR45322P2CAV2WWB0` | public — literal in the compose file |
| `WORKOS_API_KEY` | `sk_…` | **secret** — gitignored root `.env` locally (auto-loaded by compose); secret manager (Infisical / k8s) in prod |
| `WORKOS_BASE_URL` / `WORKOS_AUTHORIZE_BASE_URL` | `https://api.workos.com` | server-side + browser hosts; the same against real WorkOS |
| `TOKEN_ISSUER` | `https://api.workos.com` | confirmed from a real token |
| `JWKS_URL` | `https://api.workos.com/sso/jwks/<client_id>` | |
| `TOKEN_AUDIENCE` | **`""`** | WorkOS tokens carry no `aud` → blank it to skip the check (plain-unset defaults to `rowboat-api` and would reject WorkOS tokens) |

> `WORKOS_AUTHORIZE_BASE_URL` only needs to differ from `WORKOS_BASE_URL` if the
> browser-reachable host differs from the server-reachable one; against real
> WorkOS both are `api.workos.com`.

## WorkOS dashboard — setup checklist

1. Enable **AuthKit**; record `WORKOS_CLIENT_ID` + `WORKOS_API_KEY`.
2. **Register the desktop loopback redirect URI** `http://localhost:8080/oauth/callback`
   (WorkOS allows `localhost`). Until this is done, authorize returns
   `redirect-uri-invalid`. *(Done for this project.)*
3. (Optional) Set the AuthKit **custom domain** (`auth.solomon-ai.co`); else the
   default `*.authkit.app` domain is used.
4. `TOKEN_ISSUER` / `JWKS_URL` / `TOKEN_AUDIENCE` are already set to the confirmed
   values above; user id is read from `sub` → `workos_user_id`.

## Local end-to-end

`docker-compose.rowboat-api.yml` uses **real WorkOS** for sign-in — no overlay,
no manual sourcing. The API key is read from the **gitignored root `.env`**,
which docker compose auto-loads. devstack remains only as a dev mock for the LLM
gateway and the Google OAuth broker. Click **"Sign in to Rowboat"** in the
desktop and it opens the real AuthKit login. See `README.md` → *Local end-to-end
with the desktop*.

## Reverting to Hydra-fronts-WorkOS

Still no code change to the desktop. Deploy `charts/hydra/` + `apps/oauth-consent/`,
point `OIDC_ISSUER_URL`/`TOKEN_ISSUER`/`JWKS_URL`/`OAUTH_CLIENT_ID` at Hydra, and
the desktop's openid-client rowboat path (still present for non-broker issuers)
takes over. Reintroduce this only when Canvas/Corinthian/Billflow need a
self-controlled OAuth2 AS with custom audiences, or for a self-hosted tier.
