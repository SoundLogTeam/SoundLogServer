import cors from 'cors';

import { env } from '../config/env.js';

const developmentLocalhostOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

function getAllowedOrigins() {
  const configuredOrigins = (env.CLIENT_URLS ?? env.CLIENT_URL)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set(configuredOrigins);
}

function resolveCorsOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean | string) => void,
) {
  if (!origin) {
    callback(null, true);
    return;
  }

  const allowedOrigins = getAllowedOrigins();

  if (
    allowedOrigins.has(origin) ||
    (env.NODE_ENV !== 'production' && developmentLocalhostOriginPattern.test(origin))
  ) {
    callback(null, origin);
    return;
  }

  callback(null, false);
}

export const corsMiddleware = cors({
  origin: resolveCorsOrigin,
  credentials: true,
});
