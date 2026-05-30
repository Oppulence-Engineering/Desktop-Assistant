import { z } from 'zod';
import { ClaimsSchema, type Claims, hasAllScopes } from './claims.js';
import { Verifier, bearerToken } from './verifier.js';

/**
 * AuthedRequestSchema is the zod schema for a request carrying an optional
 * resolved claims property (Express/connect-style). The `AuthedRequest` type is
 * inferred from it.
 */
export const AuthedRequestSchema = z.object({
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())]).optional()),
  claims: ClaimsSchema.optional(),
});

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

function sendError(res: ResponseLike, status: number, error: string, code: string): void {
  res.status(status);
  if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
  res.json({ error, code });
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
      sendError(res, 401, 'missing bearer token', 'unauthorized');
      return;
    }
    try {
      req.claims = await verifier.verify(raw);
      next();
    } catch {
      sendError(res, 401, 'invalid or expired token', 'unauthorized');
    }
  };
}

/**
 * requireScopes enforces that the caller holds every named scope. Mount after
 * requireAuth. Responds 403 on missing scope.
 */
export function requireScopes(...scopes: string[]) {
  return (req: AuthedRequest, res: ResponseLike, next: NextFn): void => {
    if (!req.claims) {
      sendError(res, 401, 'unauthenticated', 'unauthorized');
      return;
    }
    if (!hasAllScopes(req.claims, ...scopes)) {
      sendError(res, 403, 'insufficient scope', 'insufficient_scope');
      return;
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
