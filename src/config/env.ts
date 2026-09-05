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
  SUPPORT_EMAIL: z.string().email().default('support@soundlog.shop'),
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

/**
 * 평문 ML 주소를 받아들일지 판단한다.
 *
 * 추천 요청에는 정확한 위경도와 무드가 실린다. 공개망을 평문으로 지나가면
 * 그대로 노출되므로 production에서는 https를 요구한다.
 *
 * 다만 ML이 같은 호스트에 있으면 이야기가 다르다. echo 배포에서 api 컨테이너는
 * host.docker.internal:8000으로 docker0 브리지를 통해 ML을 부른다. 이 트래픽은
 * 호스트 밖으로 나가지 않으므로 평문이어도 노출 경로가 없고, 여기에 https를
 * 요구하면 내부 호출에 인증서를 붙여야 하는 실익 없는 작업이 생긴다.
 *
 * 그래서 "공개망 평문만" 막는다. 이 판정이 틀리면 ML 주소가 undefined가 되어
 * 음악 추천과 리캡 배경이 조용히 폴백으로 내려간다 — 에러도 로그도 없이.
 */
function isPrivateHost(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname === 'host.docker.internal' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return true;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);

  if (!ipv4) {
    return hostname === '::1';
  }

  const [a, b] = ipv4.slice(1).map(Number);

  // 127/8 루프백, 10/8, 172.16/12, 192.168/16 사설 대역
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function resolveMlApiUrl(rawUrl: string | undefined, nodeEnv: string): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  const url = new URL(rawUrl);

  if (url.protocol === 'https:' || nodeEnv !== 'production') {
    return rawUrl;
  }

  if (isPrivateHost(url.hostname)) {
    return rawUrl;
  }

  console.warn(
    `[env] ML_RECOMMENDATION_API_URL(${url.hostname})이 공개망 평문이라 무시한다. https를 쓰거나 내부 주소로 바꿀 것.`,
  );

  return undefined;
}

const mlRecommendationApiUrl = resolveMlApiUrl(
  parsedEnv.ML_RECOMMENDATION_API_URL,
  parsedEnv.NODE_ENV,
);

export const env = {
  ...parsedEnv,
  ML_RECOMMENDATION_API_URL: mlRecommendationApiUrl,
  // Defaults to disabled under NODE_ENV=test so existing tests that call
  // auth endpoints repeatedly are not destabilized. Set
  // AUTH_RATE_LIMIT_ENABLED=true explicitly to exercise the limiter in tests.
  AUTH_RATE_LIMIT_ENABLED:
    parsedEnv.AUTH_RATE_LIMIT_ENABLED === undefined
      ? parsedEnv.NODE_ENV !== 'test'
      : parsedEnv.AUTH_RATE_LIMIT_ENABLED === 'true',
};
