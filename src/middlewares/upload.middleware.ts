import express from 'express';
import multer from 'multer';

import { env } from '../config/env.js';

const BYTES_PER_MEGABYTE = 1024 * 1024;
const MOMENT_PHOTO_MAX_FILE_SIZE_BYTES =
  env.MOMENT_PHOTO_MAX_FILE_SIZE_MB * BYTES_PER_MEGABYTE;

function normalizePublicPath(value: string) {
  const trimmed = value.trim();
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

  return withLeadingSlash.replace(/\/+$/, '') || '/';
}

export const uploadedFilesPublicPath = normalizePublicPath(env.UPLOAD_PUBLIC_PATH);

export const uploadedFilesStaticMiddleware = express.static(env.UPLOAD_DIRECTORY);

export const momentPhotoUpload = multer({
  dest: env.UPLOAD_DIRECTORY,
  limits: {
    fileSize: MOMENT_PHOTO_MAX_FILE_SIZE_BYTES,
  },
});

export function createUploadedFilePublicPath(filename: string) {
  if (uploadedFilesPublicPath === '/') {
    return `/${filename}`;
  }

  return `${uploadedFilesPublicPath}/${filename}`;
}
