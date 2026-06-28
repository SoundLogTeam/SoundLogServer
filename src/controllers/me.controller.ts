import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/auth.middleware.js';
import { apiService } from '../services/api.service.js';
import { authService } from '../services/auth.service.js';
import { dataResponse } from '../utils/response.js';

export const meController = {
  async getMe(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(dataResponse(await authService.getMe(user.id)));
  },

  async getProfile(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(dataResponse(await apiService.getMyProfile(user.id)));
  },

  async upsertProfile(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(dataResponse(await apiService.upsertMyProfile(user.id, req.body)));
  },

  async getMusicPlatform(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(dataResponse(await apiService.getMyMusicPlatform(user.id)));
  },

  async updateMusicPlatform(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(dataResponse(await apiService.updateMyMusicPlatform(user.id, req.body)));
  },

  async migrateLocalData(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(dataResponse(await apiService.migrateLocalData(user.id, req.body)));
  },
};
