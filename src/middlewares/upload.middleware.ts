import multer from 'multer';

const MOMENT_PHOTO_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const momentPhotoUpload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: MOMENT_PHOTO_MAX_FILE_SIZE_BYTES,
  },
});
