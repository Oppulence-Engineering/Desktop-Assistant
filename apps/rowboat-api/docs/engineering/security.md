# Security and tenancy

## Route security classes

Every endpoint MUST intentionally be one of:

1. Public documentation/configuration.
2. Public token-scoped response (capability token verified by the handler).
3. Pre-auth OAuth/sign-in exchange with provider state/credential validation.
4. Provider webhook with signature/OIDC verification before persistence.
5. HMAC hook.
6. Static-secret internal service API.
7. JWT-authenticated user API.
8. Authenticated plus scope/permission/entitlement/org/MFA/recent-auth step-up.

Route registration belongs inside the matching group or an explicit middleware
chain. A new route requires denial tests for missing/invalid credentials and,
for public/provider handlers, tests proving handler-level verification. The
route's class must be apparent from nearby code; ambiguous inheritance is a
review blocker.

## Tenant isolation

Authentication stores the verified `User` and `Actor` in context. Ent read
interceptors scope every tenant-owned query; the independent global mutation
hook scopes creates, updates, and deletes. Workspace membership is checked at
the persistence boundary for collaborative revenue data.

`auth.WithInternal` and `auth.WithInternalOnly` bypass tenant reads/writes and
are privileged capabilities. They are acceptable only for trusted process
work that either operates globally by design or first resolves and attaches an
explicit owner. Never use them to make a failing request test pass. Changes to
schemas, auth context, interceptors, hooks, internal APIs, or admin GraphQL MUST
include cross-tenant denial tests. `make architecture` detects missing read or
write registration for schemas with a user edge.

## Secrets and sensitive data

Secrets come from validated configuration/secret stores, remain out of URLs,
logs, errors, events, and metrics, and are redacted in scans. Examples and
fixtures use unmistakably fake values. Sensitive Ent fields must not be exposed
through generic entity serialization. Gitleaks runs before commit and in CI;
findings require rotation/remediation, not merely allowlisting.

## Exceptions

Security exceptions require an inline rationale, a focused test, and reviewer
attention. Suppression is never evidence that a path is safe. Missing security
configuration fails closed in production; graceful degradation is allowed
only for non-security optional capabilities.
