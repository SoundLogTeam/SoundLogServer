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

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null),
  ) as Partial<T>;
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

function recapItemToDto(recap: (typeof mockDb.recaps)[number]) {
  const track = findMockTrack(recap.representativeTrackId);

  if (!track) {
    throw notFound(ERROR_MESSAGES.REPRESENTATIVE_TRACK_NOT_FOUND);
  }

  return compact({
    id: recap.id,
    title: recap.title,
    placeName: recap.placeName,
    representativeTrack: trackToDto(track),
    createdAt: recap.createdAt.toISOString(),
    momentCount: recap.momentCount,
    sessionId: recap.sessionId,
  });
}

function recapShareToDto(recap: (typeof mockDb.recaps)[number]) {
  const track = findMockTrack(recap.representativeTrackId);

  if (!track) {
    throw notFound(ERROR_MESSAGES.REPRESENTATIVE_TRACK_NOT_FOUND);
  }

  return compact({
    id: recap.id,
    placeName: recap.placeName,
    trackTitle: track.title,
    artistName: track.artist,
    backgroundImageUrl: recap.backgroundImageUrl,
    discImageUrl: recap.discImageUrl,
    moments: recap.moments,
    recordedAt: (recap.recordedAt ?? recap.createdAt).toISOString(),
    shareImageUrl: recap.shareImageUrl,
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

function scoreMoodRecommendation(
  item: (typeof mockDb.moodRecommendations)[number],
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

  if (params.moodFilter && params.moodFilter !== '전체' && item.moods.includes(params.moodFilter)) {
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

  async getNearbyPlaces(params: { lat: number; limit?: number }) {
    const isSouthernContext = params.lat < 36.5;

    return [...mockDb.places]
      .sort((first, second) => {
        const firstScore = isSouthernContext && first.address?.startsWith('부산') ? -1 : 0;
        const secondScore = isSouthernContext && second.address?.startsWith('부산') ? -1 : 0;
        return firstScore - secondScore;
      })
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
    topFilter?: string;
    travelStyles?: string[];
  }) {
    return [...mockDb.moodRecommendations]
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
          moods: recommendation.moods,
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

    return playlistToDto(playlist);
  },

  async getPlaylist(_userId: string | undefined, playlistId: string, query: { lat?: number; placeId?: string }) {
    const id = playlistId === 'fallback' ? getDefaultPlaylistId(query) : playlistId;
    const playlist = mockDb.playlists.find((item) => item.id === id);

    if (!playlist) {
      throw notFound(ERROR_MESSAGES.PLAYLIST_NOT_FOUND);
    }

    return playlistToDto(playlist);
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
    trackId?: string;
    trackTitle?: string;
    travelMode?: string;
  }, idempotencyKey?: string) {
    return withMockIdempotency(
      { idempotencyKey, scope: 'moment-log.create', userId },
      () => {
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
        };

        mockDb.momentLogs.unshift(log);

        return momentLogToDto(log);
      },
    );
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

    recordMockCommunityRecommendationEvent(userId, 'trip_room_joined', {
      role: existing?.role ?? 'member',
      roomId,
    }, { sessionId: room.sessionId ?? roomId });

    return roomToDto(room);
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
          title: input.title ?? `${room.title} 공동 Recap`,
          placeName: recapMoments[0]?.placeName ?? room.title,
          representativeTrackId,
          createdAt: new Date(),
          momentCount: recapMoments.length,
          sessionId: room.sessionId,
          recordedAt: recapMoments[0]?.createdAt ?? new Date(),
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
    const track = findMockTrack(input.trackId) ?? {
      id: input.trackId ?? createPublicId('track'),
      title: input.trackTitle ?? '선택한 음악',
      artist: input.artistName ?? '아티스트 미상',
    };
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
    const blockedIds = mockDb.communityBlocks
      .filter((block) => block.blockerId === userId)
      .map((block) => block.blockedUserId);
    const pins = mockDb.soundMapPins
      .filter((pin) => pin.expiresAt > new Date())
      .filter((pin) => !blockedIds.includes(pin.userId))
      .filter((pin) => (query.visibility ? pin.visibility === query.visibility : pin.visibility !== 'private'));

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

    const blockedIds = mockDb.communityBlocks
      .filter((block) => block.blockerId === userId)
      .map((block) => block.blockedUserId);
    const pins = mockDb.soundMapPins
      .filter((pin) => pin.expiresAt > new Date())
      .filter((pin) => pin.userId !== userId && pin.visibility === 'nearby')
      .filter((pin) => !blockedIds.includes(pin.userId));

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
    const existingActiveRequest = mockDb.travelMateRequests
      .filter(
        (request) =>
          request.requesterId === userId &&
          request.targetUserId === targetUserId &&
          request.targetPinId === input.targetPinId &&
          ['pending', 'accepted'].includes(request.status),
      )
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())[0];

    if (existingActiveRequest) {
      return mateRequestToDto(existingActiveRequest);
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

  async getRecaps(_userId: string, params: { cursor?: string; limit?: number }) {
    const recaps = [...mockDb.recaps].sort(
      (first, second) => second.createdAt.getTime() - first.createdAt.getTime(),
    );
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

  async createRecap(userId: string, input: {
    momentLogIds?: string[];
    representativeTrackId?: string;
    sessionId?: string;
    title?: string;
  }, idempotencyKey?: string) {
    return withMockIdempotency(
      { idempotencyKey, scope: 'recap.create', userId },
      () => {
        const moments = mockDb.momentLogs.filter((moment) => {
          if (input.momentLogIds?.length) {
            return input.momentLogIds.includes(moment.id);
          }

          return input.sessionId ? moment.sessionId === input.sessionId : true;
        });
        const firstMoment = moments[0];
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
          candidateTrackIds.find((trackId) => Boolean(findMockTrack(trackId))) ??
          'seoul-city';

        if (!findMockTrack(representativeTrackId)) {
          throw notFound(ERROR_MESSAGES.REPRESENTATIVE_TRACK_NOT_FOUND);
        }

        const recap = {
          id: createPublicId('recap'),
          title: input.title ?? `${firstMoment?.placeName ?? '여행'}의 사운드`,
          placeName: firstMoment?.placeName ?? 'Soundlog',
          representativeTrackId,
          createdAt: new Date(),
          momentCount: moments.length,
          sessionId: input.sessionId,
          backgroundImageUrl: firstMoment?.photoUrl,
          discImageUrl: firstMoment?.photoUrl,
          recordedAt: firstMoment?.createdAt ?? new Date(),
          moments: moments.map((moment) => ({
            id: moment.id,
            imageUrl: moment.photoUrl,
            placeName: moment.placeName ?? '위치 없음',
            trackTitle: moment.trackSnapshot?.title ?? '저장된 순간',
            artistName: moment.trackSnapshot?.artist ?? '음악 없음',
            recordedAt: moment.createdAt.toISOString(),
          })),
        };

        mockDb.recaps.unshift(recap);

        return recapItemToDto(recap);
      },
    );
  },

  async getRecapShare(_userId: string, recapId: string) {
    const recap = mockDb.recaps.find((item) => item.id === recapId);

    if (!recap) {
      throw notFound(ERROR_MESSAGES.RECAP_NOT_FOUND);
    }

    return recapShareToDto(recap);
  },

  async createRecapShareEvent(_userId: string, recapId: string, input: {
    createdAt: string;
    type: string;
  }, _idempotencyKey?: string) {
    if (!mockDb.recaps.some((recap) => recap.id === recapId)) {
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
    startedAt?: string;
    travelMode?: string;
  }) {
    const session = {
      id: createPublicId('session'),
      status: 'active' as const,
      startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
      travelMode: input.travelMode,
      lat: input.location?.lat,
      lng: input.location?.lng,
      userId,
    };

    mockDb.travelSessions.push(session);

    return {
      id: session.id,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      travelMode: session.travelMode,
    };
  },

  async updateTravelSession(userId: string, sessionId: string, input: {
    endedAt?: string;
    location?: { lat: number; lng: number };
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

    return compact({
      id: session.id,
      status: session.status,
      startedAt: session.startedAt?.toISOString(),
      endedAt: session.endedAt?.toISOString(),
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
