import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/auth.middleware.js';
import { apiService } from '../services/api.service.js';
import { dataResponse } from '../utils/response.js';

export const libraryController = {
  async getTracks(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(await apiService.getLibraryTracks(user.id, req.query as never));
  },

  async updateTrackState(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(
      dataResponse(
        await apiService.updateLibraryTrackState(
          user.id,
          String(req.params.trackId),
          req.body,
          req.header('Idempotency-Key'),
        ),
      ),
    );
  },
};
