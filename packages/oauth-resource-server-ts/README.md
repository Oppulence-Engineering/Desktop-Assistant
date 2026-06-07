# @oppulence/oauth-resource-server

OAuth 2.0 resource-server toolkit for TypeScript services. Verifies bearer JWTs
against a JWKS (cached + kid-miss refresh via [`jose`](https://github.com/panva/jose)),
validates issuer/audience/expiry, extracts scopes, and ships framework
middleware. It is the TypeScript sibling of `packages/oauth-resource-server-go`;
the two behave identically so Canvas / Corinthian / Billflow MCP servers enforce
auth the same way as `rowboat-api`. See
[`apps/rfc/012-connector-suite-and-consent-broker.md`](../../apps/rfc/012-connector-suite-and-consent-broker.md).

## Install

```bash
npm install @oppulence/oauth-resource-server
```

## Express

```ts
import express from "express";
import { Verifier, requireAuth, requireScopes } from "@oppulence/oauth-resource-server";

const verifier = new Verifier({
  issuerUrl: "https://oauth.solomon-ai.co",
  audience: "canvas-api",
  jwksUrl: "https://oauth.solomon-ai.co/.well-known/jwks.json",
});

const app = express();
app.use(requireAuth(verifier)); // attaches req.claims, 401 on failure
app.get("/v1/mcp/invoices", requireScopes("invoices:read"), (req, res) => {
  res.json({ user: (req as any).claims.workosUserId });
});
```

## Hono / Fastify (framework-agnostic)

```ts
import { Verifier, verifyAuthorizationHeader } from "@oppulence/oauth-resource-server";

const verifier = new Verifier({ audience: "corinthian-api", jwksUrl: JWKS_URL });

app.use(async (c, next) => {
  try {
    const claims = await verifyAuthorizationHeader(verifier, c.req.header("authorization"));
    c.set("claims", claims);
    await next();
  } catch {
    return c.json({ error: "invalid or expired token", code: "unauthorized" }, 401);
  }
});
```

## API

- `new Verifier(config)` — `config.jwksUrl` required; optional `issuerUrl`,
  `audience`, `clockToleranceSec` (default 60), `algorithms` (default asymmetric;
  HS\* excluded by design).
- `verifier.verify(token): Promise<Claims>` — throws `TokenError` on any failure.
- `Claims` — `{ subject, issuer, audience[], scopes[], expiresAt, workosUserId?, workosOrgId?, email?, raw }`.
- `hasScope`, `hasAllScopes`, `hasAnyScope`.
- `requireAuth(verifier)`, `requireScopes(...scopes)` — Express/connect middleware.
- `verifyAuthorizationHeader(verifier, header)` — for any framework.
- `bearerToken(header)` — parse `Authorization: Bearer …`.

## Develop

```bash
npm install
npm run typecheck
npm test
npm run build
```
