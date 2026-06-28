import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/auth.middleware.js';
import { apiService } from '../services/api.service.js';
import { dataResponse } from '../utils/response.js';

export const playlistController = {
  async createContextualPlaylist(req: Request, res: Response) {
    const user = requireUser(req);
    res.status(201).json(
      dataResponse(
        await apiService.createContextualPlaylist(
          user.id,
          req.body,
          req.header('Idempotency-Key'),
        ),
      ),
    );
  },

  async getPlaylist(req: Request, res: Response) {
    res.json(
      dataResponse(
        await apiService.getPlaylist(
          req.user?.id,
          String(req.params.playlistId),
          req.query as never,
        ),
      ),
    );
  },
};
