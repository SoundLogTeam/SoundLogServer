import type { ErrorRequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { ZodError } from 'zod';

import { ERROR_CODES, ERROR_MESSAGES } from '../constants/error.constants.js';
import { HttpError } from '../utils/http-error.js';

export const errorMiddleware: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? {},
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: ERROR_CODES.BAD_REQUEST,
        message: ERROR_MESSAGES.INVALID_REQUEST,
        details: { issues: error.issues },
      },
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    res.status(400).json({
      error: {
        code: ERROR_CODES.BAD_REQUEST,
        message: ERROR_MESSAGES.FILE_UPLOAD_INVALID,
        details: { field: error.field, reason: error.message },
      },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    res.status(400).json({
      error: {
        code: ERROR_CODES.DATABASE_ERROR,
        message: ERROR_MESSAGES.DATABASE_ERROR,
        details: { code: error.code },
      },
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    error: {
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
      details: {},
    },
  });
};
