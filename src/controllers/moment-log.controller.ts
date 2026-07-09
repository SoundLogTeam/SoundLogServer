import type { Request, Response } from 'express';

import { ERROR_MESSAGES } from '../constants/error.constants.js';
import { requireUser } from '../middlewares/auth.middleware.js';
import { createUploadedFilePublicPath } from '../middlewares/upload.middleware.js';
import { apiService } from '../services/api.service.js';
import { badRequest } from '../utils/http-error.js';
import { acceptedResponse, dataResponse } from '../utils/response.js';

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

  async updateMomentLog(req: Request, res: Response) {
    const user = requireUser(req);

    res.json(
      dataResponse(
        await apiService.updateMomentLog(
          user.id,
          String(req.params.momentLogId),
          req.body,
        ),
      ),
    );
  },

  async updateMomentLogPhoto(req: Request, res: Response) {
    const user = requireUser(req);

    if (!req.file) {
      throw badRequest(ERROR_MESSAGES.PHOTO_REQUIRED);
    }

    res.json(
      dataResponse(
        await apiService.updateMomentLogPhoto(
          user.id,
          String(req.params.momentLogId),
          createUploadedFilePublicPath(req.file.filename),
        ),
      ),
    );
  },

  async deleteMomentLogPhoto(req: Request, res: Response) {
    const user = requireUser(req);

    res.json(
      dataResponse(
        await apiService.deleteMomentLogPhoto(
          user.id,
          String(req.params.momentLogId),
        ),
      ),
    );
  },

  async deleteMomentLog(req: Request, res: Response) {
    const user = requireUser(req);

    await apiService.deleteMomentLog(user.id, String(req.params.momentLogId));
    res.status(202).json(acceptedResponse());
  },
};
