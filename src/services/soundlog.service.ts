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

type RecommendationContext = Record<string, unknown>;
type CommunityVisibility = 'companions' | 'nearby' | 'private';
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

type MlRecommendationResponse = {
  tracks?: unknown;
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
  trackId?: string;
  trackTitle?: string;
  travelMode?: string | null;
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

async function fetchMlRecommendationPlaylist(input: ContextualPlaylistInput) {
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
      coverImageUrl: undefined,
      backgroundImageUrl: undefined,
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
    });
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
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

function recapItemToDto(recap: Recap & { representativeTrack: Track }) {
  return compact({
    id: recap.id,
    title: recap.title,
    placeName: recap.placeName,
    representativeTrack: trackToDto(recap.representativeTrack),
    createdAt: recap.createdAt.toISOString(),
    momentCount: recap.momentCount ?? undefined,
    sessionId: recap.sessionId ?? undefined,
  });
}

function recapShareToDto(recap: Recap & { representativeTrack: Track }) {
  return compact({
    id: recap.id,
    placeName: recap.placeName,
    trackTitle: recap.representativeTrack.title,
    artistName: recap.representativeTrack.artist,
    backgroundImageUrl: recap.backgroundImageUrl ?? undefined,
    discImageUrl: recap.discImageUrl ?? undefined,
    moments: (recap.moments as Prisma.JsonArray | null) ?? undefined,
    recordedAt: (recap.recordedAt ?? recap.createdAt).toISOString(),
    shareImageUrl: recap.shareImageUrl ?? undefined,
  });
}

function travelSessionToDto(session: TravelSession) {
  return compact({
    id: session.id,
    status: session.status,
    startedAt: session.startedAt?.toISOString(),
    endedAt: session.endedAt?.toISOString(),
    travelMode: session.travelMode ?? undefined,
  });
}

function scoreMoodRecommendation(
  item: MoodRecommendation & { track: Track },
  params: {
    moodFilter?: string;
    preferredGenres?: string[];
    preferredMoods?: string[];
    recommendationMode?: 'everyday' | 'travel';
    topFilter?: string;
    travelStyles?: string[];
  },
) {
  let score = item.sortOrder * -0.01;
  const travelModeWeight = params.recommendationMode === 'travel' ? 2.4 : 1;
  const tasteWeight = params.recommendationMode === 'travel' ? 0.7 : 1.4;

  if (params.topFilter && params.topFilter !== '전체' && item.moods.includes(params.topFilter)) {
    score += 8;
  }

  if (
    params.moodFilter &&
    params.moodFilter !== '전체' &&
    item.moods.includes(params.moodFilter)
  ) {
    score += 8;
  }

  score += (params.preferredGenres ?? []).filter((genre) =>
    item.genres.includes(genre),
  ).length * 3 * tasteWeight;
  score += (params.preferredMoods ?? []).filter((mood) =>
    item.moods.includes(mood),
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
    const tourPlaces = await fetchTourApiPlaces(params);

    if (tourPlaces.length > 0) {
      return tourPlaces.slice(0, getLimit(params.limit, 10));
    }

    const isSouthernContext = params.lat < 36.5;
    const places = await prisma.place.findMany({
      orderBy: [{ distanceMeters: 'asc' }, { title: 'asc' }],
    });
    const sorted = [...places].sort((first, second) => {
      const firstScore = isSouthernContext && first.address?.startsWith('부산') ? -1 : 0;
      const secondScore = isSouthernContext && second.address?.startsWith('부산') ? -1 : 0;
      return firstScore - secondScore;
    });

    return sorted.slice(0, getLimit(params.limit, 10)).map(placeToDto);
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
      topFilter?: string;
      travelStyles?: string[];
    },
  ) {
    const recommendations = await prisma.moodRecommendation.findMany({
      include: { track: true },
      orderBy: { sortOrder: 'asc' },
    });

    return recommendations
      .sort((first, second) => scoreMoodRecommendation(second, params) - scoreMoodRecommendation(first, params))
      .slice(0, getLimit(params.limit))
      .map((item) =>
        compact({
          id: item.id,
          title: item.title,
          subtitle: item.subtitle ?? undefined,
          color: item.color,
          genres: item.genres,
          moods: item.moods,
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
          return mlPlaylist;
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
      return mlPlaylist;
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
      trackId?: string;
      trackTitle?: string;
      travelMode?: string;
    },
    idempotencyKey?: string,
  ) {
    return withIdempotency(
      { idempotencyKey, scope: 'moment-log.create', userId },
      async () => {
        const track = input.trackId
          ? await prisma.track.findUnique({ where: { id: input.trackId } })
          : undefined;
        const photoUrl = input.photoPath
          ? normalizePublicUrl(env.UPLOAD_PUBLIC_BASE_URL, input.photoPath)
          : undefined;
        const id = createPublicId('moment');
        const log = await prisma.momentLog.create({
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
          },
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

    if (hasOwn(input, 'travelMode')) {
      data.travelMode = input.travelMode ?? null;
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

    const updated = await prisma.momentLog.update({
      where: { id: existing.id },
      data,
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

    const updated = await prisma.momentLog.update({
      where: { id: existing.id },
      data: { photoUrl: nextPhotoUrl },
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

    const updated = await prisma.momentLog.update({
      where: { id: existing.id },
      data: { photoUrl: null },
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
      select: { id: true, photoUrl: true },
    });

    if (!existing) {
      throw notFound(ERROR_MESSAGES.MOMENT_LOG_NOT_FOUND);
    }

    await prisma.$transaction([
      prisma.travelRoomMoment.updateMany({
        where: { momentLogId: existing.id },
        data: { momentLogId: null },
      }),
      prisma.momentLog.delete({ where: { id: existing.id } }),
    ]);

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
          ...recapItemToDto(recap),
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

  async getRecaps(userId: string, params: { cursor?: string; limit?: number }) {
    const recaps = await prisma.recap.findMany({
      where: { userId },
      include: { representativeTrack: true },
      orderBy: { createdAt: 'desc' },
    });
    const limit = getLimit(params.limit);
    const page = paginateByCursor(recaps, limit, params.cursor);

    return {
      data: page.items.map(recapItemToDto),
      page: {
        limit,
        nextCursor: page.nextCursor,
      },
    };
  },

  async createRecap(
    userId: string,
    input: {
      momentLogIds?: string[];
      representativeTrackId?: string;
      sessionId?: string;
      templateId: string;
      title?: string;
    },
    idempotencyKey?: string,
  ) {
    return withIdempotency(
      { idempotencyKey, scope: 'recap.create', userId },
      async () => {
        const moments = await prisma.momentLog.findMany({
          where: {
            userId,
            id: input.momentLogIds?.length ? { in: input.momentLogIds } : undefined,
            sessionId: input.sessionId,
          },
          orderBy: { createdAt: 'asc' },
        });
        const candidateTrackIds = input.representativeTrackId
          ? [input.representativeTrackId]
          : Array.from(
              new Set(
                [...moments]
                  .reverse()
                  .map((moment) => (moment.trackSnapshot as TrackDto | null)?.id)
                  .filter((trackId): trackId is string => Boolean(trackId)),
              ),
            );
        const candidateTracks = candidateTrackIds.length
          ? await prisma.track.findMany({ where: { id: { in: candidateTrackIds } } })
          : [];
        const representativeTrackId =
          input.representativeTrackId ??
          candidateTrackIds.find((trackId) =>
            candidateTracks.some((candidateTrack) => candidateTrack.id === trackId),
          ) ??
          'seoul-city';
        const track =
          candidateTracks.find((candidateTrack) => candidateTrack.id === representativeTrackId) ??
          (await prisma.track.findUnique({
            where: { id: representativeTrackId },
          }));

        if (!track) {
          throw notFound(ERROR_MESSAGES.REPRESENTATIVE_TRACK_NOT_FOUND);
        }

        const firstMoment = moments[0];
        const recap = await prisma.recap.create({
          data: {
            id: createPublicId('recap'),
            userId,
            title: input.title ?? `${firstMoment?.placeName ?? '여행'}의 사운드`,
            placeName: firstMoment?.placeName ?? 'Soundlog',
            representativeTrackId: track.id,
            momentCount: moments.length,
            sessionId: input.sessionId,
            backgroundImageUrl: firstMoment?.photoUrl,
            discImageUrl: firstMoment?.photoUrl,
            recordedAt: firstMoment?.createdAt ?? new Date(),
            moments: moments.map((moment) => {
              const momentTrack = (moment.trackSnapshot as TrackDto | null) ?? undefined;
              return {
                id: moment.id,
                imageUrl: moment.photoUrl,
                placeName: moment.placeName ?? '위치 없음',
                trackTitle: momentTrack?.title ?? '저장된 순간',
                artistName: momentTrack?.artist ?? '음악 없음',
                recordedAt: moment.createdAt.toISOString(),
              };
            }) as Prisma.JsonArray,
          },
          include: { representativeTrack: true },
        });

        return recapItemToDto(recap);
      },
    );
  },

  async getRecapShare(userId: string, recapId: string) {
    const recap = await prisma.recap.findFirst({
      where: {
        id: recapId,
        userId,
      },
      include: { representativeTrack: true },
    });

    if (!recap) {
      throw notFound(ERROR_MESSAGES.RECAP_NOT_FOUND);
    }

    return recapShareToDto(recap);
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
      startedAt?: string;
      travelMode?: string;
    },
  ) {
    const session = await prisma.travelSession.create({
      data: {
        id: createPublicId('session'),
        userId,
        status: 'active',
        startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
        travelMode: input.travelMode,
        lat: input.location?.lat,
        lng: input.location?.lng,
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
      status: 'active' | 'ended';
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
