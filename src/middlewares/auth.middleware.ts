import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { defaultUser } from '../data/seed-data.js';
import { mockDb } from '../mock/mock-db.js';
import { unauthorized } from '../utils/http-error.js';
import { verifyAccessToken } from '../utils/tokens.js';

export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const authorization = req.header('authorization');
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined;

  if (!token) {
    if (env.ALLOW_DEV_AUTH_FALLBACK && env.NODE_ENV !== 'production') {
      if (env.USE_MOCK_DB) {
        req.user = mockDb.user;
        next();
        return;
      }

      const user = await prisma.user.upsert({
        where: { provider_providerUserId: defaultUser },
        update: {},
        create: {
          ...defaultUser,
          displayName: 'Local Soundlog User',
        },
      });

      req.user = user;
      next();
      return;
    }

    throw unauthorized();
  }

  try {
    const userId = verifyAccessToken(token);

    if (env.USE_MOCK_DB) {
      if (userId !== mockDb.user.id) {
        throw unauthorized('유효하지 않은 토큰입니다.');
      }

      req.user = mockDb.user;
      next();
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        provider: true,
        providerUserId: true,
      },
    });

    if (!user) {
      throw unauthorized('유효하지 않은 토큰입니다.');
    }

    req.user = user;
    next();
  } catch {
    throw unauthorized('유효하지 않은 토큰입니다.');
  }
}

export function requireUser(req: Request) {
  if (!req.user) {
    throw unauthorized();
  }

  return req.user;
}
