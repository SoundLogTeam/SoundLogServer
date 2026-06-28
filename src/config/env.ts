import 'dotenv/config';

import { z } from 'zod';

const envSchema = z.object({
  ALLOW_DEV_AUTH_FALLBACK: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  CLIENT_URL: z.string().url().default('http://localhost:8081'),
  CLIENT_URLS: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  APPLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  KAKAO_APP_ID: z.string().optional(),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(3600),
  JWT_SECRET: z.string().min(16),
  ML_RECOMMENDATION_API_URL: z
    .string()
    .url()
    .default('http://211.188.54.204:8000/recommend'),
  ML_RECOMMENDATION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  MOMENT_PHOTO_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(10),
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  REQUEST_BODY_LIMIT: z.string().min(1).default('1mb'),
  TOUR_API_BASE_URL: z.string().url().default('https://apis.data.go.kr/B551011/KorService2'),
  TOUR_API_SERVICE_KEY: z.string().optional(),
  USE_MOCK_DB: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  UPLOAD_DIRECTORY: z.string().min(1).default('uploads'),
  UPLOAD_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
  UPLOAD_PUBLIC_PATH: z.string().min(1).default('/uploads'),
});

export const env = envSchema.parse(process.env);
