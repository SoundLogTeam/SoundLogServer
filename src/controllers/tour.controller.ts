import type { Request, Response } from 'express';

import { apiService } from '../services/api.service.js';
import { dataResponse } from '../utils/response.js';

export const tourController = {
  async searchPlaces(req: Request, res: Response) {
    res.json(dataResponse(await apiService.searchPlaces(req.query as never)));
  },

  async getNearbyPlaces(req: Request, res: Response) {
    res.json(dataResponse(await apiService.getNearbyPlaces(req.query as never)));
  },

  async reverseGeocodeLocation(req: Request, res: Response) {
    res.json(dataResponse(await apiService.reverseGeocodeLocation(req.query as never)));
  },
};
