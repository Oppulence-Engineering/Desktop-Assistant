# @oppulence/rowboat-api-client

TypeScript client for `rowboat-api`.

The public SDK contract is
[`apps/rowboat-api/api/openapi.json`](../../apps/rowboat-api/api/openapi.json).
The generated types in this package are derived from that document; do not edit
`src/generated/schema.ts` by hand.

## Install

```bash
npm install @oppulence/rowboat-api-client
```

## Usage

```ts
import { createRowboatAPIClient } from "@oppulence/rowboat-api-client";

const api = createRowboatAPIClient({
  baseUrl: "https://api.example.com",
  accessToken: () => tokenStore.currentAccessToken(),
});

const { data, error } = await api.GET("/v1/me");
if (error) {
  throw error;
}
console.log(data);
```

`createRowboatAPIClient` returns the `openapi-fetch` typed client, so callers use
the paths and request/response types generated from the checked-in OpenAPI
document.

## Develop

```bash
npm install
npm run generate
npm run typecheck
npm run build
```

From `apps/rowboat-api`, use the service-owned target:

```bash
make sdk-generate
```
