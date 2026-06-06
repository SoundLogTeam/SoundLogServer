import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

import { badRequest } from '../utils/http-error.js';

type ValidationSchemas = {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
};

export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];

      if (!schema) {
        continue;
      }

      const result = schema.safeParse(req[key]);

      if (!result.success) {
        throw badRequest('요청 값이 올바르지 않습니다.', {
          issues: result.error.issues,
        });
      }

      Object.defineProperty(req, key, {
        value: result.data,
        writable: true,
      });
    }

    next();
  };
}

