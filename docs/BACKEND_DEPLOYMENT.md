# Rowboat Backend — Deployment & Operations

Companion to the architecture RFCs in [`apps/rfc/`](../apps/rfc/README.md),
especially [RFC 010](../apps/rfc/complete-010-rowboat-api-service-plane.md) and
[RFC 011](../apps/rfc/011-identity-and-authorization-plane.md). This documents how the
implemented artifacts are deployed and the **external prerequisites that must be
provisioned by an operator** (they cannot be created from the codebase).

> **Auth posture: WorkOS-direct.** The desktop signs into **WorkOS AuthKit**
> directly; **Ory Hydra + the consent app are deferred** (kept for the
> cross-portfolio brokering / self-hosted-tier futures). The live deploy path
> below is WorkOS-direct; Hydra-fronts-WorkOS is an appendix. Full rationale and
> the env matrix live in [`apps/rowboat-api/AUTH.md`](../apps/rowboat-api/AUTH.md).

## What's in the repo

| Artifact                               | Path                                 |
| -------------------------------------- | ------------------------------------ |
| Go backend                             | `apps/rowboat-api/`                  |
| OAuth resource-server (Go)             | `packages/oauth-resource-server-go/` |
| OAuth resource-server (TS)             | `packages/oauth-resource-server-ts/` |
| rowboat-api Helm chart                 | `charts/rowboat-api/`                |
| Consent UI _(deferred — Hydra mode)_   | `apps/oauth-consent/`                |
| oauth-consent Helm chart _(deferred)_  | `charts/oauth-consent/`              |
| Hydra values + client Job _(deferred)_ | `charts/hydra/`                      |

## External prerequisites (operator-provisioned)

These are infrastructure/SaaS resources. Create them, then wire their
identifiers into the cluster Secrets below.

1. **DigitalOcean Managed Postgres** — database `rowboat` (rowboat-api). Capture
   the DSN. (A second `hydra` database is needed only in the deferred Hydra mode.)
2. **Redis** — for rate-limit token buckets (+ optional ent cache). Capture URL.
3. **WorkOS** — create a project; enable **AuthKit**; record `WORKOS_CLIENT_ID` +
   `WORKOS_API_KEY`; set the custom domain (`auth.solomon-ai.co`); register the
   desktop as a **public PKCE client** with redirect URI
   `http://localhost:8080/oauth/callback`. (In Hydra mode the redirect URI is the
   consent app's `/callback` instead.)
4. **Infisical** — workspace/project holding the vendor key pool
   (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`,
   `ELEVENLABS_API_KEY`, `EXA_API_KEY`, `COMPOSIO_API_KEY`,
   `GOOGLE_OAUTH_CLIENT_ID/SECRET`). Record a machine token + project id.
5. **DNS** — `api.x.solomon-ai.co` (rowboat-api). The issuer `auth.solomon-ai.co`
   is WorkOS's custom domain (they serve it). cert-manager issues TLS for the api.
   (`oauth.solomon-ai.co` + `consent.solomon-ai.co` are needed only in Hydra mode.)
6. **Google push infrastructure** (RFC 003 cloud events) — Pub/Sub topic +
   push subscription for Gmail, domain verification for Calendar channels.
   Provisioning playbook:
   [RFC 019](../apps/rfc/019-google-push-infrastructure.md).
7. **Kubernetes Secrets** (namespace `rowboat`):
   - `rowboat-api-secrets`: `DATABASE_URL`, `REDIS_URL`, `DB_ENCRYPTION_KEY`,
     `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `HOOK_HMAC_SECRET`,
     `INTERNAL_API_SECRET`, `INFISICAL_TOKEN`, `INFISICAL_PROJECT_ID`, and —
     for cloud events — `GOOGLE_WEBHOOK_TOKEN`, `SLACK_SIGNING_SECRET`,
     `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`.
     (`ORY_BROKER_CLIENT_ID/SECRET` are used only by the connector broker once
     Hydra is reintroduced.)

`DB_ENCRYPTION_KEY`, `HOOK_HMAC_SECRET`, `INTERNAL_API_SECRET`, and
`GOOGLE_WEBHOOK_TOKEN` are generated secrets (e.g. `openssl rand -hex 32`).

## Deploy order (WorkOS-direct)

```bash
# 0. Build + push image (CI): ghcr.io/oppulence-engineering/rowboat-api:<tag>

# 1. Run rowboat-api migrations against the managed Postgres (one-off):
DATABASE_URL=postgres://... go run ./apps/rowboat-api/cmd/migrate apply
# (or apply apps/rowboat-api/migrations/0001_init.sql)

# 2. rowboat-api (issuer envs default to WorkOS AuthKit; see AUTH.md):
helm upgrade --install rowboat-api charts/rowboat-api -n rowboat \
  -f charts/rowboat-api/values-production.yaml --set image.tag=<tag>
```

No Hydra, no consent app, no second database. WorkOS hosts the login UI.

## Verify

```bash
curl https://api.x.solomon-ai.co/healthz          # {"status":"ok"}
curl https://api.x.solomon-ai.co/v1/config        # {appUrl, oidcIssuerUrl: auth.solomon-ai.co, ...}
curl https://auth.solomon-ai.co/.well-known/openid-configuration   # WorkOS AuthKit
```

Then sign in from the desktop (see the Milestone-1 patch in
`apps/x/packages/core/src/auth/providers.ts`) and confirm `/v1/me` returns the
free-tier subscription and an LLM call streams through `/v1/llm/chat/completions`.

## Deferred: Hydra-fronts-WorkOS

Reintroduce **only** when Canvas/Corinthian/Billflow need a self-controlled
OAuth2 AS with custom audiences, or for a self-hosted sovereignty tier. The
artifacts (`apps/oauth-consent/`, `charts/hydra/`, `charts/oauth-consent/`)
remain in the tree. To switch back: provision the `hydra` DB +
`oauth.solomon-ai.co`/`consent.solomon-ai.co` DNS + the `hydra-secrets` /
`oauth-consent-secrets`, then:

```bash
helm repo add ory https://k8s.ory.sh/helm/charts
helm upgrade --install hydra ory/hydra -n ory -f charts/hydra/values-production.yaml
kubectl apply -n ory -f charts/hydra/clients/rowboat-desktop.yaml
helm upgrade --install oauth-consent charts/oauth-consent -n rowboat --set image.tag=<tag>
# point rowboat-api at Hydra (env matrix in AUTH.md) and redeploy.
```

## Product MCP servers (Canvas / Corinthian / Billflow)

Each product embeds `@oppulence/oauth-resource-server` (TS) and verifies tokens
against Hydra's JWKS with its own audience (`canvas-api`, `corinthian-api`,
`billflow-api`). They expose `/v1/internal/entitlements` and call rowboat-api's
`/v1/internal/connections/invalidate` for force-disconnect. See
[RFC 012](../apps/rfc/012-connector-suite-and-consent-broker.md) for the
connector broker and resource-server contract.
