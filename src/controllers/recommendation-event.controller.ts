import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/auth.middleware.js';
import { apiService } from '../services/api.service.js';
import { acceptedResponse } from '../utils/response.js';

export const recommendationEventController = {
  async createEvents(req: Request, res: Response) {
    const user = requireUser(req);
    await apiService.createRecommendationEvents(
      user.id,
      req.body,
      req.header('Idempotency-Key'),
    );
    res.status(202).json(acceptedResponse());
  },
};
