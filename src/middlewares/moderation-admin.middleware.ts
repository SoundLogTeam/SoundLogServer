import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.js';
import { ERROR_MESSAGES } from '../constants/error.constants.js';
import { unauthorized } from '../utils/http-error.js';

function matchesSecret(candidate: string, secret: string) {
  const candidateBuffer = Buffer.from(candidate);
  const secretBuffer = Buffer.from(secret);
  return candidateBuffer.length === secretBuffer.length &&
    crypto.timingSafeEqual(candidateBuffer, secretBuffer);
}

export function moderationAdminMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (!env.MODERATION_ADMIN_KEY) {
    throw unauthorized(ERROR_MESSAGES.MODERATION_ADMIN_NOT_CONFIGURED);
  }

  const candidate = req.header('x-soundlog-admin-key') ?? '';
  if (!matchesSecret(candidate, env.MODERATION_ADMIN_KEY)) {
    throw unauthorized();
  }

  next();
}
