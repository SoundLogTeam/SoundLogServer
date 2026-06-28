import { ERROR_CODES, ERROR_MESSAGES } from '../constants/error.constants.js';

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
  return new HttpError(400, ERROR_CODES.BAD_REQUEST, message, details);
}

export function unauthorized(message: string = ERROR_MESSAGES.AUTH_REQUIRED) {
  return new HttpError(401, ERROR_CODES.UNAUTHORIZED, message);
}

export function notFound(message: string = ERROR_MESSAGES.RESOURCE_NOT_FOUND) {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, message);
}
