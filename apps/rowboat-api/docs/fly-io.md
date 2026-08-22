# Fly.io deployment

This deployment runs the public API in two U.S. regions while keeping the idle
footprint small:

| Process         | Region                       | Size                | Idle behavior                      |
| --------------- | ---------------------------- | ------------------- | ---------------------------------- |
| API             | `iad` (Ashburn, Virginia)    | shared CPU, 512 MiB | always warm                        |
| API             | `sjc` (San Jose, California) | shared CPU, 512 MiB | stops when idle; starts on traffic |
| Temporal worker | `iad`                        | shared CPU, 512 MiB | always running                     |
| Scheduler       | `iad`                        | shared CPU, 256 MiB | always running                     |

Fly Proxy routes clients to a healthy nearby API Machine. The API is stateless:
all Machines must share externally managed Postgres, Redis, and Temporal Cloud.
Do not attach a Fly Volume for application data.

The West Coast API can cold-start after an idle period. To trade higher cost for
predictable latency in both regions, set `auto_stop_machines = "off"` and
`min_machines_running = 0` in `fly.toml`; both API Machines will then remain
running.

## Provision once

Install and authenticate `flyctl`, choose a globally unique app name, and create
the app without deploying Fly's generated configuration:

```bash
fly auth login
fly apps create <app-name> --org <organization>
```

Set runtime secrets on the app. Use the same production values documented in
[`../../../charts/rowboat-api/values-production.yaml`](../../../charts/rowboat-api/values-production.yaml)
and the existing `rowboat-api-secrets`; do not commit their values. At minimum,
production validation requires the following, plus any enabled provider keys:

```bash
fly secrets set --app <app-name> \
  DATABASE_URL='postgresql://...' \
  REDIS_URL='rediss://...' \
  DB_ENCRYPTION_KEY='...' \
  WORKOS_API_KEY='...' \
  WORKOS_CLIENT_ID='...' \
  TOKEN_ISSUER='https://api.workos.com' \
  HOOK_HMAC_SECRET='...' \
  INTERNAL_API_SECRET='...' \
  APP_URL='https://app.example.com' \
  PUBLIC_BASE_URL='https://<app-name>.fly.dev' \
  CORS_ALLOWED_ORIGINS='https://app.example.com' \
  GOOGLE_REDIRECT_URI='https://<app-name>.fly.dev/oauth/google/callback' \
  TEMPORAL_ADDRESS='your-namespace.tmprl.cloud:7233' \
  TEMPORAL_NAMESPACE='your-namespace' \
  TEMPORAL_API_KEY='...' \
  OPENAI_API_KEY='...' \
  ELEVENLABS_API_KEY='...' \
  EXA_API_KEY='...' \
  GOOGLE_OAUTH_CLIENT_ID='...' \
  GOOGLE_OAUTH_CLIENT_SECRET='...'
```

`DATABASE_URL` must be usable by both runtime Machines and the temporary release
Machine. Prefer a pooled TLS URL only if the pool supports Atlas's session-level
advisory lock; otherwise use the direct TLS Postgres URL. The release command is
idempotent: Atlas records applied versions and validates migration checksums.

Create a short-lived, app-scoped deploy token for GitHub Actions and store it in
the repository's protected `production` environment. An app-scoped token keeps
the API deploy independent from the web application's Fly credentials:

```bash
fly tokens create deploy --app <app-name> --expiry 720h
```

Configure these GitHub environment values:

| Kind                | Name                        | Value                               |
| ------------------- | --------------------------- | ----------------------------------- |
| Secret              | `ROWBOAT_API_FLY_API_TOKEN` | The app-scoped deploy token         |
| Variable            | `ROWBOAT_API_FLY_APP_NAME`  | The globally unique Fly app name    |
| Variable (optional) | `ROWBOAT_API_FLY_SMOKE_URL` | Custom API origin after DNS cutover |

## Deploy

From `apps/rowboat-api`, run:

```bash
./scripts/fly-deploy.sh <app-name>
```

For a production deployment, dispatch **Deploy rowboat-api to Fly.io** from
GitHub Actions. The workflow uses the protected `production` environment,
deploys the same script non-interactively, verifies Fly health checks, and
smoke-tests `/healthz` and `/readyz`. It is manual by design so the existing
Kubernetes production workflow cannot race a Fly rollout during migration.

The script builds with the repository root as Docker context, runs versioned
database migrations once in a temporary release Machine, rolls out the three
process groups, then enforces exactly one API Machine in each of `iad` and `sjc`
and one background Machine per process in `iad`. A failed migration aborts the
rollout. A failed regional scale exits non-zero and is safe to retry.

Verify the public and regional state:

```bash
curl https://<app-name>.fly.dev/healthz
curl https://<app-name>.fly.dev/readyz
fly status --app <app-name>
fly scale show --app <app-name>
fly checks list --app <app-name>
```

Expected scale is `app=2` in `iad,sjc`, `worker=1` in `iad`, and `scheduler=1`
in `iad`. `/readyz` must return 200 before Fly routes traffic to an API Machine.
Top-level readiness checks monitor the private worker and scheduler on port
`9090`; those checks are observable but do not route public traffic.

## Custom domain cutover

Keep Kubernetes serving production until the Fly hostname passes both smoke
checks. Add the production certificate and follow the DNS instructions returned
by Fly:

```bash
fly certs add api.oppulence.io --app <app-name>
fly certs show api.oppulence.io --app <app-name>
```

Lower the DNS TTL before cutover, update the record only after Fly reports the
certificate ready, then set `ROWBOAT_API_FLY_SMOKE_URL` to
`https://api.oppulence.io`. Preserve the Kubernetes deployment through the
observation window so DNS can be reverted without rebuilding an older release.

## Operations

- Deployments use a rolling strategy. Check `fly logs --app <app-name>` if a
  release or health check fails.
- Roll back application code with `fly releases` followed by
  `fly deploy --image <previous-image> --app <app-name>`. Database migrations
  are forward-only; ship a compensating migration when schema rollback is
  needed.
- Keep Postgres in or near `iad` until cross-region database replication is
  deliberately introduced. West Coast writes incur cross-country latency.
- Review current Machine and managed-service pricing before increasing memory,
  disabling autostop, or duplicating worker/scheduler processes.
