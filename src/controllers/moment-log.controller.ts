import type { Request, Response } from 'express';

import { ERROR_MESSAGES } from '../constants/error.constants.js';
import { requireUser } from '../middlewares/auth.middleware.js';
import { apiService } from '../services/api.service.js';
import { badRequest } from '../utils/http-error.js';
import { dataResponse } from '../utils/response.js';

export const momentLogController = {
  async getMomentLogs(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(await apiService.getMomentLogs(user.id, req.query));
  },

  async createMomentLog(req: Request, res: Response) {
    const user = requireUser(req);

    if (!req.file) {
      throw badRequest(ERROR_MESSAGES.PHOTO_REQUIRED);
    }

    res.status(201).json(
      dataResponse(
        await apiService.createMomentLog(
          user.id,
          {
            ...req.body,
            photoPath: `/uploads/${req.file.filename}`,
          },
          req.header('Idempotency-Key'),
        ),
      ),
    );
  },
};
