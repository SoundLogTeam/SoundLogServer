import fs from 'node:fs/promises';
import path from 'node:path';

import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { UPLOAD_FILE_ID_PATTERN } from '../middlewares/upload.middleware.js';

const uploadRoot = path.resolve(env.UPLOAD_DIRECTORY);

export type ResolvedUploadedFile = {
  absolutePath: string;
};

// multer's disk storage writes uploaded files under a random 32-hex-character name with no
// extension, so `res.sendFile()` has nothing to infer a Content-Type from and Express falls
// back to `application/octet-stream`. Combined with helmet's `X-Content-Type-Options: nosniff`
// (which tells browsers not to sniff the body themselves), that means images would never
// render on the web. The fix is to determine the real image type ourselves from the file's
// leading bytes — never from the client-supplied upload MIME type or a filename extension,
// both of which are trivially spoofable — and set Content-Type explicitly before serving.
const IMAGE_HEADER_SNIFF_BYTES = 12;

type ImageMagicByteSignature = {
  contentType: string;
  matches: (header: Buffer) => boolean;
};

const IMAGE_MAGIC_BYTE_SIGNATURES: ImageMagicByteSignature[] = [
  {
    contentType: 'image/jpeg',
    matches: (header) =>
      header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff,
  },
  {
    contentType: 'image/png',
    matches: (header) =>
      header.length >= 8 &&
      header[0] === 0x89 &&
      header[1] === 0x50 &&
      header[2] === 0x4e &&
      header[3] === 0x47 &&
      header[4] === 0x0d &&
      header[5] === 0x0a &&
      header[6] === 0x1a &&
      header[7] === 0x0a,
  },
  {
    contentType: 'image/gif',
    matches: (header) =>
      header.length >= 6 &&
      header.subarray(0, 3).toString('ascii') === 'GIF' &&
      ['87a', '89a'].includes(header.subarray(3, 6).toString('ascii')),
  },
  {
    contentType: 'image/webp',
    matches: (header) =>
      header.length >= 12 &&
      header.subarray(0, 4).toString('ascii') === 'RIFF' &&
      header.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    // HEIC/HEIF files are ISO base media (MP4-family) containers: bytes 4-8 are the literal
    // string "ftyp" and bytes 8-12 are a 4-character "brand" identifying the specific format.
    contentType: 'image/heic',
    matches: (header) => {
      if (header.length < 12 || header.subarray(4, 8).toString('ascii') !== 'ftyp') {
        return false;
      }

      const brand = header.subarray(8, 12).toString('ascii');

      return ['heic', 'heim', 'heis', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand);
    },
  },
];

/**
 * Sniffs the first bytes of a file already resolved via `resolveUploadedFileForUser` and
 * returns the matching image Content-Type, or `undefined` if the bytes don't match any
 * known image signature. Callers must not serve the file as an image (and should not fall
 * back to a client-supplied or extension-derived type) when this returns `undefined`.
 */
async function detectImageContentType(absolutePath: string): Promise<string | undefined> {
  const fileHandle = await fs.open(absolutePath, 'r');

  try {
    const header = Buffer.alloc(IMAGE_HEADER_SNIFF_BYTES);
    const { bytesRead } = await fileHandle.read(header, 0, IMAGE_HEADER_SNIFF_BYTES, 0);
    const signatureHeader = header.subarray(0, bytesRead);

    return IMAGE_MAGIC_BYTE_SIGNATURES.find((signature) => signature.matches(signatureHeader))
      ?.contentType;
  } finally {
    await fileHandle.close();
  }
}

/**
 * Resolves a client-supplied `fileId` (the last path segment of a stored photoUrl) to an
 * absolute file path on disk, but only if the requesting user is allowed to see it.
 *
 * Returns `undefined` for every failure case (invalid id, unknown file, missing file on
 * disk, or an access check that fails) so callers can respond with an indistinguishable
 * 404 regardless of whether the file exists — this avoids leaking the existence of
 * private resources.
 */
async function resolveUploadedFileForUser(
  userId: string,
  fileId: string,
): Promise<ResolvedUploadedFile | undefined> {
  // Reject anything that is not exactly a 32-character hex string up front. This blocks
  // path traversal (`../`), absolute paths, URL-encoded separators (`%2e%2e%2f`), null
  // bytes, and any other shape before it ever touches the filesystem or the database.
  if (!UPLOAD_FILE_ID_PATTERN.test(fileId)) {
    return undefined;
  }

  // The uploaded file's owning MomentLog is looked up by matching the stored photoUrl's
  // trailing `/<fileId>` segment. The DB — not the client — is the source of truth for
  // which filename exists and who owns it.
  const momentLog = await prisma.momentLog.findFirst({
    where: { photoUrl: { endsWith: `/${fileId}` } },
    select: { moderationStatus: true, userId: true, visibility: true },
  });

  if (!momentLog) {
    return undefined;
  }

  const isOwner = momentLog.userId === userId;
  const isPublic =
    momentLog.visibility === 'public' && momentLog.moderationStatus === 'approved';

  if (!isOwner && !isPublic) {
    return undefined;
  }

  if (!isOwner) {
    const block = await prisma.communityBlock.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedUserId: momentLog.userId },
          { blockerId: momentLog.userId, blockedUserId: userId },
        ],
      },
      select: { id: true },
    });
    if (block) {
      return undefined;
    }
  }

  // Build the path from the server-known upload root and the validated fileId only, then
  // re-verify (defense in depth) that the resolved path is still inside the upload root.
  const absolutePath = path.resolve(uploadRoot, fileId);

  if (absolutePath !== path.join(uploadRoot, fileId) || !absolutePath.startsWith(`${uploadRoot}${path.sep}`)) {
    return undefined;
  }

  try {
    const stat = await fs.stat(absolutePath);

    if (!stat.isFile()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return { absolutePath };
}

async function resolveUploadedFileForModeration(
  fileId: string,
): Promise<ResolvedUploadedFile | undefined> {
  if (!UPLOAD_FILE_ID_PATTERN.test(fileId)) {
    return undefined;
  }

  const referenced = await prisma.momentLog.findFirst({
    where: { photoUrl: { endsWith: `/${fileId}` } },
    select: { id: true },
  });
  if (!referenced) {
    return undefined;
  }

  const absolutePath = path.resolve(uploadRoot, fileId);
  if (absolutePath !== path.join(uploadRoot, fileId) || !absolutePath.startsWith(`${uploadRoot}${path.sep}`)) {
    return undefined;
  }

  try {
    const stat = await fs.stat(absolutePath);
    return stat.isFile() ? { absolutePath } : undefined;
  } catch {
    return undefined;
  }
}

export const uploadFileService = {
  detectImageContentType,
  resolveUploadedFileForModeration,
  resolveUploadedFileForUser,
};
