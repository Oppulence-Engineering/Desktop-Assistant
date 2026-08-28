// Package oauthrs is a lightweight OAuth 2.0 resource-server toolkit for Go
// services. It implements RFC 012 with RS256-only verification by default,
// cached JWKS kid-miss refresh, issuer/audience/time validation, normalized
// connector actors, all/any scope enforcement, connection status checks, and
// per-invocation approval validation.
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
