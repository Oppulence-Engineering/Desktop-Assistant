# oauth-consent

> **Status: deferred.** The desktop now signs into **WorkOS AuthKit directly**
> (WorkOS-direct — see [`apps/rowboat-api/AUTH.md`](../rowboat-api/AUTH.md)), so
> this app and Ory Hydra are **not in the live sign-in path**. It's kept for when
> the cross-portfolio connector brokering needs a self-controlled OAuth2 AS, or
> for a self-hosted sovereignty tier. The code below is current and ready to
> redeploy when that day comes.

The Ory Hydra **login + consent UI** for the Rowboat OAuth suite. Hydra delegates
the login and consent steps to this app (`urls.login` / `urls.consent` in
`charts/hydra/values-*.yaml`). It:

1. **Federates login to WorkOS** — `/login` redirects to WorkOS AuthKit; `/callback`
   verifies the WorkOS `id_token` (via JWKS) and accepts the Ory login with
   `subject = workos_user_id`.
2. **Gates consent by entitlement** — `/consent` calls rowboat-api's
   HMAC-protected `/oauth-hooks/pre-consent` for each requested connector
   audience. Allowed → grants the scopes + audiences and injects
   `ext.workos_user_id` into the access token. Denied → renders an upgrade page.
3. **Handles logout** — `/logout` accepts the Ory logout request.

Deployed at `consent.solomon-ai.co` with its own Helm chart
(`charts/oauth-consent/`).

## Configuration (env)

| Var | Purpose |
|-----|---------|
| `PORT` | listen port (default 3000) |
| `ORY_ADMIN_URL` | Hydra Admin API (cluster-internal, e.g. `http://hydra-admin.ory:4445`) |
| `WORKOS_CLIENT_ID` / `WORKOS_API_KEY` | WorkOS OIDC client |
| `WORKOS_ISSUER` | WorkOS issuer (custom domain, e.g. `https://auth.solomon-ai.co`) |
| `WORKOS_REDIRECT_URI` | `https://consent.solomon-ai.co/callback` |
| `ROWBOAT_API_URL` | rowboat-api base URL (for pre-consent) |
| `HOOK_HMAC_SECRET` | shared secret signing the pre-consent webhook |
| `COOKIE_SECRET` | signs the login-flow nonce cookie |

## Develop

```bash
npm install
npm run typecheck
npm run build && npm start
```
