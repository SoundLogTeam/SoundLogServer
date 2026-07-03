import type { Request, Response } from 'express';

import { authService } from '../services/auth.service.js';
import { acceptedResponse, dataResponse } from '../utils/response.js';

export const authController = {
  async login(req: Request, res: Response) {
    res.json(dataResponse(await authService.login(req.body)));
  },

  async register(req: Request, res: Response) {
    res.status(201).json(dataResponse(await authService.register(req.body)));
  },

  async refresh(req: Request, res: Response) {
    res.json(dataResponse(await authService.refresh(req.body.refreshToken)));
  },

  async logout(req: Request, res: Response) {
    await authService.logout(req.body.refreshToken);
    res.status(202).json(acceptedResponse());
  },
};
