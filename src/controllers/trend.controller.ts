import type { Request, Response } from 'express';

import { apiService } from '../services/api.service.js';
import { dataResponse } from '../utils/response.js';

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
