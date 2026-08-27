import { z } from 'zod';
import { ClaimsSchema, type Claims, hasAllScopes, hasAnyScope } from './claims.js';
import { AuthorizationError, type ErrorCode } from './errors.js';
import { Verifier, bearerToken } from './verifier.js';

/**
 * AuthedRequestSchema is the zod schema for a request carrying an optional
 * resolved claims property (Express/connect-style). The `AuthedRequest` type is
 * inferred from it.
 */
export const AuthedRequestSchema = z.object({
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())]).optional()),
  method: z.string().optional(),
  url: z.string().optional(),
  body: z.unknown().optional(),
  claims: ClaimsSchema.optional(),
}).passthrough();

/** A request with an optional resolved claims property (Express/connect-style). */
export type AuthedRequest = z.infer<typeof AuthedRequestSchema>;

/**
 * Minimal response surface (compatible with Express). This is a recursive,
 * method-bearing contract describing a framework object rather than validatable
 * data, so the schema is a {@link z.custom} pass-through over the type.
 */
export type ResponseLike = {
  status(code: number): ResponseLike;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
};
export const ResponseLikeSchema = z.custom<ResponseLike>();

/**
 * NextFn is the Express/connect `next` callback. As a callable (not data), it is
 * represented with {@link z.custom} over the function type.
 */
export type NextFn = (err?: unknown) => void;
export const NextFnSchema = z.custom<NextFn>();

function sendError(res: ResponseLike, err: AuthorizationError): void {
  res.status(err.status);
  if (err.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
  res.json({ error: err.message, code: err.code });
}

function denial(code: ErrorCode, status: number, message: string, cause?: unknown): AuthorizationError {
  return new AuthorizationError(code, status, message, cause);
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * requireAuth is Express/connect-style middleware that verifies the bearer
 * token and attaches `req.claims`. Responds 401 on any failure.
 */
export function requireAuth(verifier: Verifier) {
  return async (req: AuthedRequest, res: ResponseLike, next: NextFn): Promise<void> => {
    const raw = bearerToken(headerValue(req.headers['authorization']));
    if (!raw) {
      sendError(res, denial('token_missing', 401, 'missing bearer token'));
      return;
    }
    try {
      req.claims = await verifier.verify(raw);
      next();
    } catch (err) {
      sendError(res, err instanceof AuthorizationError ? err : denial('token_invalid_signature', 401, 'invalid token signature', err));
    }
  };
}

/**
 * requireScopes enforces that the caller holds every named scope. Mount after
 * requireAuth. Responds 403 on missing scope.
 */
export function requireAllScopes(...scopes: string[]) {
  return (req: AuthedRequest, res: ResponseLike, next: NextFn): void => {
    if (!req.claims) {
      sendError(res, denial('token_missing', 401, 'missing bearer token'));
      return;
    }
    if (!hasAllScopes(req.claims, ...scopes)) {
      sendError(res, denial('scope_missing', 403, 'required scope missing'));
      return;
    }
    next();
  };
}

/** Backward-compatible alias for all-of scope enforcement. */
export const requireScopes = requireAllScopes;

/** Enforces that the caller holds at least one named scope. */
export function requireAnyScope(...scopes: string[]) {
  return (req: AuthedRequest, res: ResponseLike, next: NextFn): void => {
    if (!req.claims) {
      sendError(res, denial('token_missing', 401, 'missing bearer token'));
      return;
    }
    if (scopes.length === 0 || !hasAnyScope(req.claims, ...scopes)) {
      sendError(res, denial('scope_missing', 403, 'required scope missing'));
      return;
    }
    next();
  };
}

export type ConnectionStatusValidator = (claims: Claims) => boolean | Promise<boolean>;
export type ApprovalValidator = (approvalToken: string, claims: Claims, request: AuthedRequest) => boolean | Promise<boolean>;

export type MCPTokenOptions = {
  /** Route-level audience requirement, in addition to verifier configuration. */
  audience?: string;
  /** All-of scope requirements. */
  requiredScopes?: string[];
  /** Any-of scope requirements. */
  anyScopes?: string[];
  /** Optional online connection revocation/status validation. */
  connectionValidator?: ConnectionStatusValidator;
  /** Optional money-moving approval validation/introspection. */
  approvalValidator?: ApprovalValidator;
};

/**
 * Composes RFC 012 bearer, scope, connection, and approval checks. A configured
 * approval validator makes X-Approval-Token mandatory and failures return 428.
 */
export function requireMCPToken(verifier: Verifier, options: MCPTokenOptions = {}) {
  return async (req: AuthedRequest, res: ResponseLike, next: NextFn): Promise<void> => {
    const raw = bearerToken(headerValue(req.headers['authorization']));
    if (!raw) {
      sendError(res, denial('token_missing', 401, 'missing bearer token'));
      return;
    }
    try {
      req.claims = await verifier.verify(raw);
    } catch (err) {
      sendError(res, err instanceof AuthorizationError ? err : denial('token_invalid_signature', 401, 'invalid token signature', err));
      return;
    }
    const claims = req.claims;
    if (options.audience && !claims.audience.includes(options.audience)) {
      sendError(res, denial('audience_mismatch', 401, 'token audience mismatch'));
      return;
    }
    if (options.requiredScopes && !hasAllScopes(claims, ...options.requiredScopes)) {
      sendError(res, denial('scope_missing', 403, 'required scope missing'));
      return;
    }
    if (options.anyScopes && (options.anyScopes.length === 0 || !hasAnyScope(claims, ...options.anyScopes))) {
      sendError(res, denial('scope_missing', 403, 'required scope missing'));
      return;
    }
    if (options.connectionValidator) {
      try {
        if (!(await options.connectionValidator(claims))) {
          sendError(res, denial('connection_revoked', 403, 'connection revoked'));
          return;
        }
      } catch (err) {
        sendError(res, denial('connection_revoked', 403, 'connection revoked', err));
        return;
      }
    }
    if (options.approvalValidator) {
      const token = headerValue(req.headers['x-approval-token'])?.trim();
      if (!token) {
        sendError(res, denial('approval_required', 428, 'approval required'));
        return;
      }
      try {
        if (!(await options.approvalValidator(token, claims, req))) {
          sendError(res, denial('approval_required', 428, 'approval required'));
          return;
        }
      } catch (err) {
        sendError(res, denial('approval_required', 428, 'approval required', err));
        return;
      }
    }
    next();
  };
}

/**
 * verifyAuthorizationHeader is a framework-agnostic helper for Hono, Fastify,
 * etc.: pass the raw Authorization header, get Claims back (throws TokenError).
 *
 *   app.use(async (c, next) => {
 *     const claims = await verifyAuthorizationHeader(verifier, c.req.header('authorization'));
 *     c.set('claims', claims);
 *     await next();
 *   });
 */
export async function verifyAuthorizationHeader(
  verifier: Verifier,
  authorization: string | undefined | null,
): Promise<Claims> {
  const raw = bearerToken(authorization);
  if (!raw) throw new Error('missing bearer token');
  return verifier.verify(raw);
}
