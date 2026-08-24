import express from 'express';

import { env } from '../config/env.js';

export const jsonBodyParserMiddleware = express.json({
  limit: env.REQUEST_BODY_LIMIT,
});

export const urlencodedBodyParserMiddleware = express.urlencoded({
  extended: true,
  limit: env.REQUEST_BODY_LIMIT,
});
