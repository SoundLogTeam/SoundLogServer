#!/usr/bin/env node

const cliApiBaseUrl = process.argv.slice(2).find((arg) => arg !== '--');
const apiBaseUrl = (cliApiBaseUrl || process.env.PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
const errors = [];

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

async function fetchText(path) {
  const response = await fetch(withBase(path), {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();

  return { response, text };
}

async function fetchJson(path) {
  const { response, text } = await fetchText(path);

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 160)}`);
  }

  return JSON.parse(text);
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
      '/v1/home/mood-recommendations?limit=3&moodFilter=%EC%A0%84%EC%B2%B4&recommendationMode=everyday&topFilter=%EC%A0%84%EC%B2%B4',
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

async function verifyRemovedMusicPlatformRoute() {
  try {
    const { response, text } = await fetchText('/v1/me/music-platform');

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
await verifyNearbyPlaces();
await verifyMusicMetadata();
await verifyRemovedMusicPlatformRoute();

if (errors.length > 0) {
  console.error('Public API contract check failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Public API contract check passed.');
