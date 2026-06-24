import { env } from '../config/env.js';
import { findMockTrack, mockDb } from '../mock/mock-db.js';
import { badRequest, notFound } from '../utils/http-error.js';
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
  previewUrl?: string;
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
    throw notFound('대표 트랙을 찾을 수 없습니다.');
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
    throw notFound('대표 트랙을 찾을 수 없습니다.');
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

function getDefaultPlaylistId(params?: { lat?: number; placeId?: string }) {
  if (params?.placeId) {
    const place = mockDb.places.find((item) => item.id === params.placeId);
    const placeText = [place?.title, place?.category, place?.overview].join(' ');

    if (/해변|바다|해수욕장|ocean|beach/i.test(placeText)) {
      return 'busan-ocean';
    }
  }

  return params?.lat && params.lat < 36.5 ? 'busan-ocean' : 'seoul-night';
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

  async getMyMusicPlatform() {
    return {
      ...mockDb.musicPlatform,
      updatedAt: mockDb.musicPlatform.updatedAt.toISOString(),
    };
  },

  async updateMyMusicPlatform(_userId: string, input: {
    connected?: boolean;
    providerUserId?: string;
    selectedPlatformId: string;
  }) {
    mockDb.musicPlatform = {
      ...mockDb.musicPlatform,
      ...input,
      connected: input.connected ?? false,
      updatedAt: new Date(),
    };

    return this.getMyMusicPlatform();
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
          id: place.id,
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
          source: place.source,
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
          throw notFound('추천 트랙을 찾을 수 없습니다.');
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
    placeId?: string;
  }, _idempotencyKey?: string) {
    const playlistId = getDefaultPlaylistId({
      lat: input.location?.lat,
      placeId: input.placeId,
    });
    const playlist = mockDb.playlists.find((item) => item.id === playlistId);

    if (!playlist) {
      throw notFound('플레이리스트를 찾을 수 없습니다.');
    }

    return playlistToDto(playlist);
  },

  async getPlaylist(_userId: string | undefined, playlistId: string, query: { lat?: number; placeId?: string }) {
    const id = playlistId === 'fallback' ? getDefaultPlaylistId(query) : playlistId;
    const playlist = mockDb.playlists.find((item) => item.id === id);

    if (!playlist) {
      throw notFound('플레이리스트를 찾을 수 없습니다.');
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
      throw notFound('트랙을 찾을 수 없습니다.');
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
    photoPath: string;
    placeCategory?: string;
    placeId?: string;
    placeName?: string;
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
          photoUrl: `${env.UPLOAD_PUBLIC_BASE_URL}${input.photoPath}`,
          createdAt: new Date(input.createdAt),
          sessionId: input.sessionId,
          lat: input.lat,
          lng: input.lng,
          placeCategory: input.placeCategory,
          placeId: input.placeId,
          placeName: input.placeName,
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

  async createRecommendationEvents(_userId: string, input: {
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
        createdAt: new Date(event.createdAt),
      });
    });
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
          throw notFound('대표 트랙을 찾을 수 없습니다.');
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
      throw notFound('리캡을 찾을 수 없습니다.');
    }

    return recapShareToDto(recap);
  },

  async createRecapShareEvent(_userId: string, recapId: string, input: {
    createdAt: string;
    type: string;
  }, _idempotencyKey?: string) {
    if (!mockDb.recaps.some((recap) => recap.id === recapId)) {
      throw notFound('리캡을 찾을 수 없습니다.');
    }

    mockDb.recapShareEvents.push({
      id: createPublicId('share_event'),
      recapId,
      type: input.type,
      createdAt: new Date(input.createdAt),
    });
  },

  async createTravelSession(_userId: string, input: {
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
    };

    mockDb.travelSessions.push(session);

    return {
      id: session.id,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      travelMode: session.travelMode,
    };
  },

  async updateTravelSession(_userId: string, sessionId: string, input: {
    endedAt?: string;
    location?: { lat: number; lng: number };
    status: 'active' | 'ended';
  }) {
    const session = mockDb.travelSessions.find((item) => item.id === sessionId);

    if (!session) {
      throw notFound('여행 세션을 찾을 수 없습니다.');
    }

    if (session.status === 'ended' && input.status === 'active') {
      throw badRequest('종료된 여행 세션은 다시 활성화할 수 없습니다.');
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
      throw notFound('지역 사운드 트렌드를 찾을 수 없습니다.');
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
