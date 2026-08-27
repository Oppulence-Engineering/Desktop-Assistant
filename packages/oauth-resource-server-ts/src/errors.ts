export const errorCodes = [
  'token_missing',
  'token_expired',
  'token_invalid_signature',
  'audience_mismatch',
  'scope_missing',
  'connection_revoked',
  'approval_required',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

/** Stable deny-by-default RFC 012 authorization error. */
export class AuthorizationError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly cause?: unknown;

  constructor(code: ErrorCode, status: number, message: string, cause?: unknown) {
    super(message);
    this.name = 'AuthorizationError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

export function classifyTokenError(err: unknown): AuthorizationError {
  const value = err as { code?: string; claim?: string; name?: string } | undefined;
  if (value?.claim === 'aud') {
    return new AuthorizationError('audience_mismatch', 401, 'token audience mismatch', err);
  }
  if (value?.code === 'ERR_JWT_EXPIRED' || value?.name === 'JWTExpired') {
    return new AuthorizationError('token_expired', 401, 'token expired', err);
  }
  // Issuer, nbf, iat, malformed token, unknown key, algorithm, and signature
  // failures collapse to RFC 012's non-oracular invalid-token code.
  return new AuthorizationError('token_invalid_signature', 401, 'invalid token signature', err);
}
