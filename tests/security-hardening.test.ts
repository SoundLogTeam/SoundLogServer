import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * These tests each need a distinct process.env / module graph (different
 * NODE_ENV or rate-limit config), so every test resets the module cache and
 * re-imports src/app.js fresh instead of sharing the app instance used by
 * tests/api.test.ts.
 */

// Only snapshot/restore the specific keys these tests mutate. DATABASE_URL
// and JWT_SECRET (loaded once via `dotenv/config`) must be left untouched:
// once cleared, a re-import cannot reliably reload them (dotenv's own
// module-level state isn't reset by vi.resetModules()).
const MUTATED_KEYS = [
  'NODE_ENV',
  'AUTH_RATE_LIMIT_ENABLED',
  'AUTH_RATE_LIMIT_MAX',
  'AUTH_RATE_LIMIT_WINDOW_MS',
  'AUTH_RATE_LIMIT_IP_MAX',
  'AUTH_RATE_LIMIT_IP_WINDOW_MS',
  'ML_RECOMMENDATION_API_URL',
  'TRUST_PROXY_HOPS',
] as const;
const originalEnv = Object.fromEntries(
  MUTATED_KEYS.map((key) => [key, process.env[key]]),
);

function restoreEnv() {
  for (const key of MUTATED_KEYS) {
    const value = originalEnv[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function freshApp() {
  vi.resetModules();
  const { createApp } = await import('../src/app.js');
  return createApp();
}

describe('production hardening: dev DB test route', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('does not register the dev DB test route in production', async () => {
    process.env.NODE_ENV = 'production';

    const app = await freshApp();
    const response = await request(app).post('/v1/dev/db-test-records').send({});

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('requires auth for the dev DB test route outside production', async () => {
    process.env.NODE_ENV = 'test';

    const app = await freshApp();
    const response = await request(app)
      .post('/v1/dev/db-test-records')
      .send({ label: 'no-auth' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('production hardening: ML recommendation transport', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('disables a plaintext ML endpoint in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ML_RECOMMENDATION_API_URL = 'http://211.188.54.204:8000/recommend';

    vi.resetModules();
    const { env } = await import('../src/config/env.js');

    expect(env.ML_RECOMMENDATION_API_URL).toBeUndefined();
  });

  it('treats an empty ML endpoint as disabled in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ML_RECOMMENDATION_API_URL = '';

    vi.resetModules();
    const { env } = await import('../src/config/env.js');

    expect(env.ML_RECOMMENDATION_API_URL).toBeUndefined();
  });

  it('keeps an HTTPS ML endpoint in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ML_RECOMMENDATION_API_URL = 'https://ml.soundlog.shop/recommend';

    vi.resetModules();
    const { env } = await import('../src/config/env.js');

    expect(env.ML_RECOMMENDATION_API_URL).toBe('https://ml.soundlog.shop/recommend');
  });
});

describe('auth rate limiting', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 429 once the configured auth rate limit is exceeded', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_RATE_LIMIT_ENABLED = 'true';
    process.env.AUTH_RATE_LIMIT_MAX = '2';
    process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';

    const app = await freshApp();
    const credentials = { email: 'rate-limit-test@soundlog.test', password: 'wrong-password' };

    const first = await request(app).post('/v1/auth/login').send(credentials);
    const second = await request(app).post('/v1/auth/login').send(credentials);
    const third = await request(app).post('/v1/auth/login').send(credentials);

    expect(first.status).not.toBe(429);
    expect(second.status).not.toBe(429);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('returns 429 for credential stuffing across many emails from one IP', async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_RATE_LIMIT_ENABLED = 'true';
    // Account limit set high so it never trips here — each request below uses
    // a different email, so only the per-IP limiter can be what catches this.
    process.env.AUTH_RATE_LIMIT_MAX = '1000';
    process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.AUTH_RATE_LIMIT_IP_MAX = '2';
    process.env.AUTH_RATE_LIMIT_IP_WINDOW_MS = '60000';

    const app = await freshApp();

    const first = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'stuffing-1@soundlog.test', password: 'wrong-password' });
    const second = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'stuffing-2@soundlog.test', password: 'wrong-password' });
    const third = await request(app)
      .post('/v1/auth/login')
      .send({ email: 'stuffing-3@soundlog.test', password: 'wrong-password' });

    expect(first.status).not.toBe(429);
    expect(second.status).not.toBe(429);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('does not rate limit auth endpoints under the default test configuration', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.AUTH_RATE_LIMIT_ENABLED;

    const app = await freshApp();
    const credentials = { email: 'no-rate-limit-test@soundlog.test', password: 'wrong-password' };

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const response = await request(app).post('/v1/auth/login').send(credentials);
      expect(response.status).not.toBe(429);
    }
  });
});

describe('proxy trust configuration', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('does not trust forwarded IP headers by default', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.TRUST_PROXY_HOPS;

    const app = await freshApp();

    expect(app.get('trust proxy')).toBe(false);
  });

  it('uses the explicitly configured reverse-proxy hop count', async () => {
    process.env.NODE_ENV = 'test';
    process.env.TRUST_PROXY_HOPS = '2';

    const app = await freshApp();

    expect(app.get('trust proxy')).toBe(2);
  });
});
