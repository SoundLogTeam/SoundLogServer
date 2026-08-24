import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/auth.middleware.js';
import { apiService } from '../services/api.service.js';
import { dataResponse } from '../utils/response.js';

type RecommendationPlaylistQuery = {
  mood: '감성적인' | '설레는' | '시원한' | '신나는' | '잔잔한';
  state: '바다' | '드라이브' | '산책' | '카페' | '야경';
  x: number;
  y: number;
};

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

  async getRecommendedPlaylist(req: Request, res: Response) {
    const query = req.query as unknown as RecommendationPlaylistQuery;

    res.json(
      dataResponse(
        await apiService.getRecommendedPlaylist(req.user?.id, {
          location: {
            lat: query.y,
            lng: query.x,
          },
          mood: query.mood,
          state: query.state,
        }),
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
