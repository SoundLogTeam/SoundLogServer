#!/usr/bin/env node

const apiBaseUrl = (
  process.argv.slice(2).find((argument) => argument !== '--') ||
  process.env.LIVE_API_BASE_URL ||
  'http://127.0.0.1:4000'
).replace(/\/+$/, '');
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = 'SoundlogLive!2026';
const users = [];
const passedSteps = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(path, options = {}) {
  const headers = {};
  let body;

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    body,
    headers,
    method: options.method ?? 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }

  const expectedStatuses = Array.isArray(options.expectedStatus)
    ? options.expectedStatus
    : [options.expectedStatus ?? 200];

  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} returned HTTP ${response.status}: ${text.slice(0, 300)}`,
    );
  }

  return { payload, response };
}

async function step(name, callback) {
  await callback();
  passedSteps.push(name);
  console.log(`PASS ${name}`);
}

async function registerUser(label) {
  const email = `live-${label}-${runId}@soundlog.test`;
  const { payload } = await request('/v1/auth/register', {
    body: {
      displayName: `Live ${label}`,
      email,
      password,
    },
    expectedStatus: 201,
    method: 'POST',
  });
  const user = {
    accessToken: payload?.data?.accessToken,
    email,
    id: payload?.data?.user?.id,
    refreshToken: payload?.data?.refreshToken,
  };

  assert(typeof user.accessToken === 'string', `${label} access token is missing.`);
  assert(typeof user.refreshToken === 'string', `${label} refresh token is missing.`);
  assert(typeof user.id === 'string', `${label} user id is missing.`);
  users.push(user);
  return user;
}

function createPhotoForm(fields, filename) {
  const form = new FormData();
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined) {
      form.set(key, String(value));
    }
  });
  form.set('photo', new Blob([fakeJpeg], { type: 'image/jpeg' }), filename);
  return form;
}

async function cleanupUsers() {
  for (const user of users.reverse()) {
    if (!user.accessToken) {
      continue;
    }

    try {
      await request('/v1/me', {
        expectedStatus: [200, 401],
        method: 'DELETE',
        token: user.accessToken,
      });
    } catch (error) {
      console.error(`WARN cleanup ${user.email}: ${error instanceof Error ? error.message : error}`);
    }
  }
}

let primary;
let companion;

try {
  await step('system health, OpenAPI, docs, and DB write', async () => {
    const health = await request('/v1/health');
    assert(health.payload?.data?.status === 'ok', 'Health status is not ok.');
    assert(health.payload?.data?.database === 'ok', 'Database status is not ok.');

    const openApi = await request('/openapi.yaml');
    assert(String(openApi.payload).includes('openapi: 3.1.0'), 'OpenAPI document is missing.');
    await request('/docs/', { expectedStatus: 200 });

    const dbRecord = await request('/v1/dev/db-test-records', {
      body: { label: `live-e2e-${runId}`, payload: { source: 'check-live-e2e' } },
      expectedStatus: 201,
      method: 'POST',
    });
    assert(dbRecord.payload?.data?.id, 'DB test write did not return an id.');
  });

  await step('register, login, refresh, profile, and migration', async () => {
    primary = await registerUser('primary');
    companion = await registerUser('companion');

    const login = await request('/v1/auth/login', {
      body: { email: primary.email, password },
      method: 'POST',
    });
    assert(login.payload?.data?.user?.id === primary.id, 'Login returned another user.');

    const refresh = await request('/v1/auth/refresh', {
      body: { refreshToken: primary.refreshToken },
      method: 'POST',
    });
    primary.accessToken = refresh.payload?.data?.accessToken;
    primary.refreshToken = refresh.payload?.data?.refreshToken;
    assert(typeof primary.accessToken === 'string', 'Refresh did not rotate the access token.');

    await request('/v1/me/profile', {
      body: {
        companionType: 'friends',
        dislikedArtists: [],
        locationRecommendationEnabled: true,
        preferredGenres: ['K-POP', '인디'],
        preferredMoods: ['잔잔한', '시원한'],
        travelStyles: ['산책', '바다'],
      },
      method: 'PUT',
      token: primary.accessToken,
    });
    const me = await request('/v1/me', { token: primary.accessToken });
    assert(me.payload?.data?.profile?.completedOnboarding === true, 'Profile was not completed.');

    await request('/v1/me/migrate-local-data', {
      body: {
        idempotencyKey: `live-migration-${runId}`,
        libraryTrackCount: 1,
        momentLogCount: 2,
        recapDraftCount: 1,
      },
      method: 'POST',
      token: primary.accessToken,
    });
  });

  await step('tour, home, playlist, recommendation, trend, and library', async () => {
    const search = await request('/v1/tour/places?query=%EA%B4%91%EC%95%88%EB%A6%AC&limit=5', {
      token: primary.accessToken,
    });
    assert(Array.isArray(search.payload?.data), 'Tour search did not return an array.');

    const nearby = await request(
      '/v1/tour/nearby-places?lat=35.1532&lng=129.1186&radiusMeters=2000&limit=5',
      { token: primary.accessToken },
    );
    assert(Array.isArray(nearby.payload?.data), 'Nearby places did not return an array.');
    await request('/v1/tour/reverse-geocode?lat=37.5512&lng=126.9882', {
      token: primary.accessToken,
    });

    const featured = await request(
      '/v1/home/featured-playlists?locationRecommendationEnabled=true&recommendationMode=everyday&lat=35.1532&lng=129.1186',
      { token: primary.accessToken },
    );
    assert(Array.isArray(featured.payload?.data), 'Featured playlists did not return an array.');

    const moods = await request(
      '/v1/home/mood-recommendations?moodFilter=%EC%A0%84%EC%B2%B4&limit=4',
      { token: primary.accessToken },
    );
    assert(Array.isArray(moods.payload?.data), 'Mood recommendations did not return an array.');

    const contextual = await request('/v1/playlists/contextual', {
      body: {
        location: { lat: 35.1532, lng: 129.1186 },
        mood: '시원한',
        moodTags: ['fresh'],
        state: '바다',
        travelMode: 'ocean',
      },
      expectedStatus: 201,
      method: 'POST',
      timeoutMs: 20_000,
      token: primary.accessToken,
    });
    assert(contextual.payload?.data?.tracks?.length > 0, 'Contextual playlist has no tracks.');

    const recommended = await request(
      '/v1/recommendations/playlists?mood=%EC%8B%9C%EC%9B%90%ED%95%9C&state=%EB%B0%94%EB%8B%A4&x=129.1186&y=35.1532',
      { timeoutMs: 20_000, token: primary.accessToken },
    );
    assert(recommended.payload?.data?.tracks?.length > 0, 'Recommended playlist has no tracks.');

    const playlist = await request('/v1/playlists/busan-ocean', {
      token: primary.accessToken,
    });
    assert(playlist.payload?.data?.tracks?.length > 0, 'Seed playlist has no tracks.');

    await request('/v1/library/tracks/seoul-city', {
      body: { action: 'like', playlistId: 'seoul-night' },
      method: 'PUT',
      token: primary.accessToken,
    });
    const library = await request('/v1/library/tracks?kind=liked', {
      token: primary.accessToken,
    });
    assert(
      library.payload?.data?.some((track) => track.id === 'seoul-city'),
      'Liked track is missing from the library.',
    );

    const trend = await request('/v1/trends/regions/KR-26/sound?period=weekly', {
      token: primary.accessToken,
    });
    assert(trend.payload?.data?.regionCode === 'KR-26', 'Regional trend is incorrect.');
  });

  let primarySessionId;
  let companionSessionId;
  let firstCaptureId;
  let secondCaptureId;
  let recapId;

  await step('travel session, recap capture, log, marker, and sharing', async () => {
    const startedAt = new Date().toISOString();
    const primarySession = await request('/v1/travel-sessions', {
      body: {
        location: { lat: 37.5512, lng: 126.9882 },
        startedAt,
        travelMode: 'walk',
      },
      expectedStatus: 201,
      method: 'POST',
      token: primary.accessToken,
    });
    primarySessionId = primarySession.payload?.data?.id;
    assert(primarySessionId, 'Primary travel session was not created.');

    const firstCapture = await request('/v1/recap-captures', {
      expectedStatus: 201,
      form: createPhotoForm(
        {
          createdAt: new Date().toISOString(),
          lat: 37.5512,
          lng: 126.9882,
          moodTags: 'calm,fresh',
          note: '남산에서 만든 라이브 E2E 리캡',
          placeName: '남산서울타워',
          sessionId: primarySessionId,
          templateId: 'map',
          trackId: 'seoul-city',
          travelMode: 'walk',
          visibility: 'public',
        },
        `live-first-${runId}.jpg`,
      ),
      method: 'POST',
      token: primary.accessToken,
    });
    firstCaptureId = firstCapture.payload?.data?.id;

    const secondCapture = await request('/v1/moment-logs', {
      expectedStatus: 201,
      form: createPhotoForm(
        {
          createdAt: new Date(Date.now() + 1000).toISOString(),
          lat: 37.552,
          lng: 126.989,
          moodTags: 'emotional',
          note: '두 번째 실제 DB 리캡',
          placeName: '남산 산책로',
          sessionId: primarySessionId,
          templateId: 'film',
          trackId: 'night-letter',
          travelMode: 'walk',
          visibility: 'public',
        },
        `live-second-${runId}.jpg`,
      ),
      method: 'POST',
      token: primary.accessToken,
    });
    secondCaptureId = secondCapture.payload?.data?.id;
    assert(firstCaptureId && secondCaptureId, 'Recap captures were not created.');

    await request(`/v1/recap-captures/${firstCaptureId}`, {
      body: { note: '수정된 라이브 리캡', templateId: 'album' },
      method: 'PATCH',
      token: primary.accessToken,
    });
    await request(`/v1/recap-captures/${firstCaptureId}/photo`, {
      form: createPhotoForm({}, `live-replaced-${runId}.jpg`),
      method: 'PUT',
      token: primary.accessToken,
    });

    const captures = await request(`/v1/recap-captures?sessionId=${primarySessionId}`, {
      token: primary.accessToken,
    });
    assert(captures.payload?.data?.length === 2, 'Session recap capture count is not 2.');

    await request('/v1/recommendation-events', {
      body: {
        events: [
          {
            context: { placeName: '남산서울타워', recommendationMode: 'everyday' },
            createdAt: new Date().toISOString(),
            id: `live-event-${runId}`,
            sessionId: primarySessionId,
            trackId: 'seoul-city',
            type: 'moment_log_saved',
          },
        ],
      },
      expectedStatus: 202,
      method: 'POST',
      token: primary.accessToken,
    });

    const recap = await request('/v1/recaps', {
      body: {
        momentLogIds: [firstCaptureId, secondCaptureId],
        sessionId: primarySessionId,
        templateId: 'map',
        title: '라이브 남산 사운드 로그',
        visibility: 'public',
      },
      expectedStatus: 201,
      method: 'POST',
      token: primary.accessToken,
    });
    recapId = recap.payload?.data?.id;
    assert(recapId, 'Travel log was not created.');

    const mine = await request('/v1/recaps?scope=mine', { token: primary.accessToken });
    assert(mine.payload?.data?.some((item) => item.id === recapId), 'Created log is missing.');
    const share = await request(`/v1/recaps/${recapId}/share`, {
      token: primary.accessToken,
    });
    assert(share.payload?.data?.moments?.length === 2, 'Log detail does not contain two recaps.');
    assert(share.payload?.data?.routePoints !== undefined, 'Owner route points are missing.');

    const markers = await request(
      '/v1/recap-markers?scope=public&lat=37.552&lng=126.989&radiusMeters=300',
      { token: companion.accessToken },
    );
    assert(
      markers.payload?.data?.some((marker) => marker.recapId === recapId),
      'Public recap marker is missing for another user.',
    );

    await request(`/v1/recaps/${recapId}/share-events`, {
      body: { createdAt: new Date().toISOString(), type: 'save_image' },
      expectedStatus: 202,
      method: 'POST',
      token: primary.accessToken,
    });
    await request(`/v1/recaps/${recapId}/visibility`, {
      body: { visibility: 'private' },
      method: 'PATCH',
      token: primary.accessToken,
    });
    await request(`/v1/recaps/${recapId}/visibility`, {
      body: { visibility: 'public' },
      method: 'PATCH',
      token: primary.accessToken,
    });
  });

  await step('travel room, collaborative recap, sound map, matching, and safety', async () => {
    const companionSession = await request('/v1/travel-sessions', {
      body: {
        location: { lat: 37.5522, lng: 126.9892 },
        travelMode: 'walk',
      },
      expectedStatus: 201,
      method: 'POST',
      token: companion.accessToken,
    });
    companionSessionId = companionSession.payload?.data?.id;

    const room = await request('/v1/travel-rooms', {
      body: { sessionId: primarySessionId, title: '라이브 남산 여행방' },
      expectedStatus: 201,
      method: 'POST',
      token: primary.accessToken,
    });
    const roomId = room.payload?.data?.id;
    const inviteCode = room.payload?.data?.inviteCode;
    assert(roomId && inviteCode, 'Travel room id or invite code is missing.');

    const joined = await request('/v1/travel-rooms/join', {
      body: { displayName: 'Live Companion', inviteCode: inviteCode.toLowerCase() },
      method: 'POST',
      token: companion.accessToken,
    });
    assert(joined.payload?.data?.memberCount === 2, 'Companion did not join the room.');
    await request(`/v1/travel-rooms/${roomId}`, { token: primary.accessToken });
    const rooms = await request(`/v1/travel-rooms?sessionId=${primarySessionId}`, {
      token: primary.accessToken,
    });
    assert(rooms.payload?.data?.some((item) => item.id === roomId), 'Room list is missing the room.');

    const roomMoment = await request(`/v1/travel-rooms/${roomId}/moments`, {
      body: {
        note: '동행자가 고른 남산 리캡',
        placeName: '남산 산책로',
        status: 'candidate',
        trackId: 'night-letter',
      },
      expectedStatus: 201,
      method: 'POST',
      token: companion.accessToken,
    });
    const roomMomentId = roomMoment.payload?.data?.id;
    await request(`/v1/travel-rooms/${roomId}/moments/${roomMomentId}`, {
      body: { status: 'accepted' },
      method: 'PATCH',
      token: primary.accessToken,
    });
    await request(`/v1/travel-rooms/${roomId}/moments/${roomMomentId}/comments`, {
      body: { body: '이 리캡을 공동 로그 대표로 사용해요.' },
      expectedStatus: 201,
      method: 'POST',
      token: primary.accessToken,
    });
    const collaborativeRecap = await request(`/v1/travel-rooms/${roomId}/recaps`, {
      body: { templateId: 'album', title: '라이브 공동 로그' },
      expectedStatus: 201,
      method: 'POST',
      token: primary.accessToken,
    });
    assert(collaborativeRecap.payload?.data?.roomId === roomId, 'Collaborative recap is invalid.');

    const companionPin = await request('/v1/sound-map/current-track', {
      body: {
        location: { lat: 37.5522, lng: 126.9892 },
        moodTags: ['calm'],
        placeName: '남산 산책로',
        sessionId: companionSessionId,
        trackId: 'night-letter',
        travelMode: 'walk',
        visibility: 'nearby',
      },
      expectedStatus: 202,
      method: 'POST',
      token: companion.accessToken,
    });
    const companionPinId = companionPin.payload?.data?.id;

    await request('/v1/sound-map/current-track', {
      body: {
        location: { lat: 37.5512, lng: 126.9882 },
        moodTags: ['fresh'],
        placeName: '남산서울타워',
        sessionId: primarySessionId,
        trackId: 'seoul-city',
        travelMode: 'walk',
        visibility: 'companions',
      },
      expectedStatus: 202,
      method: 'POST',
      token: primary.accessToken,
    });

    const soundMap = await request(
      '/v1/sound-map?lat=37.5512&lng=126.9882&radiusMeters=3000',
      { token: primary.accessToken },
    );
    assert(soundMap.payload?.data?.length >= 2, 'Sound map does not contain both users.');

    const nearby = await request(
      '/v1/sound-map/nearby?lat=37.5512&lng=126.9882&mood=%EC%9E%94%EC%9E%94%ED%95%9C&state=%EC%82%B0%EC%B1%85',
      { token: primary.accessToken },
    );
    assert(
      nearby.payload?.data?.some((item) => item.targetPinId === companionPinId),
      'Nearby sound did not return the companion.',
    );
    const matches = await request(
      '/v1/music-matches?lat=37.5512&lng=126.9882&mood=%EC%9E%94%EC%9E%94%ED%95%9C&state=%EC%82%B0%EC%B1%85',
      { token: primary.accessToken },
    );
    assert(
      matches.payload?.data?.some((item) => item.targetPinId === companionPinId),
      'Music match did not return the companion.',
    );

    const mateRequest = await request('/v1/travel-mate-requests', {
      body: { messageTemplate: 'walk_together', targetPinId: companionPinId },
      expectedStatus: 201,
      method: 'POST',
      token: primary.accessToken,
    });
    const mateRequestId = mateRequest.payload?.data?.id;
    const inbox = await request('/v1/travel-mate-requests?box=inbox&status=pending', {
      token: companion.accessToken,
    });
    assert(inbox.payload?.data?.some((item) => item.id === mateRequestId), 'Mate request is not in inbox.');
    await request(`/v1/travel-mate-requests/${mateRequestId}`, {
      body: { action: 'accept' },
      method: 'PATCH',
      token: companion.accessToken,
    });

    await request('/v1/community/reports', {
      body: {
        details: '라이브 E2E 안전 신고 검증',
        reason: 'other',
        targetPinId: companionPinId,
        targetUserId: companion.id,
      },
      expectedStatus: 202,
      method: 'POST',
      token: primary.accessToken,
    });
    await request('/v1/community/blocks', {
      body: { targetPinId: companionPinId },
      expectedStatus: 202,
      method: 'POST',
      token: primary.accessToken,
    });
    const hiddenMatches = await request(
      '/v1/music-matches?lat=37.5512&lng=126.9882&mood=%EC%9E%94%EC%9E%94%ED%95%9C&state=%EC%82%B0%EC%B1%85',
      { token: primary.accessToken },
    );
    assert(
      !hiddenMatches.payload?.data?.some((item) => item.targetPinId === companionPinId),
      'Blocked user is still visible in matches.',
    );
  });

  await step('travel completion, recent logs, photo deletion, and logout', async () => {
    await request(`/v1/travel-sessions/${primarySessionId}`, {
      body: {
        endedAt: new Date().toISOString(),
        routePoints: [
          { lat: 37.5512, lng: 126.9882, recordedAt: new Date().toISOString() },
          { lat: 37.552, lng: 126.989, recordedAt: new Date(Date.now() + 1000).toISOString() },
        ],
        status: 'ended',
      },
      method: 'PATCH',
      token: primary.accessToken,
    });
    await request(`/v1/travel-sessions/${companionSessionId}`, {
      body: { endedAt: new Date().toISOString(), status: 'ended' },
      method: 'PATCH',
      token: companion.accessToken,
    });

    const recent = await request('/v1/home/recent-music-logs?limit=5', {
      token: primary.accessToken,
    });
    assert(Array.isArray(recent.payload?.data), 'Recent music logs did not return an array.');

    await request(`/v1/recap-captures/${firstCaptureId}/photo`, {
      expectedStatus: 200,
      method: 'DELETE',
      token: primary.accessToken,
    });
    await request('/v1/auth/logout', {
      body: { refreshToken: primary.refreshToken },
      expectedStatus: 202,
      method: 'POST',
    });
  });

  console.log(`Live API E2E passed (${passedSteps.length} feature groups) against ${apiBaseUrl}.`);
} catch (error) {
  console.error(`Live API E2E failed after ${passedSteps.length} passed groups.`);
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  await cleanupUsers();
}
