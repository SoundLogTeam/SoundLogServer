import { env } from '../config/env.js';

type AddressDetails = Record<string, unknown>;

type NominatimReverseResponse = {
  address?: AddressDetails;
  display_name?: unknown;
  name?: unknown;
  namedetails?: AddressDetails;
  place_id?: unknown;
};

export type ReverseGeocodedPlace = {
  address?: string;
  attribution: string;
  category: string;
  id: string;
  location: {
    lat: number;
    lng: number;
  };
  source: 'reverse-geocode';
  title: string;
};

type CacheEntry = {
  expiresAt: number;
  value: ReverseGeocodedPlace | null;
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 5_000;
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
const cache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<ReverseGeocodedPlace | null>>();

let lastRequestStartedAt = 0;
let requestQueue: Promise<void> = Promise.resolve();

function asNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function firstString(source: AddressDetails | undefined, keys: string[]) {
  return keys.map((key) => asNonEmptyString(source?.[key])).find(Boolean);
}

function createCacheKey(lat: number, lng: number) {
  return `${lat.toFixed(4)}:${lng.toFixed(4)}`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function scheduleRequest<T>(request: () => Promise<T>) {
  let resolveResult: (value: T | PromiseLike<T>) => void;
  let rejectResult: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  requestQueue = requestQueue
    .catch(() => undefined)
    .then(async () => {
      const waitTime = Math.max(
        MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestStartedAt),
        0,
      );

      if (waitTime > 0) {
        await wait(waitTime);
      }

      lastRequestStartedAt = Date.now();

      try {
        resolveResult(await request());
      } catch (error) {
        rejectResult(error);
      }
    });

  return result;
}

function normalizeReverseResult(
  data: NominatimReverseResponse,
  location: { lat: number; lng: number },
): ReverseGeocodedPlace | null {
  const address = data.address;
  const koreanName = asNonEmptyString(data.namedetails?.['name:ko']);
  const title =
    koreanName ??
    firstString(address, [
      'neighbourhood',
      'quarter',
      'suburb',
      'borough',
      'city_district',
      'village',
      'town',
      'city',
      'municipality',
      'county',
      'state',
      'country',
    ]) ??
    asNonEmptyString(data.name);

  if (!title) {
    return null;
  }

  const addressText = asNonEmptyString(data.display_name);
  const placeId = asNonEmptyString(data.place_id) ?? createCacheKey(location.lat, location.lng);

  return {
    address: addressText,
    attribution: OSM_ATTRIBUTION,
    category: '현재 지역',
    id: `reverse-${placeId}`,
    location,
    source: 'reverse-geocode',
    title,
  };
}

async function fetchReverseGeocodedPlace(location: {
  lat: number;
  lng: number;
}) {
  const endpoint = `${env.REVERSE_GEOCODING_BASE_URL.replace(/\/$/, '')}/reverse`;
  const query = new URLSearchParams({
    'accept-language': 'ko,en',
    addressdetails: '1',
    format: 'jsonv2',
    lat: String(location.lat),
    layer: 'address',
    lon: String(location.lng),
    namedetails: '1',
    zoom: '14',
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${endpoint}?${query}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'ko,en;q=0.8',
        'User-Agent': env.REVERSE_GEOCODING_USER_AGENT,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return normalizeReverseResult(
      (await response.json()) as NominatimReverseResponse,
      location,
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function reverseGeocodeLocation(location: {
  lat: number;
  lng: number;
}) {
  const cacheKey = createCacheKey(location.lat, location.lng);
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const pending = pendingRequests.get(cacheKey);

  if (pending) {
    return pending;
  }

  const request = scheduleRequest(() => fetchReverseGeocodedPlace(location))
    .then((value) => {
      cache.set(cacheKey, {
        expiresAt:
          Date.now() + (value ? CACHE_TTL_MS : FAILURE_CACHE_TTL_MS),
        value,
      });
      return value;
    })
    .finally(() => {
      pendingRequests.delete(cacheKey);
    });

  pendingRequests.set(cacheKey, request);
  return request;
}
