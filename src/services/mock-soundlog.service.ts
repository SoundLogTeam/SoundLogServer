import { env } from '../config/env.js';
import { ERROR_MESSAGES } from '../constants/error.constants.js';
import { findMockTrack, mockDb } from '../mock/mock-db.js';
import { badRequest, forbidden, notFound } from '../utils/http-error.js';
import { getLimit, paginateByCursor } from '../utils/pagination.js';
import { createPublicId } from '../utils/tokens.js';

type TrackDto = {
  albumImageUrl?: string;
  artist: string;
  externalUrl?: string;
  fallbackColor?: string;
  id: string;
  isLiked?: boolean;
  isSaved?: boolean;
  platformUrls?: Record<string, string>;
  title: string;
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

type RecapListScope = 'all' | 'mine' | 'others';
type RecapMapScope = 'mine' | 'public';
type RecapVisibility = 'private' | 'public';
type RoutePointDto = {
  accuracyMeters?: number;
  lat: number;
  lng: number;
  recordedAt: string;
};

const RECAP_DISCOVERY_RADIUS_METERS = 300;
const NO_MUSIC_TRACK_ID = 'soundlog-no-music';
const TRAVEL_MATE_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const CLOSED_TRAVEL_MATE_REQUEST_STATUSES = ['cancelled', 'declined', 'expired'];

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null),
  ) as Partial<T>;
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
    }) as RoutePointDto,
  );
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

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function trackToDto(
  track: NonNullable<ReturnType<typeof findMockTrack>>,
  state?: { isLiked?: boolean; isSaved?: boolean },
): TrackDto {
  return compact({
    ...track,
    isLiked: state?.isLiked,
    isSaved: state?.isSaved,
  }) as TrackDto;
}

function getTrackState(trackId: string) {
  return mockDb.libraryTrackStates.find((state) => state.trackId === trackId);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

async function withMockIdempotency<T>(
  input: {
    idempotencyKey?: string;
    scope: string;
    userId: string;
  },
  handler: () => Promise<T> | T,
) {
  if (!input.idempotencyKey) {
    return handler();
  }

  const existingRecord = mockDb.idempotencyRecords.find(
    (record) =>
      record.idempotencyKey === input.idempotencyKey &&
      record.scope === input.scope &&
      record.userId === input.userId,
  );

  if (existingRecord) {
    return existingRecord.response as T;
  }

  const response = await handler();
  mockDb.idempotencyRecords.push({
    idempotencyKey: input.idempotencyKey,
    response,
    scope: input.scope,
    userId: input.userId,
  });

  return response;
}

function playlistToDto(playlist: (typeof mockDb.playlists)[number]) {
  return compact({
    id: playlist.id,
    regionName: playlist.regionName,
    placeName: playlist.placeName,
    reason: playlist.reason,
    coverImageUrl: playlist.coverImageUrl,
    backgroundImageUrl: playlist.backgroundImageUrl,
    trackCount: playlist.trackIds.length,
    durationText: playlist.durationText,
    tracks: playlist.trackIds
      .map((trackId) => {
        const track = findMockTrack(trackId);
        return track ? trackToDto(track, getTrackState(trackId)) : undefined;
      })
      .filter(Boolean),
  });
}

type MockPlaylistSummarySource = {
  backgroundImageUrl?: string;
  coverImageUrl?: string;
  description?: string;
  durationText: string;
  id: string;
  placeName?: string;
  reason?: string;
  regionName: string;
  trackCount?: number;
  trackIds?: string[];
};

function playlistSummaryToDto(playlist: MockPlaylistSummarySource) {
  return compact({
    id: playlist.id,
    regionName: playlist.regionName,
    placeName: playlist.placeName,
    description: playlist.description,
    reason: playlist.reason,
    coverImageUrl: playlist.coverImageUrl,
    backgroundImageUrl: playlist.backgroundImageUrl,
    trackCount: playlist.trackCount ?? playlist.trackIds?.length ?? 0,
    durationText: playlist.durationText,
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

function momentLogToDto(log: (typeof mockDb.momentLogs)[number]) {
  return compact({
    id: log.id,
    photoUrl: log.photoUrl,
    photoUri: log.photoUrl,
    createdAt: log.createdAt.toISOString(),
    sessionId: log.sessionId,
    location:
      log.lat !== undefined && log.lng !== undefined
        ? { lat: log.lat, lng: log.lng }
        : undefined,
    placeCategory: log.placeCategory,
    placeId: log.placeId,
    placeName: log.placeName,
    note: log.note,
    recapVisibility: log.visibility,
    templateId: log.templateId,
    track: log.trackSnapshot,
    travelMode: log.travelMode,
    moodTags: log.moodTags,
    source: log.source,
    syncStatus: log.syncStatus,
  });
}

function musicLogItemFromMoment(log: (typeof mockDb.momentLogs)[number]) {
  return compact({
    id: log.id,
    placeName: log.placeName ?? '위치 없음',
    trackTitle: log.trackSnapshot?.title ?? '저장된 순간',
    artistName: log.trackSnapshot?.artist ?? '음악 없음',
    createdAt: log.createdAt.toISOString(),
    imageUrl: log.photoUrl,
    recapShareId: log.id,
  });
}

type MockStoredRecapMoment = {
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

function getMockRecapMoments(recap: (typeof mockDb.recaps)[number]) {
  return (recap.moments ?? []).filter(
    (moment): moment is MockStoredRecapMoment =>
      Boolean(
        moment &&
          typeof moment === 'object' &&
          typeof (moment as Partial<MockStoredRecapMoment>).id === 'string',
      ),
  );
}

function getMockVisibleRecapMoments(
  recap: (typeof mockDb.recaps)[number],
  viewerId?: string,
) {
  const moments = getMockRecapMoments(recap);

  if (recap.userId === viewerId) {
    return moments;
  }

  return moments.filter(
    (moment) => (moment.visibility ?? recap.visibility) === 'public',
  );
}

function getMockRecapThumbnailMoment(
  recap: (typeof mockDb.recaps)[number],
  viewerId?: string,
) {
  const visibleMoments = getMockVisibleRecapMoments(recap, viewerId);

  return (
    visibleMoments.find((moment) => moment.id === recap.thumbnailMomentId) ??
    visibleMoments[0]
  );
}

function recapItemToDto(
  recap: (typeof mockDb.recaps)[number],
  viewerId?: string,
) {
  const track = findMockTrack(recap.representativeTrackId);

  if (!track) {
    throw notFound(ERROR_MESSAGES.REPRESENTATIVE_TRACK_NOT_FOUND);
  }

  const isMine = recap.userId === viewerId;
  const visibleMoments = getMockVisibleRecapMoments(recap, viewerId);
  const publicRepresentative = isMine ? undefined : visibleMoments.at(-1);
  const thumbnailMoment = getMockRecapThumbnailMoment(recap, viewerId);
  const publicTrack = publicRepresentative?.track ?? (
    publicRepresentative
      ? {
          artist: publicRepresentative.artistName,
          fallbackColor: '#252A38',
          id: `recap-moment-track-${publicRepresentative.id}`,
          title: publicRepresentative.trackTitle,
        }
      : undefined
  );

  return compact({
    id: recap.id,
    title: publicRepresentative && recap.sessionId
      ? `${publicRepresentative.placeName} 여행 로그`
      : recap.title,
    placeName: publicRepresentative?.placeName ?? recap.placeName,
    representativeTrack: publicTrack ?? trackToDto(track),
    createdAt: recap.createdAt.toISOString(),
    momentCount: isMine ? recap.momentCount : visibleMoments.length,
    sessionId: recap.sessionId,
    backgroundImageUrl: thumbnailMoment?.imageUrl ?? (isMine ? recap.backgroundImageUrl : undefined),
    thumbnailMomentId: thumbnailMoment?.id,
    visibility: recap.visibility,
  });
}

function recapShareToDto(recap: (typeof mockDb.recaps)[number], viewerId?: string) {
  const track = findMockTrack(recap.representativeTrackId);

  if (!track) {
    throw notFound(ERROR_MESSAGES.REPRESENTATIVE_TRACK_NOT_FOUND);
  }

  const canViewRoutePoints = recap.userId === viewerId;
  const visibleMoments = getMockVisibleRecapMoments(recap, viewerId);
  const publicRepresentative = canViewRoutePoints ? undefined : visibleMoments.at(-1);
  const thumbnailMoment = getMockRecapThumbnailMoment(recap, viewerId);

  return compact({
    id: recap.id,
    isMine: canViewRoutePoints,
    placeName: publicRepresentative?.placeName ?? recap.placeName,
    trackTitle: publicRepresentative?.trackTitle ?? track.title,
    artistName: publicRepresentative?.artistName ?? track.artist,
    backgroundImageUrl: thumbnailMoment?.imageUrl ?? (canViewRoutePoints ? recap.backgroundImageUrl : undefined),
    discImageUrl: publicRepresentative?.imageUrl ?? recap.discImageUrl,
    moments: visibleMoments,
    recordedAt: publicRepresentative?.recordedAt ??
      (recap.recordedAt ?? recap.createdAt).toISOString(),
    routePoints: canViewRoutePoints ? recap.routePoints : undefined,
    sessionId: recap.sessionId,
    shareImageUrl: recap.shareImageUrl,
    templateId: recap.templateId,
    thumbnailMomentId: thumbnailMoment?.id,
    visibility: recap.visibility,
  });
}

function getMockRecapMomentLocation(
  recap: (typeof mockDb.recaps)[number],
  viewerId?: string,
) {
  const moments = getMockVisibleRecapMoments(recap, viewerId);
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

function getMockRecapLocation(
  recap: (typeof mockDb.recaps)[number],
  viewerId?: string,
) {
  const canViewAllMoments = viewerId === undefined || recap.userId === viewerId;

  if (canViewAllMoments && recap.lat !== undefined && recap.lng !== undefined) {
    return {
      lat: recap.lat,
      lng: recap.lng,
    };
  }

  return getMockRecapMomentLocation(
    recap,
    canViewAllMoments ? recap.userId : viewerId,
  );
}

function assertMockPublicRecapHasLocation(
  visibility: RecapVisibility | undefined,
  location: { lat: number; lng: number } | undefined,
) {
  if (visibility === 'public' && !location) {
    throw badRequest(ERROR_MESSAGES.RECAP_PUBLIC_LOCATION_REQUIRED);
  }
}

function ensureMockTrackFromMoment(moment?: (typeof mockDb.momentLogs)[number]) {
  const snapshot = moment?.trackSnapshot;

  if (snapshot && !findMockTrack(snapshot.id)) {
    mockDb.tracks.push({
      ...snapshot,
      fallbackColor: snapshot.fallbackColor ?? '#252A38',
    });
  }

  return snapshot?.id ?? 'seoul-city';
}

function refreshMockRecapAggregates(input: {
  momentIds: string[];
  sessionIds: Array<string | undefined>;
  userId: string;
}) {
  const momentIds = new Set(input.momentIds);
  const sessionIds = new Set(input.sessionIds.filter((id): id is string => Boolean(id)));

  mockDb.recaps = mockDb.recaps.flatMap((recap) => {
    const isAffected =
      recap.userId === input.userId &&
      (
        (recap.travelSessionId
          ? sessionIds.has(recap.travelSessionId)
          : false) ||
        getMockRecapMoments(recap).some((moment) => momentIds.has(moment.id))
      );

    if (!isAffected) {
      return [recap];
    }

    const storedMomentIds = new Set(getMockRecapMoments(recap).map((moment) => moment.id));
    const moments = mockDb.momentLogs
      .filter((moment) =>
        recap.travelSessionId
          ? moment.sessionId === recap.travelSessionId && recap.userId === input.userId
          : storedMomentIds.has(moment.id) && !moment.sessionId,
      )
      .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime());

    if (moments.length === 0) {
      return [];
    }

    const representativeMoment = moments.at(-1)!;
    const thumbnailMoment =
      moments.find((moment) => moment.id === recap.thumbnailMomentId) ?? moments[0]!;
    const locatedMoment =
      representativeMoment.lat !== undefined && representativeMoment.lng !== undefined
        ? representativeMoment
        : moments.find((moment) => moment.lat !== undefined && moment.lng !== undefined);
    const hasPublicLocatedMoment = moments.some(
      (moment) =>
        moment.visibility === 'public' &&
        moment.lat !== undefined &&
        moment.lng !== undefined,
    );

    return [{
      ...recap,
      backgroundImageUrl: thumbnailMoment.photoUrl,
      discImageUrl: representativeMoment.photoUrl,
      lat: locatedMoment?.lat,
      lng: locatedMoment?.lng,
      momentCount: moments.length,
      moments: moments.map((moment) => ({
        id: moment.id,
        imageUrl: moment.photoUrl,
        location:
          moment.lat !== undefined && moment.lng !== undefined
            ? { lat: moment.lat, lng: moment.lng }
            : undefined,
        placeName: moment.placeName ?? '위치 없음',
        trackTitle: moment.trackSnapshot?.title ?? '저장된 순간',
        artistName: moment.trackSnapshot?.artist ?? '음악 없음',
        recordedAt: moment.createdAt.toISOString(),
        templateId: moment.templateId,
        track: moment.trackSnapshot,
        visibility: moment.visibility,
      })),
      placeName: representativeMoment.placeName ?? 'Soundlog',
      recordedAt: representativeMoment.createdAt,
      representativeTrackId: ensureMockTrackFromMoment(representativeMoment),
      thumbnailMomentId: thumbnailMoment.id,
      templateId: recap.travelSessionId
        ? recap.templateId
        : representativeMoment.templateId,
      visibility:
        recap.visibility === 'public' && !hasPublicLocatedMoment
          ? 'private' as const
          : recap.visibility,
    }];
  });
}

function mockRecapMapMarkerToDto(
  recap: (typeof mockDb.recaps)[number],
  viewerId: string,
  origin?: { lat: number; lng: number },
) {
  const location = getMockRecapLocation(recap, viewerId);
  const track = findMockTrack(recap.representativeTrackId);

  if (!location || !track) {
    return undefined;
  }

  const isMine = recap.userId === viewerId;
  const publicRepresentative = isMine
    ? undefined
    : getMockVisibleRecapMoments(recap, viewerId).at(-1);
  const thumbnailMoment = getMockRecapThumbnailMoment(recap, viewerId);
  const publicTrack = publicRepresentative?.track ?? (
    publicRepresentative
      ? {
          artist: publicRepresentative.artistName,
          id: `recap-moment-track-${publicRepresentative.id}`,
          title: publicRepresentative.trackTitle,
        }
      : undefined
  );

  return compact({
    id: `marker-${recap.id}`,
    recapId: recap.id,
    title: publicRepresentative && recap.sessionId
      ? `${publicRepresentative.placeName} 여행 로그`
      : recap.title,
    placeName: publicRepresentative?.placeName ?? recap.placeName,
    ownerAlias: isMine ? '나' : 'Soundlog 여행자',
    location,
    trackTitle: publicTrack?.title ?? track.title,
    artistName: publicTrack?.artist ?? track.artist,
    templateId: publicRepresentative?.templateId ?? recap.templateId,
    visibility: recap.visibility,
    distanceMeters: origin ? Math.round(distanceMeters(origin, location)) : undefined,
    imageUrl: thumbnailMoment?.imageUrl ?? (isMine ? recap.backgroundImageUrl : undefined),
    createdAt: publicRepresentative?.recordedAt ?? recap.createdAt.toISOString(),
  });
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
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function getMockUserProfile(userId: string) {
  const passwordUser = mockDb.passwordUsers.find((user) => user.id === userId);
  return {
    displayName: passwordUser?.displayName ?? mockDb.user.displayName,
    preferredGenres: mockDb.profile.preferredGenres,
    preferredMoods: mockDb.profile.preferredMoods,
    travelStyles: mockDb.profile.travelStyles,
  };
}

function getMockCompanionUserIds(userId: string) {
  const roomIds = mockDb.travelRoomMembers
    .filter((member) => member.userId === userId)
    .map((member) => member.roomId);

  return Array.from(
    new Set(
      mockDb.travelRoomMembers
        .filter((member) => roomIds.includes(member.roomId))
        .map((member) => member.userId),
    ),
  );
}

function getMockCommunityHiddenUserIds(userId: string) {
  return Array.from(new Set(
    mockDb.communityBlocks
      .filter((block) => block.blockerId === userId || block.blockedUserId === userId)
      .map((block) => (block.blockerId === userId ? block.blockedUserId : block.blockerId)),
  ));
}

function hasMockCommunityBlockBetween(userId: string, targetUserId: string) {
  return mockDb.communityBlocks.some(
    (block) =>
      (block.blockerId === userId && block.blockedUserId === targetUserId) ||
      (block.blockerId === targetUserId && block.blockedUserId === userId),
  );
}

function roomToDto(room: (typeof mockDb.travelRooms)[number]) {
  const members = mockDb.travelRoomMembers.filter((member) => member.roomId === room.id);
  const moments = mockDb.travelRoomMoments
    .filter((moment) => moment.roomId === room.id)
    .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime());

  return {
    id: room.id,
    title: room.title,
    inviteCode: room.inviteCode,
    sessionId: room.sessionId,
    visibility: room.visibility,
    memberCount: members.length,
    momentCount: moments.length,
    members: members.map((member) => ({
      id: member.id,
      userId: member.userId,
      role: member.role,
      displayName: member.displayName,
      joinedAt: member.joinedAt.toISOString(),
    })),
    moments: moments.map((moment) => ({
      id: moment.id,
      userId: moment.userId,
      momentLogId: moment.momentLogId,
      placeName: moment.placeName,
      note: moment.note,
      status: moment.status,
      track: moment.trackSnapshot,
      commentCount: mockDb.travelRoomMomentComments.filter(
        (comment) => comment.momentId === moment.id,
      ).length,
      comments: mockDb.travelRoomMomentComments
        .filter((comment) => comment.momentId === moment.id)
        .map((comment) => ({
          id: comment.id,
          userId: comment.userId,
          body: comment.body,
          createdAt: comment.createdAt.toISOString(),
        })),
      createdAt: moment.createdAt.toISOString(),
    })),
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  };
}

function soundMapPinToDto(pin: (typeof mockDb.soundMapPins)[number], viewerId: string) {
  const isMine = pin.userId === viewerId;
  const profile = getMockUserProfile(pin.userId);
  const alias = isMine
    ? '나'
    : pin.visibility === 'nearby'
      ? '근처 여행자'
      : profile.displayName ?? '동행자';

  return {
    id: pin.id,
    alias,
    isMine,
    visibility: pin.visibility,
    location: isMine
      ? { lat: pin.lat, lng: pin.lng }
      : { lat: pin.approxLat, lng: pin.approxLng },
    moodTags: pin.moodTags,
    placeName: pin.placeName,
    profile: {
      preferredGenres: profile.preferredGenres,
      preferredMoods: profile.preferredMoods,
      travelStyles: profile.travelStyles,
    },
    sessionId: pin.sessionId,
    track: pin.trackSnapshot,
    travelMode: pin.travelMode,
    expiresAt: pin.expiresAt.toISOString(),
    updatedAt: pin.updatedAt.toISOString(),
  };
}

function scoreMockMatch(pin: (typeof mockDb.soundMapPins)[number], params: {
  lat?: number;
  lng?: number;
  mood?: string;
  state?: string;
}) {
  let score = 70;
  if (params.mood && mockDb.profile.preferredMoods.some((mood) => params.mood?.includes(mood))) {
    score += 8;
  }
  if (params.state && mockDb.profile.travelStyles.some((style) => params.state?.includes(style))) {
    score += 8;
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

function recordMockCommunityRecommendationEvent(
  userId: string,
  type: string,
  context: Record<string, unknown>,
  input?: {
    sessionId?: string;
    trackId?: string;
    value?: string;
  },
) {
  mockDb.recommendationEvents.push({
    id: createPublicId('event'),
    userId,
    sessionId: input?.sessionId ?? String(context.sessionId ?? context.roomId ?? 'community'),
    type,
    trackId: input?.trackId,
    value: input?.value,
    context,
    createdAt: new Date(),
  });
}

function mateRequestToDto(request: (typeof mockDb.travelMateRequests)[number]) {
  return {
    ...request,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

function getDefaultPlaylistId(params?: { lat?: number; placeId?: string }) {
  if (params?.placeId) {
    const place = mockDb.places.find(
      (item) => item.id === toStoragePlaceId(params.placeId),
    );
    const placeText = [place?.title, place?.category, place?.overview].join(' ');

    if (/해변|바다|해수욕장|ocean|beach/i.test(placeText)) {
      return 'busan-ocean';
    }
  }

  return params?.lat && params.lat < 36.5 ? 'busan-ocean' : 'seoul-night';
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

function normalizeMoodLabel(value?: string) {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  return normalized === '청량한' ? '시원한' : normalized;
}

function matchesMoodFilter(itemMoods: readonly string[], moodFilter?: string) {
  const normalizedFilter = normalizeMoodLabel(moodFilter);

  if (!normalizedFilter || normalizedFilter === '전체') {
    return true;
  }

  return itemMoods.some((mood) => normalizeMoodLabel(mood) === normalizedFilter);
}

function scoreMoodRecommendation(
  item: (typeof mockDb.moodRecommendations)[number],
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

export const mockSoundlogService = {
  async getHealth() {
    return {
      status: 'ok',
      checkedAt: new Date().toISOString(),
      mode: 'mock-db',
    };
  },

  async getMyProfile() {
    return {
      ...mockDb.profile,
      updatedAt: mockDb.profile.updatedAt.toISOString(),
    };
  },

  async upsertMyProfile(_userId: string, input: {
    birthYear?: number;
    companionType?: string;
    dislikedArtists?: string[];
    gender?: string;
    locationRecommendationEnabled: boolean;
    preferredGenres: string[];
    preferredMoods: string[];
    travelStyles: string[];
  }) {
    mockDb.profile = {
      ...mockDb.profile,
      ...input,
      dislikedArtists: input.dislikedArtists ?? [],
      completedOnboarding: true,
      updatedAt: new Date(),
    };

    return this.getMyProfile();
  },

  async deleteMyAccount(userId: string) {
    mockDb.passwordUsers = mockDb.passwordUsers.filter((user) => user.id !== userId);
    mockDb.libraryTrackStates = [];
    mockDb.momentLogs = [];
    mockDb.recaps = mockDb.recaps.filter((recap) => recap.userId !== userId);
    mockDb.recommendationEvents = mockDb.recommendationEvents.filter(
      (event) => event.userId !== userId,
    );
    mockDb.travelSessions = mockDb.travelSessions.filter(
      (session) => session.userId !== userId,
    );
    const ownedRoomIds = new Set(
      mockDb.travelRooms.filter((room) => room.ownerId === userId).map((room) => room.id),
    );
    const ownedRoomMomentIds = new Set(
      mockDb.travelRoomMoments
        .filter((moment) => ownedRoomIds.has(moment.roomId))
        .map((moment) => moment.id),
    );
    mockDb.travelRooms = mockDb.travelRooms.filter((room) => !ownedRoomIds.has(room.id));
    mockDb.travelRoomMembers = mockDb.travelRoomMembers.filter(
      (member) => member.userId !== userId && !ownedRoomIds.has(member.roomId),
    );
    mockDb.travelRoomMoments = mockDb.travelRoomMoments.filter(
      (moment) => moment.userId !== userId && !ownedRoomIds.has(moment.roomId),
    );
    mockDb.travelRoomMomentComments = mockDb.travelRoomMomentComments.filter(
      (comment) => comment.userId !== userId && !ownedRoomMomentIds.has(comment.momentId),
    );
    mockDb.soundMapPins = mockDb.soundMapPins.filter((pin) => pin.userId !== userId);
    mockDb.travelMateRequests = mockDb.travelMateRequests.filter(
      (request) => request.requesterId !== userId && request.targetUserId !== userId,
    );
    mockDb.communityBlocks = mockDb.communityBlocks.filter(
      (block) => block.blockerId !== userId && block.blockedUserId !== userId,
    );
    mockDb.communityReports = mockDb.communityReports.filter(
      (report) => report.reporterId !== userId && report.targetUserId !== userId,
    );
    mockDb.refreshTokens = [];

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
    lat: number;
    limit?: number;
    lng: number;
    radiusMeters?: number;
  }) {
    const origin = { lat: params.lat, lng: params.lng };
    const radiusMeters = params.radiusMeters ?? 2000;

    return [...mockDb.places]
      .flatMap((place) => {
        if (place.lat === undefined || place.lng === undefined) {
          return [];
        }

        const distance = Math.round(
          distanceMeters(origin, { lat: place.lat, lng: place.lng }),
        );

        return distance <= radiusMeters ? [{ distance, place }] : [];
      })
      .sort((first, second) => first.distance - second.distance)
      .slice(0, getLimit(params.limit, 10))
      .map(({ distance, place }) =>
        compact({
          id: toPublicPlaceId(place.id),
          title: place.title,
          address: place.address,
          category: place.category,
          contentType: place.contentType,
          distanceMeters: distance,
          imageUrl: place.imageUrl,
          location:
            place.lat !== undefined && place.lng !== undefined
              ? { lat: place.lat, lng: place.lng }
              : undefined,
          overview: place.overview,
          source: toPublicPlaceSource(place.source),
        }),
      );
  },

  async reverseGeocodeLocation(params: { lat: number; lng: number }) {
    const isSanFrancisco =
      params.lat >= 37.6 &&
      params.lat <= 37.9 &&
      params.lng >= -122.6 &&
      params.lng <= -122.2;

    return {
      address: isSanFrancisco
        ? '미국 캘리포니아주 샌프란시스코'
        : '대한민국 현재 지역',
      attribution: '© OpenStreetMap contributors',
      category: '현재 지역',
      id: `reverse-${params.lat.toFixed(4)}-${params.lng.toFixed(4)}`,
      location: { lat: params.lat, lng: params.lng },
      source: 'reverse-geocode' as const,
      title: isSanFrancisco ? '샌프란시스코' : '현재 지역',
    };
  },

  async searchPlaces(params: { limit?: number; query: string }) {
    const query = params.query.trim().toLocaleLowerCase();

    return mockDb.places
      .filter((place) =>
        [place.title, place.address, place.category]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase().includes(query)),
      )
      .slice(0, getLimit(params.limit, 10))
      .map((place) =>
        compact({
          id: toPublicPlaceId(place.id),
          title: place.title,
          address: place.address,
          category: place.category,
          contentType: place.contentType,
          distanceMeters: place.distanceMeters,
          imageUrl: place.imageUrl,
          location:
            place.lat !== undefined && place.lng !== undefined
              ? { lat: place.lat, lng: place.lng }
              : undefined,
          overview: place.overview,
          source: toPublicPlaceSource(place.source),
        }),
      );
  },

  async getFeaturedPlaylists(_user: unknown, params: {
    lat?: number;
    limit?: number;
    locationRecommendationEnabled: boolean;
    placeId?: string;
    recommendationMode?: 'everyday' | 'travel';
  }) {
    const preferredId =
      params.recommendationMode === 'travel' &&
      params.locationRecommendationEnabled &&
      (params.lat || params.placeId)
        ? getDefaultPlaylistId({ lat: params.lat, placeId: params.placeId })
        : undefined;

    return [...mockDb.playlists]
      .filter((playlist) => playlist.source !== 'personalized')
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
      .map((playlist) => ({
        id: playlist.id,
        regionName: playlist.regionName,
        description: playlist.description,
        trackCount: playlist.trackIds.length,
        durationText: playlist.durationText,
        source: playlist.source,
      }));
  },

  async getMoodRecommendations(_user: unknown, params: {
    limit?: number;
    moodFilter?: string;
    preferredGenres?: string[];
    preferredMoods?: string[];
    recommendationMode?: 'everyday' | 'travel';
    travelStyles?: string[];
  }) {
    return [...mockDb.moodRecommendations]
      .filter((item) => matchesMoodFilter(item.moods, params.moodFilter))
      .sort((first, second) => scoreMoodRecommendation(second, params) - scoreMoodRecommendation(first, params))
      .slice(0, getLimit(params.limit))
      .map((recommendation) => {
        const track = findMockTrack(recommendation.trackId);

        if (!track) {
          throw notFound(ERROR_MESSAGES.RECOMMENDATION_TRACK_NOT_FOUND);
        }

        return {
          id: recommendation.id,
          title: recommendation.title,
          subtitle: 'subtitle' in recommendation ? recommendation.subtitle : undefined,
          color: recommendation.color,
          genres: recommendation.genres,
          imageUrl: recommendation.imageUrl,
          moods: recommendation.moods,
          playlistId: recommendation.playlistId,
          travelStyles: recommendation.travelStyles,
          track: trackToDto(track),
        };
      });
  },

  async getRecentMusicLogs(_userId: string, params: { limit?: number }) {
    return [...mockDb.momentLogs]
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())
      .slice(0, getLimit(params.limit, 10))
      .map(musicLogItemFromMoment);
  },

  async createContextualPlaylist(_userId: string, input: {
    location?: { lat: number; lng: number };
    mood?: string;
    moodTags?: string[];
    placeId?: string;
    preferredMoods?: string[];
    state?: string;
    travelMode?: string;
  }, _idempotencyKey?: string) {
    const playlistId = getDefaultPlaylistId({
      lat: input.location?.lat,
      placeId: input.placeId,
    });
    const playlist = mockDb.playlists.find((item) => item.id === playlistId);

    if (!playlist) {
      throw notFound(ERROR_MESSAGES.PLAYLIST_NOT_FOUND);
    }

    return withPlaylistContext(playlistToDto(playlist), {
      mood: input.mood,
      moodTags: input.moodTags,
      placeId: input.placeId,
      source: 'seed-fallback',
      state: input.state,
      travelMode: input.travelMode,
    });
  },

  async getRecommendedPlaylist(_userId: string | undefined, input: {
    location?: { lat: number; lng: number };
    mood?: string;
    state?: string;
  }) {
    const playlistId = getDefaultPlaylistId({
      lat: input.location?.lat,
    });
    const playlist = mockDb.playlists.find((item) => item.id === playlistId);

    if (!playlist) {
      throw notFound(ERROR_MESSAGES.PLAYLIST_NOT_FOUND);
    }

    return withPlaylistContext(playlistToDto(playlist), {
      mood: input.mood,
      source: 'seed-fallback',
      state: input.state,
    });
  },

  async getPlaylist(_userId: string | undefined, playlistId: string, query: { lat?: number; placeId?: string }) {
    const id = playlistId === 'fallback' ? getDefaultPlaylistId(query) : playlistId;
    const playlist = mockDb.playlists.find((item) => item.id === id);

    if (!playlist) {
      throw notFound(ERROR_MESSAGES.PLAYLIST_NOT_FOUND);
    }

    const dto = playlistToDto(playlist);

    return playlistId === 'fallback'
      ? withPlaylistContext(dto, { source: 'seed-fallback' })
      : dto;
  },

  async getLibraryTracks(_userId: string, params: {
    cursor?: string;
    kind: 'all' | 'liked' | 'saved';
    limit?: number;
  }) {
    const records = mockDb.libraryTrackStates
      .filter((state) => {
        if (params.kind === 'liked') {
          return state.isLiked;
        }

        if (params.kind === 'saved') {
          return state.isSaved;
        }

        return state.isLiked || state.isSaved;
      })
      .map((state) => {
        const track = findMockTrack(state.trackId);

        if (!track) {
          return undefined;
        }

        return {
          id: state.trackId,
          createdAt: (state.isLiked ? state.likedAt : state.savedAt)?.toISOString() ?? state.updatedAt.toISOString(),
          playlistId: state.playlistId,
          playlist: state.playlistId
            ? playlistSummaryToDto(
                mockDb.playlists.find((playlist) => playlist.id === state.playlistId) ?? {
                  id: state.playlistId,
                  regionName: state.playlistId,
                  reason: '',
                  trackIds: [],
                  durationText: '',
                },
              )
            : undefined,
          kind: state.isLiked ? 'liked' : 'saved',
          track: trackToDto(track, state),
        };
      })
      .filter(isDefined)
      .sort((first, second) => {
        if (!first || !second) {
          return 0;
        }

        return Date.parse(second.createdAt) - Date.parse(first.createdAt);
      });
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

  async updateLibraryTrackState(_userId: string, trackId: string, input: {
    action: 'like' | 'save' | 'unlike' | 'unsave';
    playlistId?: string;
  }, _idempotencyKey?: string) {
    const track = findMockTrack(trackId);

    if (!track) {
      throw notFound(ERROR_MESSAGES.TRACK_NOT_FOUND);
    }

    const now = new Date();
    let state = getTrackState(trackId);

    if (!state) {
      state = {
        trackId,
        isLiked: false,
        isSaved: false,
        updatedAt: now,
      };
      mockDb.libraryTrackStates.push(state);
    }

    state.playlistId = input.playlistId ?? state.playlistId;
    state.isLiked = input.action === 'like' ? true : input.action === 'unlike' ? false : state.isLiked;
    state.isSaved = input.action === 'save' ? true : input.action === 'unsave' ? false : state.isSaved;
    state.likedAt = input.action === 'like' ? now : input.action === 'unlike' ? undefined : state.likedAt;
    state.savedAt = input.action === 'save' ? now : input.action === 'unsave' ? undefined : state.savedAt;
    state.updatedAt = now;

    return {
      trackId,
      isLiked: state.isLiked,
      isSaved: state.isSaved,
      updatedAt: state.updatedAt.toISOString(),
    };
  },

  async getMomentLogs(_userId: string, params: {
    cursor?: string;
    limit?: number;
    sessionId?: string;
  }) {
    const logs = mockDb.momentLogs
      .filter((log) => !params.sessionId || log.sessionId === params.sessionId)
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime());
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

  async createMomentLog(userId: string, input: {
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
  }, idempotencyKey?: string) {
    return withMockIdempotency(
      { idempotencyKey, scope: 'moment-log.create', userId },
      () => {
        assertMockPublicRecapHasLocation(
          input.visibility,
          input.lat !== undefined && input.lng !== undefined
            ? { lat: input.lat, lng: input.lng }
            : undefined,
        );

        const track = findMockTrack(input.trackId);
        const log = {
          id: createPublicId('moment'),
          photoUrl: input.photoPath
            ? `${env.UPLOAD_PUBLIC_BASE_URL}${input.photoPath}`
            : undefined,
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
            track ??
            (input.trackTitle
              ? {
                  id: input.trackId ?? createPublicId('track'),
                  title: input.trackTitle,
                  artist: input.artistName ?? '음악 없음',
                }
              : undefined),
          travelMode: input.travelMode,
          moodTags: input.moodTags,
          source: 'camera' as const,
          syncStatus: 'synced' as const,
          visibility: input.visibility ?? 'private',
        };

        mockDb.momentLogs.unshift(log);
        refreshMockRecapAggregates({
          momentIds: [log.id],
          sessionIds: [log.sessionId],
          userId,
        });

        return momentLogToDto(log);
      },
    );
  },

  async updateMomentLog(
    _userId: string,
    momentLogId: string,
    input: MomentLogUpdateInput,
  ) {
    const log = mockDb.momentLogs.find((moment) => moment.id === momentLogId);

    if (!log) {
      throw notFound(ERROR_MESSAGES.MOMENT_LOG_NOT_FOUND);
    }

    const previousSessionId = log.sessionId;

    if (hasOwn(input, 'lat') || hasOwn(input, 'lng') || input.visibility) {
      const nextLat = hasOwn(input, 'lat') ? input.lat : log.lat;
      const nextLng = hasOwn(input, 'lng') ? input.lng : log.lng;
      const nextVisibility = input.visibility ?? log.visibility;

      assertMockPublicRecapHasLocation(
        nextVisibility,
        nextLat !== null && nextLat !== undefined && nextLng !== null && nextLng !== undefined
          ? { lat: nextLat, lng: nextLng }
          : undefined,
      );
    }

    if (input.createdAt) {
      log.createdAt = new Date(input.createdAt);
    }

    if (hasOwn(input, 'lat')) {
      log.lat = input.lat ?? undefined;
    }

    if (hasOwn(input, 'lng')) {
      log.lng = input.lng ?? undefined;
    }

    if (input.moodTags) {
      log.moodTags = [...input.moodTags];
    }

    if (hasOwn(input, 'note')) {
      log.note = input.note ?? undefined;
    }

    if (hasOwn(input, 'placeCategory')) {
      log.placeCategory = input.placeCategory ?? undefined;
    }

    if (hasOwn(input, 'placeId')) {
      log.placeId = input.placeId ?? undefined;
    }

    if (hasOwn(input, 'placeName')) {
      log.placeName = input.placeName ?? undefined;
    }

    if (hasOwn(input, 'sessionId')) {
      log.sessionId = input.sessionId ?? undefined;
    }

    if (input.templateId) {
      log.templateId = input.templateId;
    }

    if (hasOwn(input, 'travelMode')) {
      log.travelMode = input.travelMode ?? undefined;
    }

    if (input.visibility) {
      log.visibility = input.visibility;
    }

    const shouldUpdateTrackSnapshot =
      hasOwn(input, 'trackId') ||
      hasOwn(input, 'trackTitle') ||
      hasOwn(input, 'artistName');

    if (shouldUpdateTrackSnapshot) {
      log.trackSnapshot =
        findMockTrack(input.trackId) ??
        (input.trackId || input.trackTitle
          ? {
              id: input.trackId ?? createPublicId('track'),
              title: input.trackTitle ?? '선택한 음악',
              artist: input.artistName ?? '아티스트 미상',
            }
          : undefined);
    }

    refreshMockRecapAggregates({
      momentIds: [log.id],
      sessionIds: [previousSessionId, log.sessionId],
      userId: _userId,
    });

    return momentLogToDto(log);
  },

  async updateMomentLogPhoto(_userId: string, momentLogId: string, photoPath: string) {
    const log = mockDb.momentLogs.find((moment) => moment.id === momentLogId);

    if (!log) {
      throw notFound(ERROR_MESSAGES.MOMENT_LOG_NOT_FOUND);
    }

    log.photoUrl = `${env.UPLOAD_PUBLIC_BASE_URL}${photoPath}`;
    refreshMockRecapAggregates({
      momentIds: [log.id],
      sessionIds: [log.sessionId],
      userId: _userId,
    });

    return momentLogToDto(log);
  },

  async deleteMomentLogPhoto(_userId: string, momentLogId: string) {
    const log = mockDb.momentLogs.find((moment) => moment.id === momentLogId);

    if (!log) {
      throw notFound(ERROR_MESSAGES.MOMENT_LOG_NOT_FOUND);
    }

    log.photoUrl = undefined;
    refreshMockRecapAggregates({
      momentIds: [log.id],
      sessionIds: [log.sessionId],
      userId: _userId,
    });

    return momentLogToDto(log);
  },

  async deleteMomentLog(userId: string, momentLogId: string) {
    const index = mockDb.momentLogs.findIndex((moment) => moment.id === momentLogId);

    if (index === -1) {
      throw notFound(ERROR_MESSAGES.MOMENT_LOG_NOT_FOUND);
    }

    const [deletedMoment] = mockDb.momentLogs.splice(index, 1);
    mockDb.travelRoomMoments.forEach((moment) => {
      if (moment.momentLogId === momentLogId) {
        moment.momentLogId = undefined;
      }
    });
    refreshMockRecapAggregates({
      momentIds: [momentLogId],
      sessionIds: [deletedMoment?.sessionId],
      userId,
    });
  },

  async createRecommendationEvents(userId: string, input: {
    events: Array<{
      context: Record<string, unknown>;
      createdAt: string;
      id: string;
      playlistId?: string;
      sessionId: string;
      trackId?: string;
      type: string;
      value?: string;
    }>;
  }, _idempotencyKey?: string) {
    input.events.forEach((event) => {
      if (mockDb.recommendationEvents.some((item) => item.id === event.id)) {
        return;
      }

      mockDb.recommendationEvents.push({
        ...event,
        userId,
        createdAt: new Date(event.createdAt),
      });
    });
  },

  async createTravelRoom(userId: string, input: {
    sessionId?: string;
    title: string;
    visibility: string;
  }) {
    const now = new Date();
    const room = {
      id: createPublicId('room'),
      inviteCode: createInviteCode(),
      ownerId: userId,
      sessionId: input.sessionId,
      title: input.title,
      visibility: input.visibility,
      createdAt: now,
      updatedAt: now,
    };
    mockDb.travelRooms.push(room);
    mockDb.travelRoomMembers.push({
      id: createPublicId('member'),
      joinedAt: now,
      role: 'owner',
      roomId: room.id,
      userId,
    });

    recordMockCommunityRecommendationEvent(userId, 'trip_room_created', {
      roomId: room.id,
      visibility: room.visibility,
    }, { sessionId: room.sessionId ?? room.id });

    return roomToDto(room);
  },

  async getTravelRooms(userId: string, query: {
    limit?: number;
    sessionId?: string;
  }) {
    const roomIds = new Set(
      mockDb.travelRoomMembers
        .filter((member) => member.userId === userId)
        .map((member) => member.roomId),
    );

    return mockDb.travelRooms
      .filter((room) => roomIds.has(room.id))
      .filter((room) => !query.sessionId || room.sessionId === query.sessionId)
      .sort((first, second) => second.updatedAt.getTime() - first.updatedAt.getTime())
      .slice(0, getLimit(query.limit))
      .map(roomToDto);
  },

  async getTravelRoom(userId: string, roomId: string) {
    const room = mockDb.travelRooms.find((item) => item.id === roomId);
    const isMember = mockDb.travelRoomMembers.some(
      (member) => member.roomId === roomId && member.userId === userId,
    );

    if (!room || !isMember) {
      throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_NOT_FOUND);
    }

    return roomToDto(room);
  },

  async joinTravelRoom(userId: string, roomId: string, input: {
    displayName?: string;
    inviteCode?: string;
  }) {
    const room = mockDb.travelRooms.find((item) => item.id === roomId);

    if (!room) {
      throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_NOT_FOUND);
    }

    const existing = mockDb.travelRoomMembers.find(
      (member) => member.roomId === roomId && member.userId === userId,
    );

    if (!existing && input.inviteCode !== room.inviteCode) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_ROOM_INVITE_CODE_INVALID);
    }

    if (existing && input.inviteCode && input.inviteCode !== room.inviteCode) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_ROOM_INVITE_CODE_INVALID);
    }

    if (existing) {
      existing.displayName = input.displayName;
    } else {
      mockDb.travelRoomMembers.push({
        id: createPublicId('member'),
        displayName: input.displayName,
        joinedAt: new Date(),
        role: 'member',
        roomId,
        userId,
      });
    }
    room.updatedAt = new Date();

    recordMockCommunityRecommendationEvent(userId, 'trip_room_joined', {
      role: existing?.role ?? 'member',
      roomId,
    }, { sessionId: room.sessionId ?? roomId });

    return roomToDto(room);
  },

  async joinTravelRoomByInviteCode(userId: string, input: {
    displayName?: string;
    inviteCode: string;
  }) {
    const room = mockDb.travelRooms.find((item) => item.inviteCode === input.inviteCode);

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
    const isMember = mockDb.travelRoomMembers.some(
      (member) => member.roomId === roomId && member.userId === userId,
    );

    if (!isMember) {
      throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_NOT_FOUND);
    }

    const momentLog = input.momentLogId
      ? mockDb.momentLogs.find((moment) => moment.id === input.momentLogId)
      : undefined;

    if (input.momentLogId && !momentLog) {
      throw notFound(ERROR_MESSAGES.MOMENT_LOG_NOT_FOUND);
    }

    const track = findMockTrack(input.trackId) ??
      momentLog?.trackSnapshot ?? {
        id: input.trackId ?? createPublicId('track'),
        title: input.trackTitle ?? '선택한 음악',
        artist: input.artistName ?? '아티스트 미상',
      };
    const moment = {
      id: createPublicId('room_moment'),
      createdAt: new Date(),
      momentLogId: input.momentLogId,
      note: input.note,
      placeName: input.placeName ?? momentLog?.placeName,
      roomId,
      status: input.status ?? 'candidate',
      trackSnapshot: track,
      userId,
    };
    mockDb.travelRoomMoments.push(moment);
    const roomToTouch = mockDb.travelRooms.find((item) => item.id === roomId);
    if (roomToTouch) {
      roomToTouch.updatedAt = new Date();
    }

    recordMockCommunityRecommendationEvent(userId, 'shared_moment_added', {
      momentId: moment.id,
      placeName: moment.placeName,
      roomId,
    }, {
      sessionId: roomId,
      trackId: moment.trackSnapshot?.id,
    });

    return {
      id: moment.id,
      userId: moment.userId,
      momentLogId: moment.momentLogId,
      note: moment.note,
      placeName: moment.placeName,
      status: moment.status,
      track: moment.trackSnapshot,
      createdAt: moment.createdAt.toISOString(),
    };
  },

  async updateTravelRoomMoment(userId: string, roomId: string, momentId: string, input: {
    status: string;
  }) {
    const room = mockDb.travelRooms.find((item) => item.id === roomId && item.ownerId === userId);

    if (!room) {
      throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_NOT_FOUND);
    }

    const moment = mockDb.travelRoomMoments.find(
      (item) => item.id === momentId && item.roomId === roomId,
    );

    if (!moment) {
      throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_MOMENT_NOT_FOUND);
    }

    moment.status = input.status;
    room.updatedAt = new Date();

    recordMockCommunityRecommendationEvent(userId, 'shared_moment_status_updated', {
      momentId,
      roomId,
      status: input.status,
    }, { sessionId: room.sessionId ?? roomId });

    const comments = mockDb.travelRoomMomentComments.filter((comment) => comment.momentId === moment.id);

    return {
      id: moment.id,
      userId: moment.userId,
      momentLogId: moment.momentLogId,
      note: moment.note,
      placeName: moment.placeName,
      status: moment.status,
      track: moment.trackSnapshot,
      commentCount: comments.length,
      comments: comments.map((comment) => ({
        id: comment.id,
        userId: comment.userId,
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
      })),
      createdAt: moment.createdAt.toISOString(),
    };
  },

  async addTravelRoomMomentComment(userId: string, roomId: string, momentId: string, input: {
    body: string;
  }) {
    const isMember = mockDb.travelRoomMembers.some(
      (member) => member.roomId === roomId && member.userId === userId,
    );

    if (!isMember) {
      throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_NOT_FOUND);
    }

    const moment = mockDb.travelRoomMoments.find(
      (item) => item.id === momentId && item.roomId === roomId,
    );

    if (!moment) {
      throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_MOMENT_NOT_FOUND);
    }

    const room = mockDb.travelRooms.find((item) => item.id === roomId);
    const comment = {
      id: createPublicId('room_comment'),
      body: input.body,
      createdAt: new Date(),
      momentId,
      userId,
    };
    mockDb.travelRoomMomentComments.push(comment);
    if (room) {
      room.updatedAt = new Date();
    }

    recordMockCommunityRecommendationEvent(userId, 'shared_moment_commented', {
      momentId,
      roomId,
    }, { sessionId: room?.sessionId ?? roomId });

    return {
      id: comment.id,
      userId: comment.userId,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };
  },

  async createTravelRoomRecap(userId: string, roomId: string, input: {
    representativeTrackId?: string;
    templateId?: string;
    title?: string;
  }, idempotencyKey?: string) {
    return withMockIdempotency(
      { idempotencyKey, scope: `travel-room-recap.create.${roomId}`, userId },
      () => {
        const room = mockDb.travelRooms.find((item) => item.id === roomId && item.ownerId === userId);
        if (!room) {
          throw notFound(ERROR_MESSAGES.TRAVEL_ROOM_NOT_FOUND);
        }
        const moments = mockDb.travelRoomMoments.filter((moment) => moment.roomId === roomId);
        const recapMoments = moments.some((moment) => moment.status === 'accepted')
          ? moments.filter((moment) => moment.status === 'accepted')
          : moments;
        const representativeTrackId =
          input.representativeTrackId ??
          recapMoments.find((moment) => moment.trackSnapshot?.id)?.trackSnapshot?.id ??
          'seoul-city';

        if (!findMockTrack(representativeTrackId)) {
          throw notFound(ERROR_MESSAGES.REPRESENTATIVE_TRACK_NOT_FOUND);
        }

        const recap = {
          id: createPublicId('recap'),
          userId,
          title: input.title ?? `${room.title} 공동 Recap`,
          placeName: recapMoments[0]?.placeName ?? room.title,
          representativeTrackId,
          createdAt: new Date(),
          momentCount: recapMoments.length,
          sessionId: room.sessionId,
          recordedAt: recapMoments[0]?.createdAt ?? new Date(),
          templateId: input.templateId ?? 'album',
          visibility: 'private' as const,
          moments: recapMoments.map((moment) => ({
            id: moment.id,
            placeName: moment.placeName ?? '위치 없음',
            trackTitle: moment.trackSnapshot?.title ?? '저장된 순간',
            artistName: moment.trackSnapshot?.artist ?? '음악 없음',
            recordedAt: moment.createdAt.toISOString(),
          })),
        };
        mockDb.recaps.unshift(recap);

        recordMockCommunityRecommendationEvent(userId, 'collab_recap_created', {
          recapId: recap.id,
          roomId,
          templateId: input.templateId,
        }, {
          sessionId: room.sessionId ?? roomId,
          trackId: representativeTrackId,
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
    visibility: string;
  }) {
    if (!input.sessionId) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_SESSION_ACTIVE_REQUIRED);
    }

    const session = mockDb.travelSessions.find(
      (item) => item.id === input.sessionId && item.status === 'active' && item.userId === userId,
    );

    if (!session) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_SESSION_ACTIVE_REQUIRED);
    }

    const now = new Date();
    const track =
      findMockTrack(input.trackId) ??
      (input.trackId || input.trackTitle
        ? {
            id: input.trackId ?? createPublicId('track'),
            title: input.trackTitle ?? '선택한 음악',
            artist: input.artistName ?? '아티스트 미상',
          }
        : undefined);
    const pin = mockDb.soundMapPins.find((item) => item.userId === userId);
    const nextPin = {
      id: pin?.id ?? createPublicId('sound_pin'),
      userId,
      sessionId: session.id,
      visibility: input.visibility,
      lat: input.location.lat,
      lng: input.location.lng,
      approxLat: normalizeApproxCoordinate(input.location.lat),
      approxLng: normalizeApproxCoordinate(input.location.lng),
      travelMode: input.travelMode ?? session.travelMode,
      moodTags: input.moodTags ?? [],
      placeName: input.placeName,
      trackSnapshot: track,
      expiresAt: new Date(Date.now() + (input.ttlMinutes ?? 120) * 60_000),
      createdAt: pin?.createdAt ?? now,
      updatedAt: now,
    };

    if (pin) {
      Object.assign(pin, nextPin);
    } else {
      mockDb.soundMapPins.push(nextPin);
    }

    recordMockCommunityRecommendationEvent(userId, 'live_track_shared', {
      placeName: input.placeName,
      visibility: input.visibility,
    }, {
      sessionId: session.id,
      trackId: nextPin.trackSnapshot?.id,
      value: input.visibility,
    });

    return soundMapPinToDto(nextPin, userId);
  },

  async getSoundMapPins(userId: string, query: {
    lat?: number;
    lng?: number;
    radiusMeters?: number;
    visibility?: string;
  }) {
    const hiddenUserIds = getMockCommunityHiddenUserIds(userId);
    const companionUserIds = getMockCompanionUserIds(userId);
    const isVisibleToViewer = (pin: (typeof mockDb.soundMapPins)[number]) => {
      if (query.visibility === 'nearby') {
        return pin.visibility === 'nearby';
      }

      if (query.visibility === 'companions') {
        return pin.userId === userId || (
          pin.visibility === 'companions' && companionUserIds.includes(pin.userId)
        );
      }

      return pin.userId === userId ||
        pin.visibility === 'nearby' ||
        (pin.visibility === 'companions' && companionUserIds.includes(pin.userId));
    };
    const pins = mockDb.soundMapPins
      .filter((pin) => pin.expiresAt > new Date())
      .filter((pin) => !hiddenUserIds.includes(pin.userId))
      .filter(isVisibleToViewer);

    const scopedPins = hasGeoPoint(query)
      ? filterPinsByRadius(pins, query)
      : pins.filter((pin) => pin.userId === userId);

    recordMockCommunityRecommendationEvent(userId, 'sound_map_viewed', {
      hasLocation: hasGeoPoint(query),
      radiusMeters: query.radiusMeters,
      visibility: query.visibility,
    });

    return scopedPins
      .map((pin) => soundMapPinToDto(pin, userId));
  },

  async getNearbySoundMatches(userId: string, query: {
    lat?: number;
    lng?: number;
    mood?: string;
    radiusMeters?: number;
    state?: string;
  }) {
    if (!hasGeoPoint(query)) {
      recordMockCommunityRecommendationEvent(userId, 'nearby_sound_opened', {
        hasLocation: false,
        radiusMeters: query.radiusMeters,
      });
      return [];
    }

    const hiddenUserIds = getMockCommunityHiddenUserIds(userId);
    const pins = mockDb.soundMapPins
      .filter((pin) => pin.expiresAt > new Date())
      .filter((pin) => pin.userId !== userId && pin.visibility === 'nearby')
      .filter((pin) => !hiddenUserIds.includes(pin.userId));

    recordMockCommunityRecommendationEvent(userId, 'nearby_sound_opened', {
      hasLocation: true,
      mood: query.mood,
      radiusMeters: query.radiusMeters,
      state: query.state,
    });

    return filterPinsByRadius(pins, query)
      .map((pin) => ({
        ...soundMapPinToDto(pin, userId),
        matchScore: scoreMockMatch(pin, query),
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
    recordMockCommunityRecommendationEvent(userId, 'music_match_viewed', {
      hasLocation: hasGeoPoint(query),
      mood: query.mood,
      radiusMeters: query.radiusMeters,
      state: query.state,
    });
    return pins.map((pin) => ({
      id: `match-${pin.id}`,
      pin,
      targetPinId: pin.targetPinId,
      matchScore: pin.matchScore,
      safety: {
        exactLocationHidden: true,
        firstMessageTemplates: ['liked_track', 'walk_together', 'cafe_together'],
        contactHiddenUntilAccepted: true,
      },
    }));
  },

  async createTravelMateRequest(userId: string, input: {
    messageTemplate: string;
    targetPinId?: string;
    targetUserId?: string;
  }) {
    const targetPin = input.targetPinId
      ? mockDb.soundMapPins.find((pin) => pin.id === input.targetPinId)
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
    if (hasMockCommunityBlockBetween(userId, targetUserId)) {
      throw forbidden(ERROR_MESSAGES.TRAVEL_MATE_REQUEST_BLOCKED);
    }
    const existingActiveRequest = mockDb.travelMateRequests
      .filter(
        (request) =>
          request.requesterId === userId &&
          request.targetUserId === targetUserId &&
          ['pending', 'accepted'].includes(request.status),
      )
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())[0];

    if (existingActiveRequest) {
      return mateRequestToDto(existingActiveRequest);
    }

    const recentClosedRequest = mockDb.travelMateRequests
      .filter(
        (request) =>
          request.requesterId === userId &&
          request.targetUserId === targetUserId &&
          CLOSED_TRAVEL_MATE_REQUEST_STATUSES.includes(request.status) &&
          request.updatedAt.getTime() >= Date.now() - TRAVEL_MATE_REQUEST_COOLDOWN_MS,
      )
      .sort((first, second) => second.updatedAt.getTime() - first.updatedAt.getTime())[0];

    if (recentClosedRequest) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_MATE_REQUEST_RATE_LIMITED, {
        cooldownHours: TRAVEL_MATE_REQUEST_COOLDOWN_MS / 60 / 60 / 1000,
        requestId: recentClosedRequest.id,
      });
    }

    const now = new Date();
    const request = {
      id: createPublicId('mate'),
      requesterId: userId,
      targetUserId,
      targetPinId: input.targetPinId,
      messageTemplate: input.messageTemplate,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    mockDb.travelMateRequests.push(request);
    recordMockCommunityRecommendationEvent(userId, 'travel_mate_requested', {
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
    return mockDb.travelMateRequests
      .filter((request) => {
        const inRequestedBox =
          query.box === 'inbox'
            ? request.targetUserId === userId
            : query.box === 'sent'
              ? request.requesterId === userId
              : request.requesterId === userId || request.targetUserId === userId;
        const inRequestedStatus = query.status ? request.status === query.status : true;

        return inRequestedBox && inRequestedStatus;
      })
      .sort((first, second) => second.updatedAt.getTime() - first.updatedAt.getTime())
      .slice(0, getLimit(query.limit))
      .map(mateRequestToDto);
  },

  async updateTravelMateRequest(userId: string, requestId: string, input: { action: string }) {
    const request = mockDb.travelMateRequests.find(
      (item) => item.id === requestId && (item.requesterId === userId || item.targetUserId === userId),
    );
    if (!request) {
      throw notFound(ERROR_MESSAGES.TRAVEL_MATE_REQUEST_NOT_FOUND);
    }

    if (['accept', 'decline'].includes(input.action) && request.targetUserId !== userId) {
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
    request.status = nextStatusByAction[input.action] ?? request.status;
    request.updatedAt = new Date();
    recordMockCommunityRecommendationEvent(userId, `travel_mate_${request.status}`, {
      requestId: request.id,
      targetPinId: request.targetPinId,
      targetUserId: request.targetUserId,
    }, { sessionId: request.targetPinId ?? request.id });
    return mateRequestToDto(request);
  },

  async blockCommunityUser(userId: string, input: { targetPinId?: string; targetUserId?: string }) {
    const targetPin = input.targetPinId
      ? mockDb.soundMapPins.find((pin) => pin.id === input.targetPinId)
      : undefined;
    const targetUserId = input.targetUserId ?? targetPin?.userId;

    if (!targetUserId) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_MATE_TARGET_REQUIRED);
    }

    if (targetUserId === userId) {
      throw badRequest(ERROR_MESSAGES.TRAVEL_MATE_SELF_REQUEST_NOT_ALLOWED);
    }

    if (!mockDb.communityBlocks.some((block) => block.blockerId === userId && block.blockedUserId === targetUserId)) {
      mockDb.communityBlocks.push({
        id: createPublicId('block'),
        blockedUserId: targetUserId,
        blockerId: userId,
        createdAt: new Date(),
      });
    }

    mockDb.travelMateRequests.forEach((request) => {
      const isSamePair =
        (request.requesterId === userId && request.targetUserId === targetUserId) ||
        (request.requesterId === targetUserId && request.targetUserId === userId);

      if (isSamePair && request.status === 'pending') {
        request.status = 'cancelled';
        request.updatedAt = new Date();
      }
    });

    recordMockCommunityRecommendationEvent(userId, 'community_user_blocked', {
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
    mockDb.communityReports.push({
      id: createPublicId('report'),
      reporterId: userId,
      reason: input.reason,
      details: input.details,
      requestId: input.requestId,
      targetPinId: input.targetPinId,
      targetUserId: input.targetUserId,
      createdAt: new Date(),
    });
    recordMockCommunityRecommendationEvent(userId, 'community_user_reported', {
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
    const recaps = mockDb.recaps
      .filter((recap) => Boolean(recap.sessionId))
      .filter((recap) =>
        scope === 'mine'
          ? recap.userId === userId
          : scope === 'others'
            ? recap.userId !== userId && recap.visibility === 'public'
            : recap.userId === userId || recap.visibility === 'public',
      )
      .filter(
        (recap) =>
          recap.userId === userId || getMockVisibleRecapMoments(recap, userId).length > 0,
      )
      .sort(
        (first, second) => second.createdAt.getTime() - first.createdAt.getTime(),
      );
    const limit = getLimit(params.limit);
    const page = paginateByCursor(recaps, limit, params.cursor);

    return {
      data: page.items.map((recap) => recapItemToDto(recap, userId)),
      page: {
        limit,
        nextCursor: page.nextCursor,
      },
    };
  },

  async getRecapMarkers(userId: string, params: {
    lat?: number;
    lng?: number;
    radiusMeters?: number;
    scope?: RecapMapScope;
  }) {
    const scope = params.scope ?? 'public';
    const origin =
      scope === 'public' &&
      params.lat !== undefined &&
      params.lng !== undefined
        ? { lat: params.lat, lng: params.lng }
        : undefined;
    const radiusMeters = RECAP_DISCOVERY_RADIUS_METERS;

    return mockDb.recaps
      .filter((recap) =>
        scope === 'mine'
          ? recap.userId === userId
          : recap.visibility === 'public',
      )
      .flatMap((recap) => {
        const marker = mockRecapMapMarkerToDto(recap, userId, origin);

        return marker && (recap.userId === userId || getMockVisibleRecapMoments(recap, userId).length)
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

  async createRecap(userId: string, input: {
    momentLogIds?: string[];
    representativeTrackId?: string;
    routePoints?: RoutePointDto[];
    sessionId?: string;
    templateId?: string;
    title?: string;
    visibility?: RecapVisibility;
  }, idempotencyKey?: string) {
    return withMockIdempotency(
      { idempotencyKey, scope: 'recap.create', userId },
      () => {
        if (!input.sessionId && !input.momentLogIds?.length) {
          throw badRequest(ERROR_MESSAGES.RECAP_LOG_REQUIRES_CAPTURE);
        }

        const moments = mockDb.momentLogs
          .filter((moment) => {
            if (input.momentLogIds?.length) {
              return input.momentLogIds.includes(moment.id);
            }

            return input.sessionId ? moment.sessionId === input.sessionId : true;
          })
          .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime());
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
          ? mockDb.travelSessions.find(
              (session) => session.id === input.sessionId,
            )
          : undefined;

        if (travelSession && travelSession.userId !== userId) {
          throw badRequest(ERROR_MESSAGES.RECAP_LOG_CAPTURE_MISMATCH);
        }

        if (input.sessionId && !travelSession) {
          const recoveredRoutePoints = normalizeRoutePoints(input.routePoints);
          const recordedAt = moments.at(-1)?.createdAt ?? new Date();

          travelSession = {
            endedAt: recoveredRoutePoints?.at(-1)
              ? new Date(recoveredRoutePoints.at(-1)!.recordedAt)
              : recordedAt,
            id: input.sessionId,
            routePoints: recoveredRoutePoints,
            startedAt: recoveredRoutePoints?.[0]
              ? new Date(recoveredRoutePoints[0].recordedAt)
              : moments[0]?.createdAt ?? recordedAt,
            status: 'ended',
            userId,
          };
          mockDb.travelSessions.push(travelSession);
        }

        if (input.sessionId) {
          const existingLog = mockDb.recaps.find(
            (recap) => recap.travelSessionId === input.sessionId,
          );

          if (existingLog) {
            if (existingLog.userId !== userId) {
              throw badRequest(ERROR_MESSAGES.RECAP_LOG_CAPTURE_MISMATCH);
            }

            return recapItemToDto(existingLog, userId);
          }
        }

        const representativeMoment = moments.at(-1)!;
        const thumbnailMoment = moments[0]!;
        const candidateTrackIds = input.representativeTrackId
          ? [input.representativeTrackId]
          : Array.from(
              new Set(
                [...moments]
                  .reverse()
                  .map((moment) => moment.trackSnapshot?.id)
                  .filter((trackId): trackId is string => Boolean(trackId)),
              ),
            );
        const representativeTrackId =
          input.representativeTrackId ??
          candidateTrackIds[0] ??
          NO_MUSIC_TRACK_ID;

        const representativeTrackSnapshot = [...moments]
          .reverse()
          .map((moment) => moment.trackSnapshot)
          .find((track) => track?.id === representativeTrackId);

        if (!findMockTrack(representativeTrackId) && representativeTrackSnapshot) {
          mockDb.tracks.push({
            ...representativeTrackSnapshot,
            fallbackColor: representativeTrackSnapshot.fallbackColor ?? '#252A38',
          });
        }

        if (!findMockTrack(representativeTrackId) && representativeTrackId === NO_MUSIC_TRACK_ID) {
          mockDb.tracks.push({
            artist: 'Soundlog',
            fallbackColor: '#252A38',
            id: NO_MUSIC_TRACK_ID,
            title: '음악 없음',
          });
        }

        if (!findMockTrack(representativeTrackId)) {
          throw notFound(ERROR_MESSAGES.REPRESENTATIVE_TRACK_NOT_FOUND);
        }

        const representativeMomentLocation =
          representativeMoment.lat !== undefined && representativeMoment.lng !== undefined
            ? { lat: representativeMoment.lat, lng: representativeMoment.lng }
            : undefined;
        const routePoints =
          normalizeRoutePoints(input.routePoints) ??
          normalizeRoutePoints(travelSession?.routePoints);
        const firstRoutePoint = input.routePoints?.[0] ?? travelSession?.routePoints?.[0];
        const recapLocation = representativeMomentLocation ?? (
          firstRoutePoint
            ? { lat: firstRoutePoint.lat, lng: firstRoutePoint.lng }
            : undefined
        );

        const hasPublicLocatedMoment = moments.some(
          (moment) =>
            moment.visibility === 'public' &&
            moment.lat !== undefined &&
            moment.lng !== undefined,
        );

        if (input.visibility === 'public' && !hasPublicLocatedMoment) {
          throw badRequest(ERROR_MESSAGES.RECAP_LOG_PUBLIC_CAPTURE_REQUIRED);
        }

        const recap = {
          id: createPublicId('recap'),
          userId,
          title: input.title ?? `${representativeMoment.placeName ?? '여행'}의 사운드`,
          placeName: representativeMoment.placeName ?? 'Soundlog',
          representativeTrackId,
          createdAt: new Date(),
          momentCount: moments.length,
          sessionId: input.sessionId,
          travelSessionId: input.sessionId,
          backgroundImageUrl: thumbnailMoment.photoUrl,
          discImageUrl: representativeMoment.photoUrl,
          lat: recapLocation?.lat,
          lng: recapLocation?.lng,
          recordedAt: representativeMoment.createdAt,
          routePoints,
          templateId: input.templateId ?? 'album',
          thumbnailMomentId: thumbnailMoment.id,
          visibility: input.visibility ?? 'private',
          moments: moments.map((moment) => ({
            id: moment.id,
            imageUrl: moment.photoUrl,
            location:
              moment.lat !== undefined && moment.lng !== undefined
                ? { lat: moment.lat, lng: moment.lng }
                : undefined,
            placeName: moment.placeName ?? '위치 없음',
            trackTitle: moment.trackSnapshot?.title ?? '저장된 순간',
            artistName: moment.trackSnapshot?.artist ?? '음악 없음',
            recordedAt: moment.createdAt.toISOString(),
            templateId: moment.templateId,
            track: moment.trackSnapshot,
            visibility: moment.visibility,
          })),
        };

        mockDb.recaps.unshift(recap);

        return recapItemToDto(recap, userId);
      },
    );
  },

  async getRecapShare(userId: string, recapId: string) {
    const recap = mockDb.recaps.find(
      (item) => item.id === recapId && (item.userId === userId || item.visibility === 'public'),
    );

    if (!recap) {
      throw notFound(ERROR_MESSAGES.RECAP_NOT_FOUND);
    }

    if (recap.userId !== userId && getMockVisibleRecapMoments(recap, userId).length === 0) {
      throw notFound(ERROR_MESSAGES.RECAP_NOT_FOUND);
    }

    return recapShareToDto(recap, userId);
  },

  async updateRecapVisibility(
    userId: string,
    recapId: string,
    input: { visibility: RecapVisibility },
  ) {
    const recap = mockDb.recaps.find((item) => item.id === recapId && item.userId === userId);

    if (!recap) {
      throw notFound(ERROR_MESSAGES.RECAP_NOT_FOUND);
    }

    const memberMomentIds = new Set(getMockRecapMoments(recap).map((moment) => moment.id));

    if (recap.sessionId && input.visibility === 'public') {
      const hasPublicLocatedMoment = getMockRecapMoments(recap).some(
        (moment) =>
          moment.visibility === 'public' &&
          typeof moment.location?.lat === 'number' &&
          typeof moment.location?.lng === 'number',
      );

      if (!hasPublicLocatedMoment) {
        throw badRequest(ERROR_MESSAGES.RECAP_LOG_PUBLIC_CAPTURE_REQUIRED);
      }
    }

    if (!recap.sessionId) {
      const memberMoments = mockDb.momentLogs.filter((moment) => memberMomentIds.has(moment.id));
      const locatedMoment = memberMoments.find(
        (moment) => moment.lat !== undefined && moment.lng !== undefined,
      );

      assertMockPublicRecapHasLocation(
        input.visibility,
        locatedMoment && locatedMoment.lat !== undefined && locatedMoment.lng !== undefined
          ? { lat: locatedMoment.lat, lng: locatedMoment.lng }
          : undefined,
      );
      memberMoments.forEach((moment) => {
        moment.visibility = input.visibility;
      });
    }

    recap.visibility = input.visibility;
    refreshMockRecapAggregates({
      momentIds: [...memberMomentIds],
      sessionIds: [recap.sessionId],
      userId,
    });

    const updatedRecap = mockDb.recaps.find((item) => item.id === recapId);

    if (!updatedRecap) {
      throw notFound(ERROR_MESSAGES.RECAP_NOT_FOUND);
    }

    return recapItemToDto(updatedRecap, userId);
  },

  async updateRecapThumbnail(
    userId: string,
    recapId: string,
    input: { momentId: string },
  ) {
    const recap = mockDb.recaps.find((item) => item.id === recapId && item.userId === userId);

    if (!recap) {
      throw notFound(ERROR_MESSAGES.RECAP_NOT_FOUND);
    }

    if (!recap.sessionId) {
      throw badRequest(ERROR_MESSAGES.RECAP_THUMBNAIL_LOG_REQUIRED);
    }

    if (!getMockRecapMoments(recap).some((moment) => moment.id === input.momentId)) {
      throw badRequest(ERROR_MESSAGES.RECAP_THUMBNAIL_MOMENT_NOT_FOUND);
    }

    const thumbnailMoment = mockDb.momentLogs.find(
      (moment) =>
        moment.id === input.momentId &&
        moment.sessionId === recap.sessionId,
    );

    if (!thumbnailMoment) {
      throw badRequest(ERROR_MESSAGES.RECAP_THUMBNAIL_MOMENT_NOT_FOUND);
    }

    recap.thumbnailMomentId = thumbnailMoment.id;
    recap.backgroundImageUrl = thumbnailMoment.photoUrl;

    return recapItemToDto(recap, userId);
  },

  async createRecapShareEvent(userId: string, recapId: string, input: {
    createdAt: string;
    type: string;
  }, _idempotencyKey?: string) {
    if (!mockDb.recaps.some((recap) => recap.id === recapId && recap.userId === userId)) {
      throw notFound(ERROR_MESSAGES.RECAP_NOT_FOUND);
    }

    mockDb.recapShareEvents.push({
      id: createPublicId('share_event'),
      recapId,
      type: input.type,
      createdAt: new Date(input.createdAt),
    });
  },

  async createTravelSession(userId: string, input: {
    location?: { lat: number; lng: number };
    routePoints?: RoutePointDto[];
    startedAt?: string;
    travelMode?: string;
  }) {
    const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
    const routePoints =
      normalizeRoutePoints(input.routePoints) ??
      createInitialRoutePoints(input.location, startedAt);
    const session = {
      id: createPublicId('session'),
      status: 'active' as const,
      startedAt,
      travelMode: input.travelMode,
      lat: input.location?.lat,
      lng: input.location?.lng,
      routePoints,
      userId,
    };

    mockDb.travelSessions.push(session);

    return {
      id: session.id,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      routePoints: session.routePoints,
      travelMode: session.travelMode,
    };
  },

  async updateTravelSession(userId: string, sessionId: string, input: {
    endedAt?: string;
    location?: { lat: number; lng: number };
    routePoints?: RoutePointDto[];
    status: 'active' | 'ended';
  }) {
    const session = mockDb.travelSessions.find(
      (item) => item.id === sessionId && item.userId === userId,
    );

    if (!session) {
      throw notFound(ERROR_MESSAGES.TRAVEL_SESSION_NOT_FOUND);
    }

    if (session.status === 'ended' && input.status === 'active') {
      throw badRequest(ERROR_MESSAGES.ENDED_TRAVEL_SESSION_CANNOT_ACTIVATE);
    }

    session.status = input.status;
    session.endedAt =
      input.status === 'ended'
        ? input.endedAt
          ? new Date(input.endedAt)
          : new Date()
        : undefined;
    session.lat = input.location?.lat ?? session.lat;
    session.lng = input.location?.lng ?? session.lng;
    session.routePoints = normalizeRoutePoints(input.routePoints) ?? session.routePoints;

    if (session.status === 'ended') {
      const now = new Date();
      mockDb.soundMapPins.forEach((pin) => {
        if (pin.userId === userId && pin.sessionId === sessionId) {
          pin.expiresAt = now;
          pin.visibility = 'private';
          pin.updatedAt = now;
        }
      });
    }

    return compact({
      id: session.id,
      status: session.status,
      startedAt: session.startedAt?.toISOString(),
      endedAt: session.endedAt?.toISOString(),
      routePoints: session.routePoints,
      travelMode: session.travelMode,
    });
  },

  async getRegionSoundTrend(params: { period: string; regionCode: string }) {
    const trend = mockDb.regionSoundTrends.find(
      (item) => item.regionCode === params.regionCode && item.period === params.period,
    );

    if (!trend) {
      throw notFound(ERROR_MESSAGES.REGION_SOUND_TREND_NOT_FOUND);
    }

    return {
      regionCode: trend.regionCode,
      regionName: trend.regionName,
      period: trend.period,
      topMoodTags: trend.topMoodTags,
      topTracks: trend.topTrackIds
        .map(findMockTrack)
        .filter(isDefined)
        .map((track) => trackToDto(track)),
      sampleSize: trend.sampleSize,
    };
  },
};
