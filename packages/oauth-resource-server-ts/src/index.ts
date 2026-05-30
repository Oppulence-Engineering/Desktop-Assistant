/**
 * @oppulence/oauth-resource-server
 *
 * A lightweight OAuth 2.0 resource-server toolkit for TypeScript services. It
 * verifies bearer JWTs against a JWKS (cached, with kid-miss refresh via jose),
 * validates issuer/audience/expiry, extracts scopes, and provides framework
 * middleware for authentication and scope enforcement.
 *
 * It is the TypeScript sibling of packages/oauth-resource-server-go; the two
 * behave identically so the product suite (Canvas, Corinthian, Billflow MCP
 * servers) enforces auth the same way regardless of language.
 */
export { ClaimsSchema, type Claims, hasScope, hasAllScopes, hasAnyScope, claimsFromPayload } from './claims.js';
export { Verifier, VerifierConfigSchema, type VerifierConfig, TokenError, bearerToken } from './verifier.js';
export {
  requireAuth,
  requireScopes,
  verifyAuthorizationHeader,
  AuthedRequestSchema,
  type AuthedRequest,
  ResponseLikeSchema,
  type ResponseLike,
  NextFnSchema,
  type NextFn,
} from './middleware.js';
