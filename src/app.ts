import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { env } from './config/env.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { createApiRouter } from './routes/index.js';
import { notFound } from './utils/http-error.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.CLIENT_URL,
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
    next(notFound('요청한 API 경로를 찾을 수 없습니다.'));
  });
  app.use(errorMiddleware);

  return app;
}
