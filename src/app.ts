import express from 'express';
import path from 'node:path';

import { env } from './config/env.js';
import { ERROR_MESSAGES } from './constants/error.constants.js';
import {
  jsonBodyParserMiddleware,
  urlencodedBodyParserMiddleware,
} from './middlewares/body-parser.middleware.js';
import { corsMiddleware } from './middlewares/cors.middleware.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { requestLoggerMiddleware } from './middlewares/request-logger.middleware.js';
import { securityMiddleware } from './middlewares/security.middleware.js';
import { registerSwaggerDocs } from './middlewares/swagger.middleware.js';
import { createApiRouter } from './routes/index.js';
import { createLegalRouter } from './routes/legal.router.js';
import { createUploadsRouter } from './routes/uploads.router.js';
import { notFound } from './utils/http-error.js';

export function createApp() {
  const app = express();

  // Keep the direct-server default safe: trusting forwarded IP headers without a
  // known proxy topology lets clients spoof the address used by auth rate limits.
  // Deployments behind a reverse proxy must set the exact trusted hop count.
  if (env.TRUST_PROXY_HOPS > 0) {
    app.set('trust proxy', env.TRUST_PROXY_HOPS);
  }

  app.use(corsMiddleware);
  app.use(securityMiddleware);
  app.use(jsonBodyParserMiddleware);
  app.use(urlencodedBodyParserMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(createLegalRouter());
  app.use(
    '/assets',
    express.static(path.resolve('public/assets'), {
      immutable: true,
      maxAge: '1y',
    }),
  );
  // Uploaded photos are served only through an authenticated, ownership/visibility-checked
  // endpoint (see uploads.router.ts) — there is no unauthenticated static file serving of
  // the uploads directory.
  app.use(createUploadsRouter());
  registerSwaggerDocs(app);
  app.use(createApiRouter());
  app.use((_req, _res, next) => {
    next(notFound(ERROR_MESSAGES.ROUTE_NOT_FOUND));
  });
  app.use(errorMiddleware);

  return app;
}
