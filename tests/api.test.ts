import bcrypt from 'bcrypt';
import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import { mockDb, resetMockDb } from '../src/mock/mock-db.js';
import { reverseGeocodeLocation } from '../src/services/reverse-geocoding.service.js';
import { disconnectSeedDatabase, seedDatabase } from '../prisma/seed.js';

function fileIdFromPhotoUrl(photoUrl: string) {
  return new URL(photoUrl).pathname.split('/').pop() as string;
}

// Real JPEG SOI + APP0/JFIF magic bytes. The server now determines Content-Type for
// GET /v1/uploads/:fileId purely from the file's leading bytes (see
// upload-file.service.ts#detectImageContentType) rather than trusting the client-supplied
// upload MIME type, so test fixtures need genuine image bytes for "serves the file back
// out" assertions to mean anything.
const JPEG_MAGIC_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function fakeJpegBuffer(label: string) {
  return Buffer.concat([JPEG_MAGIC_BYTES, Buffer.from(label)]);
}

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
  artistName?: string;
  authHeader: string;
  filename: string;
  lat?: number;
  lng?: number;
  note?: string;
  placeName: string;
  sessionId?: string;
  trackId?: string | null;
  trackTitle?: string;
  visibility?: 'private' | 'public';
}) {
  const requestBuilder = request(app)
    .post('/v1/moment-logs')
    .set('Authorization', input.authHeader)
    .field('createdAt', new Date().toISOString())
    .field('moodTags', 'fresh,calm')
    .field('note', input.note ?? '')
    .field('placeName', input.placeName)
    .field('sessionId', input.sessionId ?? '')
    .field('visibility', input.visibility ?? 'private');

  if (input.trackId !== null) {
    requestBuilder.field('trackId', input.trackId ?? 'seoul-city');
  }

  if (input.artistName) {
    requestBuilder.field('artistName', input.artistName);
  }

  if (input.trackTitle) {
    requestBuilder.field('trackTitle', input.trackTitle);
  }

  if (input.lat !== undefined) {
    requestBuilder.field('lat', String(input.lat));
  }

  if (input.lng !== undefined) {
    requestBuilder.field('lng', String(input.lng));
  }

  const response = await requestBuilder
    .attach('photo', fakeJpegBuffer('fake-image'), {
      filename: input.filename,
      contentType: 'image/jpeg',
    });

  expect(response.status).toBe(201);
  return response.body.data;
}

async function createTestTravelSession(authHeader: string) {
  const response = await request(app)
    .post('/v1/travel-sessions')
    .set('Authorization', authHeader)
    .send({ startedAt: new Date().toISOString(), travelMode: 'walk' });

  expect(response.status).toBe(201);
  return response.body.data.id as string;
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

  it('rejects the dev DB test route without auth', async () => {
    const response = await request(app)
      .post('/v1/dev/db-test-records')
      .send({
        label: 'swagger-smoke-test',
        payload: {
          source: 'api-test',
        },
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('creates a DB test record with auth', async () => {
    const response = await request(app)
      .post('/v1/dev/db-test-records')
      .set('Authorization', authHeader)
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

  it('returns account summary, rejects the removed local migration route, and logs out', async () => {
    const me = await request(app).get('/v1/me').set('Authorization', authHeader);
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toEqual(expect.any(String));
    expect(me.body.data.profile).toBeDefined();

    const removedMigration = await request(app)
      .post('/v1/me/migrate-local-data')
      .set('Authorization', authHeader)
      .send({});
    expect(removedMigration.status).toBe(404);

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

  it('deletes the authenticated account and invalidates its credentials', async () => {
    const email = `delete-${Date.now()}@soundlog.test`;
    const password = 'delete-account-password';
    const register = await request(app).post('/v1/auth/register').send({
      displayName: 'Delete Account User',
      email,
      password,
    });
    const accessToken = register.body.data.accessToken as string;

    expect(register.status).toBe(201);

    const deleted = await request(app)
      .delete('/v1/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toEqual({ deleted: true });

    const meAfterDeletion = await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(meAfterDeletion.status).toBe(401);

    const loginAfterDeletion = await request(app).post('/v1/auth/login').send({
      email,
      password,
    });
    expect(loginAfterDeletion.status).toBe(401);
    expect(await getStoredPasswordHash(email)).toBeUndefined();
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
    const searchedPlaces = await request(app)
      .get('/v1/tour/places')
      .set('Authorization', authHeader)
      .query({ query: '광안리', limit: 5 });
    expect(searchedPlaces.status).toBe(200);
    expect(searchedPlaces.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringContaining('광안리'),
        }),
      ]),
    );

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

    const distantTour = await request(app)
      .get('/v1/tour/nearby-places')
      .set('Authorization', authHeader)
      .query({
        lat: 37.785834,
        lng: -122.406417,
        radiusMeters: 2000,
      });
    expect(distantTour.status).toBe(200);
    expect(distantTour.body.data).toEqual([]);

    const reverseGeocodeFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          address: {
            city: '샌프란시스코',
            country: '미국',
            state: '캘리포니아주',
          },
          display_name: '샌프란시스코, 캘리포니아주, 미국',
          namedetails: {
            'name:ko': '샌프란시스코',
          },
          place_id: 12345,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        },
      ),
    );

    try {
      const reverseGeocodeLocationParams = { lat: 37.786834, lng: -122.407417 };
      const reverseGeocodedServiceResult = await reverseGeocodeLocation(
        reverseGeocodeLocationParams,
      );

      expect(reverseGeocodedServiceResult).toEqual(
        expect.objectContaining({
          address: expect.stringContaining('샌프란시스코'),
          attribution: '© OpenStreetMap contributors',
          source: 'reverse-geocode',
          title: '샌프란시스코',
        }),
      );
      expect(reverseGeocodeFetch).toHaveBeenCalledWith(
        expect.stringContaining('accept-language=ko%2Cen'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept-Language': 'ko,en;q=0.8',
          }),
        }),
      );

      const reverseGeocoded = await request(app)
        .get('/v1/tour/reverse-geocode')
        .set('Authorization', authHeader)
        .query(reverseGeocodeLocationParams);

      expect(reverseGeocoded.status).toBe(200);
      expect(reverseGeocoded.body.data).toEqual(
        expect.objectContaining({
          address: expect.stringContaining('샌프란시스코'),
          attribution: '© OpenStreetMap contributors',
          source: 'reverse-geocode',
          title: '샌프란시스코',
        }),
      );

      const cachedReverseGeocoded = await reverseGeocodeLocation(
        reverseGeocodeLocationParams,
      );

      expect(cachedReverseGeocoded?.title).toBe('샌프란시스코');
      expect(reverseGeocodeFetch).toHaveBeenCalledTimes(1);
    } finally {
      reverseGeocodeFetch.mockRestore();
    }

    const featured = await request(app)
      .get('/v1/home/featured-playlists')
      .set('Authorization', authHeader)
      .query({ locationRecommendationEnabled: true, lat: 35.1532, lng: 129.1186 });
    expect(featured.status).toBe(200);
    expect(featured.body.data.length).toBeGreaterThan(0);
    expect(featured.body.data[0]).toEqual(
      expect.objectContaining({
        coverImageUrl: expect.stringMatching(/^http:\/\/localhost:4000\/assets\/playlists\//),
      }),
    );
    expect(
      featured.body.data.some((playlist: { source?: string }) =>
        playlist.source === 'personalized',
      ),
    ).toBe(false);
    expect(
      featured.body.data.some((playlist: { source?: string }) =>
        playlist.source === 'ml-recommendation',
      ),
    ).toBe(false);

    const unauthenticatedFeatured = await request(app)
      .get('/v1/home/featured-playlists')
      .query({ locationRecommendationEnabled: true, recommendationMode: 'travel', lat: 35.1532, lng: 129.1186 });
    expect(unauthenticatedFeatured.status).toBe(401);
    expect(unauthenticatedFeatured.body.error.code).toBe('UNAUTHORIZED');

    const playlistArtwork = await request(app).get('/assets/playlists/busan.webp');
    expect(playlistArtwork.status).toBe(200);
    expect(playlistArtwork.headers['content-type']).toBe('image/webp');
    expect(playlistArtwork.headers['cache-control']).toContain('immutable');

    const playlistIds = new Set<string>();

    for (const moodFilter of ['잔잔한', '신나는', '시원한', '설레는', '감성적인']) {
      const mood = await request(app)
        .get('/v1/home/mood-recommendations')
        .set('Authorization', authHeader)
        .query({ moodFilter, preferredGenres: 'K-POP' });

      expect(mood.status).toBe(200);
      expect(mood.body.data.length).toBeGreaterThan(0);
      expect(
        mood.body.data.every((item: { moods: string[] }) =>
          item.moods.includes(moodFilter),
        ),
      ).toBe(true);

      for (const item of mood.body.data as Array<{
        imageUrl?: string;
        playlistId?: string;
        track?: unknown;
      }>) {
        expect(item.imageUrl).toEqual(expect.any(String));
        expect(item.playlistId).toEqual(expect.any(String));
        expect(item.track).toBeDefined();
        playlistIds.add(item.playlistId as string);
      }
    }

    const legacyMood = await request(app)
      .get('/v1/home/mood-recommendations')
      .set('Authorization', authHeader)
      .query({ moodFilter: '청량한' });
    expect(legacyMood.status).toBe(200);
    expect(legacyMood.body.data.length).toBeGreaterThan(0);
    expect(
      legacyMood.body.data.every((item: { moods: string[] }) =>
        item.moods.includes('시원한'),
      ),
    ).toBe(true);

    for (const playlistId of playlistIds) {
      const playlist = await request(app)
        .get(`/v1/playlists/${playlistId}`)
        .set('Authorization', authHeader);

      expect(playlist.status).toBe(200);
      expect(playlist.body.data.id).toBe(playlistId);
      expect(playlist.body.data.tracks.length).toBeGreaterThan(0);
    }

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

    const recommendedTrack = recommended.body.data.tracks[0];
    const savedRecommendation = await request(app)
      .put(`/v1/library/tracks/${recommendedTrack.id}`)
      .set('Authorization', authHeader)
      .send({ action: 'save', playlistId: recommended.body.data.id });
    expect(savedRecommendation.status).toBe(200);
    expect(savedRecommendation.body.data.isSaved).toBe(true);

    const recommendedDetail = await request(app)
      .get(`/v1/playlists/${recommended.body.data.id}`)
      .set('Authorization', authHeader);
    expect(recommendedDetail.status).toBe(200);
    expect(recommendedDetail.body.data.tracks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: recommendedTrack.id })]),
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
      .put('/v1/library/tracks/busan-vacance')
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
    const busanRecord = list.body.data.find(
      (item: { track: { id: string } }) => item.track.id === 'busan-vacance',
    );

    expect(busanRecord).toBeTruthy();
    expect(busanRecord.playlist).toMatchObject({
      id: 'busan-ocean',
      placeName: '광안리 해변',
      regionName: '부산',
      trackCount: 6,
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
      .attach('photo', fakeJpegBuffer('fake-image'), {
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
      .attach('photo', fakeJpegBuffer('fake-image'), {
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

    const recapCaptureIdempotencyKey = `recap-capture-${Date.now()}`;
    const aliasCreated = await request(app)
      .post('/v1/recap-captures')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', recapCaptureIdempotencyKey)
      .field('createdAt', new Date().toISOString())
      .field('createStandaloneRecap', 'true')
      .field('moodTags', 'fresh')
      .field('note', '새 리캡 캡처 경로 테스트')
      .field('placeName', '리캡 캡처 테스트 장소')
      .field('trackId', 'seoul-city')
      .attach('photo', fakeJpegBuffer('alias-image'), {
        filename: 'recap-capture.jpg',
        contentType: 'image/jpeg',
      });
    expect(aliasCreated.status).toBe(201);
    expect(aliasCreated.body.data.note).toBe('새 리캡 캡처 경로 테스트');
    expect(aliasCreated.body.data.recapId).toEqual(expect.any(String));

    const aliasDuplicate = await request(app)
      .post('/v1/recap-captures')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', recapCaptureIdempotencyKey)
      .field('createdAt', new Date().toISOString())
      .field('createStandaloneRecap', 'true')
      .field('moodTags', 'calm')
      .field('placeName', '중복 리캡 캡처');
    expect(aliasDuplicate.status).toBe(201);
    expect(aliasDuplicate.body.data.id).toBe(aliasCreated.body.data.id);
    expect(aliasDuplicate.body.data.recapId).toBe(aliasCreated.body.data.recapId);

    const standaloneRecap = await request(app)
      .get(`/v1/recaps/${aliasCreated.body.data.recapId}/share`)
      .set('Authorization', authHeader);
    expect(standaloneRecap.status).toBe(200);
    expect(standaloneRecap.body.data.moments).toHaveLength(1);
    expect(standaloneRecap.body.data.moments[0].id).toBe(aliasCreated.body.data.id);

    const legacyCapture = await request(app)
      .post('/v1/recap-captures')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', `legacy-recap-capture-${Date.now()}`)
      .field('createdAt', new Date().toISOString())
      .field('moodTags', 'calm');
    expect(legacyCapture.status).toBe(201);
    expect(legacyCapture.body.data.recapId).toBeUndefined();

    const legacyRecap = await request(app)
      .post('/v1/recaps')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', `legacy-recap-${legacyCapture.body.data.id}`)
      .send({
        momentLogIds: [legacyCapture.body.data.id],
        templateId: 'album',
    });
    expect(legacyRecap.status).toBe(201);

    const legacyRecapShare = await request(app)
      .get(`/v1/recaps/${legacyRecap.body.data.id}/share`)
      .set('Authorization', authHeader);
    expect(legacyRecapShare.status).toBe(200);
    expect(legacyRecapShare.body.data.moments[0].id).toBe(legacyCapture.body.data.id);

    const aliasUpdated = await request(app)
      .patch(`/v1/recap-captures/${aliasCreated.body.data.id}`)
      .set('Authorization', authHeader)
      .send({ note: '새 리캡 캡처 경로 수정' });
    expect(aliasUpdated.status).toBe(200);
    expect(aliasUpdated.body.data.note).toBe('새 리캡 캡처 경로 수정');

    const aliasList = await request(app)
      .get('/v1/recap-captures')
      .set('Authorization', authHeader);
    expect(aliasList.status).toBe(200);
    expect(aliasList.body.data.some((item: { id: string }) => item.id === aliasCreated.body.data.id)).toBe(true);

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
      .attach('photo', fakeJpegBuffer('replacement-image'), {
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

    const aliasPhotoUpdated = await request(app)
      .put(`/v1/recap-captures/${aliasCreated.body.data.id}/photo`)
      .set('Authorization', authHeader)
      .attach('photo', fakeJpegBuffer('alias-replacement-image'), {
        filename: 'recap-capture-replacement.jpg',
        contentType: 'image/jpeg',
      });
    expect(aliasPhotoUpdated.status).toBe(200);
    expect(aliasPhotoUpdated.body.data.photoUrl).toContain('/uploads/');

    const aliasPhotoDeleted = await request(app)
      .delete(`/v1/recap-captures/${aliasCreated.body.data.id}/photo`)
      .set('Authorization', authHeader);
    expect(aliasPhotoDeleted.status).toBe(200);
    expect(aliasPhotoDeleted.body.data.photoUrl).toBeUndefined();

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

    const aliasDeleted = await request(app)
      .delete(`/v1/recap-captures/${aliasCreated.body.data.id}`)
      .set('Authorization', authHeader);
    expect(aliasDeleted.status).toBe(202);
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
            value: 'server',
          },
        ],
      });

    expect(response.status).toBe(202);
    expect(response.body.data.accepted).toBe(true);
  });

  it('handles recap APIs', async () => {
    const recapSessionId = await createTestTravelSession(authHeader);
    const farRecapSessionId = await createTestTravelSession(authHeader);
    const noLocationRecapSessionId = await createTestTravelSession(authHeader);
    const mlRecapSessionId = await createTestTravelSession(authHeader);
    const noMusicRecapSessionId = await createTestTravelSession(authHeader);
    const mlTrackId = `ml-track-${Date.now()}`;

    const firstRecapMoment = await createTestMomentLog({
      authHeader,
      filename: 'recap-moment-1.jpg',
      lat: 37.5512,
      lng: 126.9882,
      placeName: '리캡 테스트 장소',
      sessionId: recapSessionId,
      trackId: 'seoul-night-track',
      visibility: 'public',
    });
    const secondRecapMoment = await createTestMomentLog({
      authHeader,
      filename: 'recap-moment-2.jpg',
      lat: 37.552,
      lng: 126.989,
      placeName: '리캡 테스트 장소',
      sessionId: recapSessionId,
      trackId: 'seoul-night-track',
      visibility: 'public',
    });
    await createTestMomentLog({
      authHeader,
      filename: 'recap-moment-no-location.jpg',
      placeName: '위치 없는 리캡 테스트',
      sessionId: noLocationRecapSessionId,
      trackId: 'seoul-night-track',
    });
    await createTestMomentLog({
      authHeader,
      filename: 'recap-moment-far.jpg',
      lat: 37.57,
      lng: 127.02,
      placeName: '멀리 있는 공개 리캡',
      sessionId: farRecapSessionId,
      trackId: 'seoul-night-track',
      visibility: 'public',
    });
    const mlMoment = await createTestMomentLog({
      artistName: 'ML Artist',
      authHeader,
      filename: 'recap-moment-ml.jpg',
      lat: 37.5514,
      lng: 126.9884,
      placeName: 'ML 추천 리캡 테스트',
      sessionId: mlRecapSessionId,
      trackId: mlTrackId,
      trackTitle: 'ML Recommended Track',
    });

    const mlTrackRecap = await request(app)
      .post('/v1/recaps')
      .set('Authorization', authHeader)
      .send({
        momentLogIds: [mlMoment.id],
        representativeTrackId: mlTrackId,
        sessionId: mlRecapSessionId,
        templateId: 'album',
        title: 'ML 추천곡 리캡',
      });
    expect(mlTrackRecap.status).toBe(201);
    expect(mlTrackRecap.body.data.representativeTrack).toMatchObject({
      artist: 'ML Artist',
      id: mlTrackId,
      title: 'ML Recommended Track',
    });
    const noMusicMoment = await createTestMomentLog({
      authHeader,
      filename: 'recap-moment-no-music.jpg',
      lat: 37.5515,
      lng: 126.9885,
      placeName: '음악 없는 리캡 테스트',
      sessionId: noMusicRecapSessionId,
      trackId: null,
    });

    const noMusicRecap = await request(app)
      .post('/v1/recaps')
      .set('Authorization', authHeader)
      .send({
        momentLogIds: [noMusicMoment.id],
        sessionId: noMusicRecapSessionId,
        templateId: 'album',
        title: '음악 없는 리캡',
      });
    expect(noMusicRecap.status).toBe(201);
    expect(noMusicRecap.body.data.representativeTrack).toMatchObject({
      artist: 'Soundlog',
      id: 'soundlog-no-music',
      title: '음악 없음',
    });

    const emptyRecap = await request(app)
      .post('/v1/recaps')
      .set('Authorization', authHeader)
      .send({ templateId: 'album', title: '빈 로그' });
    expect(emptyRecap.status).toBe(400);
    expect(emptyRecap.body.error.code).toBe('BAD_REQUEST');

    const publicNoLocationCreate = await request(app)
      .post('/v1/recaps')
      .set('Authorization', authHeader)
      .send({
        templateId: 'album',
        sessionId: noLocationRecapSessionId,
        title: '위치 없는 공개 리캡',
        visibility: 'public',
      });
    expect(publicNoLocationCreate.status).toBe(400);
    expect(publicNoLocationCreate.body.error.code).toBe('BAD_REQUEST');

    const privateNoLocationCreate = await request(app)
      .post('/v1/recaps')
      .set('Authorization', authHeader)
      .send({
        templateId: 'album',
        sessionId: noLocationRecapSessionId,
        title: '위치 없는 비공개 리캡',
      });
    expect(privateNoLocationCreate.status).toBe(201);

    const publicNoLocationUpdate = await request(app)
      .patch(`/v1/recaps/${privateNoLocationCreate.body.data.id}/visibility`)
      .set('Authorization', authHeader)
      .send({ visibility: 'public' });
    expect(publicNoLocationUpdate.status).toBe(400);
    expect(publicNoLocationUpdate.body.error.code).toBe('BAD_REQUEST');

    const routePoints = [
      { lat: 37.5512, lng: 126.9882, recordedAt: '2026-07-12T01:00:00.000Z' },
      { lat: 37.5516, lng: 126.9888, recordedAt: '2026-07-12T01:05:00.000Z' },
      { lat: 37.552, lng: 126.989, recordedAt: '2026-07-12T01:10:00.000Z' },
    ];
    const idempotencyKey = `recap-${Date.now()}`;
    const created = await request(app)
      .post('/v1/recaps')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        routePoints,
        templateId: 'album',
        sessionId: recapSessionId,
        title: '테스트 리캡',
      });
    expect(created.status).toBe(201);
    createdRecapId = created.body.data.id;
    expect(created.body.data.representativeTrack.id).toBe('seoul-night-track');
    expect(created.body.data.thumbnailMomentId).toBe(firstRecapMoment.id);
    expect(created.body.data.backgroundImageUrl).toBe(firstRecapMoment.photoUrl);
    expect(created.body.data.visibility).toBe('private');

    const list = await request(app).get('/v1/recaps').set('Authorization', authHeader);
    expect(list.status).toBe(200);
    expect(list.body.data.some((recap: { id: string }) => recap.id === createdRecapId)).toBe(true);
    expect(
      list.body.data.every(
        (recap: { sessionId?: string }) => typeof recap.sessionId === 'string',
      ),
    ).toBe(true);

    const mineMarkers = await request(app)
      .get('/v1/recap-markers')
      .query({ lat: 37.5512, lng: 126.9882, radiusMeters: 300, scope: 'mine' })
      .set('Authorization', authHeader);
    expect(mineMarkers.status).toBe(200);
    expect(mineMarkers.body.data.some((marker: { recapId: string }) => marker.recapId === createdRecapId)).toBe(true);

    const publicMarkersBeforeUpdate = await request(app)
      .get('/v1/recap-markers')
      .query({ lat: 37.5512, lng: 126.9882, radiusMeters: 300, scope: 'public' })
      .set('Authorization', authHeader);
    expect(publicMarkersBeforeUpdate.status).toBe(200);
    expect(
      publicMarkersBeforeUpdate.body.data.some(
        (marker: { recapId: string }) => marker.recapId === createdRecapId,
      ),
    ).toBe(false);

    const visibilityUpdate = await request(app)
      .patch(`/v1/recaps/${createdRecapId}/visibility`)
      .set('Authorization', authHeader)
      .send({ visibility: 'public' });
    expect(visibilityUpdate.status).toBe(200);
    expect(visibilityUpdate.body.data.visibility).toBe('public');

    const farCreated = await request(app)
      .post('/v1/recaps')
      .set('Authorization', authHeader)
      .send({
        templateId: 'album',
        sessionId: farRecapSessionId,
        title: '300m 밖 공개 리캡',
        visibility: 'public',
      });
    expect(farCreated.status).toBe(201);
    expect(farCreated.body.data.visibility).toBe('public');

    const allMineMarkers = await request(app)
      .get('/v1/recap-markers')
      .query({ scope: 'mine' })
      .set('Authorization', authHeader);
    expect(allMineMarkers.status).toBe(200);
    expect(
      allMineMarkers.body.data.map((marker: { recapId: string }) => marker.recapId),
    ).toEqual(expect.arrayContaining([createdRecapId, farCreated.body.data.id]));

    const otherEmail = `public-log-${Date.now()}@soundlog.test`;
    const otherRegister = await request(app).post('/v1/auth/register').send({
      displayName: 'Public Log Traveler',
      email: otherEmail,
      password: 'soundlog-password',
    });
    expect(otherRegister.status).toBe(201);
    const otherLogin = await request(app).post('/v1/auth/login').send({
      email: otherEmail,
      password: 'soundlog-password',
    });
    expect(otherLogin.status).toBe(200);
    const otherAuthHeader = `Bearer ${otherLogin.body.data.accessToken}`;
    const otherRecapSessionId = await createTestTravelSession(otherAuthHeader);

    const otherFirstPublicMoment = await createTestMomentLog({
      authHeader: otherAuthHeader,
      filename: 'other-public-recap.jpg',
      lat: 37.5513,
      lng: 126.9883,
      placeName: '다른 사람 공개 리캡',
      sessionId: otherRecapSessionId,
      trackId: 'seoul-city',
      visibility: 'public',
    });
    const otherPrivateMoment = await createTestMomentLog({
      authHeader: otherAuthHeader,
      filename: 'other-private-recap.jpg',
      lat: 37.5514,
      lng: 126.9884,
      placeName: '비공개 장소 이름',
      sessionId: otherRecapSessionId,
      trackId: 'moon-seoul',
      visibility: 'private',
    });
    await createTestMomentLog({
      authHeader: otherAuthHeader,
      filename: 'other-latest-public-recap.jpg',
      lat: 37.5515,
      lng: 126.9885,
      placeName: '마지막 공개 리캡',
      sessionId: otherRecapSessionId,
      trackId: 'hangang',
      visibility: 'public',
    });

    const otherPublicCreated = await request(app)
      .post('/v1/recaps')
      .set('Authorization', otherAuthHeader)
      .send({
        templateId: 'album',
        sessionId: otherRecapSessionId,
        title: '다른 사람 공개 로그',
        visibility: 'public',
      });
    expect(otherPublicCreated.status).toBe(201);

    const mineList = await request(app)
      .get('/v1/recaps')
      .query({ scope: 'mine' })
      .set('Authorization', authHeader);
    expect(mineList.status).toBe(200);
    expect(mineList.body.data.some((recap: { id: string }) => recap.id === createdRecapId)).toBe(true);
    expect(
      mineList.body.data.some((recap: { id: string }) => recap.id === otherPublicCreated.body.data.id),
    ).toBe(false);

    const othersList = await request(app)
      .get('/v1/recaps')
      .query({ scope: 'others' })
      .set('Authorization', authHeader);
    expect(othersList.status).toBe(200);
    expect(
      othersList.body.data.some((recap: { id: string }) => recap.id === otherPublicCreated.body.data.id),
    ).toBe(true);
    expect(
      othersList.body.data.some((recap: { id: string }) => recap.id === createdRecapId),
    ).toBe(false);

    const allList = await request(app)
      .get('/v1/recaps')
      .query({ scope: 'all' })
      .set('Authorization', authHeader);
    expect(allList.status).toBe(200);
    expect(allList.body.data.some((recap: { id: string }) => recap.id === createdRecapId)).toBe(true);
    expect(
      allList.body.data.some((recap: { id: string }) => recap.id === otherPublicCreated.body.data.id),
    ).toBe(true);

    const invalidScope = await request(app)
      .get('/v1/recaps')
      .query({ scope: 'everyone' })
      .set('Authorization', authHeader);
    expect(invalidScope.status).toBe(400);

    const publicMarkersAfterUpdate = await request(app)
      .get('/v1/recap-markers')
      .query({ lat: 37.5512, lng: 126.9882, radiusMeters: 300, scope: 'public' })
      .set('Authorization', authHeader);
    expect(publicMarkersAfterUpdate.status).toBe(200);
    expect(
      publicMarkersAfterUpdate.body.data.some(
        (marker: { recapId: string; visibility: string }) =>
          marker.recapId === createdRecapId && marker.visibility === 'public',
      ),
    ).toBe(true);
    const mixedVisibilityMarker = publicMarkersAfterUpdate.body.data.find(
      (marker: { recapId: string }) => marker.recapId === otherPublicCreated.body.data.id,
    );
    expect(mixedVisibilityMarker).toMatchObject({
      artistName: '폴킴',
      location: { lat: 37.5515, lng: 126.9885 },
      placeName: '마지막 공개 리캡',
      trackTitle: '한강에서',
    });
    expect(JSON.stringify(mixedVisibilityMarker)).not.toContain('비공개 장소 이름');
    expect(
      publicMarkersAfterUpdate.body.data.some(
        (marker: { recapId: string }) => marker.recapId === farCreated.body.data.id,
      ),
    ).toBe(false);

    const expandedRadiusMarkers = await request(app)
      .get('/v1/recap-markers')
      .query({ lat: 37.5512, lng: 126.9882, radiusMeters: 5000, scope: 'public' })
      .set('Authorization', authHeader);
    expect(expandedRadiusMarkers.status).toBe(200);
    expect(
      expandedRadiusMarkers.body.data.some(
        (marker: { recapId: string }) => marker.recapId === farCreated.body.data.id,
      ),
    ).toBe(true);

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
    expect(share.body.data.isMine).toBe(true);
    expect(share.body.data.trackTitle).toBe(created.body.data.representativeTrack.title);
    expect(share.body.data.templateId).toBe('album');
    expect(share.body.data.visibility).toBe('public');
    expect(share.body.data.sessionId).toBe(recapSessionId);
    expect(share.body.data.thumbnailMomentId).toBe(firstRecapMoment.id);
    expect(share.body.data.backgroundImageUrl).toBe(firstRecapMoment.photoUrl);
    expect(share.body.data.moments.length).toBeGreaterThan(1);
    expect(share.body.data.routePoints).toEqual(routePoints);
    expect(share.body.data.moments.map((moment: { location?: unknown }) => moment.location)).toEqual(
      expect.arrayContaining([
        { lat: 37.5512, lng: 126.9882 },
        { lat: 37.552, lng: 126.989 },
      ]),
    );

    const thumbnailUpdate = await request(app)
      .patch(`/v1/recaps/${createdRecapId}/thumbnail`)
      .set('Authorization', authHeader)
      .send({ momentId: secondRecapMoment.id });
    expect(thumbnailUpdate.status).toBe(200);
    expect(thumbnailUpdate.body.data.thumbnailMomentId).toBe(secondRecapMoment.id);
    expect(thumbnailUpdate.body.data.backgroundImageUrl).toBe(secondRecapMoment.photoUrl);

    const invalidThumbnailUpdate = await request(app)
      .patch(`/v1/recaps/${createdRecapId}/thumbnail`)
      .set('Authorization', authHeader)
      .send({ momentId: 'moment-not-in-this-log' });
    expect(invalidThumbnailUpdate.status).toBe(400);

    const forbiddenThumbnailUpdate = await request(app)
      .patch(`/v1/recaps/${createdRecapId}/thumbnail`)
      .set('Authorization', otherAuthHeader)
      .send({ momentId: secondRecapMoment.id });
    expect(forbiddenThumbnailUpdate.status).toBe(404);

    const publicShareAsOther = await request(app)
      .get(`/v1/recaps/${createdRecapId}/share`)
      .set('Authorization', otherAuthHeader);
    expect(publicShareAsOther.status).toBe(200);
    expect(publicShareAsOther.body.data.isMine).toBe(false);
    expect(publicShareAsOther.body.data.routePoints).toBeUndefined();
    expect(publicShareAsOther.body.data.thumbnailMomentId).toBe(secondRecapMoment.id);
    expect(publicShareAsOther.body.data.backgroundImageUrl).toBe(secondRecapMoment.photoUrl);

    const mixedVisibilityShare = await request(app)
      .get(`/v1/recaps/${otherPublicCreated.body.data.id}/share`)
      .set('Authorization', authHeader);
    expect(mixedVisibilityShare.status).toBe(200);
    expect(mixedVisibilityShare.body.data.moments).toHaveLength(2);
    expect(
      mixedVisibilityShare.body.data.moments.every(
        (moment: { visibility: string }) => moment.visibility === 'public',
      ),
    ).toBe(true);
    expect(JSON.stringify(mixedVisibilityShare.body.data)).not.toContain('비공개 장소 이름');

    const privateThumbnailSelection = await request(app)
      .patch(`/v1/recaps/${otherPublicCreated.body.data.id}/thumbnail`)
      .set('Authorization', otherAuthHeader)
      .send({ momentId: otherPrivateMoment.id });
    expect(privateThumbnailSelection.status).toBe(200);
    expect(privateThumbnailSelection.body.data.thumbnailMomentId).toBe(otherPrivateMoment.id);

    const publicShareAfterPrivateThumbnail = await request(app)
      .get(`/v1/recaps/${otherPublicCreated.body.data.id}/share`)
      .set('Authorization', authHeader);
    expect(publicShareAfterPrivateThumbnail.status).toBe(200);
    expect(publicShareAfterPrivateThumbnail.body.data.thumbnailMomentId).toBe(
      otherFirstPublicMoment.id,
    );
    expect(publicShareAfterPrivateThumbnail.body.data.backgroundImageUrl).toBe(
      otherFirstPublicMoment.photoUrl,
    );
    expect(JSON.stringify(publicShareAfterPrivateThumbnail.body.data)).not.toContain(
      otherPrivateMoment.photoUrl,
    );

    const aggregateUpdate = await request(app)
      .patch(`/v1/moment-logs/${secondRecapMoment.id}`)
      .set('Authorization', authHeader)
      .send({ placeName: '수정된 리캡 장소' });
    expect(aggregateUpdate.status).toBe(200);

    const refreshedShare = await request(app)
      .get(`/v1/recaps/${createdRecapId}/share`)
      .set('Authorization', authHeader);
    expect(refreshedShare.status).toBe(200);
    expect(refreshedShare.body.data.placeName).toBe('수정된 리캡 장소');
    expect(refreshedShare.body.data.thumbnailMomentId).toBe(secondRecapMoment.id);

    const aggregateDelete = await request(app)
      .delete(`/v1/moment-logs/${secondRecapMoment.id}`)
      .set('Authorization', authHeader);
    expect(aggregateDelete.status).toBe(202);

    const shareAfterDelete = await request(app)
      .get(`/v1/recaps/${createdRecapId}/share`)
      .set('Authorization', authHeader);
    expect(shareAfterDelete.status).toBe(200);
    expect(shareAfterDelete.body.data.moments).toHaveLength(1);
    expect(shareAfterDelete.body.data.moments[0].id).toBe(firstRecapMoment.id);
    expect(shareAfterDelete.body.data.thumbnailMomentId).toBe(firstRecapMoment.id);
    expect(shareAfterDelete.body.data.backgroundImageUrl).toBe(firstRecapMoment.photoUrl);

    const recoveredSessionId = `offline-session-${Date.now()}`;
    const offlineMoment = await createTestMomentLog({
      authHeader,
      filename: 'offline-session-recap.jpg',
      lat: 37.5518,
      lng: 126.9888,
      placeName: '오프라인 여행 기록',
      sessionId: recoveredSessionId,
      trackId: 'seoul-city',
    });
    const recoveredLog = await request(app)
      .post('/v1/recaps')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', `travel-log:${recoveredSessionId}`)
      .send({
        momentLogIds: [offlineMoment.id],
        sessionId: recoveredSessionId,
        templateId: 'album',
        title: '복구된 오프라인 로그',
      });
    expect(recoveredLog.status).toBe(201);
    expect(recoveredLog.body.data.sessionId).toBe(recoveredSessionId);

    const shareEvent = await request(app)
      .post(`/v1/recaps/${createdRecapId}/share-events`)
      .set('Authorization', authHeader)
      .send({ type: 'os_share', createdAt: new Date().toISOString() });
    expect(shareEvent.status).toBe(202);
  });

  it('handles travel session APIs', async () => {
    const routePoints = [
      { lat: 37.5512, lng: 126.9882, recordedAt: '2026-07-12T02:00:00.000Z' },
      { lat: 37.5516, lng: 126.9888, recordedAt: '2026-07-12T02:03:00.000Z' },
    ];
    const created = await request(app)
      .post('/v1/travel-sessions')
      .set('Authorization', authHeader)
      .send({
        location: { lat: 37.5512, lng: 126.9882 },
        routePoints,
        travelMode: 'walk',
      });
    expect(created.status).toBe(201);
    createdSessionId = created.body.data.id;
    expect(created.body.data.routePoints).toEqual(routePoints);

    const synced = await request(app)
      .patch(`/v1/travel-sessions/${createdSessionId}`)
      .set('Authorization', authHeader)
      .send({
        location: { lat: 37.552, lng: 126.989 },
        routePoints: [
          ...routePoints,
          { lat: 37.552, lng: 126.989, recordedAt: '2026-07-12T02:08:00.000Z' },
        ],
        status: 'active',
      });
    expect(synced.status).toBe(200);
    expect(synced.body.data.status).toBe('active');
    expect(synced.body.data.routePoints).toHaveLength(3);

    const updated = await request(app)
      .patch(`/v1/travel-sessions/${createdSessionId}`)
      .set('Authorization', authHeader)
      .send({
        routePoints: [
          ...synced.body.data.routePoints,
          { lat: 37.5524, lng: 126.9895, recordedAt: '2026-07-12T02:12:00.000Z' },
        ],
        status: 'ended',
        endedAt: new Date().toISOString(),
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.status).toBe('ended');
    expect(updated.body.data.routePoints).toHaveLength(4);
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

  (useMockDb ? describe.skip : describe)('GET /v1/uploads/:fileId access control', () => {
    it('lets the owner fetch their own private moment photo', async () => {
      const moment = await createTestMomentLog({
        authHeader,
        filename: 'owner-private.jpg',
        placeName: '업로드 접근 테스트',
      });
      const fileId = fileIdFromPhotoUrl(moment.photoUrl);

      const response = await request(app)
        .get(`/v1/uploads/${fileId}`)
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
    });

    it('returns 404 (not 403) when another user requests a private photo', async () => {
      const moment = await createTestMomentLog({
        authHeader,
        filename: 'owner-private-other.jpg',
        placeName: '업로드 접근 테스트',
      });
      const fileId = fileIdFromPhotoUrl(moment.photoUrl);
      const otherAccessToken = await getToken();

      const response = await request(app)
        .get(`/v1/uploads/${fileId}`)
        .set('Authorization', `Bearer ${otherAccessToken}`);

      expect(response.status).toBe(404);
    });

    it('rejects an unauthenticated request for a private photo', async () => {
      const moment = await createTestMomentLog({
        authHeader,
        filename: 'owner-private-anon.jpg',
        placeName: '업로드 접근 테스트',
      });
      const fileId = fileIdFromPhotoUrl(moment.photoUrl);

      const response = await request(app).get(`/v1/uploads/${fileId}`);

      expect([401, 404]).toContain(response.status);
    });

    it('lets another authenticated user fetch a public moment photo', async () => {
      const moment = await createTestMomentLog({
        authHeader,
        filename: 'owner-public.jpg',
        lat: 37.5665,
        lng: 126.978,
        placeName: '업로드 접근 테스트(공개)',
        visibility: 'public',
      });
      const fileId = fileIdFromPhotoUrl(moment.photoUrl);
      const otherAccessToken = await getToken();

      const response = await request(app)
        .get(`/v1/uploads/${fileId}`)
        .set('Authorization', `Bearer ${otherAccessToken}`);

      expect(response.status).toBe(200);
    });

    it('returns 404 for a well-formed file id that does not exist', async () => {
      const response = await request(app)
        .get(`/v1/uploads/${'a'.repeat(32)}`)
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
    });

    it('blocks path traversal, absolute paths, and encoded separators in the file id', async () => {
      const maliciousIds = [
        '../../../etc/passwd',
        '..%2f..%2f..%2fetc%2fpasswd',
        '%2e%2e%2f%2e%2e%2fsrc%2fapp.ts',
        encodeURIComponent('../../../etc/passwd'),
        encodeURIComponent('/etc/passwd'),
        // Double URL-encoding: decodes once (by Express) to a still-encoded traversal
        // sequence, which must still fail the anchored hex pattern rather than being
        // decoded a second time and slipping through.
        '%252e%252e%252fetc%252fpasswd',
        encodeURIComponent(encodeURIComponent('../../../etc/passwd')),
        // Backslash variants (meaningful as a path separator on Windows filesystems).
        '..\\..\\..\\etc\\passwd',
        encodeURIComponent('..\\..\\..\\etc\\passwd'),
        '%5c..%5c..%5cetc%5cpasswd',
        // A well-formed 32-hex id with an extra path segment before or after it.
        `${'a'.repeat(32)}/../../../etc/passwd`,
        `some-prefix/${'a'.repeat(32)}`,
        `${'a'.repeat(32)}/extra-suffix`,
        encodeURIComponent('a'.repeat(32) + ' '),
      ];

      for (const maliciousId of maliciousIds) {
        const response = await request(app)
          .get(`/v1/uploads/${maliciousId}`)
          .set('Authorization', authHeader);

        expect(response.status).not.toBe(200);
        expect(response.text ?? '').not.toContain('root:');
      }
    });

    it('rejects traversal attempts hidden behind a query string', async () => {
      const response = await request(app)
        .get('/v1/uploads/..%2f..%2f..%2fetc%2fpasswd?x=1')
        .set('Authorization', authHeader);

      expect(response.status).not.toBe(200);
      expect(response.text ?? '').not.toContain('root:');
    });

    it('still resolves a valid file id when a harmless query string is appended', async () => {
      const moment = await createTestMomentLog({
        authHeader,
        filename: 'owner-with-query.jpg',
        placeName: '쿼리스트링 테스트',
      });
      const fileId = fileIdFromPhotoUrl(moment.photoUrl);

      const response = await request(app)
        .get(`/v1/uploads/${fileId}?cachebust=1`)
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
    });

    (useMockDb ? it.skip : it)(
      'returns 404 for a real on-disk file that has no matching DB record',
      async () => {
        const uploadDir = path.resolve(env.UPLOAD_DIRECTORY);
        const orphanFileId = 'f'.repeat(32);
        const orphanFilePath = path.join(uploadDir, orphanFileId);

        await fs.writeFile(orphanFilePath, fakeJpegBuffer('untracked-file'));

        try {
          const response = await request(app)
            .get(`/v1/uploads/${orphanFileId}`)
            .set('Authorization', authHeader);

          expect(response.status).toBe(404);
        } finally {
          await fs.unlink(orphanFilePath).catch(() => undefined);
        }
      },
    );

    it('sets an image Content-Type derived from the file bytes and keeps nosniff enabled', async () => {
      const moment = await createTestMomentLog({
        authHeader,
        filename: 'owner-content-type.jpg',
        placeName: '콘텐츠 타입 테스트',
      });
      const fileId = fileIdFromPhotoUrl(moment.photoUrl);

      const response = await request(app)
        .get(`/v1/uploads/${fileId}`)
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^image\/jpeg/);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    (useMockDb ? it.skip : it)(
      'never serves a stored file as an image when its on-disk bytes are not a recognized image signature',
      async () => {
        const uploadDir = path.resolve(env.UPLOAD_DIRECTORY);

        const moment = await createTestMomentLog({
          authHeader,
          filename: 'will-be-corrupted.jpg',
          placeName: '비이미지 바이트 테스트',
        });
        const fileId = fileIdFromPhotoUrl(moment.photoUrl);
        const filePath = path.join(uploadDir, fileId);

        // Overwrites the on-disk bytes with non-image content while keeping the same
        // filename/DB row, so the fileId is legitimately owned but the bytes are not an
        // image. This confirms the GET endpoint's own magic-byte check — not the
        // upload-time filter — is the real boundary for what gets served as an image.
        await fs.writeFile(filePath, Buffer.from('not an image at all'));

        const response = await request(app)
          .get(`/v1/uploads/${fileId}`)
          .set('Authorization', authHeader);

        expect(response.status).toBe(404);
      },
    );
  });

  describe('upload MIME whitelist', () => {
    it('rejects a disallowed declared MIME type without writing a file to disk', async () => {
      const uploadDir = path.resolve(env.UPLOAD_DIRECTORY);
      const filesBefore = useMockDb ? undefined : new Set(await fs.readdir(uploadDir));

      const response = await request(app)
        .post('/v1/moment-logs')
        .set('Authorization', authHeader)
        .field('createdAt', new Date().toISOString())
        .field('moodTags', 'fresh')
        .field('placeName', 'MIME 화이트리스트 테스트')
        .attach('photo', Buffer.from('#!/bin/sh\necho not an image\n'), {
          contentType: 'application/x-sh',
          filename: 'not-an-image.sh',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');

      if (!useMockDb) {
        const filesAfter = new Set(await fs.readdir(uploadDir));
        expect(filesAfter.size).toBe(filesBefore!.size);
      }
    });

    it('accepts every image type on the allowed MIME whitelist', async () => {
      const allowedMimeTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif',
        'image/gif',
      ];

      for (const mimeType of allowedMimeTypes) {
        const response = await request(app)
          .post('/v1/moment-logs')
          .set('Authorization', authHeader)
          .field('createdAt', new Date().toISOString())
          .field('moodTags', 'fresh')
          .field('placeName', `MIME 허용 테스트 ${mimeType}`)
          .attach('photo', fakeJpegBuffer(mimeType), {
            contentType: mimeType,
            filename: `allowed.${mimeType.split('/')[1]}`,
          });

        expect(response.status).toBe(201);
      }
    });
  });

  (useMockDb ? describe.skip : describe)('orphaned upload cleanup on failure', () => {
    it('deletes the newly uploaded file when creating the MomentLog row fails', async () => {
      const uploadDir = path.resolve(env.UPLOAD_DIRECTORY);
      const filesBefore = new Set(await fs.readdir(uploadDir));

      // createMomentLog writes the row inside `prisma.$transaction(async (transaction) =>
      // ...)`. The `transaction` client Prisma hands to that callback is a distinct proxy
      // per call, so spying on `prisma.momentLog.create` would never intercept it —
      // `$transaction` itself is the right interception point to simulate a failure deep
      // inside the write.
      const transactionSpy = vi
        .spyOn(prisma, '$transaction')
        .mockRejectedValueOnce(new Error('simulated DB failure'));

      try {
        const response = await request(app)
          .post('/v1/moment-logs')
          .set('Authorization', authHeader)
          .field('createdAt', new Date().toISOString())
          .field('moodTags', 'fresh')
          .field('placeName', 'DB 실패 정리 테스트')
          .attach('photo', fakeJpegBuffer('db-failure'), {
            contentType: 'image/jpeg',
            filename: 'db-failure.jpg',
          });

        expect(response.status).toBe(500);
      } finally {
        transactionSpy.mockRestore();
      }

      const filesAfter = new Set(await fs.readdir(uploadDir));
      expect(filesAfter.size).toBe(filesBefore.size);
    });

    it('deletes the newly uploaded replacement photo (keeping the original) when the photo-update transaction fails', async () => {
      const moment = await createTestMomentLog({
        authHeader,
        filename: 'photo-update-db-failure.jpg',
        placeName: 'DB 실패 시 교체 사진 정리 테스트',
      });
      const originalFileId = fileIdFromPhotoUrl(moment.photoUrl);

      const uploadDir = path.resolve(env.UPLOAD_DIRECTORY);
      const filesBefore = new Set(await fs.readdir(uploadDir));

      const transactionSpy = vi
        .spyOn(prisma, '$transaction')
        .mockRejectedValueOnce(new Error('simulated DB failure'));

      try {
        const response = await request(app)
          .put(`/v1/moment-logs/${moment.id}/photo`)
          .set('Authorization', authHeader)
          .attach('photo', fakeJpegBuffer('replacement-db-failure'), {
            contentType: 'image/jpeg',
            filename: 'replacement-db-failure.jpg',
          });

        expect(response.status).toBe(500);
      } finally {
        transactionSpy.mockRestore();
      }

      // The newly uploaded replacement file must not linger on disk...
      const filesAfter = new Set(await fs.readdir(uploadDir));
      expect(filesAfter.size).toBe(filesBefore.size);

      // ...and the original photo must still be intact and fetchable.
      const originalStillServed = await request(app)
        .get(`/v1/uploads/${originalFileId}`)
        .set('Authorization', authHeader);
      expect(originalStillServed.status).toBe(200);
    });
  });

  (useMockDb ? it.skip : it)(
    'deletes the orphaned upload file when an idempotent duplicate request is skipped',
    async () => {
      const uploadDir = path.resolve(env.UPLOAD_DIRECTORY);
      const idempotencyKey = `orphan-cleanup-${Date.now()}`;

      const filesBefore = new Set(await fs.readdir(uploadDir));

      const created = await request(app)
        .post('/v1/moment-logs')
        .set('Authorization', authHeader)
        .set('Idempotency-Key', idempotencyKey)
        .field('createdAt', new Date().toISOString())
        .field('moodTags', 'fresh')
        .field('placeName', '고아 파일 정리 테스트')
        .attach('photo', fakeJpegBuffer('fake-image-1'), {
          contentType: 'image/jpeg',
          filename: 'orphan-first.jpg',
        });
      expect(created.status).toBe(201);

      const filesAfterFirst = new Set(await fs.readdir(uploadDir));
      expect(filesAfterFirst.size).toBe(filesBefore.size + 1);

      const duplicate = await request(app)
        .post('/v1/moment-logs')
        .set('Authorization', authHeader)
        .set('Idempotency-Key', idempotencyKey)
        .field('createdAt', new Date().toISOString())
        .field('moodTags', 'fresh')
        .field('placeName', '고아 파일 정리 테스트(중복)')
        .attach('photo', fakeJpegBuffer('fake-image-2'), {
          contentType: 'image/jpeg',
          filename: 'orphan-duplicate.jpg',
        });
      expect(duplicate.status).toBe(201);
      expect(duplicate.body.data.id).toBe(created.body.data.id);

      // The duplicate request's upload must not be left behind on disk: the idempotency
      // short-circuit skips the DB write, so the file it wrote is never referenced by any
      // MomentLog row and should have been cleaned up.
      const filesAfterDuplicate = new Set(await fs.readdir(uploadDir));
      expect(filesAfterDuplicate.size).toBe(filesAfterFirst.size);
    },
  );

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
