#!/usr/bin/env node

const cliApiBaseUrl = process.argv.slice(2).find((arg) => arg !== '--');
const apiBaseUrl = (cliApiBaseUrl || process.env.PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
const errors = [];
let accessToken = process.env.PUBLIC_API_ACCESS_TOKEN;
let ownsContractUser = false;

if (!apiBaseUrl) {
  console.error(
    'Usage: PUBLIC_API_BASE_URL=https://api.soundlog.p-e.kr node scripts/check-public-api-contract.mjs',
  );
  process.exit(1);
}

function addError(message) {
  errors.push(message);
}

function withBase(path) {
  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

async function fetchText(path, options = {}) {
  const headers = {};

  if (options.authenticated) {
    if (!accessToken) {
      throw new Error(`${path} requires an authenticated contract session.`);
    }

    headers.Authorization = `Bearer ${accessToken}`;
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(withBase(path), {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method ?? 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();

  return { response, text };
}

async function fetchJson(path, options) {
  const { response, text } = await fetchText(path, options);

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 160)}`);
  }

  return JSON.parse(text);
}

async function createContractSession() {
  if (accessToken) {
    return;
  }

  try {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const payload = await fetchJson('/v1/auth/register', {
      body: {
        displayName: 'Soundlog Contract Check',
        email: `soundlog-contract-${uniqueId}@example.com`,
        password: 'SoundlogContract!2026',
        termsAccepted: true,
        termsVersion: '2026-08-15',
      },
      method: 'POST',
    });

    if (typeof payload?.data?.accessToken !== 'string') {
      addError('/v1/auth/register did not return an access token for contract checks.');
      return;
    }

    accessToken = payload.data.accessToken;
    ownsContractUser = true;
  } catch (error) {
    addError(error instanceof Error ? error.message : String(error));
  }
}

async function deleteContractUser() {
  if (!ownsContractUser || !accessToken) {
    return;
  }

  try {
    const { response, text } = await fetchText('/v1/me', {
      authenticated: true,
      method: 'DELETE',
    });

    if (!response.ok) {
      addError(`/v1/me cleanup returned HTTP ${response.status}: ${text.slice(0, 160)}`);
    }
  } catch (error) {
    addError(`Contract user cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    accessToken = undefined;
    ownsContractUser = false;
  }
}

async function verifyHealth() {
  try {
    const payload = await fetchJson('/v1/health');

    if (payload?.data?.status !== 'ok') {
      addError(`/v1/health returned unexpected payload: ${JSON.stringify(payload)}`);
    }
  } catch (error) {
    addError(error instanceof Error ? error.message : String(error));
  }
}

async function verifyOpenApi() {
  try {
    const { response, text } = await fetchText('/openapi.yaml');

    if (!response.ok) {
      addError(`/openapi.yaml returned HTTP ${response.status}.`);
    }

    const requiredPaths = [
      '/v1/auth/register:',
      '/v1/community/blocks:',
      '/v1/admin/moderation/reports:',
    ];

    if (
      !text.includes('openapi: 3.1.0') ||
      requiredPaths.some((path) => !text.includes(path))
    ) {
      addError('/openapi.yaml does not match the current SoundLogServer API contract.');
    }
  } catch (error) {
    addError(error instanceof Error ? error.message : String(error));
  }
}

async function verifyLegalPages() {
  const pages = [
    ['/legal/privacy', '개인정보 처리방침'],
    ['/legal/terms', '서비스 이용약관'],
    ['/support', '고객지원'],
  ];

  for (const [path, title] of pages) {
    try {
      const { response, text } = await fetchText(path);

      if (!response.ok) {
        addError(`${path} returned HTTP ${response.status}.`);
        continue;
      }
      if (!response.headers.get('content-type')?.includes('text/html')) {
        addError(`${path} did not return an HTML document.`);
      }
      if (!text.includes(`<h1>${title}</h1>`) || !text.includes('mailto:')) {
        addError(`${path} does not contain the expected public support content.`);
      }
    } catch (error) {
      addError(error instanceof Error ? error.message : String(error));
    }
  }
}

async function verifyModerationAuthBoundary() {
  try {
    const { response, text } = await fetchText('/v1/admin/moderation/reports');

    if (response.status !== 401) {
      addError(
        `/v1/admin/moderation/reports returned HTTP ${response.status}; expected 401 without the admin key. sample=${text.slice(0, 120)}`,
      );
    }
  } catch (error) {
    addError(error instanceof Error ? error.message : String(error));
  }
}

async function verifyNearbyPlaces() {
  try {
    const payload = await fetchJson(
      '/v1/tour/nearby-places?lat=35.1595&lng=129.1604&radiusMeters=2000&limit=1',
      { authenticated: true },
    );

    if (!Array.isArray(payload?.data)) {
      addError('/v1/tour/nearby-places returned a non-array data payload.');
      return;
    }

    const place = payload.data[0];

    if (!place) {
      return;
    }

    if (typeof place.id === 'string' && place.id.startsWith('mock-')) {
      addError('/v1/tour/nearby-places returned a legacy mock-* place id.');
    }

    if (place.source === 'mock') {
      addError('/v1/tour/nearby-places returned legacy source="mock".');
    }
  } catch (error) {
    addError(error instanceof Error ? error.message : String(error));
  }
}

async function verifyMusicMetadata() {
  try {
    const payload = await fetchJson(
      '/v1/home/mood-recommendations?limit=3&moodFilter=%EC%A0%84%EC%B2%B4&recommendationMode=everyday',
      { authenticated: true },
    );
    const serialized = JSON.stringify(payload?.data ?? {});

    if (serialized.includes('open.spotify.com') || /"spotify"\s*:/.test(serialized)) {
      addError('/v1/home/mood-recommendations still exposes Spotify metadata.');
    }

    if (/"previewUrl"\s*:/.test(serialized)) {
      addError('/v1/home/mood-recommendations still exposes streaming preview URLs.');
    }
  } catch (error) {
    addError(error instanceof Error ? error.message : String(error));
  }
}

async function verifyMlRecommendation() {
  try {
    const payload = await fetchJson(
      '/v1/recommendations/playlists?mood=%EC%9E%94%EC%9E%94%ED%95%9C&state=%EB%B0%94%EB%8B%A4&x=129.1186&y=35.1532',
      { authenticated: true },
    );
    const recommendation = payload?.data;

    if (recommendation?.context?.source !== 'ml-recommendation') {
      addError(
        `/v1/recommendations/playlists did not return the ML source: ${JSON.stringify(
          recommendation?.context ?? null,
        )}`,
      );
    }

    if (!Array.isArray(recommendation?.tracks) || recommendation.tracks.length === 0) {
      addError('/v1/recommendations/playlists returned no recommended tracks.');
    }

    if (!recommendation?.coverImageUrl?.startsWith('https://')) {
      addError('/v1/recommendations/playlists returned no HTTPS playlist cover image.');
    }
  } catch (error) {
    addError(error instanceof Error ? error.message : String(error));
  }
}

async function verifyPlaylistCatalog() {
  try {
    const payload = await fetchJson('/v1/playlists/jeju-island', {
      authenticated: true,
    });
    const playlist = payload?.data;

    if (playlist?.id !== 'jeju-island' || !Array.isArray(playlist.tracks) || playlist.tracks.length === 0) {
      addError('/v1/playlists/jeju-island did not return a seeded playlist with tracks.');
    }

    if (typeof playlist?.backgroundImageUrl !== 'string') {
      addError('/v1/playlists/jeju-island did not return a background image URL.');
    } else {
      const artworkPath = new URL(playlist.backgroundImageUrl, `${apiBaseUrl}/`).pathname;
      const { response } = await fetchText(artworkPath);

      if (!response.ok || response.headers.get('content-type') !== 'image/webp') {
        addError(`${artworkPath} did not return a WebP playlist image.`);
      }
    }

    const featuredPayload = await fetchJson(
      '/v1/home/featured-playlists?limit=20&locationRecommendationEnabled=true&recommendationMode=travel&lat=33.4996&lng=126.5312',
      { authenticated: true },
    );
    const featuredIds = new Set(
      Array.isArray(featuredPayload?.data)
        ? featuredPayload.data.map((item) => item?.id)
        : [],
    );

    if (
      !Array.isArray(featuredPayload?.data) ||
      featuredPayload.data.some((item) => typeof item?.coverImageUrl !== 'string')
    ) {
      addError('/v1/home/featured-playlists contains an item without a cover image URL.');
    }

    for (const regionalPlaylistId of ['jeju-island', 'gangneung-sea', 'yeosu-night-sea']) {
      if (!featuredIds.has(regionalPlaylistId)) {
        addError(`/v1/home/featured-playlists is missing ${regionalPlaylistId}.`);
      }
    }
  } catch (error) {
    addError(error instanceof Error ? error.message : String(error));
  }
}

async function verifyRemovedMusicPlatformRoute() {
  try {
    const { response, text } = await fetchText('/v1/me/music-platform', {
      authenticated: true,
    });

    if (response.status !== 404) {
      addError(
        `/v1/me/music-platform returned HTTP ${response.status}; expected 404 for removed music-platform API. sample=${text.slice(
          0,
          120,
        )}`,
      );
    }
  } catch (error) {
    addError(error instanceof Error ? error.message : String(error));
  }
}

await verifyHealth();
await verifyOpenApi();
await verifyLegalPages();
await verifyModerationAuthBoundary();
await createContractSession();

try {
  await verifyNearbyPlaces();
  await verifyMusicMetadata();
  await verifyMlRecommendation();
  await verifyPlaylistCatalog();
  await verifyRemovedMusicPlatformRoute();
} finally {
  await deleteContractUser();
}

if (errors.length > 0) {
  console.error('Public API contract check failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Public API contract check passed.');
