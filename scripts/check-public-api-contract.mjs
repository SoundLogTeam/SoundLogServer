#!/usr/bin/env node

const cliApiBaseUrl = process.argv.slice(2).find((arg) => arg !== '--');
const apiBaseUrl = (cliApiBaseUrl || process.env.PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
const errors = [];
let accessToken = process.env.PUBLIC_API_ACCESS_TOKEN;
let ownsContractUser = false;

if (!apiBaseUrl) {
  console.error(
    'Usage: PUBLIC_API_BASE_URL=https://soundlog.shop/api/soundlog node scripts/check-public-api-contract.mjs',
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

    if (!text.includes('openapi: 3.1.0') || !text.includes('/v1/auth/register')) {
      addError('/openapi.yaml does not match the current SoundLogServer API contract.');
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

async function verifyPlaylistCatalog() {
  try {
    const payload = await fetchJson('/v1/playlists/geoje-ocean', {
      authenticated: true,
    });
    const playlist = payload?.data;

    if (playlist?.id !== 'geoje-ocean' || !Array.isArray(playlist.tracks) || playlist.tracks.length === 0) {
      addError('/v1/playlists/geoje-ocean did not return a seeded playlist with tracks.');
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
await createContractSession();

try {
  await verifyNearbyPlaces();
  await verifyMusicMetadata();
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
