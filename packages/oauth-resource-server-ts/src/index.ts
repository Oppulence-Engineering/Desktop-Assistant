/**
 * @oppulence/oauth-resource-server
 *
 * A lightweight OAuth 2.0 resource-server toolkit for TypeScript services. It
 * implements RFC 012 with RS256-only verification by default, cached JWKS
 * kid-miss refresh, issuer/audience/time validation, normalized connector
 * actors, all/any scope enforcement, connection status checks, and
 * per-invocation approval validation.
 *
 * It is the TypeScript sibling of packages/oauth-resource-server-go; the two
 * behave identically so the product suite (Canvas, Corinthian, Billflow MCP
 * servers) enforces auth the same way regardless of language.
 */
export { ClaimsSchema, type Claims, hasScope, hasAllScopes, hasAnyScope, claimsFromPayload } from './claims.js';
export { Verifier, GenericVerifier, VerifierConfigSchema, GenericVerifierConfigSchema, type VerifierConfig, type GenericVerifierConfig, TokenError, bearerToken } from './verifier.js';
export { AuthorizationError, errorCodes, type ErrorCode } from './errors.js';
export {
  EntitlementRequestVerifier,
  EntitlementRequestError,
  MemoryEntitlementReplayStore,
  signEntitlementRequest,
  newEntitlementRequestId,
  ENTITLEMENT_CONNECTOR_HEADER,
  ENTITLEMENT_TIMESTAMP_HEADER,
  ENTITLEMENT_REQUEST_ID_HEADER,
  ENTITLEMENT_SIGNATURE_HEADER,
  type EntitlementReplayStore,
  type EntitlementRequestVerifierConfig,
} from './entitlements.js';
export {
  requireAuth,
  requireScopes,
  requireAllScopes,
  requireAnyScope,
  requireMCPToken,
  verifyAuthorizationHeader,
  MAX_OFFLINE_DEVELOPMENT_TOKEN_TTL_SECONDS,
  AuthedRequestSchema,
  type AuthedRequest,
  ResponseLikeSchema,
  type ResponseLike,
  NextFnSchema,
  type NextFn,
  type MCPTokenOptions,
  type ConnectionValidationMode,
  type ConnectionStatusValidator,
  type ApprovalValidator,
} from './middleware.js';
