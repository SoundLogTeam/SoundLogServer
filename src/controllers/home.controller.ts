import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/auth.middleware.js';
import { apiService } from '../services/api.service.js';
import { dataResponse } from '../utils/response.js';

export const homeController = {
  async getFeaturedPlaylists(req: Request, res: Response) {
    res.json(
      dataResponse(await apiService.getFeaturedPlaylists(req.user, req.query as never)),
    );
  },

  async getMoodRecommendations(req: Request, res: Response) {
    res.json(
      dataResponse(await apiService.getMoodRecommendations(req.user, req.query as never)),
    );
  },

  async getRecentMusicLogs(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(dataResponse(await apiService.getRecentMusicLogs(user.id, req.query)));
  },
};
