import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/auth.middleware.js';
import { createUploadedFilePublicPath } from '../middlewares/upload.middleware.js';
import { apiService } from '../services/api.service.js';
import { dataResponse } from '../utils/response.js';

export const momentLogController = {
  async getMomentLogs(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(await apiService.getMomentLogs(user.id, req.query));
  },

  async createMomentLog(req: Request, res: Response) {
    const user = requireUser(req);
    const photoPath = req.file
      ? createUploadedFilePublicPath(req.file.filename)
      : undefined;

    res.status(201).json(
      dataResponse(
        await apiService.createMomentLog(
          user.id,
          {
            ...req.body,
            photoPath,
          },
          req.header('Idempotency-Key'),
        ),
      ),
    );
  },
};
