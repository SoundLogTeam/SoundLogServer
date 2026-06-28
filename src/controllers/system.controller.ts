import type { Request, Response } from 'express';

import { apiService } from '../services/api.service.js';
import { dataResponse } from '../utils/response.js';

export const systemController = {
  async getHealth(_req: Request, res: Response) {
    res.json(dataResponse(await apiService.getHealth()));
  },
};
