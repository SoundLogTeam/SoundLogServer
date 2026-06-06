import type { Request, Response } from 'express';

import { apiService } from '../services/api.service.js';
import { authService } from '../services/auth.service.js';
import { acceptedResponse, dataResponse } from '../utils/response.js';
import { badRequest } from '../utils/http-error.js';
import { requireUser } from '../middlewares/auth.middleware.js';

export const systemController = {
  async getHealth(_req: Request, res: Response) {
    res.json(dataResponse(await apiService.getHealth()));
  },
};

export const authController = {
  async socialLogin(req: Request, res: Response) {
    res.json(dataResponse(await authService.socialLogin(req.body)));
  },

  async refresh(req: Request, res: Response) {
    res.json(dataResponse(await authService.refresh(req.body.refreshToken)));
  },
};

export const meController = {
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
};

export const tourController = {
  async getNearbyPlaces(req: Request, res: Response) {
    res.json(dataResponse(await apiService.getNearbyPlaces(req.query as never)));
  },
};

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

export const playlistController = {
  async createContextualPlaylist(req: Request, res: Response) {
    const user = requireUser(req);
    res.status(201).json(dataResponse(await apiService.createContextualPlaylist(user.id, req.body)));
  },

  async getPlaylist(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(
      dataResponse(
        await apiService.getPlaylist(
          user.id,
          String(req.params.playlistId),
          req.query as never,
        ),
      ),
    );
  },
};

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
        ),
      ),
    );
  },
};

export const momentLogController = {
  async getMomentLogs(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(await apiService.getMomentLogs(user.id, req.query));
  },

  async createMomentLog(req: Request, res: Response) {
    const user = requireUser(req);

    if (!req.file) {
      throw badRequest('photo 파일이 필요합니다.');
    }

    res.status(201).json(
      dataResponse(
        await apiService.createMomentLog(user.id, {
          ...req.body,
          photoPath: `/uploads/${req.file.filename}`,
        }),
      ),
    );
  },
};

export const recommendationEventController = {
  async createEvents(req: Request, res: Response) {
    const user = requireUser(req);
    await apiService.createRecommendationEvents(user.id, req.body);
    res.status(202).json(acceptedResponse());
  },
};

export const recapController = {
  async getRecaps(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(await apiService.getRecaps(user.id, req.query));
  },

  async createRecap(req: Request, res: Response) {
    const user = requireUser(req);
    res.status(201).json(dataResponse(await apiService.createRecap(user.id, req.body)));
  },

  async getRecapShare(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(dataResponse(await apiService.getRecapShare(user.id, String(req.params.recapId))));
  },

  async createShareEvent(req: Request, res: Response) {
    const user = requireUser(req);
    await apiService.createRecapShareEvent(user.id, String(req.params.recapId), req.body);
    res.status(202).json(acceptedResponse());
  },
};

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

export const trendController = {
  async getRegionSoundTrend(req: Request, res: Response) {
    res.json(
      dataResponse(
        await apiService.getRegionSoundTrend({
          period: String(req.query.period),
          regionCode: String(req.params.regionCode),
        }),
      ),
    );
  },
};
