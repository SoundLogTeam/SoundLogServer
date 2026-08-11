import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/auth.middleware.js';
import { uploadFileService } from '../services/upload-file.service.js';
import { notFound } from '../utils/http-error.js';

export const uploadFileController = {
  async getUploadedFile(req: Request, res: Response) {
    const user = requireUser(req);
    const fileId = String(req.params.fileId);

    const resolved = await uploadFileService.resolveUploadedFileForUser(user.id, fileId);

    // Unknown file, disallowed access, and invalid/traversal file ids all resolve the
    // same way (undefined) and all produce the same 404, so a caller cannot use the
    // response to tell a private file that doesn't belong to them apart from a file
    // that simply doesn't exist.
    if (!resolved) {
      throw notFound();
    }

    // multer stores uploads with no extension, so Content-Type must be derived from the
    // file's actual bytes (never the client-supplied upload MIME type or a filename), or
    // helmet's `X-Content-Type-Options: nosniff` leaves browsers refusing to render it. If
    // the bytes don't match a known image signature, the file is not served as an image at
    // all — this also covers legacy/unexpected on-disk files that happen to have a matching
    // DB row but aren't actually images.
    const contentType = await uploadFileService.detectImageContentType(resolved.absolutePath);

    if (!contentType) {
      throw notFound();
    }

    res.type(contentType);
    res.sendFile(resolved.absolutePath);
  },
};
