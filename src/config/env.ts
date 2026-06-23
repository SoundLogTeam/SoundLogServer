import 'dotenv/config';

import { z } from 'zod';

const envSchema = z.object({
  ALLOW_DEV_AUTH_FALLBACK: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  CLIENT_URL: z.string().url().default('http://localhost:8081'),
  DATABASE_URL: z.string().min(1),
  APPLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(3600),
  JWT_SECRET: z.string().min(16),
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  TOUR_API_BASE_URL: z.string().url().default('https://apis.data.go.kr/B551011/KorService2'),
  TOUR_API_SERVICE_KEY: z.string().optional(),
  USE_MOCK_DB: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  UPLOAD_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
});

export const env = envSchema.parse(process.env);
