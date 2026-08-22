# Fly.io deployment

Fly.io is an additive deployment target for `rowboat-www`. The existing Kubernetes workflow remains
the production default until DNS is deliberately cut over.

The application uses the existing Node 24 standalone Docker image. Fly builds with the monorepo root
as its Docker context because the image includes `packages/ui`, `packages/relationship-contract`, and
`packages/eslint-plugin-oppulence-web`.

## One-time provisioning

Install `flyctl`, authenticate, and run these commands from the monorepo root:

```bash
fly apps create oppulence-rowboat-www
fly secrets set --app oppulence-rowboat-www ROWBOAT_WWW_SESSION_SECRET="$(openssl rand -base64 48)"
fly deploy . \
  --app oppulence-rowboat-www \
  --config apps/rowboat-www/config/deployment/fly.toml \
  --remote-only
fly scale count 2 --app oppulence-rowboat-www --yes
```

The checked-in configuration keeps both Machines running, uses blue-green releases, and admits traffic
only after `/readyz` confirms both runtime configuration and `rowboat-api` availability. `/healthz`
remains the shallow container liveness endpoint.

The app name in `fly.toml` is the production default. Use `--app` to target an existing differently
named Fly App.

## GitHub Actions setup

The `Deploy rowboat-www to Fly.io` workflow is manual so it cannot race the existing Kubernetes
production deployment. Configure the GitHub `production` environment with:

- `FLY_API_TOKEN` secret: an app-scoped deploy token from
  `fly tokens create deploy --app oppulence-rowboat-www --expiry 720h`. Rotate it before the
  30-day expiry.
- `ROWBOAT_WWW_SESSION_SECRET` secret: the same 32-or-more-character value used for the Fly App.
- Optional `FLY_APP_NAME` variable when the Fly App is not named `oppulence-rowboat-www`.
- Optional `ROWBOAT_WWW_FLY_SMOKE_URL` variable when the smoke test should use a custom hostname
  instead of the app's `.fly.dev` hostname.

The workflow validates the Fly config, stages the session secret for the release, deploys from the
monorepo root, enforces two Machines, checks Fly health, and runs the existing public smoke test.

## Domain cutover

Test the `.fly.dev` hostname before changing public DNS. Then attach the production host:

```bash
fly certs add oppulence.io --app oppulence-rowboat-www
fly certs check oppulence.io --app oppulence-rowboat-www
```

Follow the DNS records returned by `fly certs add`. For an apex domain, Fly recommends A and AAAA
records. If Cloudflare proxying remains enabled, provision the ownership or ACME challenge record Fly
shows before switching traffic.

After DNS resolves to Fly, verify the public hostname from the monorepo root:

```bash
ROWBOAT_WWW_EXPECTED_API_BASE_URL=https://api.oppulence.io \
  scripts/rowboat-www-smoke.sh https://oppulence.io
```

Rollback is a DNS change back to the existing Kubernetes ingress while that deployment remains live.

## Operations

```bash
fly status --app oppulence-rowboat-www
fly checks list --app oppulence-rowboat-www
fly logs --app oppulence-rowboat-www
fly releases --app oppulence-rowboat-www
```

Do not add Fly volumes for the Next.js cache. The app currently relies on build-time static output and
ephemeral per-Machine caches; if ISR or tag revalidation becomes product-critical, introduce and test a
shared Next.js cache handler before depending on cross-Machine consistency.
