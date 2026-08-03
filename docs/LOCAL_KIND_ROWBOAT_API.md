# Local kind rowboat-api workflow

This workflow deploys `apps/rowboat-api` into a local kind cluster with the same
Helm chart used for staging/production, plus local-only dependencies:

- Postgres 16 for the ent database.
- Redis 7 for rate limiting/cache.
- `devstack`, built from the rowboat-api image, as the local OIDC/WorkOS/LLM/Google mock.
- Infisical CLI, which creates `rowboat-api-secrets` in kind before Helm deploys.

The desktop talks to the API through kind host port mappings, so no production
DNS changes are required. Secrets are pulled into Kubernetes from Infisical
instead of being rendered by Helm.

## Infisical prerequisites

Log in with the Infisical CLI:

```bash
infisical login
```

Then either run `infisical init` in the repo root, or export the project id:

```bash
export INFISICAL_PROJECT_ID=...
export INFISICAL_ENVIRONMENT=dev # optional, default: dev
export INFISICAL_SECRET_PATH=/   # optional, default: /
export INFISICAL_RECURSIVE=true  # optional, default: false
```

The selected Infisical scope must contain these keys:

```text
DATABASE_URL
REDIS_URL
DB_ENCRYPTION_KEY
WORKOS_CLIENT_ID
WORKOS_API_KEY
OPENAI_API_KEY
OPENROUTER_API_KEY
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
HOOK_HMAC_SECRET
INTERNAL_API_SECRET
SLACK_SIGNING_SECRET
GOOGLE_WEBHOOK_TOKEN
WEBHOOK_SIGNING_SECRET
```

For the default local dependencies, use the in-cluster service URLs:

```text
DATABASE_URL=postgres://rowboat:rowboat@rowboat-api-postgres:5432/rowboat?sslmode=disable
REDIS_URL=redis://rowboat-api-redis:6379/0
WORKOS_CLIENT_ID=rowboat-desktop-kind
```

## Start the stack

```bash
scripts/rowboat-api-kind.sh up
```

The script:

1. Creates or reuses a `rowboat-api` kind cluster.
2. Builds `rowboat-api:kind` from `apps/rowboat-api/Dockerfile`.
3. Loads the image into kind.
4. Applies `deploy/kind/rowboat-api/dependencies.yaml`.
5. Runs `infisical secrets --output=dotenv` and creates Kubernetes Secret
   `rowboat-api-secrets`.
6. Installs `charts/rowboat-api` with `charts/rowboat-api/values-kind.yaml`.
7. Exposes host ports through kind NodePort mappings:
   - API: `http://localhost:18080`
   - devstack issuer/mock: `http://localhost:18090`
8. Runs smoke checks for `/healthz`, `/readyz`, `/v1/config`, `/openapi.json`,
   `/docs`, WorkOS broker URL generation, `/v1/me`, and `/v1/llm/models`.

The API reference is served by Scalar at `http://localhost:18080/docs`. The
underlying generated OpenAPI document is served by the API itself at
`http://localhost:18080/openapi.json`.

## Run the desktop against kind

```bash
scripts/rowboat-api-kind.sh desktop
```

Or manually:

```bash
cd apps/x
API_URL=http://localhost:18080 ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT=9222 npm run dev
```

Click **Sign in to Rowboat**. The API will return a login URL backed by the
local devstack issuer at `http://localhost:18090`; devstack auto-approves the
flow and redirects back to the desktop loopback callback on `localhost:8080`.

The `ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT` value is optional, but useful for
local QA. It exposes the Electron renderer to Chrome DevTools Protocol on port
`9222`, so `agent-browser connect 9222` can inspect the running desktop.

## Profile and budget-check the desktop

```bash
make perf-desktop
```

This packages the Electron app, launches it with an isolated workspace, drives
representative UI/IPC/API workflows, samples the process tree, captures a
renderer CPU profile, and fails on performance budgets or local baseline
regressions. Use `make perf-desktop-full` when a change needs the API/Temporal
background-task workflow, warm launch, and larger workspace checks too. Use
`make perf-desktop-deep` for the longest local scale and memory-growth pass.
See [Desktop Performance Gate](./DESKTOP_PERFORMANCE_GATE.md).

## Useful commands

```bash
scripts/rowboat-api-kind.sh status
scripts/rowboat-api-kind.sh infisical-validate
scripts/rowboat-api-kind.sh validate
scripts/rowboat-api-kind.sh validate-full
scripts/rowboat-api-kind.sh desktop-perf
scripts/rowboat-api-kind.sh logs
scripts/rowboat-api-kind.sh port-forward  # fallback for clusters without port mappings
scripts/rowboat-api-kind.sh down
scripts/rowboat-api-kind.sh delete-cluster
```

`infisical-validate` reads secrets through the Infisical CLI, refreshes
`rowboat-api-secrets`, and verifies required key names without printing secret
values. Set `INFISICAL_RECURSIVE=true` if the selected path should include
subfolders. `down` removes the Helm release, local dependencies, and the local
synced Secret but keeps the kind cluster. `delete-cluster` removes the whole
cluster.

## Override defaults

```bash
KIND_CLUSTER_NAME=rowboat-local \
ROWBOAT_API_PORT=28080 \
ROWBOAT_DEVSTACK_PORT=28090 \
scripts/rowboat-api-kind.sh up
```

If you override the devstack port, also override `charts/rowboat-api/values-kind.yaml`
for `OIDC_ISSUER_URL`, `TOKEN_ISSUER`, and `WORKOS_AUTHORIZE_BASE_URL`, because
those values are embedded in devstack-issued tokens and browser login URLs.

If you created the kind cluster before this file existed, recreate it so the
host port mappings are present:

```bash
scripts/rowboat-api-kind.sh delete-cluster
scripts/rowboat-api-kind.sh up
```

## What this validates

This validates the production chart path locally:

- Helm template/render/install behavior.
- Pod security settings used by the chart.
- ConfigMap + Infisical-managed Secret env injection.
- Infisical CLI secret read into the local Kubernetes Secret consumed by Helm.
- Embedded OpenAPI delivery and Scalar documentation UI.
- Postgres connectivity and auto-migration.
- Redis connectivity.
- Readiness/liveness probes.
- The desktop's `API_URL` runtime override.
- The rowboat-api broker sign-in path without real WorkOS secrets.

Production and staging values are still rendered separately in CI or locally
with:

```bash
helm lint charts/rowboat-api
helm template rowboat-api charts/rowboat-api -f charts/rowboat-api/values-staging.yaml
helm template rowboat-api charts/rowboat-api -f charts/rowboat-api/values-production.yaml
```
