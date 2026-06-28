import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { env } from './config/env.js';
import { ERROR_MESSAGES } from './constants/error.constants.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { createApiRouter } from './routes/index.js';
import { notFound } from './utils/http-error.js';

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

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: resolveCorsOrigin,
      credentials: true,
    }),
  );
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.NODE_ENV === 'test' ? 'tiny' : 'dev'));
  app.use('/uploads', express.static('uploads'));
  app.use(createApiRouter());
  app.use((_req, _res, next) => {
    next(notFound(ERROR_MESSAGES.ROUTE_NOT_FOUND));
  });
  app.use(errorMiddleware);

  return app;
}
