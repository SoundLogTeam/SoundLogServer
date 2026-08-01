import express from 'express';

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
import { createUploadsRouter } from './routes/uploads.router.js';
import { notFound } from './utils/http-error.js';

export function createApp() {
  const app = express();

  // Behind a single Caddy reverse proxy hop (see Caddyfile / docker-compose.prod.yml).
  // Trusting exactly 1 hop lets req.ip reflect the real client IP (needed for
  // rate limiting) without allowing X-Forwarded-For spoofing from the client.
  app.set('trust proxy', 1);

  app.use(corsMiddleware);
  app.use(securityMiddleware);
  app.use(jsonBodyParserMiddleware);
  app.use(urlencodedBodyParserMiddleware);
  app.use(requestLoggerMiddleware);
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
