import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { resetMockDb } from '../src/mock/mock-db.js';
import { disconnectSeedDatabase, seedDatabase } from '../prisma/seed.js';

const app = createApp();
const useMockDb = process.env.USE_MOCK_DB === 'true';

async function getToken() {
  const response = await request(app).post('/v1/auth/social-login').send({
    provider: 'google',
    providerAccessToken: 'local-dev-token',
    device: {
      deviceId: 'local-soundlog-user',
      platform: 'web',
    },
  });

  expect(response.status).toBe(200);
  expect(response.body.data.user.id).toEqual(expect.any(String));
  return response.body.data.accessToken as string;
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

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns JSON not found for unknown routes', async () => {
    const response = await request(app).get('/v1/no-such-route');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('refreshes auth tokens', async () => {
    const login = await request(app).post('/v1/auth/social-login').send({
      provider: 'google',
      providerAccessToken: 'refresh-dev-token',
      device: {
        deviceId: 'refresh-user',
        platform: 'web',
      },
    });
    const response = await request(app).post('/v1/auth/refresh').send({
      refreshToken: login.body.data.refreshToken,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.user.id).toEqual(expect.any(String));
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

    const login = await request(app).post('/v1/auth/social-login').send({
      provider: 'kakao',
      providerAccessToken: 'logout-dev-token',
    });
    const logout = await request(app).post('/v1/auth/logout').send({
      refreshToken: login.body.data.refreshToken,
    });
    expect(logout.status).toBe(202);
    expect(logout.body.data.accepted).toBe(true);
  });

  it('handles profile and music platform APIs', async () => {
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

    const platform = await request(app)
      .get('/v1/me/music-platform')
      .set('Authorization', authHeader);
    expect(platform.status).toBe(200);

    const updatedPlatform = await request(app)
      .put('/v1/me/music-platform')
      .set('Authorization', authHeader)
      .send({ selectedPlatformId: 'spotify', connected: true });
    expect(updatedPlatform.status).toBe(200);
    expect(updatedPlatform.body.data.selectedPlatformId).toBe('spotify');
  });

  it('returns tour and home data', async () => {
    const tour = await request(app).get('/v1/tour/nearby-places').query({
      lat: 35.1532,
      lng: 129.1186,
      limit: 2,
    });
    expect(tour.status).toBe(200);
    expect(tour.body.data[0].id).toContain('mock-');

    const featured = await request(app)
      .get('/v1/home/featured-playlists')
      .set('Authorization', authHeader)
      .query({ locationRecommendationEnabled: true, lat: 35.1532, lng: 129.1186 });
    expect(featured.status).toBe(200);
    expect(featured.body.data.length).toBeGreaterThan(0);

    const publicFeatured = await request(app)
      .get('/v1/home/featured-playlists')
      .query({ locationRecommendationEnabled: true, recommendationMode: 'travel', lat: 35.1532, lng: 129.1186 });
    expect(publicFeatured.status).toBe(200);
    expect(publicFeatured.body.data[0].id).toBe('busan-ocean');

    const mood = await request(app)
      .get('/v1/home/mood-recommendations')
      .set('Authorization', authHeader)
      .query({ topFilter: '청량한', moodFilter: '전체', preferredGenres: 'K-POP' });
    expect(mood.status).toBe(200);
    expect(mood.body.data[0].track).toBeDefined();

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
        moodTags: ['fresh'],
        travelMode: 'ocean',
      });
    expect(contextual.status).toBe(201);
    expect(contextual.body.data.tracks.length).toBeGreaterThan(0);

    const detail = await request(app)
      .get('/v1/playlists/busan-ocean')
      .set('Authorization', authHeader);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe('busan-ocean');

    const publicDetail = await request(app).get('/v1/playlists/busan-ocean');
    expect(publicDetail.status).toBe(200);
    expect(publicDetail.body.data.id).toBe('busan-ocean');
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
    expect(list.body.data.some((item: { track: { id: string } }) => item.track.id === 'moon-seoul')).toBe(true);
  });

  it('handles moment log APIs', async () => {
    const idempotencyKey = `moment-${Date.now()}`;
    const created = await request(app)
      .post('/v1/moment-logs')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .field('createdAt', new Date().toISOString())
      .field('moodTags', 'fresh,calm')
      .field('placeName', '테스트 장소')
      .field('trackId', 'seoul-city')
      .attach('photo', Buffer.from('fake-image'), {
        filename: 'moment.jpg',
        contentType: 'image/jpeg',
      });

    expect(created.status).toBe(201);
    expect(created.body.data.photoUrl).toContain('/uploads/');

    const duplicate = await request(app)
      .post('/v1/moment-logs')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .field('createdAt', new Date().toISOString())
      .field('moodTags', 'fresh')
      .field('placeName', '중복 요청 장소')
      .field('trackId', 'seoul-city')
      .attach('photo', Buffer.from('fake-image'), {
        filename: 'moment-duplicate.jpg',
        contentType: 'image/jpeg',
      });
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.data.id).toBe(created.body.data.id);

    const list = await request(app)
      .get('/v1/moment-logs')
      .set('Authorization', authHeader);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
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
            type: 'track_play',
            trackId: 'seoul-city',
            playlistId: 'seoul-night',
            context: { moodFilter: '전체' },
            createdAt: new Date().toISOString(),
          },
        ],
      });

    expect(response.status).toBe(202);
    expect(response.body.data.accepted).toBe(true);
  });

  it('handles recap APIs', async () => {
    const list = await request(app).get('/v1/recaps').set('Authorization', authHeader);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);

    const idempotencyKey = `recap-${Date.now()}`;
    const created = await request(app)
      .post('/v1/recaps')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({ templateId: 'album', sessionId: 'seed-session', title: '테스트 리캡' });
    expect(created.status).toBe(201);
    createdRecapId = created.body.data.id;
    expect(created.body.data.representativeTrack.id).toBe('seoul-night-track');

    const duplicate = await request(app)
      .post('/v1/recaps')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({ templateId: 'album', sessionId: 'seed-session', title: '중복 리캡' });
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

  it('returns regional trends without auth', async () => {
    const response = await request(app)
      .get('/v1/trends/regions/KR-26/sound')
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
