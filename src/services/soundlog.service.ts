import type {
  LibraryTrackState,
  MomentLog,
  MoodRecommendation,
  Place,
  Playlist,
  PlaylistTrack,
  Prisma,
  Recap,
  RegionSoundTrend,
  Track,
  TravelSession,
  UserProfile,
} from '@prisma/client';

import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { getLimit, paginateByCursor } from '../utils/pagination.js';
import { createPublicId } from '../utils/tokens.js';
import { badRequest, notFound } from '../utils/http-error.js';

type MaybeUser = { id: string } | undefined;

type TrackDto = {
  id: string;
  title: string;
  artist: string;
  fallbackColor?: string;
  albumImageUrl?: string;
  previewUrl?: string;
  externalUrl?: string;
  platformUrls?: Record<string, string>;
  isLiked?: boolean;
  isSaved?: boolean;
};

type RecommendationContext = Record<string, unknown>;

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null),
  ) as Partial<T>;
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
    previewUrl: track.previewUrl ?? undefined,
    externalUrl: track.externalUrl ?? undefined,
    platformUrls: (track.platformUrls as Record<string, string> | null) ?? undefined,
    isLiked: state?.isLiked ?? seededState?.isLiked,
    isSaved: state?.isSaved ?? seededState?.isSaved,
  }) as TrackDto;
}

function placeToDto(place: Place) {
  return compact({
    id: place.id,
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
    source: place.source,
  });
}

type PlaylistWithTracks = Playlist & {
  tracks: Array<PlaylistTrack & { track: Track }>;
};

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

function musicPlatformToDto(platform: {
  connected: boolean;
  providerUserId: string | null;
  selectedPlatformId: string;
  updatedAt: Date;
}) {
  return compact({
    selectedPlatformId: platform.selectedPlatformId,
    connected: platform.connected,
    providerUserId: platform.providerUserId ?? undefined,
    updatedAt: platform.updatedAt.toISOString(),
  });
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
    topFilter?: string;
    travelStyles?: string[];
  },
) {
  let score = item.sortOrder * -0.01;

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
  ).length * 3;
  score += (params.preferredMoods ?? []).filter((mood) =>
    item.moods.includes(mood),
  ).length * 2;
  score += (params.travelStyles ?? []).filter((style) =>
    item.travelStyles.includes(style),
  ).length * 2;

  return score;
}

async function findDefaultPlaylist(params?: { lat?: number; placeId?: string }) {
  if (params?.placeId) {
    const place = await prisma.place.findUnique({ where: { id: params.placeId } });
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
    return {
      status: 'ok',
      checkedAt: new Date().toISOString(),
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

  async getMyMusicPlatform(userId: string) {
    const platform = await prisma.musicPlatform.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        selectedPlatformId: 'none',
        connected: false,
      },
    });

    return musicPlatformToDto(platform);
  },

  async updateMyMusicPlatform(
    userId: string,
    input: {
      connected?: boolean;
      providerUserId?: string;
      selectedPlatformId: string;
    },
  ) {
    const platform = await prisma.musicPlatform.upsert({
      where: { userId },
      update: input,
      create: {
        userId,
        selectedPlatformId: input.selectedPlatformId,
        connected: input.connected ?? false,
        providerUserId: input.providerUserId,
      },
    });

    return musicPlatformToDto(platform);
  },

  async getNearbyPlaces(params: { lat: number; lng: number; limit?: number }) {
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
    },
  ) {
    const playlists = await prisma.playlist.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    const preferredId =
      params.locationRecommendationEnabled && (params.lat || params.placeId)
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
    input: {
      location?: { lat: number; lng: number };
      moodTags?: string[];
      placeId?: string;
      travelMode?: string;
    },
  ) {
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

    await prisma.playlist.update({
      where: { id: playlist.id },
      data: {
        context: compact({
          moodTags: input.moodTags,
          placeId: input.placeId,
          travelMode: input.travelMode,
        }),
      },
    });

    return playlistToDto(playlist, userId);
  },

  async getPlaylist(
    userId: string,
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
      throw notFound('플레이리스트를 찾을 수 없습니다.');
    }

    return playlistToDto(playlist, userId);
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
    const records = states.map((state) => ({
      id: state.trackId,
      createdAt: (state.isLiked ? state.likedAt : state.savedAt)?.toISOString() ?? state.updatedAt.toISOString(),
      playlistId: state.playlistId ?? undefined,
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
  ) {
    const track = await prisma.track.findUnique({ where: { id: trackId } });

    if (!track) {
      throw notFound('트랙을 찾을 수 없습니다.');
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
      photoPath: string;
      placeCategory?: string;
      placeId?: string;
      placeName?: string;
      sessionId?: string;
      trackId?: string;
      trackTitle?: string;
      travelMode?: string;
    },
  ) {
    const track = input.trackId
      ? await prisma.track.findUnique({ where: { id: input.trackId } })
      : undefined;
    const photoUrl = `${env.UPLOAD_PUBLIC_BASE_URL}${input.photoPath}`;
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
  ) {
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
  ) {
    const moments = await prisma.momentLog.findMany({
      where: {
        userId,
        id: input.momentLogIds?.length ? { in: input.momentLogIds } : undefined,
        sessionId: input.sessionId,
      },
      orderBy: { createdAt: 'asc' },
    });
    const representativeTrackId =
      input.representativeTrackId ??
      ((moments[0]?.trackSnapshot as TrackDto | null)?.id || 'seoul-city');
    const track = await prisma.track.findUnique({
      where: { id: representativeTrackId },
    });

    if (!track) {
      throw notFound('대표 트랙을 찾을 수 없습니다.');
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

  async getRecapShare(userId: string, recapId: string) {
    const recap = await prisma.recap.findFirst({
      where: {
        id: recapId,
        userId,
      },
      include: { representativeTrack: true },
    });

    if (!recap) {
      throw notFound('리캡을 찾을 수 없습니다.');
    }

    return recapShareToDto(recap);
  },

  async createRecapShareEvent(
    userId: string,
    recapId: string,
    input: { createdAt: string; type: string },
  ) {
    const recap = await prisma.recap.findFirst({
      where: {
        id: recapId,
        userId,
      },
    });

    if (!recap) {
      throw notFound('리캡을 찾을 수 없습니다.');
    }

    await prisma.recapShareEvent.create({
      data: {
        recapId,
        userId,
        type: input.type,
        createdAt: new Date(input.createdAt),
      },
    });
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
      throw notFound('여행 세션을 찾을 수 없습니다.');
    }

    if (session.status === 'ended' && input.status === 'active') {
      throw badRequest('종료된 여행 세션은 다시 활성화할 수 없습니다.');
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
      throw notFound('지역 사운드 트렌드를 찾을 수 없습니다.');
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
