import type { Request, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

import { env } from '../config/env.js';

function accountKeyGenerator(req: Request) {
  const email =
    typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const ipKey = ipKeyGenerator(req.ip ?? 'unknown');

  // Endpoints without an email in the body (e.g. refresh) fall back to an
  // IP-only key here; the IP-only limiter below still applies independently.
  return email ? `${ipKey}:${email}` : ipKey;
}

function ipKeyGeneratorForRequest(req: Request) {
  return ipKeyGenerator(req.ip ?? 'unknown');
}

function handler(_req: Request, res: Response) {
  res.status(429).json({
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
      details: {},
    },
  });
}

const skip = () => !env.AUTH_RATE_LIMIT_ENABLED;

/**
 * Applies only to the auth endpoints that are most attractive to credential
 * stuffing / brute-force / account-enumeration attacks
 * (login, register, refresh). Not applied API-wide.
 *
 * Per-account limiter (keyed by IP + email): stops repeated attempts against
 * a single known account. On its own this does NOT stop credential
 * stuffing, where an attacker tries many different emails from the same IP
 * — each email is a fresh bucket. See authIpRateLimitMiddleware below for
 * that case; both are chained on the routes.
 *
 * Disabled by default under NODE_ENV=test (see src/config/env.ts) so it does
 * not destabilize existing test suites that call these endpoints repeatedly;
 * can be forced on via AUTH_RATE_LIMIT_ENABLED=true for dedicated tests.
 */
export const authAccountRateLimitMiddleware = rateLimit({
  handler,
  keyGenerator: accountKeyGenerator,
  legacyHeaders: false,
  limit: env.AUTH_RATE_LIMIT_MAX,
  skip,
  standardHeaders: true,
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
});

/**
 * Per-IP limiter (keyed by IP only, ignores email/account). This is the
 * actual defense against credential stuffing, where an attacker cycles
 * through many different email addresses from one IP — the account-scoped
 * limiter above would treat each attempt as a fresh bucket, but this one
 * catches the aggregate volume from that IP regardless of which account is
 * targeted. Deliberately looser than the account limit so legitimate users
 * behind shared/NAT IPs are unlikely to be affected.
 *
 * Shares the same enable/disable and response behavior as the account
 * limiter above.
 */
export const authIpRateLimitMiddleware = rateLimit({
  handler,
  keyGenerator: ipKeyGeneratorForRequest,
  legacyHeaders: false,
  limit: env.AUTH_RATE_LIMIT_IP_MAX,
  skip,
  standardHeaders: true,
  windowMs: env.AUTH_RATE_LIMIT_IP_WINDOW_MS,
});

export const communitySafetyRateLimitMiddleware = rateLimit({
  handler,
  keyGenerator: (req) => req.user?.id ?? ipKeyGeneratorForRequest(req),
  legacyHeaders: false,
  limit: 20,
  skip,
  standardHeaders: true,
  windowMs: 60 * 60 * 1000,
});
