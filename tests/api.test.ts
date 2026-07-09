import bcrypt from 'bcrypt';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { mockDb, resetMockDb } from '../src/mock/mock-db.js';
import { disconnectSeedDatabase, seedDatabase } from '../prisma/seed.js';

const app = createApp();
const useMockDb = process.env.USE_MOCK_DB === 'true';

async function getToken() {
  const email = `local-${Date.now()}@soundlog.test`;
  const password = 'soundlog-password';

  const register = await request(app).post('/v1/auth/register').send({
    displayName: 'Local Soundlog User',
    email,
    password,
  });

  expect(register.status).toBe(201);

  const response = await request(app).post('/v1/auth/login').send({
    email,
    password,
  });

  expect(response.status).toBe(200);
  expect(response.body.data.user.id).toEqual(expect.any(String));
  return response.body.data.accessToken as string;
}

async function getStoredPasswordHash(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  if (useMockDb) {
    return mockDb.passwordUsers.find((user) => user.email === normalizedEmail)?.passwordHash;
  }

  const user = await prisma.user.findUnique({
    where: {
      provider_providerUserId: {
        provider: 'email',
        providerUserId: normalizedEmail,
      },
    },
    select: {
      passwordHash: true,
    },
  });

  return user?.passwordHash;
}

function findSecretLeaks(value: unknown, secret: string, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSecretLeaks(item, secret, `${path}[${index}]`));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => {
      const nextPath = `${path}.${key}`;
      const keyLeaks = key.toLowerCase().includes('password') ? [nextPath] : [];

      return [...keyLeaks, ...findSecretLeaks(item, secret, nextPath)];
    });
  }

  return value === secret ? [path] : [];
}

async function createTestMomentLog(input: {
  authHeader: string;
  filename: string;
  note?: string;
  placeName: string;
  sessionId?: string;
  trackId?: string;
}) {
  const response = await request(app)
    .post('/v1/moment-logs')
    .set('Authorization', input.authHeader)
    .field('createdAt', new Date().toISOString())
    .field('moodTags', 'fresh,calm')
    .field('note', input.note ?? '')
    .field('placeName', input.placeName)
    .field('sessionId', input.sessionId ?? '')
    .field('trackId', input.trackId ?? 'seoul-city')
    .attach('photo', Buffer.from('fake-image'), {
      filename: input.filename,
      contentType: 'image/jpeg',
    });

  expect(response.status).toBe(201);
  return response.body.data;
}

describe('Soundlog API', () => {
  let accessToken: string;
  let authHeader: string;
  let createdSessionId: string;
  let createdRecapId: string;

  beforeAll(async () => {
    if (useMockDb) {
      resetMockDb();
    } else {
      await seedDatabase();
    }

    accessToken = await getToken();
    authHeader = `Bearer ${accessToken}`;
  });

  it('returns health without auth', async () => {
    const response = await request(app).get('/v1/health');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
  });

  it('serves Swagger UI and OpenAPI YAML', async () => {
    const spec = await request(app).get('/openapi.yaml');
    const docs = await request(app).get('/docs/');
    const v1Docs = await request(app).get('/v1/docs');

    expect(spec.status).toBe(200);
    expect(spec.headers['content-type']).toContain('application/yaml');
    expect(spec.text).toContain('openapi: 3.1.0');
    expect(docs.status).toBe(200);
    expect(docs.text).toContain('Soundlog API Docs');
    expect(v1Docs.status).toBe(302);
    expect(v1Docs.headers.location).toBe('/docs');
  });

  it('creates a DB test record without auth', async () => {
    const response = await request(app)
      .post('/v1/dev/db-test-records')
      .send({
        label: 'swagger-smoke-test',
        payload: {
          source: 'api-test',
        },
      });

    expect(response.status).toBe(201);
    expect(response.body.data.id).toEqual(expect.any(String));
    expect(response.body.data.label).toBe('swagger-smoke-test');
    expect(response.body.data.table).toBe('DbTestRecord');
    expect(response.body.data.database).toBe(useMockDb ? 'mock-db' : 'postgres');
  });

  it('allows Expo web dev origins through CORS in non-production', async () => {
    const response = await request(app)
      .options('/v1/home/featured-playlists')
      .set('Origin', 'http://localhost:8082')
      .set('Access-Control-Request-Method', 'GET');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:8082');
  });

  it('rejects protected endpoints without bearer token', async () => {
    const response = await request(app).get('/v1/me/profile');
    const home = await request(app)
      .get('/v1/home/featured-playlists')
      .query({
        locationRecommendationEnabled: true,
        recommendationMode: 'travel',
        lat: 35.1532,
        lng: 129.1186,
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(home.status).toBe(401);
    expect(home.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns JSON not found for unknown routes', async () => {
    const response = await request(app).get('/v1/no-such-route');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('refreshes auth tokens', async () => {
    const password = 'refresh-password';
    const register = await request(app).post('/v1/auth/register').send({
      displayName: 'Refresh User',
      email: `refresh-${Date.now()}@soundlog.test`,
      password,
    });
    const response = await request(app).post('/v1/auth/refresh').send({
      refreshToken: register.body.data.refreshToken,
    });

    expect(register.status).toBe(201);
    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.user.id).toEqual(expect.any(String));
  });

  it('stores first-party passwords only as one-way bcrypt hashes', async () => {
    const email = `secure-${Date.now()}@soundlog.test`;
    const password = 'soundlog-password-SECURE-123!';

    const register = await request(app).post('/v1/auth/register').send({
      displayName: 'Password Security User',
      email,
      password,
    });

    expect(register.status).toBe(201);
    expect(findSecretLeaks(register.body, password)).toEqual([]);

    const passwordHash = await getStoredPasswordHash(email);

    expect(passwordHash).toEqual(expect.any(String));
    expect(passwordHash).not.toBe(password);
    expect(passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(Number(passwordHash?.split('$')[2])).toBeGreaterThanOrEqual(12);
    await expect(bcrypt.compare(password, passwordHash as string)).resolves.toBe(true);
    await expect(bcrypt.compare(`${password}-wrong`, passwordHash as string)).resolves.toBe(false);

    const login = await request(app).post('/v1/auth/login').send({
      email,
      password,
    });

    expect(login.status).toBe(200);
    expect(findSecretLeaks(login.body, password)).toEqual([]);

    const wrongPassword = await request(app).post('/v1/auth/login').send({
      email,
      password: `${password}-wrong`,
    });

    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns account summary, migrates local data, and logs out', async () => {
    const me = await request(app).get('/v1/me').set('Authorization', authHeader);
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toEqual(expect.any(String));
    expect(me.body.data.profile).toBeDefined();

    const migration = await request(app)
      .post('/v1/me/migrate-local-data')
      .set('Authorization', authHeader)
      .send({
        idempotencyKey: `test-migration-${Date.now()}`,
        libraryTrackCount: 2,
        momentLogCount: 3,
        recapDraftCount: 1,
      });
    expect(migration.status).toBe(200);
    expect(migration.body.data.accepted).toBe(true);
    expect(migration.body.data.migrated.momentLogCount).toBe(3);

    const login = await request(app).post('/v1/auth/register').send({
      email: `logout-${Date.now()}@soundlog.test`,
      password: 'logout-password',
    });
    const logout = await request(app).post('/v1/auth/logout').send({
      refreshToken: login.body.data.refreshToken,
    });
    expect(logout.status).toBe(202);
    expect(logout.body.data.accepted).toBe(true);
  });

  it('handles profile APIs', async () => {
    const profile = await request(app)
      .get('/v1/me/profile')
      .set('Authorization', authHeader);
    expect(profile.status).toBe(200);

    const updatedProfile = await request(app)
      .put('/v1/me/profile')
      .set('Authorization', authHeader)
      .send({
        companionType: 'friends',
        locationRecommendationEnabled: true,
        preferredGenres: ['K-POP'],
        preferredMoods: ['청량한'],
        travelStyles: ['산책'],
      });
    expect(updatedProfile.status).toBe(200);
    expect(updatedProfile.body.data.completedOnboarding).toBe(true);
  });

  it('returns tour and home data', async () => {
    const tour = await request(app)
      .get('/v1/tour/nearby-places')
      .set('Authorization', authHeader)
      .query({
        lat: 35.1532,
        lng: 129.1186,
        limit: 2,
      });
    expect(tour.status).toBe(200);
    expect(tour.body.data[0].id).toContain('seed-');
    expect(tour.body.data[0].source).toBe('seed');

    const featured = await request(app)
      .get('/v1/home/featured-playlists')
      .set('Authorization', authHeader)
      .query({ locationRecommendationEnabled: true, lat: 35.1532, lng: 129.1186 });
    expect(featured.status).toBe(200);
    expect(featured.body.data.length).toBeGreaterThan(0);

    const unauthenticatedFeatured = await request(app)
      .get('/v1/home/featured-playlists')
      .query({ locationRecommendationEnabled: true, recommendationMode: 'travel', lat: 35.1532, lng: 129.1186 });
    expect(unauthenticatedFeatured.status).toBe(401);
    expect(unauthenticatedFeatured.body.error.code).toBe('UNAUTHORIZED');

    const mood = await request(app)
      .get('/v1/home/mood-recommendations')
      .set('Authorization', authHeader)
      .query({ topFilter: '청량한', moodFilter: '전체', preferredGenres: 'K-POP' });
    expect(mood.status).toBe(200);
    expect(mood.body.data[0].track).toBeDefined();

    await createTestMomentLog({
      authHeader,
      filename: 'recent-music-log.jpg',
      placeName: '최근 로그 테스트 장소',
      sessionId: `recent-session-${Date.now()}`,
      trackId: 'seoul-city',
    });

    const recent = await request(app)
      .get('/v1/home/recent-music-logs')
      .set('Authorization', authHeader);
    expect(recent.status).toBe(200);
    expect(recent.body.data.length).toBeGreaterThan(0);
  });

  it('handles playlist APIs', async () => {
    const contextual = await request(app)
      .post('/v1/playlists/contextual')
      .set('Authorization', authHeader)
      .send({
        location: { lat: 35.1532, lng: 129.1186 },
        mood: '시원한',
        moodTags: ['fresh'],
        state: '바다',
        travelMode: 'ocean',
      });
    expect(contextual.status).toBe(201);
    expect(contextual.body.data.tracks.length).toBeGreaterThan(0);
    expect(['ml-recommendation', 'seed-fallback']).toContain(
      contextual.body.data.context.source,
    );

    const noLocationContextual = await request(app)
      .post('/v1/playlists/contextual')
      .set('Authorization', authHeader)
      .send({
        mood: '잔잔한',
        state: '산책',
        travelMode: 'walk',
      });
    expect(noLocationContextual.status).toBe(201);
    expect(noLocationContextual.body.data.context).toMatchObject({
      source: 'seed-fallback',
      state: '산책',
      travelMode: 'walk',
    });

    const recommended = await request(app)
      .get('/v1/recommendations/playlists')
      .set('Authorization', authHeader)
      .query({
        mood: '시원한',
        state: '바다',
        x: 129.1186,
        y: 35.1532,
      });
    expect(recommended.status).toBe(200);
    expect(recommended.body.data.tracks.length).toBeGreaterThan(0);
    expect(['ml-recommendation', 'seed-fallback']).toContain(
      recommended.body.data.context.source,
    );

    const invalidRecommendation = await request(app)
      .get('/v1/recommendations/playlists')
      .set('Authorization', authHeader)
      .query({
        mood: '편안한',
        state: '바다',
        x: 129.1186,
        y: 35.1532,
      });
    expect(invalidRecommendation.status).toBe(400);

    const detail = await request(app)
      .get('/v1/playlists/busan-ocean')
      .set('Authorization', authHeader);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe('busan-ocean');

    const unauthenticatedDetail = await request(app).get('/v1/playlists/busan-ocean');
    expect(unauthenticatedDetail.status).toBe(401);
    expect(unauthenticatedDetail.body.error.code).toBe('UNAUTHORIZED');
  });

  it('handles library APIs', async () => {
    const updated = await request(app)
      .put('/v1/library/tracks/moon-seoul')
      .set('Authorization', authHeader)
      .send({ action: 'like', playlistId: 'busan-ocean' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.isLiked).toBe(true);

    const list = await request(app)
      .get('/v1/library/tracks')
      .set('Authorization', authHeader)
      .query({ kind: 'liked' });
    expect(list.status).toBe(200);
    expect(list.body.page.limit).toBeGreaterThan(0);
    const moonRecord = list.body.data.find(
      (item: { track: { id: string } }) => item.track.id === 'moon-seoul',
    );

    expect(moonRecord).toBeTruthy();
    expect(moonRecord.playlist).toMatchObject({
      id: 'busan-ocean',
      placeName: '광안리 해변',
      regionName: '부산',
      trackCount: 5,
    });
  });

  it('handles moment log APIs', async () => {
    const idempotencyKey = `moment-${Date.now()}`;
    const created = await request(app)
      .post('/v1/moment-logs')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .field('createdAt', new Date().toISOString())
      .field('moodTags', 'fresh,calm')
      .field('note', '카페 거리에서 남긴 테스트 메모')
      .field('placeName', '테스트 장소')
      .field('trackId', 'seoul-city')
      .attach('photo', Buffer.from('fake-image'), {
        filename: 'moment.jpg',
        contentType: 'image/jpeg',
      });

    expect(created.status).toBe(201);
    expect(created.body.data.photoUrl).toContain('/uploads/');
    expect(created.body.data.note).toBe('카페 거리에서 남긴 테스트 메모');

    const duplicate = await request(app)
      .post('/v1/moment-logs')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .field('createdAt', new Date().toISOString())
      .field('moodTags', 'fresh')
      .field('note', '중복 요청 메모는 반영되지 않아야 함')
      .field('placeName', '중복 요청 장소')
      .field('trackId', 'seoul-city')
      .attach('photo', Buffer.from('fake-image'), {
        filename: 'moment-duplicate.jpg',
        contentType: 'image/jpeg',
      });
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.data.id).toBe(created.body.data.id);
    expect(duplicate.body.data.note).toBe('카페 거리에서 남긴 테스트 메모');

    const textOnlyMoment = await request(app)
      .post('/v1/moment-logs')
      .set('Authorization', authHeader)
      .field('createdAt', new Date().toISOString())
      .field('moodTags', 'calm')
      .field('note', '사진 없이 남긴 테스트 메모')
      .field('placeName', '텍스트 기록 장소')
      .field('trackTitle', '사진 없는 순간');
    expect(textOnlyMoment.status).toBe(201);
    expect(textOnlyMoment.body.data.photoUrl).toBeUndefined();
    expect(textOnlyMoment.body.data.note).toBe('사진 없이 남긴 테스트 메모');

    const minimalMoment = await request(app)
      .post('/v1/moment-logs')
      .set('Authorization', authHeader)
      .field('createdAt', new Date().toISOString())
      .field('moodTags', '');
    expect(minimalMoment.status).toBe(201);
    expect(minimalMoment.body.data.photoUrl).toBeUndefined();
    expect(minimalMoment.body.data.location).toBeUndefined();
    expect(minimalMoment.body.data.placeName).toBeUndefined();
    expect(minimalMoment.body.data.track).toBeUndefined();
    expect(minimalMoment.body.data.moodTags).toEqual([]);
    expect(minimalMoment.body.data.syncStatus).toBe('synced');

    const updated = await request(app)
      .patch(`/v1/moment-logs/${created.body.data.id}`)
      .set('Authorization', authHeader)
      .send({
        moodTags: ['calm'],
        note: '수정된 테스트 메모',
        placeName: '수정된 테스트 장소',
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.id).toBe(created.body.data.id);
    expect(updated.body.data.moodTags).toEqual(['calm']);
    expect(updated.body.data.note).toBe('수정된 테스트 메모');
    expect(updated.body.data.placeName).toBe('수정된 테스트 장소');

    const trackUpdated = await request(app)
      .patch(`/v1/moment-logs/${created.body.data.id}`)
      .set('Authorization', authHeader)
      .send({
        artistName: '수정된 아티스트',
        trackTitle: '수정된 연결 곡',
      });
    expect(trackUpdated.status).toBe(200);
    expect(trackUpdated.body.data.track.title).toBe('수정된 연결 곡');
    expect(trackUpdated.body.data.track.artist).toBe('수정된 아티스트');

    const photoUpdated = await request(app)
      .put(`/v1/moment-logs/${created.body.data.id}/photo`)
      .set('Authorization', authHeader)
      .attach('photo', Buffer.from('replacement-image'), {
        filename: 'moment-replacement.jpg',
        contentType: 'image/jpeg',
      });
    expect(photoUpdated.status).toBe(200);
    expect(photoUpdated.body.data.photoUrl).toContain('/uploads/');
    expect(photoUpdated.body.data.photoUrl).not.toBe(created.body.data.photoUrl);

    const missingPhoto = await request(app)
      .put(`/v1/moment-logs/${created.body.data.id}/photo`)
      .set('Authorization', authHeader);
    expect(missingPhoto.status).toBe(400);
    expect(missingPhoto.body.error.code).toBe('BAD_REQUEST');

    const photoDeleted = await request(app)
      .delete(`/v1/moment-logs/${created.body.data.id}/photo`)
      .set('Authorization', authHeader);
    expect(photoDeleted.status).toBe(200);
    expect(photoDeleted.body.data.photoUrl).toBeUndefined();

    const clearedNote = await request(app)
      .patch(`/v1/moment-logs/${created.body.data.id}`)
      .set('Authorization', authHeader)
      .send({ note: null });
    expect(clearedNote.status).toBe(200);
    expect(clearedNote.body.data.note).toBeUndefined();

    const missingUpdate = await request(app)
      .patch('/v1/moment-logs/missing-moment-log')
      .set('Authorization', authHeader)
      .send({ note: '없는 로그 수정' });
    expect(missingUpdate.status).toBe(404);

    const deleted = await request(app)
      .delete(`/v1/moment-logs/${textOnlyMoment.body.data.id}`)
      .set('Authorization', authHeader);
    expect(deleted.status).toBe(202);
    expect(deleted.body.data.accepted).toBe(true);

    const missingDelete = await request(app)
      .delete(`/v1/moment-logs/${textOnlyMoment.body.data.id}`)
      .set('Authorization', authHeader);
    expect(missingDelete.status).toBe(404);

    const list = await request(app)
      .get('/v1/moment-logs')
      .set('Authorization', authHeader);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data.some((item: { id: string }) => item.id === textOnlyMoment.body.data.id)).toBe(false);
    expect(list.body.data.some((item: { placeName?: string }) => item.placeName === '수정된 테스트 장소')).toBe(true);
  });

  it('accepts recommendation events', async () => {
    const response = await request(app)
      .post('/v1/recommendation-events')
      .set('Authorization', authHeader)
      .send({
        events: [
          {
            id: `event-${Date.now()}`,
            sessionId: 'seed-session',
            type: 'live_track_shared',
            trackId: 'seoul-city',
            playlistId: 'seoul-night',
            context: { moodFilter: '전체', placeName: '서울 야경 산책' },
            createdAt: new Date().toISOString(),
            value: 'companions',
          },
          {
            id: `event-nearby-${Date.now()}`,
            sessionId: 'seed-session',
            type: 'nearby_sound_opened',
            trackId: 'seoul-city',
            playlistId: 'seoul-night',
            context: { moodFilter: '잔잔한', placeName: '서울 야경 산책' },
            createdAt: new Date().toISOString(),
            value: 'nearby',
          },
          {
            id: `event-external-failed-${Date.now()}`,
            sessionId: 'seed-session',
            type: 'external_music_open_failed',
            trackId: 'seoul-city',
            playlistId: 'seoul-night',
            context: { moodFilter: '잔잔한', placeName: '서울 야경 산책' },
            createdAt: new Date().toISOString(),
            value: 'external_link',
          },
          {
            id: `event-track-selected-${Date.now()}`,
            sessionId: 'seed-session',
            type: 'track_selected',
            trackId: 'seoul-city',
            playlistId: 'seoul-night',
            context: { moodFilter: '잔잔한', placeName: '서울 야경 산책' },
            createdAt: new Date().toISOString(),
            value: 'playlist_detail',
          },
          {
            id: `event-moment-saved-${Date.now()}`,
            sessionId: 'seed-session',
            type: 'moment_log_saved',
            trackId: 'seoul-city',
            playlistId: 'seoul-night',
            context: { moodFilter: '잔잔한', placeName: '서울 야경 산책' },
            createdAt: new Date().toISOString(),
            value: 'pending',
          },
          {
            id: `event-moment-sync-failed-${Date.now()}`,
            sessionId: 'seed-session',
            type: 'moment_log_sync_failed',
            trackId: 'seoul-city',
            playlistId: 'seoul-night',
            context: { moodFilter: '잔잔한', placeName: '서울 야경 산책' },
            createdAt: new Date().toISOString(),
            value: 'network_error',
          },
        ],
      });

    expect(response.status).toBe(202);
    expect(response.body.data.accepted).toBe(true);
  });

  it('handles recap APIs', async () => {
    const recapSessionId = `recap-session-${Date.now()}`;

    await createTestMomentLog({
      authHeader,
      filename: 'recap-moment-1.jpg',
      placeName: '리캡 테스트 장소',
      sessionId: recapSessionId,
      trackId: 'seoul-night-track',
    });
    await createTestMomentLog({
      authHeader,
      filename: 'recap-moment-2.jpg',
      placeName: '리캡 테스트 장소',
      sessionId: recapSessionId,
      trackId: 'seoul-night-track',
    });

    const idempotencyKey = `recap-${Date.now()}`;
    const created = await request(app)
      .post('/v1/recaps')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({ templateId: 'album', sessionId: recapSessionId, title: '테스트 리캡' });
    expect(created.status).toBe(201);
    createdRecapId = created.body.data.id;
    expect(created.body.data.representativeTrack.id).toBe('seoul-night-track');

    const list = await request(app).get('/v1/recaps').set('Authorization', authHeader);
    expect(list.status).toBe(200);
    expect(list.body.data.some((recap: { id: string }) => recap.id === createdRecapId)).toBe(true);

    const duplicate = await request(app)
      .post('/v1/recaps')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({ templateId: 'album', sessionId: recapSessionId, title: '중복 리캡' });
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.data.id).toBe(createdRecapId);

    const share = await request(app)
      .get(`/v1/recaps/${createdRecapId}/share`)
      .set('Authorization', authHeader);
    expect(share.status).toBe(200);
    expect(share.body.data.id).toBe(createdRecapId);
    expect(share.body.data.trackTitle).toBe(created.body.data.representativeTrack.title);
    expect(share.body.data.moments.length).toBeGreaterThan(1);

    const shareEvent = await request(app)
      .post(`/v1/recaps/${createdRecapId}/share-events`)
      .set('Authorization', authHeader)
      .send({ type: 'os_share', createdAt: new Date().toISOString() });
    expect(shareEvent.status).toBe(202);
  });

  it('handles travel session APIs', async () => {
    const created = await request(app)
      .post('/v1/travel-sessions')
      .set('Authorization', authHeader)
      .send({
        location: { lat: 37.5512, lng: 126.9882 },
        travelMode: 'walk',
      });
    expect(created.status).toBe(201);
    createdSessionId = created.body.data.id;

    const updated = await request(app)
      .patch(`/v1/travel-sessions/${createdSessionId}`)
      .set('Authorization', authHeader)
      .send({ status: 'ended', endedAt: new Date().toISOString() });
    expect(updated.status).toBe(200);
    expect(updated.body.data.status).toBe('ended');
  });

  it('handles travel rooms, sound map, and mate requests', async () => {
    const targetEmail = `target-${Date.now()}@soundlog.test`;
    const targetPassword = 'soundlog-password';
    const targetRegister = await request(app).post('/v1/auth/register').send({
      displayName: 'Nearby Sound Traveler',
      email: targetEmail,
      password: targetPassword,
    });
    expect(targetRegister.status).toBe(201);
    const targetUserId = targetRegister.body.data.user.id;
    const targetLogin = await request(app).post('/v1/auth/login').send({
      email: targetEmail,
      password: targetPassword,
    });
    expect(targetLogin.status).toBe(200);
    const targetAuthHeader = `Bearer ${targetLogin.body.data.accessToken}`;

    const outsiderEmail = `outsider-${Date.now()}@soundlog.test`;
    const outsiderPassword = 'soundlog-password';
    const outsiderRegister = await request(app).post('/v1/auth/register').send({
      displayName: 'Unrelated Traveler',
      email: outsiderEmail,
      password: outsiderPassword,
    });
    expect(outsiderRegister.status).toBe(201);
    const outsiderLogin = await request(app).post('/v1/auth/login').send({
      email: outsiderEmail,
      password: outsiderPassword,
    });
    expect(outsiderLogin.status).toBe(200);
    const outsiderAuthHeader = `Bearer ${outsiderLogin.body.data.accessToken}`;

    const ownerSession = await request(app)
      .post('/v1/travel-sessions')
      .set('Authorization', authHeader)
      .send({
        location: { lat: 37.751, lng: 128.875 },
        travelMode: 'walk',
      });
    expect(ownerSession.status).toBe(201);

    const targetSession = await request(app)
      .post('/v1/travel-sessions')
      .set('Authorization', targetAuthHeader)
      .send({
        location: { lat: 37.752, lng: 128.876 },
        travelMode: 'walk',
      });
    expect(targetSession.status).toBe(201);

    const room = await request(app)
      .post('/v1/travel-rooms')
      .set('Authorization', authHeader)
      .send({
        sessionId: ownerSession.body.data.id,
        title: '강릉 사운드 여행방',
      });
    expect(room.status).toBe(201);
    expect(room.body.data.inviteCode).toEqual(expect.any(String));

    const ownerRooms = await request(app)
      .get('/v1/travel-rooms')
      .set('Authorization', authHeader)
      .query({ sessionId: ownerSession.body.data.id });
    expect(ownerRooms.status).toBe(200);
    expect(ownerRooms.body.data.map((item: { id: string }) => item.id)).toContain(
      room.body.data.id,
    );

    const missingInvite = await request(app)
      .post(`/v1/travel-rooms/${room.body.data.id}/join`)
      .set('Authorization', targetAuthHeader)
      .send({
        displayName: '수경',
      });
    expect(missingInvite.status).toBe(400);

    const joined = await request(app)
      .post(`/v1/travel-rooms/${room.body.data.id}/join`)
      .set('Authorization', targetAuthHeader)
      .send({
        displayName: '수경',
        inviteCode: room.body.data.inviteCode,
    });
    expect(joined.status).toBe(200);
    expect(joined.body.data.memberCount).toBe(2);

    const targetRooms = await request(app)
      .get('/v1/travel-rooms')
      .set('Authorization', targetAuthHeader)
      .query({ sessionId: ownerSession.body.data.id });
    expect(targetRooms.status).toBe(200);
    expect(targetRooms.body.data.map((item: { id: string }) => item.id)).toContain(
      room.body.data.id,
    );

    const joinedByInviteCode = await request(app)
      .post('/v1/travel-rooms/join')
      .set('Authorization', targetAuthHeader)
      .send({
        displayName: '수경',
        inviteCode: room.body.data.inviteCode.toLowerCase(),
      });
    expect(joinedByInviteCode.status).toBe(200);
    expect(joinedByInviteCode.body.data.id).toBe(room.body.data.id);

    const invalidMomentLog = await request(app)
      .post(`/v1/travel-rooms/${room.body.data.id}/moments`)
      .set('Authorization', targetAuthHeader)
      .send({
        momentLogId: 'missing-moment-log',
        note: '잘못된 Moment 참조',
      });
    expect(invalidMomentLog.status).toBe(404);

    const sharedMoment = await request(app)
      .post(`/v1/travel-rooms/${room.body.data.id}/moments`)
      .set('Authorization', targetAuthHeader)
      .send({
        note: '주문진 바다 컷',
        placeName: '주문진 해변',
        status: 'accepted',
        trackId: 'seoul-night-track',
      });
    expect(sharedMoment.status).toBe(201);
    expect(sharedMoment.body.data.track.id).toBe('seoul-night-track');

    const updatedMoment = await request(app)
      .patch(`/v1/travel-rooms/${room.body.data.id}/moments/${sharedMoment.body.data.id}`)
      .set('Authorization', authHeader)
      .send({ status: 'accepted' });
    expect(updatedMoment.status).toBe(200);
    expect(updatedMoment.body.data.status).toBe('accepted');

    const commentedMoment = await request(app)
      .post(`/v1/travel-rooms/${room.body.data.id}/moments/${sharedMoment.body.data.id}/comments`)
      .set('Authorization', authHeader)
      .send({ body: '이 컷은 첫 번째 페이지에 넣자' });
    expect(commentedMoment.status).toBe(201);
    expect(commentedMoment.body.data.body).toContain('첫 번째');

    const roomRecap = await request(app)
      .post(`/v1/travel-rooms/${room.body.data.id}/recaps`)
      .set('Authorization', authHeader)
      .send({
        templateId: 'album',
        title: '강릉 공동 Recap',
      });
    expect(roomRecap.status).toBe(201);
    expect(roomRecap.body.data.roomId).toBe(room.body.data.id);

    const targetPin = await request(app)
      .post('/v1/sound-map/current-track')
      .set('Authorization', targetAuthHeader)
      .send({
        location: { lat: 37.752, lng: 128.876 },
        moodTags: ['calm'],
        placeName: '강릉 카페거리',
        sessionId: targetSession.body.data.id,
        trackId: 'seoul-night-track',
        travelMode: 'walk',
        visibility: 'nearby',
      });
    expect(targetPin.status).toBe(202);
    expect(targetPin.body.data.visibility).toBe('nearby');

    const myPin = await request(app)
      .post('/v1/sound-map/current-track')
      .set('Authorization', authHeader)
      .send({
        location: { lat: 37.751, lng: 128.875 },
        moodTags: ['fresh'],
        placeName: '강릉역',
        sessionId: ownerSession.body.data.id,
        trackId: 'seoul-city',
        travelMode: 'walk',
        visibility: 'companions',
    });
    expect(myPin.status).toBe(202);

    const map = await request(app)
      .get('/v1/sound-map')
      .set('Authorization', authHeader)
      .query({ lat: 37.751, lng: 128.875, radiusMeters: 3000 });
    expect(map.status).toBe(200);
    expect(map.body.data.length).toBeGreaterThanOrEqual(2);

    const targetCompanionMap = await request(app)
      .get('/v1/sound-map')
      .set('Authorization', targetAuthHeader)
      .query({ lat: 37.752, lng: 128.876, radiusMeters: 3000 });
    expect(targetCompanionMap.status).toBe(200);
    expect(targetCompanionMap.body.data.map((pin: { id: string }) => pin.id)).toContain(
      myPin.body.data.id,
    );

    const outsiderMap = await request(app)
      .get('/v1/sound-map')
      .set('Authorization', outsiderAuthHeader)
      .query({ lat: 37.752, lng: 128.876, radiusMeters: 3000 });
    expect(outsiderMap.status).toBe(200);
    expect(outsiderMap.body.data.map((pin: { id: string }) => pin.id)).not.toContain(
      myPin.body.data.id,
    );
    expect(outsiderMap.body.data.map((pin: { id: string }) => pin.id)).toContain(
      targetPin.body.data.id,
    );

    const endedOwnerSession = await request(app)
      .patch(`/v1/travel-sessions/${ownerSession.body.data.id}`)
      .set('Authorization', authHeader)
      .send({ status: 'ended', endedAt: new Date().toISOString() });
    expect(endedOwnerSession.status).toBe(200);

    const mapAfterEndingOwnerSession = await request(app)
      .get('/v1/sound-map')
      .set('Authorization', targetAuthHeader)
      .query({ lat: 37.752, lng: 128.876, radiusMeters: 3000 });
    expect(mapAfterEndingOwnerSession.status).toBe(200);
    expect(
      mapAfterEndingOwnerSession.body.data.map((pin: { id: string }) => pin.id),
    ).not.toContain(myPin.body.data.id);

    const smallRadiusMap = await request(app)
      .get('/v1/sound-map')
      .set('Authorization', authHeader)
      .query({ lat: 37.751, lng: 128.875, radiusMeters: 100 });
    expect(smallRadiusMap.status).toBe(200);
    expect(smallRadiusMap.body.data.map((pin: { id: string }) => pin.id)).not.toContain(
      targetPin.body.data.id,
    );

    const emptyNearbyByRadius = await request(app)
      .get('/v1/sound-map/nearby')
      .set('Authorization', authHeader)
      .query({ lat: 37.751, lng: 128.875, radiusMeters: 100 });
    expect(emptyNearbyByRadius.status).toBe(200);
    expect(emptyNearbyByRadius.body.data).toEqual([]);

    const emptyNearbyWithoutLocation = await request(app)
      .get('/v1/sound-map/nearby')
      .set('Authorization', authHeader)
      .query({ mood: '잔잔한', state: '산책' });
    expect(emptyNearbyWithoutLocation.status).toBe(200);
    expect(emptyNearbyWithoutLocation.body.data).toEqual([]);

    const nearby = await request(app)
      .get('/v1/sound-map/nearby')
      .set('Authorization', authHeader)
      .query({ lat: 37.751, lng: 128.875, mood: '잔잔한', state: '산책' });
    expect(nearby.status).toBe(200);
    expect(nearby.body.data[0].targetPinId).toBe(targetPin.body.data.id);
    expect(nearby.body.data[0].alias).toBe('근처 여행자');

    const matches = await request(app)
      .get('/v1/music-matches')
      .set('Authorization', authHeader)
      .query({ lat: 37.751, lng: 128.875, mood: '잔잔한', state: '산책' });
    expect(matches.status).toBe(200);
    expect(matches.body.data[0].targetPinId).toBe(targetPin.body.data.id);
    expect(matches.body.data[0].safety.exactLocationHidden).toBe(true);

    const mateRequest = await request(app)
      .post('/v1/travel-mate-requests')
      .set('Authorization', authHeader)
      .send({
        messageTemplate: 'liked_track',
        targetPinId: targetPin.body.data.id,
    });
    expect(mateRequest.status).toBe(201);
    expect(mateRequest.body.data.status).toBe('pending');

    const targetInbox = await request(app)
      .get('/v1/travel-mate-requests')
      .set('Authorization', targetAuthHeader)
      .query({ box: 'inbox', status: 'pending' });
    expect(targetInbox.status).toBe(200);
    expect(targetInbox.body.data.map((item: { id: string }) => item.id)).toContain(
      mateRequest.body.data.id,
    );

    const requesterSent = await request(app)
      .get('/v1/travel-mate-requests')
      .set('Authorization', authHeader)
      .query({ box: 'sent', status: 'pending' });
    expect(requesterSent.status).toBe(200);
    expect(requesterSent.body.data.map((item: { id: string }) => item.id)).toContain(
      mateRequest.body.data.id,
    );

    const requesterAccept = await request(app)
      .patch(`/v1/travel-mate-requests/${mateRequest.body.data.id}`)
      .set('Authorization', authHeader)
      .send({ action: 'accept' });
    expect(requesterAccept.status).toBe(403);

    const duplicateMateRequest = await request(app)
      .post('/v1/travel-mate-requests')
      .set('Authorization', authHeader)
      .send({
        messageTemplate: 'liked_track',
        targetPinId: targetPin.body.data.id,
      });
    expect(duplicateMateRequest.status).toBe(201);
    expect(duplicateMateRequest.body.data.id).toBe(mateRequest.body.data.id);

    const outsiderMateRequest = await request(app)
      .post('/v1/travel-mate-requests')
      .set('Authorization', outsiderAuthHeader)
      .send({
        messageTemplate: 'walk_together',
        targetPinId: targetPin.body.data.id,
      });
    expect(outsiderMateRequest.status).toBe(201);

    const declinedOutsiderRequest = await request(app)
      .patch(`/v1/travel-mate-requests/${outsiderMateRequest.body.data.id}`)
      .set('Authorization', targetAuthHeader)
      .send({ action: 'decline' });
    expect(declinedOutsiderRequest.status).toBe(200);
    expect(declinedOutsiderRequest.body.data.status).toBe('declined');

    const repeatedOutsiderMateRequest = await request(app)
      .post('/v1/travel-mate-requests')
      .set('Authorization', outsiderAuthHeader)
      .send({
        messageTemplate: 'walk_together',
        targetPinId: targetPin.body.data.id,
      });
    expect(repeatedOutsiderMateRequest.status).toBe(400);
    expect(repeatedOutsiderMateRequest.body.error.message).toContain('최근 처리된 동행 매칭 요청');

    const accepted = await request(app)
      .patch(`/v1/travel-mate-requests/${mateRequest.body.data.id}`)
      .set('Authorization', targetAuthHeader)
      .send({ action: 'accept' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe('accepted');

    const acceptedInbox = await request(app)
      .get('/v1/travel-mate-requests')
      .set('Authorization', targetAuthHeader)
      .query({ box: 'inbox', status: 'accepted' });
    expect(acceptedInbox.status).toBe(200);
    expect(acceptedInbox.body.data.map((item: { id: string }) => item.id)).toContain(
      mateRequest.body.data.id,
    );

    const report = await request(app)
      .post('/v1/community/reports')
      .set('Authorization', authHeader)
      .send({
        reason: 'safety',
        targetPinId: targetPin.body.data.id,
        targetUserId,
      });
    expect(report.status).toBe(202);

    const block = await request(app)
      .post('/v1/community/blocks')
      .set('Authorization', authHeader)
      .send({ targetPinId: targetPin.body.data.id });
    expect(block.status).toBe(202);

    const blockedMateRequest = await request(app)
      .post('/v1/travel-mate-requests')
      .set('Authorization', authHeader)
      .send({
        messageTemplate: 'liked_track',
        targetPinId: targetPin.body.data.id,
      });
    expect(blockedMateRequest.status).toBe(403);
    expect(blockedMateRequest.body.error.message).toContain('차단 관계');

    const hiddenMatches = await request(app)
      .get('/v1/music-matches')
      .set('Authorization', authHeader)
      .query({ lat: 37.751, lng: 128.875, mood: '잔잔한', state: '산책' });
    expect(hiddenMatches.status).toBe(200);
    expect(hiddenMatches.body.data).toEqual([]);
  });

  it('returns regional trends with auth', async () => {
    const response = await request(app)
      .get('/v1/trends/regions/KR-26/sound')
      .set('Authorization', authHeader)
      .query({ period: 'weekly' });

    expect(response.status).toBe(200);
    expect(response.body.data.regionName).toBe('부산');
    expect(response.body.data.topTracks.length).toBeGreaterThan(0);
  });

  afterAll(async () => {
    if (useMockDb) {
      resetMockDb();
    } else {
      await seedDatabase();
      await disconnectSeedDatabase();
    }

    await prisma.$disconnect();
  });
});
