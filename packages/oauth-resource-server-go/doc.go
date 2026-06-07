// Package oauthrs is a lightweight OAuth 2.0 resource-server toolkit for Go
// services. It verifies bearer JWTs against a JWKS (cached, with kid-miss
// refresh), validates issuer / audience / expiry, extracts scopes, and exposes
// net/http middleware for authentication and per-route scope enforcement.
//
// rowboat-api and each product MCP server (Canvas, Corinthian, Billflow) embed
// this library to verify Ory/WorkOS-issued tokens against the same JWKS, so
// authorization behaves identically across the suite. See
// apps/rfc/012-connector-suite-and-consent-broker.md.
//
// It is published to npm as @oppulence/oauth-resource-server (the TS sibling).
// In this monorepo it is the Go source of truth, imported by other Go modules
// via the module path.
package oauthrs
