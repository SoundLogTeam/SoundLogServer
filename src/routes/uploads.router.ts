import { Router } from 'express';

import { uploadFileController } from '../controllers/upload-file.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { UPLOADED_FILE_ROUTE_PATH } from '../middlewares/upload.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';

export function createUploadsRouter() {
  const router = Router();

  router.get(
    `${UPLOADED_FILE_ROUTE_PATH}/:fileId`,
    authMiddleware,
    asyncHandler(uploadFileController.getUploadedFile),
  );

  return router;
}
