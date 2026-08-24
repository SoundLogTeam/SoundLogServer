import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/auth.middleware.js';
import { apiService } from '../services/api.service.js';
import { dataResponse } from '../utils/response.js';

export const travelSessionController = {
  async createTravelSession(req: Request, res: Response) {
    const user = requireUser(req);
    res.status(201).json(
      dataResponse(await apiService.createTravelSession(user.id, req.body)),
    );
  },

  async updateTravelSession(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(
      dataResponse(
        await apiService.updateTravelSession(
          user.id,
          String(req.params.sessionId),
          req.body,
        ),
      ),
    );
  },
};
