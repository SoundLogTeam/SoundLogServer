import { Prisma } from '@prisma/client';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ERROR_CODES, ERROR_MESSAGES } from '../src/constants/error.constants.js';
import { errorMiddleware } from '../src/middlewares/error.middleware.js';
import { requireUser } from '../src/middlewares/auth.middleware.js';
import { createUploadedFilePublicPath } from '../src/middlewares/upload.middleware.js';
import { validate } from '../src/middlewares/validate.middleware.js';
import { badRequest, notFound } from '../src/utils/http-error.js';
import { acceptedResponse, pagedResponse } from '../src/utils/response.js';

function createErrorTestApp() {
  const app = express();

  app.use(express.json());
  app.get('/http-error', () => {
    throw notFound('missing route');
  });
  app.get('/zod-error', () => {
    z.object({ id: z.string().uuid() }).parse({ id: 'not-a-uuid' });
  });
  app.get('/multer-error', (_req, _res, next) => {
    next(new multer.MulterError('LIMIT_FILE_SIZE', 'photo'));
  });
  app.get('/prisma-error', (_req, _res, next) => {
    next(
      new Prisma.PrismaClientKnownRequestError('unique failed', {
        clientVersion: 'test',
        code: 'P2002',
      }),
    );
  });
  app.get('/unknown-error', () => {
    throw new Error('boom');
  });
  app.get(
    '/validated',
    validate({
      query: z.object({
        limit: z.coerce.number().int().min(1),
      }),
    }),
    (req, res) => {
      res.json({ limitType: typeof req.query.limit, value: req.query.limit });
    },
  );
  app.get(
    '/invalid',
    validate({
      query: z.object({
        limit: z.coerce.number().int().min(1),
      }),
    }),
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  app.get('/bad-request', () => {
    throw badRequest('bad input', { reason: 'test' });
  });
  app.use(errorMiddleware);

  return app;
}

describe('middleware and response utilities', () => {
  it('serializes known application, validation, upload, and database errors', async () => {
    const app = createErrorTestApp();

    const httpError = await request(app).get('/http-error');
    const zodError = await request(app).get('/zod-error');
    const uploadError = await request(app).get('/multer-error');
    const prismaError = await request(app).get('/prisma-error');
    const badInput = await request(app).get('/bad-request');

    expect(httpError.status).toBe(404);
    expect(httpError.body.error).toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
      message: 'missing route',
    });
    expect(zodError.status).toBe(400);
    expect(zodError.body.error.details.issues).toHaveLength(1);
    expect(uploadError.status).toBe(400);
    expect(uploadError.body.error).toMatchObject({
      code: ERROR_CODES.BAD_REQUEST,
      message: ERROR_MESSAGES.FILE_UPLOAD_INVALID,
    });
    expect(uploadError.body.error.details.field).toBe('photo');
    expect(prismaError.status).toBe(400);
    expect(prismaError.body.error.details.code).toBe('P2002');
    expect(badInput.body.error.details.reason).toBe('test');
  });

  it('hides unknown errors behind a generic 500 response', async () => {
    const app = createErrorTestApp();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await request(app).get('/unknown-error');

    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
      details: {},
    });
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it('replaces request values with parsed validation output', async () => {
    const app = createErrorTestApp();

    const valid = await request(app).get('/validated?limit=3');
    const invalid = await request(app).get('/invalid?limit=0');

    expect(valid.status).toBe(200);
    expect(valid.body).toEqual({ limitType: 'number', value: 3 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.message).toBe(ERROR_MESSAGES.INVALID_REQUEST);
  });

  it('throws when a protected controller requires a missing user', () => {
    expect(() => requireUser({} as never)).toThrow(ERROR_MESSAGES.AUTH_REQUIRED);
  });

  it('normalizes response and upload helper output', () => {
    expect(pagedResponse([{ id: 'one' }], { limit: 1 })).toEqual({
      data: [{ id: 'one' }],
      page: {
        limit: 1,
        nextCursor: null,
      },
    });
    expect(acceptedResponse()).toEqual({ data: { accepted: true } });
    expect(createUploadedFilePublicPath('photo.jpg')).toMatch(/\/photo\.jpg$/);
  });
});
