import type { Request, Response } from 'express';

import { apiService } from '../services/api.service.js';
import { dataResponse } from '../utils/response.js';

export const tourController = {
  async getNearbyPlaces(req: Request, res: Response) {
    res.json(dataResponse(await apiService.getNearbyPlaces(req.query as never)));
  },
};
