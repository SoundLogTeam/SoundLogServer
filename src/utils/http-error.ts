export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function badRequest(message: string, details?: Record<string, unknown>) {
  return new HttpError(400, 'BAD_REQUEST', message, details);
}

export function unauthorized(message = '인증이 필요합니다.') {
  return new HttpError(401, 'UNAUTHORIZED', message);
}

export function notFound(message = '요청한 리소스를 찾을 수 없습니다.') {
  return new HttpError(404, 'NOT_FOUND', message);
}

