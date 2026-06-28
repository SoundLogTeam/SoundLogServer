import type { Request, Response } from 'express';

import { devDbTestService } from '../services/dev-db-test.service.js';
import { dataResponse } from '../utils/response.js';

export const devDbTestController = {
  async createRecord(req: Request, res: Response) {
    res.status(201).json(dataResponse(await devDbTestService.createRecord(req.body)));
  },
};
