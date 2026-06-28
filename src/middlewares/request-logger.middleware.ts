import morgan from 'morgan';

import { env } from '../config/env.js';

export const requestLoggerMiddleware = morgan(env.NODE_ENV === 'test' ? 'tiny' : 'dev');
