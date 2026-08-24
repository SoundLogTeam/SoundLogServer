import {
  Prisma,
  type LibraryTrackState,
  type MomentLog,
  type MoodRecommendation,
  type Place,
  type Playlist,
  type PlaylistTrack,
  type Recap,
  type RegionSoundTrend,
  type SoundMapPin,
  type Track,
  type TravelMateRequest,
  type TravelRoom,
  type TravelRoomMember,
  type TravelRoomMoment,
  type TravelRoomMomentComment,
  type TravelSession,
  type UserProfile,
} from '@prisma/client';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { env } from '../config/env.js';
import { ERROR_MESSAGES } from '../constants/error.constants.js';
import { prisma } from '../config/prisma.js';
import { getLimit, paginateByCursor } from '../utils/pagination.js';
import { createPublicId } from '../utils/tokens.js';
import { badRequest, forbidden, notFound } from '../utils/http-error.js';
import { reverseGeocodeLocation } from './reverse-geocoding.service.js';

type MaybeUser = { id: string } | undefined;

type TrackDto = {
  id: string;
  title: string;
  artist: string;
  fallbackColor?: string;
  albumImageUrl?: string;
  externalUrl?: string;
  platformUrls?: Record<string, string>;
  isLiked?: boolean;
  isSaved?: boolean;
};

const NO_MUSIC_TRACK_ID = 'soundlog-no-music';

type RecommendationContext = Record<string, unknown>;
type CommunityVisibility = 'companions' | 'nearby' | 'private';
type RecapListScope = 'all' | 'mine' | 'others';
type RecapMapScope = 'mine' | 'public';
type RecapVisibility = 'private' | 'public';
type RoutePointDto = {
  accuracyMeters?: number;
  lat: number;
  lng: number;
  recordedAt: string;
};
type RoomWithCommunity = TravelRoom & {
  members: TravelRoomMember[];
  moments: Array<TravelRoomMoment & { comments?: TravelRoomMomentComment[] }>;
};
type SoundMapPinWithUser = SoundMapPin & {
  user: {
    displayName: string | null;
    profile: {
      preferredGenres: string[];
      preferredMoods: string[];
      travelStyles: string[];
    } | null;
  };
};

type TourApiResponse = {
  response?: {
    body?: {
      items?: {
        item?: unknown;
      };
    };
    header?: {
      resultCode?: string;
    };
  };
};

type MlTravelState = '바다' | '드라이브' | '산책' | '카페' | '야경';
type MlMood = '잔잔한' | '신나는' | '시원한' | '설레는' | '감성적인';

const RECAP_DISCOVERY_RADIUS_METERS = 300;

type MlRecommendationResponse = {
  backgroundImageUrl?: string | null;
  tracks?: unknown;
};

type MlPlaylistDto = {
  backgroundImageUrl?: string;
  context: RecommendationContext;
  coverImageUrl?: string;
  durationText: string;
  id: string;
  placeName?: string;
  reason: string;
  regionName: string;
  trackCount: number;
  tracks: TrackDto[];
};

const TRAVEL_MATE_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const CLOSED_TRAVEL_MATE_REQUEST_STATUSES = ['cancelled', 'declined', 'expired'];

type ContextualPlaylistInput = {
  excludeTrackIds?: string[];
  location?: { lat: number; lng: number };
  mood?: MlMood;
  moodTags?: string[];
  placeId?: string;
  preferredGenres?: string[];
  preferredMoods?: string[];
  state?: MlTravelState;
  travelMode?: string;
};

type MomentLogUpdateInput = {
  artistName?: string;
  createdAt?: string;
  lat?: number | null;
  lng?: number | null;
  moodTags?: string[];
  note?: string | null;
  placeCategory?: string | null;
  placeId?: string | null;
  placeName?: string | null;
  sessionId?: string | null;
  templateId?: string;
  trackId?: string;
  trackTitle?: string;
  travelMode?: string | null;
  visibility?: RecapVisibility;
};

type RecapWithMarkerRelations = Recap & {
  representativeTrack: Track;
  user: {
    displayName: string | null;
    id: string;
  };
};

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null),
  ) as Partial<T>;
}

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? { accepted: true })) as Prisma.InputJsonValue;
}

function isRoutePoint(value: unknown): value is RoutePointDto {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as {
    accuracyMeters?: unknown;
    lat?: unknown;
    lng?: unknown;
    recordedAt?: unknown;
  };

  return (
    typeof candidate.lat === 'number' &&
    typeof candidate.lng === 'number' &&
    typeof candidate.recordedAt === 'string' &&
    (
      candidate.accuracyMeters === undefined ||
      typeof candidate.accuracyMeters === 'number'
    )
  );
}

function routePointsToDto(value?: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const routePoints = value.filter(isRoutePoint).map((point): RoutePointDto => {
    const routePoint: RoutePointDto = {
      lat: point.lat,
      lng: point.lng,
      recordedAt: point.recordedAt,
    };

    if (point.accuracyMeters !== undefined) {
      routePoint.accuracyMeters = point.accuracyMeters;
    }

    return routePoint;
  });

  return routePoints.length ? routePoints : undefined;
}

function normalizeRoutePoints(routePoints?: RoutePointDto[]) {
  if (!routePoints) {
    return undefined;
  }

  return routePoints.map((point) =>
    compact({
      accuracyMeters: point.accuracyMeters,
      lat: point.lat,
      lng: point.lng,
      recordedAt: point.recordedAt,
    }),
  ) as Prisma.InputJsonArray;
}

function createInitialRoutePoints(
  location: { lat: number; lng: number } | undefined,
  recordedAt: Date,
) {
  if (!location) {
    return undefined;
  }

  return normalizeRoutePoints([
    {
      lat: location.lat,
      lng: location.lng,
      recordedAt: recordedAt.toISOString(),
    },
  ]);
}

function normalizeApproxCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

function distanceMeters(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function filterPinsByRadius<T extends { lat: number; lng: number }>(
  pins: T[],
  query: { lat?: number; lng?: number; radiusMeters?: number },
) {
  if (query.lat === undefined || query.lng === undefined) {
    return pins;
  }

  const radiusMeters = query.radiusMeters ?? 3000;
  return pins.filter(
    (pin) => distanceMeters({ lat: query.lat!, lng: query.lng! }, pin) <= radiusMeters,
  );
}

function hasGeoPoint(query: { lat?: number; lng?: number }) {
  return query.lat !== undefined && query.lng !== undefined;
}

function createInviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function createTrackSnapshot(track?: Track | null, fallback?: {
  artistName?: string;
  trackId?: string;
  trackTitle?: string;
}) {
  if (track) {
    return {
      id: track.id,
      title: track.title,
      artist: track.artist,
      fallbackColor: track.fallbackColor,
      platformUrls: track.platformUrls,
    };
  }

  if (!fallback?.trackId && !fallback?.trackTitle) {
    return undefined;
  }

  return {
    id: fallback.trackId ?? createPublicId('track'),
    title: fallback.trackTitle ?? '선택한 음악',
    artist: fallback.artistName ?? '아티스트 미상',
  };
}

function roomToDto(room: RoomWithCommunity) {
  return {
    id: room.id,
    title: room.title,
    inviteCode: room.inviteCode,
    sessionId: room.sessionId ?? undefined,
    visibility: room.visibility,
    memberCount: room.members.length,
    momentCount: room.moments.length,
    members: room.members.map((member) => ({
      id: member.id,
      userId: member.userId,
      role: member.role,
      displayName: member.displayName ?? undefined,
      joinedAt: member.joinedAt.toISOString(),
    })),
    moments: room.moments.map((moment) => ({
      id: moment.id,
      userId: moment.userId,
      momentLogId: moment.momentLogId ?? undefined,
      placeName: moment.placeName ?? undefined,
      note: moment.note ?? undefined,
      status: moment.status,
      track: (moment.trackSnapshot as TrackDto | null) ?? undefined,
      commentCount: moment.comments?.length ?? 0,
      comments: moment.comments?.map((comment) => ({
        id: comment.id,
        userId: comment.userId,
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
      })) ?? [],
      createdAt: moment.createdAt.toISOString(),
    })),
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  };
}

function soundMapPinToDto(pin: SoundMapPinWithUser, viewerId: string, includeExactLocation = false) {
  const isMine = pin.userId === viewerId;
  const track = (pin.trackSnapshot as TrackDto | null) ?? undefined;
  const alias = isMine
    ? '나'
    : pin.visibility === 'nearby'
      ? '근처 여행자'
      : pin.user.displayName ?? '동행자';

  return {
    id: pin.id,
    userId: isMine ? pin.userId : undefined,
    alias,
    isMine,
    visibility: pin.visibility,
    location: includeExactLocation || isMine
      ? { lat: pin.lat, lng: pin.lng }
      : { lat: pin.approxLat, lng: pin.approxLng },
    moodTags: pin.moodTags,
    placeName: pin.placeName ?? undefined,
    profile: {
      preferredGenres: pin.user.profile?.preferredGenres ?? [],
      preferredMoods: pin.user.profile?.preferredMoods ?? [],
      travelStyles: pin.user.profile?.travelStyles ?? [],
    },
    sessionId: pin.sessionId ?? undefined,
    track,
    travelMode: pin.travelMode ?? undefined,
    expiresAt: pin.expiresAt.toISOString(),
    updatedAt: pin.updatedAt.toISOString(),
  };
}

function scoreMatch(pin: SoundMapPinWithUser, params: {
  lat?: number;
  lng?: number;
  mood?: string;
  state?: string;
}) {
  const profile = pin.user.profile;
  let score = 64;
  if (params.mood && profile?.preferredMoods.some((mood) => params.mood?.includes(mood))) {
    score += 10;
  }
  if (params.state && profile?.travelStyles.some((style) => params.state?.includes(style))) {
    score += 8;
  }
  if (pin.moodTags.length > 0) {
    score += 6;
  }
  if (pin.trackSnapshot) {
    score += 6;
  }

  if (params.lat !== undefined && params.lng !== undefined) {
    const distance = distanceMeters({ lat: params.lat, lng: params.lng }, pin);
    if (distance <= 500) {
      score += 8;
    } else if (distance <= 1500) {
      score += 4;
    }
  }

  const minutesSinceUpdate = (Date.now() - pin.updatedAt.getTime()) / 60_000;
  if (minutesSinceUpdate <= 30) {
    score += 6;
  } else if (minutesSinceUpdate <= 120) {
    score += 3;
  }

  return Math.min(score, 96);
}

async function recordCommunityRecommendationEvent(
  userId: string,
  type: string,
  context: RecommendationContext,
  input?: {
    sessionId?: string;
    trackId?: string;
    value?: string;
  },
) {
  await prisma.recommendationEvent.create({
    data: {
      id: createPublicId('event'),
      userId,
      sessionId: input?.sessionId ?? String(context.sessionId ?? context.roomId ?? 'community'),
      type,
      trackId: input?.trackId,
      value: input?.value,
      context: context as Prisma.InputJsonValue,
      createdAt: new Date(),
    },
  });
}

async function touchTravelRoom(roomId: string) {
  await prisma.travelRoom.update({
    where: { id: roomId },
    data: { updatedAt: new Date() },
  });
}

async function getCompanionUserIds(userId: string) {
  const memberships = await prisma.travelRoomMember.findMany({
    where: {
      room: {
        members: {
          some: { userId },
        },
      },
    },
    select: { userId: true },
  });

  return Array.from(new Set(memberships.map((membership) => membership.userId)));
}

async function getCommunityHiddenUserIds(userId: string) {
  const blocks = await prisma.communityBlock.findMany({
    select: {
      blockedUserId: true,
      blockerId: true,
    },
    where: {
      OR: [
        { blockerId: userId },
        { blockedUserId: userId },
      ],
    },
  });

  return Array.from(new Set(blocks.map((block) =>
    block.blockerId === userId ? block.blockedUserId : block.blockerId,
  )));
}

async function hasCommunityBlockBetween(userId: string, targetUserId: string) {
  const block = await prisma.communityBlock.findFirst({
    where: {
      OR: [
        { blockedUserId: targetUserId, blockerId: userId },
        { blockedUserId: userId, blockerId: targetUserId },
      ],
    },
  });

  return Boolean(block);
}

function mateRequestToDto(request: TravelMateRequest) {
  return {
    id: request.id,
    requesterId: request.requesterId,
    targetUserId: request.targetUserId,
    targetPinId: request.targetPinId ?? undefined,
    messageTemplate: request.messageTemplate,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withIdempotency<T>(
  params: {
    idempotencyKey?: string;
    scope: string;
    userId: string;
  },
  action: () => Promise<T>,
): Promise<T> {
  if (!params.idempotencyKey) {
    return action();
  }

  const where = {
    scope_key_userId: {
      key: params.idempotencyKey,
      scope: params.scope,
      userId: params.userId,
    },
  };
  const existing = await prisma.idempotencyRecord.findUnique({ where });

  if (existing) {
    if (existing.response !== null) {
      return existing.response as T;
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await wait(50);

      const completed = await prisma.idempotencyRecord.findUnique({ where });

      if (completed && completed.response !== null) {
        return completed.response as T;
      }
    }

    throw badRequest(ERROR_MESSAGES.IDEMPOTENCY_IN_PROGRESS);
  }

  try {
    await prisma.idempotencyRecord.create({
      data: {
        key: params.idempotencyKey,
        scope: params.scope,
        userId: params.userId,
        response: Prisma.JsonNull,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await wait(50);

        const duplicate = await prisma.idempotencyRecord.findUnique({ where });

        if (duplicate && duplicate.response !== null) {
          return duplicate.response as T;
        }
      }

      throw badRequest(ERROR_MESSAGES.IDEMPOTENCY_IN_PROGRESS);
    }

    throw error;
  }

  try {
    const response = await action();

    await prisma.idempotencyRecord.update({
      where,
      data: {
        response: toInputJson(response),
      },
    });

    return response;
  } catch (error) {
    await prisma.idempotencyRecord.delete({ where }).catch(() => undefined);
    throw error;
  }

}

function normalizePublicUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function getLocalUploadedFilePath(photoUrl?: string | null) {
  if (!photoUrl) {
    return undefined;
  }

  const uploadPublicRoot = normalizePublicUrl(env.UPLOAD_PUBLIC_BASE_URL, env.UPLOAD_PUBLIC_PATH);
  const fileName = photoUrl.startsWith(`${uploadPublicRoot}/`)
    ? photoUrl.slice(uploadPublicRoot.length + 1)
    : undefined;

  if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
    return undefined;
  }

  return path.join(env.UPLOAD_DIRECTORY, fileName);
}

async function deleteLocalUploadedFile(photoUrl?: string | null) {
  const filePath = getLocalUploadedFilePath(photoUrl);

  if (!filePath) {
    return;
  }

  await fs.unlink(filePath).catch(() => undefined);
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function getEncodedServiceKey(serviceKey: string) {
  return serviceKey.includes('%') ? serviceKey : encodeURIComponent(serviceKey);
}

async function fetchTourApiPlaces(params: {
  contentTypes?: string;
  lat: number;
  limit?: number;
  lng: number;
  radiusMeters?: number;
}) {
  const serviceKey = env.TOUR_API_SERVICE_KEY;

  if (!serviceKey) {
    return [];
  }

  const endpoint = `${env.TOUR_API_BASE_URL.replace(/\/$/, '')}/locationBasedList2`;
  const firstContentType = params.contentTypes
    ?.split(',')
    .map((item) => item.trim())
    .find(Boolean);
  const query = new URLSearchParams({
    MobileApp: 'Soundlog',
    MobileOS: 'ETC',
    _type: 'json',
    arrange: 'E',
    mapX: String(params.lng),
    mapY: String(params.lat),
    numOfRows: String(getLimit(params.limit, 10)),
    pageNo: '1',
    radius: String(params.radiusMeters ?? 2000),
  });

  if (firstContentType) {
    query.set('contentTypeId', firstContentType);
  }

  try {
    const response = await fetch(`${endpoint}?serviceKey=${getEncodedServiceKey(serviceKey)}&${query}`);

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as TourApiResponse;

    if (data.response?.header?.resultCode && data.response.header.resultCode !== '0000') {
      return [];
    }

    const rawItems = data.response?.body?.items?.item;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    return items.flatMap((raw) => {
      if (!raw || typeof raw !== 'object') {
        return [];
      }

      const item = raw as Record<string, unknown>;
      const id = asString(item.contentid);
      const title = asString(item.title);

      if (!id || !title) {
        return [];
      }

      const lat = asNumber(item.mapy);
      const lng = asNumber(item.mapx);

      return [
        compact({
          id,
          title,
          address: asString(item.addr1) ?? asString(item.addr2),
          category: asString(item.cat3) ?? asString(item.cat2) ?? asString(item.cat1),
          contentType: asString(item.contenttypeid),
          distanceMeters: asNumber(item.dist),
          imageUrl: asString(item.firstimage) ?? asString(item.firstimage2),
          location: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
          source: 'tour-api',
        }),
      ];
    });
  } catch {
    return [];
  }
}

const mlTrackFallbackColors = [
  '#192554',
  '#48A5B4',
  '#D70D31',
  '#F3B015',
  '#526391',
  '#DA6C51',
  '#2D6A72',
  '#334D3F',
];

const travelModeToMlState: Record<string, MlTravelState> = {
  cafe: '카페',
  drive: '드라이브',
  night: '야경',
  ocean: '바다',
  walk: '산책',
};

const moodTagToMlMood: Record<string, MlMood> = {
  active: '신나는',
  calm: '잔잔한',
  emotional: '감성적인',
  fresh: '시원한',
  local: '설레는',
};

const moodTextToMlMood: Record<string, MlMood> = {
  감성: '감성적인',
  감성적인: '감성적인',
  로컬: '설레는',
  로컬한: '설레는',
  설레는: '설레는',
  시원한: '시원한',
  신나는: '신나는',
  잔잔한: '잔잔한',
  청량한: '시원한',
  활기찬: '신나는',
};

function createStableTrackId(artist: string, title: string, index: number) {
  const digest = crypto
    .createHash('sha1')
    .update(`${artist}:${title}:${index}`)
    .digest('hex')
    .slice(0, 12);

  return `ml-${digest}`;
}

function createStablePlaylistId(input: {
  lat: number;
  lng: number;
  mood: MlMood;
  state: MlTravelState;
}) {
  const digest = crypto
    .createHash('sha1')
    .update(`${input.state}:${input.mood}:${input.lng.toFixed(4)}:${input.lat.toFixed(4)}`)
    .digest('hex')
    .slice(0, 12);

  return `ml-playlist-${digest}`;
}

function createMusicSearchUrls(artist: string, title: string) {
  const query = encodeURIComponent(`${artist} ${title}`.trim());

  return {
    externalUrl: `https://music.youtube.com/search?q=${query}`,
    platformUrls: {
      youtubeMusic: `https://music.youtube.com/search?q=${query}`,
    },
  };
}

function resolveMlTravelState(input: ContextualPlaylistInput): MlTravelState {
  return input.state ?? travelModeToMlState[input.travelMode ?? ''] ?? '산책';
}

function resolveMlMood(input: ContextualPlaylistInput): MlMood {
  if (input.mood) {
    return input.mood;
  }

  const moodFromTags = input.moodTags
    ?.map((tag) => moodTagToMlMood[tag])
    .find(Boolean);

  if (moodFromTags) {
    return moodFromTags;
  }

  const moodFromPreferences = input.preferredMoods
    ?.map((mood) => moodTextToMlMood[mood])
    .find(Boolean);

  return moodFromPreferences ?? '잔잔한';
}

function normalizeMlTracks(rawTracks: unknown): TrackDto[] {
  const tracks = Array.isArray(rawTracks) ? rawTracks : [];

  return tracks.flatMap((rawTrack, index) => {
    if (!rawTrack || typeof rawTrack !== 'object') {
      return [];
    }

    const item = rawTrack as Record<string, unknown>;
    const title = asString(item.title) ?? asString(item.name);
    const artist =
      asString(item.artist) ??
      asString(item.artistName) ??
      asString(item.artist_name) ??
      asString(item.singer);

    if (!title || !artist) {
      return [];
    }

    const { externalUrl, platformUrls } = createMusicSearchUrls(artist, title);

    return [
      compact({
        id: createStableTrackId(artist, title, index),
        title,
        artist,
        albumImageUrl: asString(item.albumImageUrl) ?? asString(item.imageUrl),
        externalUrl,
        fallbackColor: mlTrackFallbackColors[index % mlTrackFallbackColors.length],
        platformUrls,
      }) as TrackDto,
    ];
  });
}

async function fetchMlRecommendationPlaylist(
  input: ContextualPlaylistInput,
): Promise<MlPlaylistDto | undefined> {
  const location = input.location;

  if (!location) {
    return undefined;
  }

  const state = resolveMlTravelState(input);
  const mood = resolveMlMood(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ML_RECOMMENDATION_TIMEOUT_MS);

  try {
    const response = await fetch(env.ML_RECOMMENDATION_API_URL, {
      body: JSON.stringify({
        mood,
        state,
        x: location.lng,
        y: location.lat,
      }),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });

    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json().catch(() => undefined)) as
      | MlRecommendationResponse
      | undefined;
    const tracks = normalizeMlTracks(data?.tracks);

    if (tracks.length === 0) {
      return undefined;
    }

    return compact({
      id: createStablePlaylistId({
        lat: location.lat,
        lng: location.lng,
        mood,
        state,
      }),
      regionName: state,
      placeName: input.placeId,
      reason: `${state} 중인 지금, ${mood} 무드에 맞춰 추천했어요`,
      coverImageUrl: data?.backgroundImageUrl ?? undefined,
      backgroundImageUrl: data?.backgroundImageUrl ?? undefined,
      trackCount: tracks.length,
      durationText: `${tracks.length * 4}:00분`,
      context: {
        mood,
        source: 'ml-recommendation',
        state,
        x: location.lng,
        y: location.lat,
      },
      tracks,
    }) as MlPlaylistDto;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function persistMlRecommendationPlaylist(playlist: MlPlaylistDto) {
  const trackIds = playlist.tracks.map((track) => track.id);

  await prisma.$transaction(async (transaction) => {
    await transaction.playlist.upsert({
      where: { id: playlist.id },
      update: {
        backgroundImageUrl: playlist.backgroundImageUrl,
        context: toInputJson(playlist.context),
        coverImageUrl: playlist.coverImageUrl,
        durationText: playlist.durationText,
        placeName: playlist.placeName,
        reason: playlist.reason,
        regionName: playlist.regionName,
        source: 'ml-recommendation',
        trackCount: playlist.trackCount,
      },
      create: {
        backgroundImageUrl: playlist.backgroundImageUrl,
        context: toInputJson(playlist.context),
        coverImageUrl: playlist.coverImageUrl,
        durationText: playlist.durationText,
        id: playlist.id,
        placeName: playlist.placeName,
        reason: playlist.reason,
        regionName: playlist.regionName,
        source: 'ml-recommendation',
        trackCount: playlist.trackCount,
      },
    });

    for (const track of playlist.tracks) {
      await transaction.track.upsert({
        where: { id: track.id },
        update: {
          albumImageUrl: track.albumImageUrl,
          artist: track.artist,
          externalUrl: track.externalUrl,
          fallbackColor: track.fallbackColor,
          platformUrls: track.platformUrls ? toInputJson(track.platformUrls) : Prisma.JsonNull,
          title: track.title,
        },
        create: {
          albumImageUrl: track.albumImageUrl,
          artist: track.artist,
          externalUrl: track.externalUrl,
          fallbackColor: track.fallbackColor,
          id: track.id,
          platformUrls: track.platformUrls ? toInputJson(track.platformUrls) : undefined,
          title: track.title,
        },
      });
    }

    await transaction.playlistTrack.deleteMany({
      where: {
        playlistId: playlist.id,
        trackId: { notIn: trackIds },
      },
    });

    for (const [position, track] of playlist.tracks.entries()) {
      await transaction.playlistTrack.upsert({
        where: {
          playlistId_trackId: {
            playlistId: playlist.id,
            trackId: track.id,
          },
        },
        update: { position },
        create: {
          playlistId: playlist.id,
          position,
          trackId: track.id,
        },
      });
    }
  });
}

async function withMlPlaylistTrackStates(playlist: MlPlaylistDto, userId?: string) {
  const states = await getTrackStates(
    userId,
    playlist.tracks.map((track) => track.id),
  );

  return {
    ...playlist,
    tracks: playlist.tracks.map((track) => {
      const state = states.get(track.id);

      return compact({
        ...track,
        isLiked: state?.isLiked,
        isSaved: state?.isSaved,
      }) as TrackDto;
    }),
  };
}

function trackToDto(
  track: Track,
  state?: Pick<LibraryTrackState, 'isLiked' | 'isSaved'> | null,
  seededState?: Pick<PlaylistTrack, 'isLiked' | 'isSaved'>,
): TrackDto {
  return compact({
    id: track.id,
    title: track.title,
    artist: track.artist,
    fallbackColor: track.fallbackColor ?? undefined,
    albumImageUrl: track.albumImageUrl ?? undefined,
    externalUrl: track.externalUrl ?? undefined,
    platformUrls: (track.platformUrls as Record<string, string> | null) ?? undefined,
    isLiked: state?.isLiked ?? seededState?.isLiked,
    isSaved: state?.isSaved ?? seededState?.isSaved,
  }) as TrackDto;
}

function placeToDto(place: Place) {
  return compact({
    id: toPublicPlaceId(place.id),
    title: place.title,
    address: place.address ?? undefined,
    category: place.category ?? undefined,
    contentType: place.contentType ?? undefined,
    distanceMeters: place.distanceMeters ?? undefined,
    imageUrl: place.imageUrl ?? undefined,
    location:
      place.lat !== null && place.lng !== null
        ? { lat: place.lat, lng: place.lng }
        : undefined,
    overview: place.overview ?? undefined,
    source: toPublicPlaceSource(place.source),
  });
}

function toPublicPlaceId(id: string) {
  return id.startsWith('mock-') ? `seed-${id.slice('mock-'.length)}` : id;
}

function toStoragePlaceId(id?: string) {
  return id?.startsWith('seed-') ? `mock-${id.slice('seed-'.length)}` : id;
}

function toPublicPlaceSource(source: string) {
  return source === 'mock' ? 'seed' : source;
}

type PlaylistWithTracks = Playlist & {
  tracks: Array<PlaylistTrack & { track: Track }>;
};

type PlaylistSummarySource = Pick<
  Playlist,
  | 'backgroundImageUrl'
  | 'coverImageUrl'
  | 'description'
  | 'durationText'
  | 'id'
  | 'placeName'
  | 'reason'
  | 'regionName'
  | 'trackCount'
>;

function createFallbackPlaylistSummary(playlistId: string): PlaylistSummarySource {
  return {
    id: playlistId,
    regionName: playlistId,
    description: null,
    placeName: null,
    reason: '',
    coverImageUrl: null,
    backgroundImageUrl: null,
    trackCount: 0,
    durationText: '',
  };
}

function playlistSummaryToDto(playlist: PlaylistSummarySource) {
  return compact({
    id: playlist.id,
    regionName: playlist.regionName,
    placeName: playlist.placeName ?? undefined,
    description: playlist.description ?? undefined,
    reason: playlist.reason,
    coverImageUrl: playlist.coverImageUrl ?? undefined,
    backgroundImageUrl: playlist.backgroundImageUrl ?? undefined,
    trackCount: playlist.trackCount,
    durationText: playlist.durationText,
  });
}

async function getTrackStates(userId: string | undefined, trackIds: string[]) {
  if (!userId || trackIds.length === 0) {
    return new Map<string, LibraryTrackState>();
  }

  const states = await prisma.libraryTrackState.findMany({
    where: {
      userId,
      trackId: { in: trackIds },
    },
  });

  return new Map(states.map((state) => [state.trackId, state]));
}

async function playlistToDto(playlist: PlaylistWithTracks, userId?: string) {
  const sortedTracks = [...playlist.tracks].sort(
    (first, second) => first.position - second.position,
  );
  const states = await getTrackStates(
    userId,
    sortedTracks.map((item) => item.trackId),
  );

  return compact({
    id: playlist.id,
    regionName: playlist.regionName,
    placeName: playlist.placeName ?? undefined,
    reason: playlist.reason,
    coverImageUrl: playlist.coverImageUrl ?? undefined,
    backgroundImageUrl: playlist.backgroundImageUrl ?? undefined,
    trackCount: playlist.trackCount,
    durationText: playlist.durationText,
    context: (playlist.context as RecommendationContext | null) ?? undefined,
    tracks: sortedTracks.map((item) =>
      trackToDto(item.track, states.get(item.trackId), item),
    ),
  });
}

function profileToDto(profile: UserProfile) {
  return compact({
    companionType: profile.companionType ?? undefined,
    locationRecommendationEnabled: profile.locationRecommendationEnabled,
    preferredGenres: profile.preferredGenres,
    preferredMoods: profile.preferredMoods,
    travelStyles: profile.travelStyles,
    dislikedArtists: profile.dislikedArtists,
    birthYear: profile.birthYear ?? undefined,
    gender: profile.gender ?? undefined,
    completedOnboarding: profile.completedOnboarding,
    updatedAt: profile.updatedAt.toISOString(),
  });
}

function withPlaylistContext<T extends Record<string, unknown>>(
  playlist: T,
  context: Record<string, unknown>,
) {
  const currentContext =
    playlist.context && typeof playlist.context === 'object'
      ? (playlist.context as Record<string, unknown>)
      : {};

  return {
    ...playlist,
    context: compact({
      ...currentContext,
      ...context,
    }),
  };
}

function momentLogToDto(log: MomentLog) {
  return compact({
    id: log.id,
    photoUrl: log.photoUrl,
    photoUri: log.photoUrl,
    createdAt: log.createdAt.toISOString(),
    sessionId: log.sessionId ?? undefined,
    location:
      log.lat !== null && log.lng !== null ? { lat: log.lat, lng: log.lng } : undefined,
    placeCategory: log.placeCategory ?? undefined,
    placeId: log.placeId ?? undefined,
    placeName: log.placeName ?? undefined,
    note: log.note ?? undefined,
    recapVisibility: log.visibility as RecapVisibility,
    templateId: log.templateId,
    track: (log.trackSnapshot as TrackDto | null) ?? undefined,
    travelMode: log.travelMode ?? undefined,
    moodTags: log.moodTags,
    source: log.source,
    syncStatus: log.syncStatus,
  });
}

function musicLogItemFromMoment(log: MomentLog) {
  const track = (log.trackSnapshot as TrackDto | null) ?? undefined;

  return compact({
    id: log.id,
    placeName: log.placeName ?? '위치 없음',
    trackTitle: track?.title ?? '저장된 순간',
    artistName: track?.artist ?? '음악 없음',
    createdAt: log.createdAt.toISOString(),
    imageUrl: log.photoUrl,
    recapShareId: log.id,
  });
}

type StoredRecapMoment = {
  artistName: string;
  id: string;
  imageUrl?: string;
  location?: { lat: number; lng: number };
  placeName: string;
  recordedAt: string;
  templateId?: string;
  track?: TrackDto;
  trackTitle: string;
  visibility?: RecapVisibility;
};

function recapMomentsToDto(recap: Recap) {
  if (!Array.isArray(recap.moments)) {
    return [];
  }

  return (recap.moments as unknown[]).filter((value): value is StoredRecapMoment => {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const moment = value as Partial<StoredRecapMoment>;

    return (
      typeof moment.id === 'string' &&
      typeof moment.placeName === 'string' &&
      typeof moment.recordedAt === 'string' &&
      typeof moment.trackTitle === 'string' &&
      typeof moment.artistName === 'string'
    );
  });
}

function getVisibleRecapMoments(recap: Recap, viewerId?: string) {
  const moments = recapMomentsToDto(recap);

  if (recap.userId === viewerId) {
    return moments;
  }

  return moments.filter(
    (moment) => (moment.visibility ?? recap.visibility) === 'public',
  );
}

function getRecapThumbnailMoment(recap: Recap, viewerId?: string) {
  const visibleMoments = getVisibleRecapMoments(recap, viewerId);

  return (
    visibleMoments.find((moment) => moment.id === recap.thumbnailMomentId) ??
    visibleMoments[0]
  );
}

function trackDtoFromRecapMoment(moment: StoredRecapMoment): TrackDto {
  return (
    moment.track ?? {
      artist: moment.artistName,
      fallbackColor: '#252A38',
      id: `recap-moment-track-${moment.id}`,
      title: moment.trackTitle,
    }
  );
}

function recapItemToDto(
  recap: Recap & { representativeTrack: Track },
  viewerId?: string,
) {
  const isMine = recap.userId === viewerId;
  const visibleMoments = getVisibleRecapMoments(recap, viewerId);
  const publicRepresentative = isMine ? undefined : visibleMoments.at(-1);
  const thumbnailMoment = getRecapThumbnailMoment(recap, viewerId);

  return compact({
    id: recap.id,
    title: publicRepresentative && recap.sessionId
      ? `${publicRepresentative.placeName} 여행 로그`
      : recap.title,
    placeName: publicRepresentative?.placeName ?? recap.placeName,
    representativeTrack: publicRepresentative
      ? trackDtoFromRecapMoment(publicRepresentative)
      : trackToDto(recap.representativeTrack),
    createdAt: recap.createdAt.toISOString(),
    momentCount: isMine ? recap.momentCount ?? undefined : visibleMoments.length,
    sessionId: recap.sessionId ?? undefined,
    backgroundImageUrl: thumbnailMoment?.imageUrl ?? (isMine ? recap.backgroundImageUrl ?? undefined : undefined),
    thumbnailMomentId: thumbnailMoment?.id,
    visibility: recap.visibility,
  });
}

function recapShareToDto(
  recap: Recap & { representativeTrack: Track },
  viewerId?: string,
  travelSession?: TravelSession,
) {
  const canViewRoutePoints = recap.userId === viewerId;
  const visibleMoments = getVisibleRecapMoments(recap, viewerId);
  const publicRepresentative = canViewRoutePoints ? undefined : visibleMoments.at(-1);
  const thumbnailMoment = getRecapThumbnailMoment(recap, viewerId);

  return compact({
    id: recap.id,
    isMine: canViewRoutePoints,
    placeName: publicRepresentative?.placeName ?? recap.placeName,
    trackTitle: publicRepresentative?.trackTitle ?? recap.representativeTrack.title,
    artistName: publicRepresentative?.artistName ?? recap.representativeTrack.artist,
    backgroundImageUrl: thumbnailMoment?.imageUrl ?? (
      canViewRoutePoints ? recap.backgroundImageUrl ?? undefined : undefined
    ),
    discImageUrl: publicRepresentative?.imageUrl ?? recap.discImageUrl ?? undefined,
    moments: visibleMoments,
    recordedAt: publicRepresentative?.recordedAt ??
      (recap.recordedAt ?? recap.createdAt).toISOString(),
    routePoints: canViewRoutePoints ? routePointsToDto(recap.routePoints) : undefined,
    sessionEndedAt: canViewRoutePoints ? travelSession?.endedAt?.toISOString() : undefined,
    sessionId: recap.sessionId ?? undefined,
    sessionStartedAt: canViewRoutePoints ? travelSession?.startedAt?.toISOString() : undefined,
    shareImageUrl: recap.shareImageUrl ?? undefined,
    templateId: recap.templateId,
    thumbnailMomentId: thumbnailMoment?.id,
    visibility: recap.visibility,
  });
}

function getRecapMomentLocation(recap: Recap, viewerId?: string) {
  const moments = getVisibleRecapMoments(recap, viewerId);
  const location = [...moments].reverse().find(
    (moment) =>
      typeof moment.location?.lat === 'number' &&
      typeof moment.location?.lng === 'number',
  )?.location;

  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    return undefined;
  }

  return {
    lat: location.lat,
    lng: location.lng,
  };
}

function getRecapLocation(recap: Recap, viewerId?: string) {
  const canViewAllMoments = viewerId === undefined || recap.userId === viewerId;

  if (canViewAllMoments && recap.lat !== null && recap.lng !== null) {
    return {
      lat: recap.lat,
      lng: recap.lng,
    };
  }

  return getRecapMomentLocation(
    recap,
    canViewAllMoments ? recap.userId : viewerId,
  );
}

function assertPublicRecapHasLocation(
  visibility: RecapVisibility | undefined,
  location: { lat: number; lng: number } | undefined,
) {
  if (visibility === 'public' && !location) {
    throw badRequest(ERROR_MESSAGES.RECAP_PUBLIC_LOCATION_REQUIRED);
  }
}

function recapMapMarkerToDto(
  recap: RecapWithMarkerRelations,
  viewerId: string,
  origin?: { lat: number; lng: number },
) {
  const location = getRecapLocation(recap, viewerId);

  if (!location) {
    return undefined;
  }

  const isMine = recap.userId === viewerId;
  const publicRepresentative = isMine
    ? undefined
    : getVisibleRecapMoments(recap, viewerId).at(-1);
  const thumbnailMoment = getRecapThumbnailMoment(recap, viewerId);
  const publicTrack = publicRepresentative
    ? trackDtoFromRecapMoment(publicRepresentative)
    : undefined;

  return compact({
    id: `marker-${recap.id}`,
    recapId: recap.id,
    title: publicRepresentative && recap.sessionId
      ? `${publicRepresentative.placeName} 여행 로그`
      : recap.title,
    placeName: publicRepresentative?.placeName ?? recap.placeName,
    ownerAlias: isMine ? '나' : recap.user.displayName ?? 'Soundlog 여행자',
    location,
    trackTitle: publicTrack?.title ?? recap.representativeTrack.title,
    artistName: publicTrack?.artist ?? recap.representativeTrack.artist,
    templateId: publicRepresentative?.templateId ?? recap.templateId,
    visibility: recap.visibility as RecapVisibility,
    distanceMeters: origin ? Math.round(distanceMeters(origin, location)) : undefined,
    imageUrl: thumbnailMoment?.imageUrl ?? (isMine ? recap.backgroundImageUrl ?? undefined : undefined),
    createdAt: publicRepresentative?.recordedAt ?? recap.createdAt.toISOString(),
  });
}

function momentLogToRecapShareMoment(moment: MomentLog) {
  const momentTrack = (moment.trackSnapshot as TrackDto | null) ?? undefined;

  return compact({
    id: moment.id,
    imageUrl: moment.photoUrl,
    location:
      moment.lat !== null && moment.lng !== null
        ? { lat: moment.lat, lng: moment.lng }
        : undefined,
    placeName: moment.placeName ?? '위치 없음',
    trackTitle: momentTrack?.title ?? '저장된 순간',
    artistName: momentTrack?.artist ?? '음악 없음',
    recordedAt: moment.createdAt.toISOString(),
    templateId: moment.templateId,
    track: momentTrack,
    visibility: moment.visibility as RecapVisibility,
  });
}

async function resolveAggregateTrack(
  client: Prisma.TransactionClient,
  moments: MomentLog[],
) {
  const snapshot = [...moments]
    .reverse()
    .map((moment) => moment.trackSnapshot as TrackDto | null)
    .find((track): track is TrackDto => Boolean(track?.id));

  if (snapshot) {
    return client.track.upsert({
      where: { id: snapshot.id },
      update: {},
      create: {
        id: snapshot.id,
        albumImageUrl: snapshot.albumImageUrl,
        artist: snapshot.artist,
        externalUrl: snapshot.externalUrl,
        fallbackColor: snapshot.fallbackColor,
        platformUrls: snapshot.platformUrls
          ? toInputJson(snapshot.platformUrls)
          : undefined,
        title: snapshot.title,
      },
    });
  }

  return client.track.upsert({
    where: { id: NO_MUSIC_TRACK_ID },
    update: {},
    create: {
      id: NO_MUSIC_TRACK_ID,
      artist: 'Soundlog',
      fallbackColor: '#252A38',
      title: '음악 없음',
    },
  });
}

async function refreshRecapAggregates(
  client: Prisma.TransactionClient,
  input: {
    momentIds: string[];
    sessionIds: Array<string | null | undefined>;
    userId: string;
  },
) {
  const sessionIds = new Set(input.sessionIds.filter((id): id is string => Boolean(id)));
  const momentIds = new Set(input.momentIds);
  const candidates = await client.recap.findMany({
    where: {
      userId: input.userId,
      OR: [
        { travelSessionId: { in: [...sessionIds] } },
        { sessionId: null, travelSessionId: null },
      ],
    },
  });
  const affectedRecaps = candidates.filter(
    (recap) =>
      (recap.travelSessionId
        ? sessionIds.has(recap.travelSessionId)
        : false) ||
      recapMomentsToDto(recap).some((moment) => momentIds.has(moment.id)),
  );

  for (const recap of affectedRecaps) {
    const storedMomentIds = recapMomentsToDto(recap).map((moment) => moment.id);
    const moments = await client.momentLog.findMany({
      where: recap.travelSessionId
        ? {
            sessionId: recap.travelSessionId,
            userId: input.userId,
          }
        : {
            id: { in: storedMomentIds },
            sessionId: null,
            userId: input.userId,
          },
      orderBy: { createdAt: 'asc' },
    });

    if (moments.length === 0) {
      await client.recap.delete({ where: { id: recap.id } });
      continue;
    }

    const representativeMoment = moments.at(-1)!;
    const thumbnailMoment =
      moments.find((moment) => moment.id === recap.thumbnailMomentId) ?? moments[0]!;
    const representativeTrack = await resolveAggregateTrack(client, moments);
    const representativeLocation =
      representativeMoment.lat !== null && representativeMoment.lng !== null
        ? { lat: representativeMoment.lat, lng: representativeMoment.lng }
        : moments.find((moment) => moment.lat !== null && moment.lng !== null);
    const hasPublicLocatedMoment = moments.some(
      (moment) =>
        moment.visibility === 'public' &&
        moment.lat !== null &&
        moment.lng !== null,
    );

    await client.recap.update({
      where: { id: recap.id },
      data: {
        backgroundImageUrl: thumbnailMoment.photoUrl,
        discImageUrl: representativeMoment.photoUrl,
        lat: representativeLocation?.lat,
        lng: representativeLocation?.lng,
        momentCount: moments.length,
        moments: moments.map(momentLogToRecapShareMoment) as Prisma.JsonArray,
        placeName: representativeMoment.placeName ?? 'Soundlog',
        recordedAt: representativeMoment.createdAt,
        representativeTrackId: representativeTrack.id,
        thumbnailMomentId: thumbnailMoment.id,
        templateId: recap.travelSessionId
          ? recap.templateId
          : representativeMoment.templateId,
        visibility:
          recap.visibility === 'public' && !hasPublicLocatedMoment
            ? 'private'
            : recap.visibility,
      },
    });
  }
}

function travelSessionToDto(session: TravelSession) {
  return compact({
    id: session.id,
    status: session.status,
    startedAt: session.startedAt?.toISOString(),
    endedAt: session.endedAt?.toISOString(),
    routePoints: routePointsToDto(session.routePoints),
    travelMode: session.travelMode ?? undefined,
  });
}

function normalizeMoodLabel(value?: string) {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  return normalized === '청량한' ? '시원한' : normalized;
}

function matchesMoodFilter(itemMoods: string[], moodFilter?: string) {
  const normalizedFilter = normalizeMoodLabel(moodFilter);

  if (!normalizedFilter || normalizedFilter === '전체') {
    return true;
  }

  return itemMoods.some((mood) => normalizeMoodLabel(mood) === normalizedFilter);
}

function scoreMoodRecommendation(
  item: MoodRecommendation & { track: Track },
  params: {
    moodFilter?: string;
    preferredGenres?: string[];
    preferredMoods?: string[];
    recommendationMode?: 'everyday' | 'travel';
    travelStyles?: string[];
  },
) {
  let score = item.sortOrder * -0.01;
  const travelModeWeight = params.recommendationMode === 'travel' ? 2.4 : 1;
  const tasteWeight = params.recommendationMode === 'travel' ? 0.7 : 1.4;

  score += (params.preferredGenres ?? []).filter((genre) =>
    item.genres.includes(genre),
  ).length * 3 * tasteWeight;
  score += (params.preferredMoods ?? []).filter((mood) =>
    item.moods.some((itemMood) => normalizeMoodLabel(itemMood) === normalizeMoodLabel(mood)),
  ).length * 2 * tasteWeight;
  score += (params.travelStyles ?? []).filter((style) =>
    item.travelStyles.includes(style),
  ).length * 2 * travelModeWeight;

  return score;
}

async function findDefaultPlaylist(params?: { lat?: number; placeId?: string }) {
  if (params?.placeId) {
    const place = await prisma.place.findUnique({
      where: { id: toStoragePlaceId(params.placeId) },
    });
    const placeText = [place?.title, place?.category, place?.overview].join(' ');

    if (/해변|바다|해수욕장|ocean|beach/i.test(placeText)) {
      return 'busan-ocean';
    }
  }

  if (params?.lat && params.lat < 36.5) {
    return 'busan-ocean';
  }

  return 'seoul-night';
}

export const soundlogService = {
  async getHealth() {
    let database: 'ok' | 'unavailable' = 'ok';

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'unavailable';
    }

    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      checkedAt: new Date().toISOString(),
      database,
    };
  },

  async getMyProfile(userId: string) {
    const profile = await prisma.userProfile.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        locationRecommendationEnabled: true,
        preferredGenres: [],
        preferredMoods: [],
        travelStyles: [],
        completedOnboarding: false,
      },
    });

    return profileToDto(profile);
  },

  async upsertMyProfile(
    userId: string,
    input: {
      birthYear?: number;
      companionType?: string;
      dislikedArtists?: string[];
      gender?: string;
      locationRecommendationEnabled: boolean;
      preferredGenres: string[];
      preferredMoods: string[];
      travelStyles: string[];
    },
  ) {
    const profile = await prisma.userProfile.upsert({
      where: { userId },
      update: {
        ...input,
        dislikedArtists: input.dislikedArtists ?? [],
        completedOnboarding: true,
      },
      create: {
        userId,
        ...input,
        dislikedArtists: input.dislikedArtists ?? [],
        completedOnboarding: true,
      },
    });

    return profileToDto(profile);
  },

  async deleteMyAccount(userId: string) {
    const momentLogs = await prisma.momentLog.findMany({
      where: { userId },
      select: { photoUrl: true },
    });

    await prisma.user.delete({ where: { id: userId } });
    await Promise.all(
      momentLogs.map((momentLog) => deleteLocalUploadedFile(momentLog.photoUrl)),
    );

    return { deleted: true };
  },

  async migrateLocalData(_userId: string, input: {
    idempotencyKey: string;
    libraryTrackCount: number;
    momentLogCount: number;
    recapDraftCount: number;
  }) {
    return {
      accepted: true,
      idempotencyKey: input.idempotencyKey,
      migrated: {
        libraryTrackCount: input.libraryTrackCount,
        momentLogCount: input.momentLogCount,
        recapDraftCount: input.recapDraftCount,
      },
    };
  },

  async getNearbyPlaces(params: {
    contentTypes?: string;
    lat: number;
    limit?: number;
    lng: number;
    radiusMeters?: number;
  }) {
    const origin = { lat: params.lat, lng: params.lng };
    const radiusMeters = params.radiusMeters ?? 2000;
    const limit = getLimit(params.limit, 10);
    const tourPlaces = await fetchTourApiPlaces(params);

    if (tourPlaces.length > 0) {
      return tourPlaces
        .flatMap((place) => {
          if (!place.location) {
            return [];
          }

          const distance = Math.round(distanceMeters(origin, place.location));

          return distance <= radiusMeters
            ? [{ ...place, distanceMeters: distance }]
            : [];
        })
        .sort((first, second) => first.distanceMeters - second.distanceMeters)
        .slice(0, limit);
    }

    const latitudeDelta = radiusMeters / 111_320;
    const longitudeScale = Math.max(Math.cos((params.lat * Math.PI) / 180), 0.01);
    const longitudeDelta = radiusMeters / (111_320 * longitudeScale);
    const places = await prisma.place.findMany({
      where: {
        lat: { gte: params.lat - latitudeDelta, lte: params.lat + latitudeDelta },
        lng: { gte: params.lng - longitudeDelta, lte: params.lng + longitudeDelta },
      },
    });

    return places
      .flatMap((place) => {
        if (place.lat === null || place.lng === null) {
          return [];
        }

        const distance = Math.round(
          distanceMeters(origin, { lat: place.lat, lng: place.lng }),
        );

        return distance <= radiusMeters
          ? [{ ...placeToDto(place), distanceMeters: distance }]
          : [];
      })
      .sort((first, second) => first.distanceMeters - second.distanceMeters)
      .slice(0, limit);
  },

  async reverseGeocodeLocation(params: { lat: number; lng: number }) {
    return reverseGeocodeLocation(params);
  },

  async searchPlaces(params: { limit?: number; query: string }) {
    const query = params.query.trim();
    const places = await prisma.place.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { address: { contains: query, mode: 'insensitive' } },
          { category: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ title: 'asc' }],
      take: getLimit(params.limit, 10),
    });

    return places.map(placeToDto);
  },

  async getFeaturedPlaylists(
    _user: MaybeUser,
    params: {
      lat?: number;
      limit?: number;
      locationRecommendationEnabled: boolean;
      placeId?: string;
      recommendationMode?: 'everyday' | 'travel';
    },
  ) {
    const playlists = await prisma.playlist.findMany({
      orderBy: { updatedAt: 'desc' },
      where: {
        OR: [
          { source: null },
          { source: { not: 'personalized' } },
        ],
      },
    });
    const preferredId =
      params.recommendationMode === 'travel' &&
      params.locationRecommendationEnabled &&
      (params.lat || params.placeId)
        ? await findDefaultPlaylist({ lat: params.lat, placeId: params.placeId })
        : undefined;

    return playlists
      .sort((first, second) => {
        if (first.id === preferredId) {
          return -1;
        }

        if (second.id === preferredId) {
          return 1;
        }

        return first.regionName.localeCompare(second.regionName, 'ko');
      })
      .slice(0, getLimit(params.limit))
      .map((playlist) =>
        compact({
          id: playlist.id,
          regionName: playlist.regionName,
          description: playlist.description ?? '',
          trackCount: playlist.trackCount,
          durationText: playlist.durationText,
          source: playlist.source ?? undefined,
        }),
      );
  },

  async getMoodRecommendations(
    _user: MaybeUser,
    params: {
      limit?: number;
      moodFilter?: string;
      preferredGenres?: string[];
      preferredMoods?: string[];
      recommendationMode?: 'everyday' | 'travel';
      travelStyles?: string[];
    },
  ) {
    const recommendations = await prisma.moodRecommendation.findMany({
      include: { track: true },
      orderBy: { sortOrder: 'asc' },
    });

    return recommendations
      .filter((item) => matchesMoodFilter(item.moods, params.moodFilter))
      .sort((first, second) => scoreMoodRecommendation(second, params) - scoreMoodRecommendation(first, params))
      .slice(0, getLimit(params.limit))
      .map((item) =>
        compact({
          id: item.id,
          title: item.title,
          subtitle: item.subtitle ?? undefined,
          color: item.color,
          genres: item.genres,
          imageUrl: item.imageUrl ?? undefined,
          moods: item.moods,
          playlistId: item.playlistId ?? undefined,
          travelStyles: item.travelStyles,
          track: trackToDto(item.track),
        }),
      );
  },

  async getRecentMusicLogs(userId: string, params: { limit?: number }) {
    const logs = await prisma.momentLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: getLimit(params.limit, 10),
    });

    return logs.map(musicLogItemFromMoment);
  },

  async createContextualPlaylist(
    userId: string,
    input: ContextualPlaylistInput,
    idempotencyKey?: string,
  ) {
    return withIdempotency(
      { idempotencyKey, scope: 'playlist.contextual.create', userId },
      async () => {
        const mlPlaylist = await fetchMlRecommendationPlaylist(input);

        if (mlPlaylist) {
          await persistMlRecommendationPlaylist(mlPlaylist);
          return withMlPlaylistTrackStates(mlPlaylist, userId);
        }

        const playlistId = await findDefaultPlaylist({
          lat: input.location?.lat,
          placeId: input.placeId,
        });
        const playlist = await prisma.playlist.findUnique({
          where: { id: playlistId },
          include: {
            tracks: {
              include: { track: true },
            },
          },
        });

        if (!playlist) {
          throw notFound();
        }

        return withPlaylistContext(await playlistToDto(playlist, userId), {
          mood: input.mood,
          moodTags: input.moodTags,
          placeId: input.placeId,
          source: 'seed-fallback',
          state: input.state,
          travelMode: input.travelMode,
        });
      },
    );
  },

  async getRecommendedPlaylist(
    userId: string | undefined,
    input: ContextualPlaylistInput,
  ) {
    const mlPlaylist = await fetchMlRecommendationPlaylist(input);

    if (mlPlaylist) {
      await persistMlRecommendationPlaylist(mlPlaylist);
      return withMlPlaylistTrackStates(mlPlaylist, userId);
    }

    const playlistId = await findDefaultPlaylist({
      lat: input.location?.lat,
      placeId: input.placeId,
    });
    const playlist = await prisma.playlist.findUnique({
      where: { id: playlistId },
      include: {
        tracks: {
          include: { track: true },
        },
      },
    });

    if (!playlist) {
      throw notFound();
    }

    return withPlaylistContext(await playlistToDto(playlist, userId), {
      mood: input.mood,
      placeId: input.placeId,
      source: 'seed-fallback',
      state: input.state,
      travelMode: input.travelMode,
    });
  },

  async getPlaylist(
    userId: string | undefined,
    playlistId: string,
    query: { lat?: number; placeId?: string },
  ) {
    const id = playlistId === 'fallback' ? await findDefaultPlaylist(query) : playlistId;
    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: {
        tracks: {
          include: { track: true },
        },
      },
    });

    if (!playlist) {
      throw notFound(ERROR_MESSAGES.PLAYLIST_NOT_FOUND);
    }

    const dto = await playlistToDto(playlist, userId);

    return playlistId === 'fallback'
      ? withPlaylistContext(dto, { source: 'seed-fallback' })
      : dto;
  },

  async getLibraryTracks(
    userId: string,
    params: { cursor?: string; kind: 'liked' | 'saved' | 'all'; limit?: number },
  ) {
    const states = await prisma.libraryTrackState.findMany({
      where: {
        userId,
        OR:
          params.kind === 'all'
            ? [{ isLiked: true }, { isSaved: true }]
            : params.kind === 'liked'
              ? [{ isLiked: true }]
              : [{ isSaved: true }],
      },
      include: { track: true },
      orderBy: { updatedAt: 'desc' },
    });
    const playlistIds = Array.from(
      new Set(states.map((state) => state.playlistId).filter(Boolean) as string[]),
    );
    const playlists = playlistIds.length > 0
      ? await prisma.playlist.findMany({ where: { id: { in: playlistIds } } })
      : [];
    const playlistById = new Map(playlists.map((playlist) => [playlist.id, playlist]));
    const records = states.map((state) => ({
      id: state.trackId,
      createdAt: (state.isLiked ? state.likedAt : state.savedAt)?.toISOString() ?? state.updatedAt.toISOString(),
      playlistId: state.playlistId ?? undefined,
      playlist: state.playlistId
        ? playlistSummaryToDto(
            playlistById.get(state.playlistId) ?? createFallbackPlaylistSummary(state.playlistId),
          )
        : undefined,
      kind: state.isLiked ? 'liked' : 'saved',
      track: trackToDto(state.track, state),
    }));
    const limit = getLimit(params.limit);
    const page = paginateByCursor(records, limit, params.cursor);

    return {
      data: page.items,
      page: {
        limit,
        nextCursor: page.nextCursor,
      },
    };
  },

  async updateLibraryTrackState(
    userId: string,
    trackId: string,
    input: {
      action: 'like' | 'unlike' | 'save' | 'unsave';
      playlistId?: string;
    },
    idempotencyKey?: string,
  ) {
    return withIdempotency(
      { idempotencyKey, scope: `library.track.${trackId}`, userId },
      async () => {
        const track = await prisma.track.findUnique({ where: { id: trackId } });

        if (!track) {
          throw notFound(ERROR_MESSAGES.TRACK_NOT_FOUND);
        }

        const now = new Date();
        const state = await prisma.libraryTrackState.upsert({
          where: {
            userId_trackId: { userId, trackId },
          },
          update: {
            playlistId: input.playlistId,
            isLiked: input.action === 'like' ? true : input.action === 'unlike' ? false : undefined,
            isSaved: input.action === 'save' ? true : input.action === 'unsave' ? false : undefined,
            likedAt: input.action === 'like' ? now : input.action === 'unlike' ? null : undefined,
            savedAt: input.action === 'save' ? now : input.action === 'unsave' ? null : undefined,
          },
          create: {
            userId,
            trackId,
            playlistId: input.playlistId,
            isLiked: input.action === 'like',
            isSaved: input.action === 'save',
            likedAt: input.action === 'like' ? now : undefined,
            savedAt: input.action === 'save' ? now : undefined,
          },
        });

        return {
          trackId: state.trackId,
          isLiked: state.isLiked,
          isSaved: state.isSaved,
          updatedAt: state.updatedAt.toISOString(),
        };
      },
    );
  },

  async getMomentLogs(
    userId: string,
    params: { cursor?: string; limit?: number; sessionId?: string },
  ) {
    const logs = await prisma.momentLog.findMany({
      where: {
        userId,
        sessionId: params.sessionId,
      },
      orderBy: { createdAt: 'desc' },
    });
    const limit = getLimit(params.limit);
    const page = paginateByCursor(logs, limit, params.cursor);

    return {
      data: page.items.map(momentLogToDto),
      page: {
        limit,
        nextCursor: page.nextCursor,
      },
    };
  },

  async createMomentLog(
    userId: string,
    input: {
      artistName?: string;
      createdAt: string;
      lat?: number;
      lng?: number;
      moodTags: string[];
      photoPath?: string;
      placeCategory?: string;
      placeId?: string;
      placeName?: string;
      note?: string;
      sessionId?: string;
      templateId?: string;
      trackId?: string;
      trackTitle?: string;
      travelMode?: string;
      visibility?: RecapVisibility;
    },
    idempotencyKey?: string,
  ) {
    return withIdempotency(
      { idempotencyKey, scope: 'moment-log.create', userId },
      async () => {
        const location =
          input.lat !== undefined && input.lng !== undefined
            ? { lat: input.lat, lng: input.lng }
            : undefined;

        assertPublicRecapHasLocation(input.visibility, location);

        const track = input.trackId
          ? await prisma.track.findUnique({ where: { id: input.trackId } })
          : undefined;
        const photoUrl = input.photoPath
          ? normalizePublicUrl(env.UPLOAD_PUBLIC_BASE_URL, input.photoPath)
          : undefined;
        const id = createPublicId('moment');
        const log = await prisma.$transaction(async (transaction) => {
          const created = await transaction.momentLog.create({
            data: {
              id,
              userId,
              photoUrl,
              createdAt: new Date(input.createdAt),
              sessionId: input.sessionId,
              lat: input.lat,
              lng: input.lng,
              placeCategory: input.placeCategory,
              placeId: input.placeId,
              placeName: input.placeName,
              note: input.note,
              templateId: input.templateId ?? 'album',
              trackSnapshot:
                track || input.trackTitle
                  ? {
                      id: track?.id ?? input.trackId ?? createPublicId('track'),
                      title: track?.title ?? input.trackTitle ?? '저장된 순간',
                      artist: track?.artist ?? input.artistName ?? '음악 없음',
                      fallbackColor: track?.fallbackColor,
                      platformUrls: track?.platformUrls,
                    }
                  : undefined,
              travelMode: input.travelMode,
              moodTags: input.moodTags,
              source: 'camera',
              syncStatus: 'synced',
              visibility: input.visibility ?? 'private',
            },
          });

          await refreshRecapAggregates(transaction, {
            momentIds: [created.id],
            sessionIds: [created.sessionId],
            userId,
          });

          return created;
        });

        return momentLogToDto(log);
      },
    );
  },

  async updateMomentLog(
    userId: string,
    momentLogId: string,
    input: MomentLogUpdateInput,
  ) {
    const existing = await prisma.momentLog.findFirst({
      where: {
        id: momentLogId,
        userId,
      },
    });

    if (!existing) {
      throw notFound(ERROR_MESSAGES.MOMENT_LOG_NOT_FOUND);
    }

    const data: Prisma.MomentLogUpdateInput = {};

    if (input.createdAt) {
      data.createdAt = new Date(input.createdAt);
    }

    if (hasOwn(input, 'lat')) {
      data.lat = input.lat ?? null;
    }

    if (hasOwn(input, 'lng')) {
      data.lng = input.lng ?? null;
    }

    if (input.moodTags) {
      data.moodTags = input.moodTags;
    }

    if (hasOwn(input, 'note')) {
      data.note = input.note ?? null;
    }

    if (hasOwn(input, 'placeCategory')) {
      data.placeCategory = input.placeCategory ?? null;
    }

    if (hasOwn(input, 'placeId')) {
      data.placeId = input.placeId ?? null;
    }

    if (hasOwn(input, 'placeName')) {
      data.placeName = input.placeName ?? null;
    }

    if (hasOwn(input, 'sessionId')) {
      data.sessionId = input.sessionId ?? null;
    }

    if (input.templateId) {
      data.templateId = input.templateId;
    }

    if (hasOwn(input, 'travelMode')) {
      data.travelMode = input.travelMode ?? null;
    }

    if (input.visibility) {
      data.visibility = input.visibility;
    }

    if (hasOwn(input, 'lat') || hasOwn(input, 'lng') || input.visibility) {
      const nextLat = hasOwn(input, 'lat') ? input.lat : existing.lat;
      const nextLng = hasOwn(input, 'lng') ? input.lng : existing.lng;
      const nextVisibility = input.visibility ?? (existing.visibility as RecapVisibility);
      const location =
        nextLat !== null && nextLat !== undefined && nextLng !== null && nextLng !== undefined
          ? { lat: nextLat, lng: nextLng }
          : undefined;

      assertPublicRecapHasLocation(nextVisibility, location);
    }

    const shouldUpdateTrackSnapshot =
      hasOwn(input, 'trackId') ||
      hasOwn(input, 'trackTitle') ||
      hasOwn(input, 'artistName');

    if (shouldUpdateTrackSnapshot) {
      const track = input.trackId
        ? await prisma.track.findUnique({ where: { id: input.trackId } })
        : undefined;
      const trackSnapshot = createTrackSnapshot(track, {
        artistName: input.artistName,
        trackId: input.trackId,
        trackTitle: input.trackTitle,
      });

      data.trackSnapshot = trackSnapshot ? toInputJson(trackSnapshot) : Prisma.JsonNull;
    }

    if (Object.keys(data).length === 0) {
      return momentLogToDto(existing);
    }

    const updated = await prisma.$transaction(async (transaction) => {
      const nextMoment = await transaction.momentLog.update({
        where: { id: existing.id },
        data,
      });

      await refreshRecapAggregates(transaction, {
        momentIds: [existing.id],
        sessionIds: [existing.sessionId, nextMoment.sessionId],
        userId,
      });

      return nextMoment;
    });

    return momentLogToDto(updated);
  },

  async updateMomentLogPhoto(userId: string, momentLogId: string, photoPath: string) {
    const nextPhotoUrl = normalizePublicUrl(env.UPLOAD_PUBLIC_BASE_URL, photoPath);
    const existing = await prisma.momentLog.findFirst({
      where: {
        id: momentLogId,
        userId,
      },
    });

    if (!existing) {
      await deleteLocalUploadedFile(nextPhotoUrl);
      throw notFound(ERROR_MESSAGES.MOMENT_LOG_NOT_FOUND);
    }

    const updated = await prisma.$transaction(async (transaction) => {
      const nextMoment = await transaction.momentLog.update({
        where: { id: existing.id },
        data: { photoUrl: nextPhotoUrl },
      });

      await refreshRecapAggregates(transaction, {
        momentIds: [existing.id],
        sessionIds: [existing.sessionId],
        userId,
      });

      return nextMoment;
    });

    await deleteLocalUploadedFile(existing.photoUrl);

    return momentLogToDto(updated);
  },

  async deleteMomentLogPhoto(userId: string, momentLogId: string) {
    const existing = await prisma.momentLog.findFirst({
      where: {
        id: momentLogId,
        userId,
      },
    });

    if (!existing) {
      throw notFound(ERROR_MESSAGES.MOMENT_LOG_NOT_FOUND);
    }

    if (!existing.photoUrl) {
      return momentLogToDto(existing);
    }

    const updated = await prisma.$transaction(async (transaction) => {
      const nextMoment = await transaction.momentLog.update({
        where: { id: existing.id },
        data: { photoUrl: null },
      });

      await refreshRecapAggregates(transaction, {
        momentIds: [existing.id],
        sessionIds: [existing.sessionId],
        userId,
      });

      return nextMoment;
    });

    await deleteLocalUploadedFile(existing.photoUrl);

    return momentLogToDto(updated);
  },

  async deleteMomentLog(userId: string, momentLogId: string) {
    const existing = await prisma.momentLog.findFirst({
      where: {
        id: momentLogId,
        userId,
      },
      select: { id: true, photoUrl: true, sessionId: true },
    });

    if (!existing) {
      throw notFound(ERROR_MESSAGES.MOMENT_LOG_NOT_FOUND);
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.travelRoomMoment.updateMany({
        where: { momentLogId: existing.id },
        data: { momentLogId: null },
      });
      await transaction.momentLog.delete({ where: { id: existing.id } });
      await refreshRecapAggregates(transaction, {
        momentIds: [existing.id],
        sessionIds: [existing.sessionId],
        userId,
      });
    });

    await deleteLocalUploadedFile(existing.photoUrl);
  },

  async createRecommendationEvents(
    userId: string,
    input: {
      events: Array<{
        context: RecommendationContext;
        createdAt: string;
        id: string;
        playlistId?: string;
        sessionId: string;
        trackId?: string;
        type: string;
        value?: string;
      }>;
    },
    idempotencyKey?: string,
  ) {
    await withIdempotency(
      { idempotencyKey, scope: 'recommendation-events.create', userId },
      async () => {
        await prisma.recommendationEvent.createMany({
          data: input.events.map((event) => ({
            id: event.id,
            userId,
            sessionId: event.sessionId,
            type: event.type,
            trackId: event.trackId,
            playlistId: event.playlistId,
            value: event.value,
            context: event.context as Prisma.InputJsonValue,
            createdAt: new Date(event.createdAt),
          })),
          skipDuplicates: true,
        });

        return { accepted: true };
      },
    );
  },

  async createTravelRoom(userId: string, input: {
    sessionId?: string;
    title: string;
    visibility: string;
  }) {
    const room = await prisma.travelRoom.create({
      data: {
        id: createPublicId('room'),
        ownerId: userId,
        inviteCode: createInviteCode(),
        sessionId: input.sessionId,
        title: input.title,
        visibility: input.visibility,
        members: {
          create: {
            userId,
            role: 'owner',
          },
        },
      },
      include: {
        members: true,
        moments: {
          include: { comments: { orderBy: { createdAt: 'asc' } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    await recordCommunityRecommendationEvent(userId, 'trip_room_created', {
      roomId: room.id,
      visibility: room.visibility,
    }, { sessionId: room.sessionId ?? room.id });

    return roomToDto(room);
  },

  async getTravelRooms(userId: string, query: {
    limit?: number;
    sessionId?: string;
  }) {
    const rooms = await prisma.travelRoom.findMany({
      where: {
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
        members: { some: { userId } },
      },
      include: {
        members: true,
        moments: {
          include: { comments: { orderBy: { createdAt: 'asc' } } },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: getLimit(query.limit),
    });

    return rooms.map(roomToDto);
  },

  async getTravelRoom(userId: string, roomId: string) {
    const room = await prisma.travelRoom.findFirst({
      where: {
        id: roomId,
        members: { some: { userId } },
      },
      include: {
        members: true,
        moments: {
          include: { comments: { orderBy: { createdAt: 'asc' } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!room) {
      throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_NOT_FOUND);
    }

    return roomToDto(room);
  },

  async joinTravelRoom(userId: string, roomId: string, input: {
    displayName?: string;
    inviteCode?: string;
  }) {
    const room = await prisma.travelRoom.findUnique({
      where: { id: roomId },
      include: {
        members: true,
        moments: {
          include: { comments: { orderBy: { createdAt: 'asc' } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!room) {
      throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_NOT_FOUND);
    }

    const existingMember = room.members.find((member) => member.userId === userId);

    if (!existingMember && input.inviteCode !== room.inviteCode) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_ROOM_INVITE_CODE_INVALID);
    }

    if (existingMember && input.inviteCode && input.inviteCode !== room.inviteCode) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_ROOM_INVITE_CODE_INVALID);
    }

    await prisma.travelRoomMember.upsert({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
      update: {
        displayName: input.displayName,
      },
      create: {
        roomId,
        userId,
        displayName: input.displayName,
        role: 'member',
      },
    });
    await touchTravelRoom(roomId);

    await recordCommunityRecommendationEvent(userId, 'trip_room_joined', {
      roomId,
      role: existingMember?.role ?? 'member',
    }, { sessionId: room.sessionId ?? roomId });

    return this.getTravelRoom(userId, roomId);
  },

  async joinTravelRoomByInviteCode(userId: string, input: {
    displayName?: string;
    inviteCode: string;
  }) {
    const room = await prisma.travelRoom.findUnique({
      where: { inviteCode: input.inviteCode },
    });

    if (!room) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_ROOM_INVITE_CODE_INVALID);
    }

    return this.joinTravelRoom(userId, room.id, input);
  },

  async addTravelRoomMoment(userId: string, roomId: string, input: {
    artistName?: string;
    momentLogId?: string;
    note?: string;
    placeName?: string;
    status?: string;
    trackId?: string;
    trackTitle?: string;
  }) {
    const member = await prisma.travelRoomMember.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
    });

    if (!member) {
      throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_NOT_FOUND);
    }

    const momentLog = input.momentLogId
      ? await prisma.momentLog.findFirst({ where: { id: input.momentLogId, userId } })
      : undefined;

    if (input.momentLogId && !momentLog) {
      throw notFound(ERROR_MESSAGES.MOMENT_LOG_NOT_FOUND);
    }

    const track = input.trackId ? await prisma.track.findUnique({ where: { id: input.trackId } }) : undefined;
    const trackSnapshot =
      (momentLog?.trackSnapshot as TrackDto | null | undefined) ??
      createTrackSnapshot(track, {
        artistName: input.artistName,
        trackId: input.trackId,
        trackTitle: input.trackTitle,
      });

    const roomMoment = await prisma.travelRoomMoment.create({
      data: {
        id: createPublicId('room_moment'),
        roomId,
        userId,
        momentLogId: momentLog?.id ?? input.momentLogId,
        note: input.note,
        placeName: input.placeName ?? momentLog?.placeName,
        status: input.status ?? 'candidate',
        trackSnapshot: trackSnapshot ? toInputJson(trackSnapshot) : undefined,
      },
    });
    await touchTravelRoom(roomId);

    await recordCommunityRecommendationEvent(userId, 'shared_moment_added', {
      roomId,
      momentId: roomMoment.id,
      placeName: roomMoment.placeName,
    }, {
      sessionId: roomId,
      trackId: (roomMoment.trackSnapshot as TrackDto | null)?.id,
    });

    return {
      id: roomMoment.id,
      userId: roomMoment.userId,
      momentLogId: roomMoment.momentLogId ?? undefined,
      note: roomMoment.note ?? undefined,
      placeName: roomMoment.placeName ?? undefined,
      status: roomMoment.status,
      track: (roomMoment.trackSnapshot as TrackDto | null) ?? undefined,
      createdAt: roomMoment.createdAt.toISOString(),
    };
  },

  async updateTravelRoomMoment(userId: string, roomId: string, momentId: string, input: {
    status: string;
  }) {
    const room = await prisma.travelRoom.findFirst({
      where: {
        id: roomId,
        ownerId: userId,
      },
    });

    if (!room) {
      throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_NOT_FOUND);
    }

    const moment = await prisma.travelRoomMoment.findFirst({
      where: { id: momentId, roomId },
    });

    if (!moment) {
      throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_MOMENT_NOT_FOUND);
    }

    const updated = await prisma.travelRoomMoment.update({
      where: { id: moment.id },
      data: { status: input.status },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    });
    await touchTravelRoom(roomId);

    await recordCommunityRecommendationEvent(userId, 'shared_moment_status_updated', {
      roomId,
      momentId,
      status: input.status,
    }, { sessionId: room.sessionId ?? roomId });

    return {
      id: updated.id,
      userId: updated.userId,
      momentLogId: updated.momentLogId ?? undefined,
      note: updated.note ?? undefined,
      placeName: updated.placeName ?? undefined,
      status: updated.status,
      track: (updated.trackSnapshot as TrackDto | null) ?? undefined,
      commentCount: updated.comments.length,
      comments: updated.comments.map((comment) => ({
        id: comment.id,
        userId: comment.userId,
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
      })),
      createdAt: updated.createdAt.toISOString(),
    };
  },

  async addTravelRoomMomentComment(userId: string, roomId: string, momentId: string, input: {
    body: string;
  }) {
    const member = await prisma.travelRoomMember.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
    });

    if (!member) {
      throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_NOT_FOUND);
    }

    const moment = await prisma.travelRoomMoment.findFirst({
      where: { id: momentId, roomId },
      include: { room: true },
    });

    if (!moment) {
      throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_MOMENT_NOT_FOUND);
    }

    const comment = await prisma.travelRoomMomentComment.create({
      data: {
        body: input.body,
        momentId: moment.id,
        userId,
      },
    });
    await touchTravelRoom(roomId);

    await recordCommunityRecommendationEvent(userId, 'shared_moment_commented', {
      roomId,
      momentId,
    }, { sessionId: moment.room.sessionId ?? roomId });

    return {
      id: comment.id,
      userId: comment.userId,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };
  },

  async createTravelRoomRecap(
    userId: string,
    roomId: string,
    input: {
      representativeTrackId?: string;
      templateId?: string;
      title?: string;
    },
    idempotencyKey?: string,
  ) {
    return withIdempotency(
      { idempotencyKey, scope: `travel-room-recap.create.${roomId}`, userId },
      async () => {
        const room = await prisma.travelRoom.findFirst({
          where: {
            id: roomId,
            ownerId: userId,
          },
          include: {
            moments: { orderBy: { createdAt: 'asc' } },
          },
        });

        if (!room) {
          throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_NOT_FOUND);
        }

        const recapMoments = room.moments.some((moment) => moment.status === 'accepted')
          ? room.moments.filter((moment) => moment.status === 'accepted')
          : room.moments;
        const momentTracks = recapMoments
          .map((moment) => (moment.trackSnapshot as TrackDto | null)?.id)
          .filter((trackId): trackId is string => Boolean(trackId));
        const representativeTrackId = input.representativeTrackId ?? momentTracks[0] ?? 'seoul-city';
        const track = await prisma.track.findUnique({ where: { id: representativeTrackId } });

        if (!track) {
          throw notFound(ERROR_MESSAGES.REPRESENTATIVE_TRACK_NOT_FOUND);
        }

        const recap = await prisma.recap.create({
          data: {
            id: createPublicId('recap'),
            userId,
            title: input.title ?? `${room.title} 공동 Recap`,
            placeName: recapMoments[0]?.placeName ?? room.title,
            representativeTrackId: track.id,
            momentCount: recapMoments.length,
            sessionId: room.sessionId,
            recordedAt: recapMoments[0]?.createdAt ?? new Date(),
            templateId: input.templateId ?? 'album',
            visibility: 'private',
            moments: recapMoments.map((moment) => {
              const momentTrack = (moment.trackSnapshot as TrackDto | null) ?? undefined;
              return {
                id: moment.id,
                placeName: moment.placeName ?? '위치 없음',
                trackTitle: momentTrack?.title ?? '저장된 순간',
                artistName: momentTrack?.artist ?? '음악 없음',
                recordedAt: moment.createdAt.toISOString(),
              };
            }) as Prisma.JsonArray,
          },
          include: { representativeTrack: true },
        });

        await recordCommunityRecommendationEvent(userId, 'collab_recap_created', {
          roomId,
          recapId: recap.id,
          templateId: input.templateId,
        }, {
          sessionId: room.sessionId ?? roomId,
          trackId: track.id,
        });

        return compact({
          ...recapItemToDto(recap, userId),
          roomId,
          templateId: input.templateId,
        });
      },
    );
  },

  async upsertSoundMapCurrentTrack(userId: string, input: {
    artistName?: string;
    location: { lat: number; lng: number };
    moodTags?: string[];
    placeName?: string;
    sessionId?: string;
    trackId?: string;
    trackTitle?: string;
    travelMode?: string;
    ttlMinutes?: number;
    visibility: CommunityVisibility;
  }) {
    if (!input.sessionId) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_SESSION_ACTIVE_REQUIRED);
    }

    const session = await prisma.travelSession.findFirst({
      where: {
        id: input.sessionId,
        status: 'active',
        userId,
      },
    });

    if (!session) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_SESSION_ACTIVE_REQUIRED);
    }

    const track = input.trackId ? await prisma.track.findUnique({ where: { id: input.trackId } }) : undefined;
    const trackSnapshot = createTrackSnapshot(track, {
      artistName: input.artistName,
      trackId: input.trackId,
      trackTitle: input.trackTitle,
    });
    const trackSnapshotValue = trackSnapshot ? toInputJson(trackSnapshot) : Prisma.JsonNull;
    const expiresAt = new Date(Date.now() + (input.ttlMinutes ?? 120) * 60_000);
    const pin = await prisma.soundMapPin.upsert({
      where: { userId },
      update: {
        approxLat: normalizeApproxCoordinate(input.location.lat),
        approxLng: normalizeApproxCoordinate(input.location.lng),
        expiresAt,
        lat: input.location.lat,
        lng: input.location.lng,
        moodTags: input.moodTags ?? [],
        placeName: input.placeName,
        sessionId: session.id,
        trackSnapshot: trackSnapshotValue,
        travelMode: input.travelMode ?? session.travelMode,
        visibility: input.visibility,
      },
      create: {
        id: createPublicId('sound_pin'),
        approxLat: normalizeApproxCoordinate(input.location.lat),
        approxLng: normalizeApproxCoordinate(input.location.lng),
        expiresAt,
        lat: input.location.lat,
        lng: input.location.lng,
        moodTags: input.moodTags ?? [],
        placeName: input.placeName,
        sessionId: session.id,
        trackSnapshot: trackSnapshotValue,
        travelMode: input.travelMode ?? session.travelMode,
        userId,
        visibility: input.visibility,
      },
      include: {
        user: {
          select: {
            displayName: true,
            profile: {
              select: {
                preferredGenres: true,
                preferredMoods: true,
                travelStyles: true,
              },
            },
          },
        },
      },
    });

    await recordCommunityRecommendationEvent(userId, 'live_track_shared', {
      placeName: input.placeName,
      visibility: input.visibility,
    }, {
      sessionId: session.id,
      trackId: trackSnapshot?.id,
      value: input.visibility,
    });

    return soundMapPinToDto(pin, userId, input.visibility !== 'nearby');
  },

  async getSoundMapPins(userId: string, query: {
    lat?: number;
    lng?: number;
    radiusMeters?: number;
    visibility?: string;
  }) {
    const [hiddenUserIds, companionUserIds] = await Promise.all([
      getCommunityHiddenUserIds(userId),
      getCompanionUserIds(userId),
    ]);
    const visibilityScope =
      query.visibility === 'nearby'
        ? { visibility: 'nearby' }
        : query.visibility === 'companions'
          ? {
              OR: [
                { userId },
                {
                  userId: { in: companionUserIds },
                  visibility: 'companions',
                },
              ],
            }
          : {
              OR: [
                { userId },
                { visibility: 'nearby' },
                {
                  userId: { in: companionUserIds },
                  visibility: 'companions',
                },
              ],
            };
    const pins = await prisma.soundMapPin.findMany({
      where: {
        AND: [
          { expiresAt: { gt: new Date() } },
          { userId: { notIn: hiddenUserIds } },
          visibilityScope,
        ],
      },
      include: {
        user: {
          select: {
            displayName: true,
            profile: {
              select: {
                preferredGenres: true,
                preferredMoods: true,
                travelStyles: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    const scopedPins = hasGeoPoint(query)
      ? filterPinsByRadius(pins, query)
      : pins.filter((pin) => pin.userId === userId);

    await recordCommunityRecommendationEvent(userId, 'sound_map_viewed', {
      hasLocation: hasGeoPoint(query),
      radiusMeters: query.radiusMeters,
      visibility: query.visibility,
    });

    return scopedPins.map((pin) => soundMapPinToDto(pin, userId, false));
  },

  async getNearbySoundMatches(userId: string, query: {
    lat?: number;
    lng?: number;
    mood?: string;
    radiusMeters?: number;
    state?: string;
  }) {
    if (!hasGeoPoint(query)) {
      await recordCommunityRecommendationEvent(userId, 'nearby_sound_opened', {
        hasLocation: false,
        radiusMeters: query.radiusMeters,
      });
      return [];
    }

    const hiddenUserIds = await getCommunityHiddenUserIds(userId);
    const pins = await prisma.soundMapPin.findMany({
      where: {
        AND: [
          { userId: { not: userId } },
          { userId: { notIn: hiddenUserIds } },
        ],
        expiresAt: { gt: new Date() },
        visibility: 'nearby',
      },
      include: {
        user: {
          select: {
            displayName: true,
            profile: {
              select: {
                preferredGenres: true,
                preferredMoods: true,
                travelStyles: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    await recordCommunityRecommendationEvent(userId, 'nearby_sound_opened', {
      hasLocation: true,
      mood: query.mood,
      radiusMeters: query.radiusMeters,
      state: query.state,
    });

    return filterPinsByRadius(pins, query).map((pin) => ({
        ...soundMapPinToDto(pin, userId, false),
        matchScore: scoreMatch(pin, query),
        targetPinId: pin.id,
      }));
  },

  async getMusicMatches(userId: string, query: {
    lat?: number;
    lng?: number;
    mood?: string;
    radiusMeters?: number;
    state?: string;
  }) {
    const pins = await this.getNearbySoundMatches(userId, query);

    await recordCommunityRecommendationEvent(userId, 'music_match_viewed', {
      hasLocation: hasGeoPoint(query),
      mood: query.mood,
      radiusMeters: query.radiusMeters,
      state: query.state,
    });

    return pins
      .map((pin) => ({
        id: `match-${pin.id}`,
        pin,
        targetPinId: pin.targetPinId,
        matchScore: pin.matchScore,
        safety: {
          exactLocationHidden: true,
          firstMessageTemplates: ['liked_track', 'walk_together', 'cafe_together'],
          contactHiddenUntilAccepted: true,
        },
      }))
      .sort((first, second) => second.matchScore - first.matchScore);
  },

  async createTravelMateRequest(userId: string, input: {
    messageTemplate: string;
    targetPinId?: string;
    targetUserId?: string;
  }) {
    const targetPin = input.targetPinId
      ? await prisma.soundMapPin.findUnique({ where: { id: input.targetPinId } })
      : undefined;
    const targetUserId = input.targetUserId ?? targetPin?.userId;

    if (!targetUserId) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_MATE_TARGET_REQUIRED);
    }

    if (targetUserId === userId) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_MATE_SELF_REQUEST_NOT_ALLOWED);
    }

    if (targetPin && (targetPin.visibility !== 'nearby' || targetPin.expiresAt <= new Date())) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_MATE_TARGET_REQUIRED);
    }

    if (await hasCommunityBlockBetween(userId, targetUserId)) {
      throw forbidden(ERROR_MESSAGES.TRAVEL_MATE_REQUEST_BLOCKED);
    }

    const existingActiveRequest = await prisma.travelMateRequest.findFirst({
      where: {
        requesterId: userId,
        status: { in: ['pending', 'accepted'] },
        targetUserId,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingActiveRequest) {
      return mateRequestToDto(existingActiveRequest);
    }

    const recentClosedRequest = await prisma.travelMateRequest.findFirst({
      where: {
        requesterId: userId,
        status: { in: CLOSED_TRAVEL_MATE_REQUEST_STATUSES },
        targetUserId,
        updatedAt: {
          gte: new Date(Date.now() - TRAVEL_MATE_REQUEST_COOLDOWN_MS),
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (recentClosedRequest) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_MATE_REQUEST_RATE_LIMITED, {
        cooldownHours: TRAVEL_MATE_REQUEST_COOLDOWN_MS / 60 / 60 / 1000,
        requestId: recentClosedRequest.id,
      });
    }

    const request = await prisma.travelMateRequest.create({
      data: {
        id: createPublicId('mate'),
        messageTemplate: input.messageTemplate,
        requesterId: userId,
        status: 'pending',
        targetPinId: input.targetPinId,
        targetUserId,
      },
    });

    await recordCommunityRecommendationEvent(userId, 'travel_mate_requested', {
      requestId: request.id,
      targetPinId: request.targetPinId,
      targetUserId: request.targetUserId,
    }, { sessionId: request.targetPinId ?? request.id });

    return mateRequestToDto(request);
  },

  async getTravelMateRequests(userId: string, query: {
    box?: string;
    limit?: number;
    status?: string;
  }) {
    const ownershipWhere =
      query.box === 'inbox'
        ? { targetUserId: userId }
        : query.box === 'sent'
          ? { requesterId: userId }
          : {
              OR: [
                { requesterId: userId },
                { targetUserId: userId },
              ],
            };

    const requests = await prisma.travelMateRequest.findMany({
      where: {
        ...ownershipWhere,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: getLimit(query.limit),
    });

    return requests.map(mateRequestToDto);
  },

  async updateTravelMateRequest(userId: string, requestId: string, input: { action: string }) {
    const request = await prisma.travelMateRequest.findUnique({ where: { id: requestId } });

    if (!request || (request.requesterId !== userId && request.targetUserId !== userId)) {
      throw notFound(ERROR_MESSAGES.TRAVEL_MATE_REQUEST_NOT_FOUND);
    }

    const targetOnlyActions = new Set(['accept', 'decline']);
    if (targetOnlyActions.has(input.action) && request.targetUserId !== userId) {
      throw forbidden(ERROR_MESSAGES.TRAVEL_MATE_REQUEST_ACTION_NOT_ALLOWED);
    }

    if (input.action === 'cancel' && request.requesterId !== userId) {
      throw forbidden(ERROR_MESSAGES.TRAVEL_MATE_REQUEST_ACTION_NOT_ALLOWED);
    }

    if (request.status !== 'pending' && input.action !== 'expire') {
      throw badRequest(ERROR_MESSAGES.TRAVEL_MATE_REQUEST_NOT_PENDING);
    }

    const nextStatusByAction: Record<string, string> = {
      accept: 'accepted',
      cancel: 'cancelled',
      decline: 'declined',
      expire: 'expired',
    };
    const updated = await prisma.travelMateRequest.update({
      where: { id: request.id },
      data: { status: nextStatusByAction[input.action] ?? request.status },
    });

    await recordCommunityRecommendationEvent(userId, `travel_mate_${updated.status}`, {
      requestId: updated.id,
      targetPinId: updated.targetPinId,
      targetUserId: updated.targetUserId,
    }, { sessionId: updated.targetPinId ?? updated.id });

    return mateRequestToDto(updated);
  },

  async blockCommunityUser(userId: string, input: { targetPinId?: string; targetUserId?: string }) {
    const targetPin = input.targetPinId
      ? await prisma.soundMapPin.findUnique({ where: { id: input.targetPinId } })
      : undefined;
    const targetUserId = input.targetUserId ?? targetPin?.userId;

    if (!targetUserId) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_MATE_TARGET_REQUIRED);
    }

    if (targetUserId === userId) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_MATE_SELF_REQUEST_NOT_ALLOWED);
    }

    await prisma.communityBlock.upsert({
      where: {
        blockerId_blockedUserId: {
          blockedUserId: targetUserId,
          blockerId: userId,
        },
      },
      update: {},
      create: {
        blockedUserId: targetUserId,
        blockerId: userId,
      },
    });

    await prisma.travelMateRequest.updateMany({
      where: {
        OR: [
          { requesterId: userId, targetUserId },
          { requesterId: targetUserId, targetUserId: userId },
        ],
        status: 'pending',
      },
      data: { status: 'cancelled' },
    });

    await recordCommunityRecommendationEvent(userId, 'community_user_blocked', {
      targetPinId: input.targetPinId,
      targetUserId,
    }, { sessionId: input.targetPinId ?? targetUserId });
  },

  async reportCommunityTarget(userId: string, input: {
    details?: string;
    reason: string;
    requestId?: string;
    targetPinId?: string;
    targetUserId?: string;
  }) {
    await prisma.communityReport.create({
      data: {
        details: input.details,
        reason: input.reason,
        reporterId: userId,
        requestId: input.requestId,
        targetPinId: input.targetPinId,
        targetUserId: input.targetUserId,
      },
    });

    await recordCommunityRecommendationEvent(userId, 'community_user_reported', {
      reason: input.reason,
      requestId: input.requestId,
      targetPinId: input.targetPinId,
      targetUserId: input.targetUserId,
    }, { sessionId: input.requestId ?? input.targetPinId ?? input.targetUserId ?? 'community' });
  },

  async getRecaps(userId: string, params: {
    cursor?: string;
    limit?: number;
    scope?: RecapListScope;
  }) {
    const scope = params.scope ?? 'mine';
    const scopeWhere: Prisma.RecapWhereInput =
      scope === 'mine'
        ? { userId }
        : scope === 'others'
          ? { userId: { not: userId }, visibility: 'public' }
          : {
              OR: [
                { userId },
                { userId: { not: userId }, visibility: 'public' },
              ],
            };
    const recaps = await prisma.recap.findMany({
      where: {
        AND: [{ sessionId: { not: null } }, scopeWhere],
      },
      include: { representativeTrack: true },
      orderBy: { createdAt: 'desc' },
    });
    const visibleRecaps = recaps.filter(
      (recap) => recap.userId === userId || getVisibleRecapMoments(recap, userId).length > 0,
    );
    const limit = getLimit(params.limit);
    const page = paginateByCursor(visibleRecaps, limit, params.cursor);

    return {
      data: page.items.map((recap) => recapItemToDto(recap, userId)),
      page: {
        limit,
        nextCursor: page.nextCursor,
      },
    };
  },

  async getRecapMarkers(
    userId: string,
    params: {
      lat?: number;
      lng?: number;
      radiusMeters?: number;
      scope?: RecapMapScope;
    },
  ) {
    const scope = params.scope ?? 'public';
    const origin =
      scope === 'public' && hasGeoPoint(params)
        ? { lat: params.lat!, lng: params.lng! }
        : undefined;
    const radiusMeters = params.radiusMeters ?? RECAP_DISCOVERY_RADIUS_METERS;
    const recaps = await prisma.recap.findMany({
      where: scope === 'mine'
        ? { userId }
        : { visibility: 'public' },
      include: {
        representativeTrack: true,
        user: {
          select: {
            displayName: true,
            id: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return recaps
      .flatMap((recap) => {
        const marker = recapMapMarkerToDto(recap, userId, origin);

        return marker && (recap.userId === userId || getVisibleRecapMoments(recap, userId).length)
          ? [marker]
          : [];
      })
      .filter((marker) =>
        origin
          ? typeof marker.distanceMeters === 'number' &&
            marker.distanceMeters <= radiusMeters
          : true,
      );
  },

  async createRecap(
    userId: string,
    input: {
      momentLogIds?: string[];
      representativeTrackId?: string;
      routePoints?: RoutePointDto[];
      sessionId?: string;
      templateId: string;
      title?: string;
      visibility?: RecapVisibility;
    },
    idempotencyKey?: string,
  ) {
    return withIdempotency(
      { idempotencyKey, scope: 'recap.create', userId },
      async () => {
        if (!input.sessionId && !input.momentLogIds?.length) {
          throw badRequest(ERROR_MESSAGES.RECAP_LOG_REQUIRES_CAPTURE);
        }

        const moments = await prisma.momentLog.findMany({
          where: {
            userId,
            id: input.momentLogIds?.length ? { in: input.momentLogIds } : undefined,
            sessionId: input.sessionId,
          },
          orderBy: { createdAt: 'asc' },
        });
        const requestedMomentIds = Array.from(new Set(input.momentLogIds ?? []));

        if (requestedMomentIds.length > 0 && moments.length !== requestedMomentIds.length) {
          throw badRequest(ERROR_MESSAGES.RECAP_LOG_CAPTURE_MISMATCH);
        }

        if (
          !input.sessionId &&
          (requestedMomentIds.length !== 1 || moments.some((moment) => moment.sessionId))
        ) {
          throw badRequest(ERROR_MESSAGES.RECAP_LOG_CAPTURE_MISMATCH);
        }

        if (moments.length === 0) {
          throw badRequest(ERROR_MESSAGES.RECAP_LOG_REQUIRES_CAPTURE);
        }

        let travelSession = input.sessionId
          ? await prisma.travelSession.findUnique({
              where: { id: input.sessionId },
            })
          : undefined;

        if (travelSession && travelSession.userId !== userId) {
          throw badRequest(ERROR_MESSAGES.RECAP_LOG_CAPTURE_MISMATCH);
        }

        if (input.sessionId && !travelSession) {
          const recoveredRoutePoints = normalizeRoutePoints(input.routePoints);
          const recordedAt = moments.at(-1)?.createdAt ?? new Date();
          const firstRoutePoint = input.routePoints?.[0];
          const lastRoutePoint = input.routePoints?.at(-1);

          travelSession = await prisma.travelSession.create({
            data: {
              id: input.sessionId,
              userId,
              status: 'ended',
              startedAt: firstRoutePoint
                ? new Date(firstRoutePoint.recordedAt)
                : moments[0]?.createdAt ?? recordedAt,
              endedAt: lastRoutePoint
                ? new Date(lastRoutePoint.recordedAt)
                : recordedAt,
              routePoints: recoveredRoutePoints,
            },
          });
        }

        if (input.sessionId) {
          const existingLog = await prisma.recap.findUnique({
            where: { travelSessionId: input.sessionId },
            include: { representativeTrack: true },
          });

          if (existingLog) {
            if (existingLog.userId !== userId) {
              throw badRequest(ERROR_MESSAGES.RECAP_LOG_CAPTURE_MISMATCH);
            }

            return recapItemToDto(existingLog, userId);
          }
        }
        const sessionRoutePoints = routePointsToDto(travelSession?.routePoints);
        const routePoints =
          normalizeRoutePoints(input.routePoints) ??
          normalizeRoutePoints(sessionRoutePoints);
        const momentTrackSnapshots = [...moments]
          .reverse()
          .map((moment) => moment.trackSnapshot as TrackDto | null)
          .filter((snapshot): snapshot is TrackDto => Boolean(snapshot?.id));
        const candidateTrackIds = input.representativeTrackId
          ? [input.representativeTrackId]
          : Array.from(new Set(momentTrackSnapshots.map((snapshot) => snapshot.id)));
        const candidateTracks = candidateTrackIds.length
          ? await prisma.track.findMany({ where: { id: { in: candidateTrackIds } } })
          : [];
        const representativeTrackId =
          input.representativeTrackId ?? candidateTrackIds[0] ?? NO_MUSIC_TRACK_ID;
        const representativeTrackSnapshot = momentTrackSnapshots.find(
          (snapshot) => snapshot.id === representativeTrackId,
        );
        let track =
          candidateTracks.find((candidateTrack) => candidateTrack.id === representativeTrackId) ??
          (await prisma.track.findUnique({ where: { id: representativeTrackId } }));

        if (!track && representativeTrackSnapshot) {
          track = await prisma.track.upsert({
            where: { id: representativeTrackSnapshot.id },
            update: {},
            create: {
              id: representativeTrackSnapshot.id,
              albumImageUrl: representativeTrackSnapshot.albumImageUrl,
              artist: representativeTrackSnapshot.artist,
              externalUrl: representativeTrackSnapshot.externalUrl,
              fallbackColor: representativeTrackSnapshot.fallbackColor,
              platformUrls: representativeTrackSnapshot.platformUrls
                ? toInputJson(representativeTrackSnapshot.platformUrls)
                : undefined,
              title: representativeTrackSnapshot.title,
            },
          });
        }

        if (!track && representativeTrackId === NO_MUSIC_TRACK_ID) {
          track = await prisma.track.upsert({
            where: { id: NO_MUSIC_TRACK_ID },
            update: {},
            create: {
              id: NO_MUSIC_TRACK_ID,
              artist: 'Soundlog',
              fallbackColor: '#252A38',
              title: '음악 없음',
            },
          });
        }

        if (!track) {
          throw notFound(ERROR_MESSAGES.REPRESENTATIVE_TRACK_NOT_FOUND);
        }

        const representativeMoment = moments.at(-1)!;
        const thumbnailMoment = moments[0]!;
        const representativeMomentLocation =
          representativeMoment.lat !== null &&
          representativeMoment.lng !== null
            ? {
                lat: representativeMoment.lat,
                lng: representativeMoment.lng,
              }
            : undefined;
        const firstRoutePoint = input.routePoints?.[0] ?? sessionRoutePoints?.[0];
        const recapLocation = representativeMomentLocation ?? (
          firstRoutePoint
            ? { lat: firstRoutePoint.lat, lng: firstRoutePoint.lng }
            : undefined
        );

        const hasPublicLocatedMoment = moments.some(
          (moment) =>
            moment.visibility === 'public' &&
            moment.lat !== null &&
            moment.lng !== null,
        );

        if (input.visibility === 'public' && !hasPublicLocatedMoment) {
          throw badRequest(ERROR_MESSAGES.RECAP_LOG_PUBLIC_CAPTURE_REQUIRED);
        }

        let recap: Recap & { representativeTrack: Track };

        try {
          recap = await prisma.recap.create({
            data: {
            id: createPublicId('recap'),
            userId,
            title: input.title ?? `${representativeMoment.placeName ?? '여행'}의 사운드`,
            placeName: representativeMoment.placeName ?? 'Soundlog',
            representativeTrackId: track.id,
            momentCount: moments.length,
            sessionId: input.sessionId,
            travelSessionId: input.sessionId,
            backgroundImageUrl: thumbnailMoment.photoUrl,
            discImageUrl: representativeMoment.photoUrl,
            recordedAt: representativeMoment.createdAt,
            moments: moments.map(momentLogToRecapShareMoment) as Prisma.JsonArray,
            routePoints,
            templateId: input.templateId,
            thumbnailMomentId: thumbnailMoment.id,
            visibility: input.visibility ?? 'private',
            lat: recapLocation?.lat,
            lng: recapLocation?.lng,
            },
            include: { representativeTrack: true },
          });
        } catch (error) {
          if (
            input.sessionId &&
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            const concurrentLog = await prisma.recap.findUnique({
              where: { travelSessionId: input.sessionId },
              include: { representativeTrack: true },
            });

            if (concurrentLog?.userId === userId) {
              return recapItemToDto(concurrentLog, userId);
            }
          }

          throw error;
        }

        return recapItemToDto(recap, userId);
      },
    );
  },

  async getRecapShare(userId: string, recapId: string) {
    const recap = await prisma.recap.findFirst({
      where: {
        id: recapId,
        OR: [
          { userId },
          { visibility: 'public' },
        ],
      },
      include: { representativeTrack: true, travelSession: true },
    });

    if (!recap) {
      throw notFound(ERROR_MESSAGES.RECAP_NOT_FOUND);
    }

    if (recap.userId !== userId && getVisibleRecapMoments(recap, userId).length === 0) {
      throw notFound(ERROR_MESSAGES.RECAP_NOT_FOUND);
    }

    return recapShareToDto(recap, userId, recap.travelSession ?? undefined);
  },

  async updateRecapVisibility(
    userId: string,
    recapId: string,
    input: { visibility: RecapVisibility },
  ) {
    const recap = await prisma.recap.findFirst({
      where: {
        id: recapId,
        userId,
      },
    });

    if (!recap) {
      throw notFound(ERROR_MESSAGES.RECAP_NOT_FOUND);
    }

    const memberMomentIds = recapMomentsToDto(recap).map((moment) => moment.id);

    if (input.visibility === 'public' && recap.sessionId) {
      const hasPublicLocatedMoment = recapMomentsToDto(recap).some(
        (moment) =>
          moment.visibility === 'public' &&
          typeof moment.location?.lat === 'number' &&
          typeof moment.location?.lng === 'number',
      );

      if (!hasPublicLocatedMoment) {
        throw badRequest(ERROR_MESSAGES.RECAP_LOG_PUBLIC_CAPTURE_REQUIRED);
      }
    }

    const updatedRecap = await prisma.$transaction(async (transaction) => {
      if (!recap.sessionId) {
        const moments = await transaction.momentLog.findMany({
          where: {
            id: { in: memberMomentIds },
            userId,
          },
        });
        const locatedMoment = moments.find(
          (moment) => moment.lat !== null && moment.lng !== null,
        );

        assertPublicRecapHasLocation(
          input.visibility,
          locatedMoment && locatedMoment.lat !== null && locatedMoment.lng !== null
            ? { lat: locatedMoment.lat, lng: locatedMoment.lng }
            : undefined,
        );

        await transaction.momentLog.updateMany({
          where: {
            id: { in: memberMomentIds },
            userId,
          },
          data: { visibility: input.visibility },
        });
      }

      await transaction.recap.update({
        where: { id: recapId },
        data: { visibility: input.visibility },
      });

      await refreshRecapAggregates(transaction, {
        momentIds: memberMomentIds,
        sessionIds: [recap.sessionId],
        userId,
      });

      return transaction.recap.findUniqueOrThrow({
        where: { id: recapId },
        include: { representativeTrack: true },
      });
    });

    return recapItemToDto(updatedRecap, userId);
  },

  async updateRecapThumbnail(
    userId: string,
    recapId: string,
    input: { momentId: string },
  ) {
    const recap = await prisma.recap.findFirst({
      where: {
        id: recapId,
        userId,
      },
    });

    if (!recap) {
      throw notFound(ERROR_MESSAGES.RECAP_NOT_FOUND);
    }

    if (!recap.sessionId) {
      throw badRequest(ERROR_MESSAGES.RECAP_THUMBNAIL_LOG_REQUIRED);
    }

    if (!recapMomentsToDto(recap).some((moment) => moment.id === input.momentId)) {
      throw badRequest(ERROR_MESSAGES.RECAP_THUMBNAIL_MOMENT_NOT_FOUND);
    }

    const thumbnailMoment = await prisma.momentLog.findFirst({
      where: {
        id: input.momentId,
        sessionId: recap.sessionId,
        userId,
      },
    });

    if (!thumbnailMoment) {
      throw badRequest(ERROR_MESSAGES.RECAP_THUMBNAIL_MOMENT_NOT_FOUND);
    }

    const updatedRecap = await prisma.recap.update({
      where: { id: recapId },
      data: {
        backgroundImageUrl: thumbnailMoment.photoUrl,
        thumbnailMomentId: thumbnailMoment.id,
      },
      include: { representativeTrack: true },
    });

    return recapItemToDto(updatedRecap, userId);
  },

  async createRecapShareEvent(
    userId: string,
    recapId: string,
    input: { createdAt: string; type: string },
    idempotencyKey?: string,
  ) {
    await withIdempotency(
      { idempotencyKey, scope: `recap-share-event.${recapId}`, userId },
      async () => {
        const recap = await prisma.recap.findFirst({
          where: {
            id: recapId,
            userId,
          },
        });

        if (!recap) {
          throw notFound(ERROR_MESSAGES.RECAP_NOT_FOUND);
        }

        await prisma.recapShareEvent.create({
          data: {
            recapId,
            userId,
            type: input.type,
            createdAt: new Date(input.createdAt),
          },
        });

        return { accepted: true };
      },
    );
  },

  async createTravelSession(
    userId: string,
    input: {
      location?: { lat: number; lng: number };
      routePoints?: RoutePointDto[];
      startedAt?: string;
      travelMode?: string;
    },
  ) {
    const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
    const routePoints =
      normalizeRoutePoints(input.routePoints) ??
      createInitialRoutePoints(input.location, startedAt);

    const session = await prisma.travelSession.create({
      data: {
        id: createPublicId('session'),
        userId,
        status: 'active',
        startedAt,
        travelMode: input.travelMode,
        lat: input.location?.lat,
        lng: input.location?.lng,
        routePoints,
      },
    });

    return travelSessionToDto(session);
  },

  async updateTravelSession(
    userId: string,
    sessionId: string,
    input: {
      endedAt?: string;
      location?: { lat: number; lng: number };
      routePoints?: RoutePointDto[];
      status: 'active' | 'ended';
      travelMode?: string;
    },
  ) {
    const session = await prisma.travelSession.findFirst({
      where: {
        id: sessionId,
        userId,
      },
    });

    if (!session) {
      throw notFound(ERROR_MESSAGES.TRAVEL_SESSION_NOT_FOUND);
    }

    if (session.status === 'ended' && input.status === 'active') {
      throw badRequest(ERROR_MESSAGES.ENDED_TRAVEL_SESSION_CANNOT_ACTIVATE);
    }

    const routePoints = normalizeRoutePoints(input.routePoints);

    const updated = await prisma.travelSession.update({
      where: { id: sessionId },
      data: {
        status: input.status,
        endedAt:
          input.status === 'ended'
            ? input.endedAt
              ? new Date(input.endedAt)
              : new Date()
            : undefined,
        lat: input.location?.lat,
        lng: input.location?.lng,
        routePoints,
        travelMode: input.travelMode,
      },
    });

    if (updated.status === 'ended') {
      await prisma.soundMapPin.updateMany({
        where: {
          sessionId,
          userId,
        },
        data: {
          expiresAt: new Date(),
          visibility: 'private',
        },
      });
    }

    return travelSessionToDto(updated);
  },

  async getRegionSoundTrend(params: { period: string; regionCode: string }) {
    const trend = await prisma.regionSoundTrend.findUnique({
      where: {
        regionCode_period: {
          regionCode: params.regionCode,
          period: params.period,
        },
      },
    });

    if (!trend) {
      throw notFound(ERROR_MESSAGES.REGION_SOUND_TREND_NOT_FOUND);
    }

    return regionTrendToDto(trend);
  },
};

async function regionTrendToDto(trend: RegionSoundTrend) {
  const tracks = await prisma.track.findMany({
    where: {
      id: { in: trend.topTrackIds },
    },
  });
  const order = new Map(trend.topTrackIds.map((id, index) => [id, index]));

  return {
    regionCode: trend.regionCode,
    regionName: trend.regionName,
    period: trend.period,
    topMoodTags: trend.topMoodTags,
    topTracks: tracks
      .sort((first, second) => (order.get(first.id) ?? 0) - (order.get(second.id) ?? 0))
      .map((track) => trackToDto(track)),
    sampleSize: trend.sampleSize ?? undefined,
  };
}
