export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export function badRequest(code: string, message = 'The authorization request is invalid.'): AppError {
  return new AppError(400, code, message);
}

export function conflict(code: string, message = 'This authorization action has already been used.'): AppError {
  return new AppError(409, code, message);
}

export function upstream(service: string, status?: number): AppError {
  return new AppError(
    502,
    `${service}_upstream_${status ?? 'unavailable'}`,
    'The authorization service is temporarily unavailable.',
  );
}
