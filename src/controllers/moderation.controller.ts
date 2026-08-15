import type { Request, Response } from 'express';

import { apiService } from '../services/api.service.js';
import { uploadFileService } from '../services/upload-file.service.js';
import { notFound } from '../utils/http-error.js';
import { dataResponse } from '../utils/response.js';

export const moderationController = {
  async listPendingContent(req: Request, res: Response) {
    res.json(dataResponse(
      await apiService.listPendingModerationContent(Number(req.query.limit ?? 50)),
    ));
  },

  async reviewContent(req: Request, res: Response) {
    res.json(dataResponse(await apiService.reviewModerationContent({
      contentId: String(req.params.contentId),
      reviewedBy: req.header('x-soundlog-admin-actor')?.trim() || 'admin',
      ...req.body,
    })));
  },

  async getPendingContentImage(req: Request, res: Response) {
    const resolved = await uploadFileService.resolveUploadedFileForModeration(
      String(req.params.fileId),
    );
    if (!resolved) throw notFound();

    const contentType = await uploadFileService.detectImageContentType(resolved.absolutePath);
    if (!contentType) throw notFound();

    res.type(contentType);
    res.sendFile(resolved.absolutePath);
  },

  async listReports(req: Request, res: Response) {
    res.json(dataResponse(await apiService.listModerationReports(req.query as never)));
  },

  async resolveReport(req: Request, res: Response) {
    res.json(dataResponse(await apiService.resolveModerationReport(
      String(req.params.reportId),
      {
        ...req.body,
        resolvedBy: req.header('x-soundlog-admin-actor')?.trim() || 'admin',
      },
    )));
  },

  async sweepDeadlines(_req: Request, res: Response) {
    res.json(dataResponse(await apiService.sweepModerationDeadlines()));
  },
};
