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

  async createRecapCapture(req: Request, res: Response) {
    const user = requireUser(req);
    const photoPath = req.file
      ? createUploadedFilePublicPath(req.file.filename)
      : undefined;
    const idempotencyKey = req.header('Idempotency-Key');
    const capture = await apiService.createMomentLog(
      user.id,
      {
        ...req.body,
        photoPath,
      },
      idempotencyKey,
    );

    if (req.body.sessionId || !req.body.createStandaloneRecap) {
      res.status(201).json(dataResponse(capture));
      return;
    }

    if (!capture.id) {
      throw new Error('Created recap capture did not return an id.');
    }

    const recap = await apiService.createRecap(
      user.id,
      {
        momentLogIds: [capture.id],
        templateId: req.body.templateId ?? 'film',
        visibility: req.body.visibility ?? 'private',
      },
      `standalone-recap:${idempotencyKey ?? capture.id}`,
    );

    res.status(201).json(
      dataResponse({
        ...capture,
        recapId: recap.id,
      }),
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
