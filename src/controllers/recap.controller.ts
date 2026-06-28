import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/auth.middleware.js';
import { apiService } from '../services/api.service.js';
import { acceptedResponse, dataResponse } from '../utils/response.js';

export const recapController = {
  async getRecaps(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(await apiService.getRecaps(user.id, req.query));
  },

  async createRecap(req: Request, res: Response) {
    const user = requireUser(req);
    res.status(201).json(
      dataResponse(
        await apiService.createRecap(
          user.id,
          req.body,
          req.header('Idempotency-Key'),
        ),
      ),
    );
  },

  async getRecapShare(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(dataResponse(await apiService.getRecapShare(user.id, String(req.params.recapId))));
  },

  async createShareEvent(req: Request, res: Response) {
    const user = requireUser(req);
    await apiService.createRecapShareEvent(
      user.id,
      String(req.params.recapId),
      req.body,
      req.header('Idempotency-Key'),
    );
    res.status(202).json(acceptedResponse());
  },
};
