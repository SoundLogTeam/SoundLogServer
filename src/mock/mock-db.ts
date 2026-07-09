import {
  defaultUser,
  moodRecommendations,
  places,
  playlists,
  recaps,
  regionSoundTrends,
  seedMomentLogs,
  tracks,
} from '../data/seed-data.js';

type MockTrack = {
  albumImageUrl?: string;
  artist: string;
  externalUrl?: string;
  fallbackColor?: string;
  id: string;
  platformUrls?: Record<string, string>;
  title: string;
};

type MockMomentLog = {
  createdAt: Date;
  id: string;
  lat?: number;
  lng?: number;
  moodTags: string[];
  photoUrl?: string;
  placeCategory?: string;
  placeId?: string;
  placeName?: string;
  note?: string;
  sessionId?: string;
  source: 'camera';
  syncStatus: 'failed' | 'pending' | 'synced';
  trackSnapshot?: MockTrack;
  travelMode?: string;
};

type MockLibraryTrackState = {
  isLiked: boolean;
  isSaved: boolean;
  likedAt?: Date;
  playlistId?: string;
  savedAt?: Date;
  trackId: string;
  updatedAt: Date;
};

type MockRecap = {
  backgroundImageUrl?: string;
  createdAt: Date;
  discImageUrl?: string;
  id: string;
  momentCount?: number;
  moments?: unknown[];
  placeName: string;
  recordedAt?: Date;
  representativeTrackId: string;
  sessionId?: string;
  shareImageUrl?: string;
  title: string;
};

type MockTravelSession = {
  endedAt?: Date;
  id: string;
  lat?: number;
  lng?: number;
  startedAt?: Date;
  status: 'active' | 'ended' | 'idle';
  travelMode?: string;
  userId: string;
};

type MockRefreshToken = {
  expiresAt: Date;
  tokenHash: string;
};

type MockPasswordUser = {
  displayName: string;
  email: string;
  id: string;
  passwordHash: string;
};

type MockTravelRoom = {
  createdAt: Date;
  id: string;
  inviteCode: string;
  ownerId: string;
  sessionId?: string;
  title: string;
  updatedAt: Date;
  visibility: string;
};

type MockTravelRoomMember = {
  displayName?: string;
  id: string;
  joinedAt: Date;
  role: string;
  roomId: string;
  userId: string;
};

type MockTravelRoomMoment = {
  createdAt: Date;
  id: string;
  momentLogId?: string;
  note?: string;
  placeName?: string;
  roomId: string;
  status: string;
  trackSnapshot?: MockTrack;
  userId: string;
};

type MockTravelRoomMomentComment = {
  body: string;
  createdAt: Date;
  id: string;
  momentId: string;
  userId: string;
};

type MockSoundMapPin = {
  approxLat: number;
  approxLng: number;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  lat: number;
  lng: number;
  moodTags: string[];
  placeName?: string;
  sessionId?: string;
  trackSnapshot?: MockTrack;
  travelMode?: string;
  updatedAt: Date;
  userId: string;
  visibility: string;
};

type MockTravelMateRequest = {
  createdAt: Date;
  id: string;
  messageTemplate: string;
  requesterId: string;
  status: string;
  targetPinId?: string;
  targetUserId: string;
  updatedAt: Date;
};

function cloneTrack(track: (typeof tracks)[number]): MockTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    fallbackColor: track.fallbackColor,
    externalUrl: 'externalUrl' in track ? track.externalUrl : undefined,
    platformUrls:
      'platformUrls' in track
        ? (track.platformUrls as Record<string, string>)
        : undefined,
  };
}

function createMockDb() {
  const now = new Date();
  const nextTracks = tracks.map(cloneTrack);
  const trackById = new Map(nextTracks.map((track) => [track.id, track]));

  return {
    user: {
      id: 'mock-user-local',
      ...defaultUser,
      displayName: 'Local Soundlog Mock User',
    },
    profile: {
      companionType: 'friends',
      locationRecommendationEnabled: true,
      preferredGenres: ['K-POP', '인디'],
      preferredMoods: ['청량한', '잔잔한'],
      travelStyles: ['산책', '카페 투어'],
      dislikedArtists: [] as string[],
      completedOnboarding: true,
      updatedAt: now,
    },
    musicPlatform: {
      selectedPlatformId: 'none',
      connected: false,
      providerUserId: undefined as string | undefined,
      updatedAt: now,
    },
    tracks: nextTracks,
    places: places.map((place) => ({ ...place })),
    playlists: playlists.map((playlist) => ({
      ...playlist,
      trackIds: [...playlist.trackIds],
    })),
    moodRecommendations: moodRecommendations.map((recommendation) => ({
      ...recommendation,
      genres: recommendation.genres.map(String),
      moods: recommendation.moods.map(String),
      travelStyles: recommendation.travelStyles.map(String),
    })),
    libraryTrackStates: [
      {
        trackId: 'seoul-city',
        playlistId: 'seoul-night',
        isLiked: true,
        isSaved: false,
        likedAt: now,
        updatedAt: now,
      },
      {
        trackId: 'hangang',
        playlistId: 'seoul-night',
        isLiked: false,
        isSaved: true,
        savedAt: now,
        updatedAt: now,
      },
    ] as MockLibraryTrackState[],
    momentLogs: seedMomentLogs.map((log) => ({
      id: log.id,
      photoUrl: log.photoUrl,
      createdAt: new Date(log.createdAt),
      sessionId: log.sessionId,
      placeName: log.placeName,
      note: log.note,
      moodTags: [...log.moodTags],
      source: 'camera' as const,
      syncStatus: 'synced' as const,
      trackSnapshot: trackById.get(log.trackId),
    })) as MockMomentLog[],
    recommendationEvents: [] as Array<{
      context: Record<string, unknown>;
      createdAt: Date;
      id: string;
      playlistId?: string;
      sessionId: string;
      trackId?: string;
      type: string;
      userId: string;
      value?: string;
    }>,
    recaps: recaps.map((recap) => ({
      id: recap.id,
      title: recap.title,
      placeName: recap.placeName,
      representativeTrackId: recap.representativeTrackId,
      createdAt: new Date(recap.createdAt),
      momentCount: recap.momentCount,
      sessionId: recap.sessionId,
      backgroundImageUrl: recap.backgroundImageUrl,
      discImageUrl: recap.discImageUrl,
      recordedAt: new Date(recap.recordedAt),
      moments: [...recap.moments],
    })) as MockRecap[],
    recapShareEvents: [] as Array<{
      createdAt: Date;
      id: string;
      recapId: string;
      type: string;
    }>,
    travelSessions: [] as MockTravelSession[],
    regionSoundTrends: regionSoundTrends.map((trend) => ({
      ...trend,
      topMoodTags: [...trend.topMoodTags],
      topTrackIds: [...trend.topTrackIds],
    })),
    refreshTokens: [] as MockRefreshToken[],
    passwordUsers: [] as MockPasswordUser[],
    travelRooms: [] as MockTravelRoom[],
    travelRoomMembers: [] as MockTravelRoomMember[],
    travelRoomMoments: [] as MockTravelRoomMoment[],
    travelRoomMomentComments: [] as MockTravelRoomMomentComment[],
    soundMapPins: [] as MockSoundMapPin[],
    travelMateRequests: [] as MockTravelMateRequest[],
    communityBlocks: [] as Array<{
      blockedUserId: string;
      blockerId: string;
      createdAt: Date;
      id: string;
    }>,
    communityReports: [] as Array<{
      createdAt: Date;
      details?: string;
      id: string;
      reason: string;
      reporterId: string;
      requestId?: string;
      targetPinId?: string;
      targetUserId?: string;
    }>,
    idempotencyRecords: [] as Array<{
      idempotencyKey: string;
      response: unknown;
      scope: string;
      userId: string;
    }>,
  };
}

export const mockDb = createMockDb();

export function resetMockDb() {
  Object.assign(mockDb, createMockDb());
}

export function findMockTrack(trackId?: string) {
  return trackId ? mockDb.tracks.find((track) => track.id === trackId) : undefined;
}
