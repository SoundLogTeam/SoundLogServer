import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/auth.middleware.js';
import { apiService } from '../services/api.service.js';
import { acceptedResponse, dataResponse } from '../utils/response.js';

export const communityController = {
  async createTravelRoom(req: Request, res: Response) {
    const user = requireUser(req);
    res.status(201).json(dataResponse(await apiService.createTravelRoom(user.id, req.body)));
  },

  async getTravelRoom(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(dataResponse(await apiService.getTravelRoom(user.id, String(req.params.roomId))));
  },

  async joinTravelRoom(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(
      dataResponse(
        await apiService.joinTravelRoom(user.id, String(req.params.roomId), req.body),
      ),
    );
  },

  async addTravelRoomMoment(req: Request, res: Response) {
    const user = requireUser(req);
    res.status(201).json(
      dataResponse(
        await apiService.addTravelRoomMoment(user.id, String(req.params.roomId), req.body),
      ),
    );
  },

  async updateTravelRoomMoment(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(
      dataResponse(
        await apiService.updateTravelRoomMoment(
          user.id,
          String(req.params.roomId),
          String(req.params.momentId),
          req.body,
        ),
      ),
    );
  },

  async addTravelRoomMomentComment(req: Request, res: Response) {
    const user = requireUser(req);
    res.status(201).json(
      dataResponse(
        await apiService.addTravelRoomMomentComment(
          user.id,
          String(req.params.roomId),
          String(req.params.momentId),
          req.body,
        ),
      ),
    );
  },

  async createTravelRoomRecap(req: Request, res: Response) {
    const user = requireUser(req);
    res.status(201).json(
      dataResponse(
        await apiService.createTravelRoomRecap(
          user.id,
          String(req.params.roomId),
          req.body,
          req.header('Idempotency-Key'),
        ),
      ),
    );
  },

  async getSoundMap(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(dataResponse(await apiService.getSoundMapPins(user.id, req.query)));
  },

  async upsertCurrentTrack(req: Request, res: Response) {
    const user = requireUser(req);
    res.status(202).json(dataResponse(await apiService.upsertSoundMapCurrentTrack(user.id, req.body)));
  },

  async getNearbySounds(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(dataResponse(await apiService.getNearbySoundMatches(user.id, req.query)));
  },

  async getMusicMatches(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(dataResponse(await apiService.getMusicMatches(user.id, req.query)));
  },

  async createTravelMateRequest(req: Request, res: Response) {
    const user = requireUser(req);
    res.status(201).json(dataResponse(await apiService.createTravelMateRequest(user.id, req.body)));
  },

  async updateTravelMateRequest(req: Request, res: Response) {
    const user = requireUser(req);
    res.json(
      dataResponse(
        await apiService.updateTravelMateRequest(
          user.id,
          String(req.params.requestId),
          req.body,
        ),
      ),
    );
  },

  async blockCommunityUser(req: Request, res: Response) {
    const user = requireUser(req);
    await apiService.blockCommunityUser(user.id, req.body);
    res.status(202).json(acceptedResponse());
  },

  async reportCommunityTarget(req: Request, res: Response) {
    const user = requireUser(req);
    await apiService.reportCommunityTarget(user.id, req.body);
    res.status(202).json(acceptedResponse());
  },
};
