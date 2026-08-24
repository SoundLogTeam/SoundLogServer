import crypto from 'node:crypto';

import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';

type AccessTokenPayload = {
  sub: string;
};

export function signAccessToken(userId: string) {
  return jwt.sign({ sub: userId } satisfies AccessTokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN_SECONDS,
  });
}

export function verifyAccessToken(token: string) {
  const payload = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;

  return payload.sub;
}

export function createRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createPublicId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}
