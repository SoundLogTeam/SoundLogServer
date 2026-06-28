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
import {
  uploadedFilesPublicPath,
  uploadedFilesStaticMiddleware,
} from './middlewares/upload.middleware.js';
import { createApiRouter } from './routes/index.js';
import { notFound } from './utils/http-error.js';

export function createApp() {
  const app = express();

  app.use(corsMiddleware);
  app.use(securityMiddleware);
  app.use(jsonBodyParserMiddleware);
  app.use(urlencodedBodyParserMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(uploadedFilesPublicPath, uploadedFilesStaticMiddleware);
  registerSwaggerDocs(app);
  app.use(createApiRouter());
  app.use((_req, _res, next) => {
    next(notFound(ERROR_MESSAGES.ROUTE_NOT_FOUND));
  });
  app.use(errorMiddleware);

  return app;
}
