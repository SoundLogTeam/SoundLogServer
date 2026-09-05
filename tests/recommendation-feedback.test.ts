import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { CURRENT_TERMS_VERSION } from '../src/constants/legal.constants.js';
import { createApp } from '../src/app.js';
import { mockDb } from '../src/mock/mock-db.js';

/**
 * RECOMMENDATION_FEEDBACK_SERVER_SPEC.md 8절 수용 시나리오.
 *
 * mock 모드에서 돈다 — Postgres 없이 계약만 검증한다.
 *   USE_MOCK_DB=true npx vitest run tests/recommendation-feedback.test.ts
 */
const app = createApp();

let accessToken: string;

async function getToken() {
  const email = `feedback-${Date.now()}-${Math.random().toString(36).slice(2)}@soundlog.test`;
  const password = 'soundlog-password';

  // 이 서버는 약관 동의 없이는 가입이 막힌다 (앱 심사 대응).
  await request(app).post('/v1/auth/register').send({
    displayName: '피드백 테스트',
    email,
    password,
    termsAccepted: true,
    termsVersion: CURRENT_TERMS_VERSION,
  });

  const login = await request(app).post('/v1/auth/login').send({ email, password });

  expect(login.status).toBe(200);

  return login.body.data.accessToken as string;
}

let counter = 0;

function feedbackEvent(overrides: {
  context?: Record<string, unknown>;
  id?: string;
  playlistId?: string | null;
  value?: unknown;
}) {
  counter += 1;

  const event: Record<string, unknown> = {
    context: overrides.context ?? { source: 'ml-recommendation' },
    createdAt: new Date().toISOString(),
    id: overrides.id ?? `event-test-${Date.now()}-${counter}`,
    sessionId: `session-test-${Date.now()}`,
    type: 'recommendation_feedback',
    value:
      typeof overrides.value === 'string'
        ? overrides.value
        : JSON.stringify(
            overrides.value ?? {
              rating: 5,
              subject: 'music',
              version: 1,
            },
          ),
  };

  if (overrides.playlistId !== null) {
    event.playlistId = overrides.playlistId ?? 'playlist-seoul-night';
  }

  return event;
}

function post(events: Array<Record<string, unknown>>) {
  return request(app)
    .post('/v1/recommendation-events')
    .set('Authorization', `Bearer ${accessToken}`)
    .set('Idempotency-Key', String(events[0]?.id ?? 'batch'))
    .send({ events });
}

function storedById(id: string) {
  return mockDb.recommendationFeedbacks.find((item) => item.id === id);
}

describe('추천 피드백', () => {
  beforeAll(async () => {
    accessToken = await getToken();
  });

  it('음악에 별점만 보낸 이벤트를 저장한다', async () => {
    const event = feedbackEvent({ value: { rating: 5, subject: 'music', version: 1 } });
    const response = await post([event]);

    expect(response.status).toBe(202);
    expect(response.body.data.accepted).toBe(true);

    const stored = storedById(event.id as string);

    expect(stored?.rating).toBe(5);
    expect(stored?.subject).toBe('music');
    expect(stored?.opinion).toBeNull();
    expect(stored?.playlistId).toBe('playlist-seoul-night');
  });

  it('음악에 별점과 의견을 함께 저장한다', async () => {
    const event = feedbackEvent({
      value: {
        opinion: '산책할 때 잘 어울렸어요',
        rating: 3,
        subject: 'music',
        version: 1,
      },
    });

    expect((await post([event])).status).toBe(202);
    expect(storedById(event.id as string)?.opinion).toBe('산책할 때 잘 어울렸어요');
  });

  it('추천사진 피드백을 장소와 연결해 저장한다', async () => {
    const event = feedbackEvent({
      context: {
        placeId: 'tour-126508',
        placeName: '서울숲',
        source: 'recommended-photo:tour-api',
      },
      playlistId: null,
      value: { rating: 4, subject: 'photo', version: 1 },
    });

    expect((await post([event])).status).toBe(202);

    const stored = storedById(event.id as string);

    expect(stored?.subject).toBe('photo');
    expect(stored?.placeId).toBe('tour-126508');
    expect(stored?.placeName).toBe('서울숲');
    // context.source가 zod 스키마에 없으면 여기서 null이 된다.
    expect(stored?.source).toBe('recommended-photo:tour-api');
  });

  it('공백만 있는 의견은 거부한다', async () => {
    const response = await post([
      feedbackEvent({
        value: { opinion: '   ', rating: 4, subject: 'music', version: 1 },
      }),
    ]);

    expect(response.status).toBe(400);
  });

  it('0점과 6점과 소수점 별점을 거부한다', async () => {
    for (const rating of [0, 6, 3.5]) {
      const response = await post([
        feedbackEvent({ value: { rating, subject: 'music', version: 1 } }),
      ]);

      expect(response.status).toBe(400);
    }
  });

  it('301자 의견을 거부한다', async () => {
    const response = await post([
      feedbackEvent({
        value: {
          opinion: '가'.repeat(301),
          rating: 4,
          subject: 'music',
          version: 1,
        },
      }),
    ]);

    expect(response.status).toBe(400);
  });

  it('지원하지 않는 version을 거부한다', async () => {
    const response = await post([
      feedbackEvent({ value: { rating: 4, subject: 'music', version: 2 } }),
    ]);

    expect(response.status).toBe(400);
    expect(
      response.body.error.details.issues.some(
        (issue: { params?: { feedbackCode?: string } }) =>
          issue.params?.feedbackCode === 'UNSUPPORTED_FEEDBACK_VERSION',
      ),
    ).toBe(true);
  });

  it('음악 피드백에 playlistId가 없으면 거부한다', async () => {
    const response = await post([
      feedbackEvent({
        playlistId: null,
        value: { rating: 4, subject: 'music', version: 1 },
      }),
    ]);

    expect(response.status).toBe(400);
  });

  it('JSON이 아닌 value를 거부한다', async () => {
    const response = await post([feedbackEvent({ value: 'not-json' })]);

    expect(response.status).toBe(400);
  });

  it('같은 이벤트를 두 번 보내도 하나만 저장한다', async () => {
    const event = feedbackEvent({ id: `event-dup-${Date.now()}` });

    expect((await post([event])).status).toBe(202);
    expect((await post([event])).status).toBe(202);

    const matches = mockDb.recommendationFeedbacks.filter(
      (item) => item.id === event.id,
    );

    expect(matches).toHaveLength(1);
  });

  it('저장 데이터에 사진 URI가 없다', async () => {
    const serialized = JSON.stringify(mockDb.recommendationFeedbacks);

    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toMatch(/file:\/\//);
  });

  it('한 이벤트가 잘못되면 배치 전체를 거부한다', async () => {
    const good = feedbackEvent({ id: `event-batch-good-${Date.now()}` });
    const bad = feedbackEvent({
      id: `event-batch-bad-${Date.now()}`,
      value: { rating: 9, subject: 'music', version: 1 },
    });

    const response = await post([good, bad]);

    expect(response.status).toBe(400);
    expect(storedById(good.id as string)).toBeUndefined();
  });
});
