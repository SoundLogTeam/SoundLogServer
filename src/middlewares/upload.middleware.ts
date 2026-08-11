import multer from 'multer';

import { env } from '../config/env.js';

const BYTES_PER_MEGABYTE = 1024 * 1024;
const MOMENT_PHOTO_MAX_FILE_SIZE_BYTES =
  env.MOMENT_PHOTO_MAX_FILE_SIZE_MB * BYTES_PER_MEGABYTE;

// Client-declared MIME types accepted at upload time. This is a cheap, spoofable
// first line of defense (multer's fileFilter only sees the multipart part's declared
// Content-Type, not the actual bytes) that simply stops obviously-wrong uploads (PDFs,
// executables, etc.) from ever being written to disk. The real security boundary is the
// magic-byte sniff performed when serving the file back out (see
// upload-file.service.ts#detectImageContentType), which never trusts this value.
const ALLOWED_MOMENT_PHOTO_MIME_TYPES = new Set([
  'image/gif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

// multer's default disk storage names files with crypto.randomBytes(16).toString('hex'),
// i.e. exactly 32 lowercase hex characters and nothing else (no path separators, no dots).
// This pattern is the single source of truth for what a valid stored filename looks like,
// and is used both to generate public-facing file ids and to validate/reject any client
// supplied file id (blocking path traversal, absolute paths, encoded separators, etc.)
// before it is ever used to build a filesystem path.
export const UPLOAD_FILE_ID_PATTERN = /^[a-f0-9]{32}$/;

export const UPLOADED_FILE_ROUTE_PATH = '/v1/uploads';

export const momentPhotoUpload = multer({
  dest: env.UPLOAD_DIRECTORY,
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MOMENT_PHOTO_MIME_TYPES.has(file.mimetype)) {
      // Using multer's own error type (rather than an arbitrary Error) means the existing
      // errorMiddleware `multer.MulterError` branch turns this into a 400 automatically —
      // no changes needed there. Rejecting via this callback happens before multer's
      // storage engine writes anything for this part, so no file is left on disk.
      callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
      return;
    }

    callback(null, true);
  },
  limits: {
    fileSize: MOMENT_PHOTO_MAX_FILE_SIZE_BYTES,
  },
});

export function createUploadedFilePublicPath(filename: string) {
  return `${UPLOADED_FILE_ROUTE_PATH}/${filename}`;
}
