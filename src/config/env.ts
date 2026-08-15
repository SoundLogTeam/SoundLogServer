import 'dotenv/config';

import { z } from 'zod';

const envSchema = z.object({
  ALLOW_DEV_AUTH_FALLBACK: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  AUTH_RATE_LIMIT_ENABLED: z.string().optional(),
  AUTH_RATE_LIMIT_IP_MAX: z.coerce.number().int().positive().default(40),
  AUTH_RATE_LIMIT_IP_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  CLIENT_URL: z.string().url().default('http://localhost:8081'),
  CLIENT_URLS: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(3600),
  JWT_SECRET: z.string().min(16),
  ML_RECOMMENDATION_API_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  ML_RECOMMENDATION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  MODERATION_ADMIN_KEY: z.string().min(32).optional(),
  MODERATION_ALERT_MODE: z.enum(['cloud_logging', 'webhook']).default('cloud_logging'),
  MODERATION_ALERT_WEBHOOK_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  MODERATION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  MOMENT_PHOTO_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(10),
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  REQUEST_BODY_LIMIT: z.string().min(1).default('1mb'),
  REVERSE_GEOCODING_BASE_URL: z
    .string()
    .url()
    .default('https://nominatim.openstreetmap.org'),
  REVERSE_GEOCODING_USER_AGENT: z
    .string()
    .min(8)
    .default('Soundlog/0.1 (+https://github.com/SoundLogTeam/SoundLogServer)'),
  TOUR_API_BASE_URL: z.string().url().default('https://apis.data.go.kr/B551011/KorService2'),
  TOUR_API_SERVICE_KEY: z.string().optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  USE_MOCK_DB: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  UPLOAD_DIRECTORY: z.string().min(1).default('uploads'),
  UPLOAD_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
});

const parsedEnv = envSchema.parse(process.env);

const mlRecommendationApiUrl =
  parsedEnv.NODE_ENV === 'production' &&
  parsedEnv.ML_RECOMMENDATION_API_URL &&
  new URL(parsedEnv.ML_RECOMMENDATION_API_URL).protocol !== 'https:'
    ? undefined
    : parsedEnv.ML_RECOMMENDATION_API_URL;

export const env = {
  ...parsedEnv,
  // Production recommendation requests can include precise location and mood.
  // Drop a legacy plaintext endpoint so callers use their local fallback instead.
  ML_RECOMMENDATION_API_URL: mlRecommendationApiUrl,
  // Defaults to disabled under NODE_ENV=test so existing tests that call
  // auth endpoints repeatedly are not destabilized. Set
  // AUTH_RATE_LIMIT_ENABLED=true explicitly to exercise the limiter in tests.
  AUTH_RATE_LIMIT_ENABLED:
    parsedEnv.AUTH_RATE_LIMIT_ENABLED === undefined
      ? parsedEnv.NODE_ENV !== 'test'
      : parsedEnv.AUTH_RATE_LIMIT_ENABLED === 'true',
};
