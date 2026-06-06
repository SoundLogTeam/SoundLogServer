import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { disconnectSeedDatabase, seedDatabase } from '../prisma/seed.js';

const app = createApp();

async function getToken() {
  const response = await request(app).post('/v1/auth/social-login').send({
    provider: 'google',
    providerToken: 'local-dev-token',
    deviceId: 'local-soundlog-user',
  });

  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

describe('Soundlog API', () => {
  let accessToken: string;
  let authHeader: string;
  let createdSessionId: string;
  let createdRecapId: string;

  beforeAll(async () => {
    await seedDatabase();
    accessToken = await getToken();
    authHeader = `Bearer ${accessToken}`;
  });

  it('returns health without auth', async () => {
    const response = await request(app).get('/v1/health');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
  });

  it('rejects protected endpoints without bearer token', async () => {
    const response = await request(app).get('/v1/me/profile');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('refreshes auth tokens', async () => {
    const login = await request(app).post('/v1/auth/social-login').send({
      provider: 'google',
      providerToken: 'refresh-dev-token',
      deviceId: 'refresh-user',
    });
    const response = await request(app).post('/v1/auth/refresh').send({
      refreshToken: login.body.data.refreshToken,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toEqual(expect.any(String));
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
    const created = await request(app)
      .post('/v1/moment-logs')
      .set('Authorization', authHeader)
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

    const created = await request(app)
      .post('/v1/recaps')
      .set('Authorization', authHeader)
      .send({ templateId: 'album', sessionId: 'seed-session', title: '테스트 리캡' });
    expect(created.status).toBe(201);
    createdRecapId = created.body.data.id;

    const share = await request(app)
      .get(`/v1/recaps/${createdRecapId}/share`)
      .set('Authorization', authHeader);
    expect(share.status).toBe(200);
    expect(share.body.data.id).toBe(createdRecapId);

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
    await seedDatabase();
    await disconnectSeedDatabase();
    await prisma.$disconnect();
  });
});
