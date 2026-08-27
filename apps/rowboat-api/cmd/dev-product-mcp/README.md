# RFC 012 dev product MCP

This command is a public-HTTP conformance resource server for RFC 012. It uses
the repository's Go resource-server library and PostgreSQL for online connection
status, one-time approvals, tenant binding, and product-side audit records.

PostgreSQL must have the `pgcrypto` extension because approval tokens are stored
only as SHA-256 hashes. The same database also provides the atomic shared replay
claim store for signed product-entitlement request IDs, so replay protection is
preserved when multiple dev-product replicas are running. Start with:

```sh
createdb rowboat_rfc012
psql rowboat_rfc012 -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto'
DATABASE_URL=postgres://localhost/rowboat_rfc012?sslmode=disable \
PRODUCT_MCP_ISSUER=http://127.0.0.1:4444/ \
PRODUCT_MCP_JWKS_URL=http://127.0.0.1:4444/.well-known/jwks.json \
go run ./cmd/dev-product-mcp
```

Routes:

- `POST /v1/mcp/read`, audience `dev-product-api`, scope `dev:records.read`
- `POST /v1/mcp/pay?resource_id=...`, scope `dev:payments.execute` and a
  single-use `X-Approval-Token`

The acceptance harness seeds `dev_product_connections` and
`dev_product_approvals`. No provider API key is accepted, returned, or persisted.
