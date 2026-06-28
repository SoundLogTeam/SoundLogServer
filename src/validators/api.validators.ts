import { z } from 'zod';

import { ERROR_MESSAGES } from '../constants/error.constants.js';

const optionalCsvArray = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => String(item).split(','));
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return value;
}, z.array(z.string()).optional());

const requiredStringArray = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => String(item).split(','));
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return value;
}, z.array(z.string()));

const queryNumber = z.coerce.number();
const optionalQueryNumber = z.coerce.number().optional();
const queryBoolean = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return value;
}, z.boolean());

const limit = z.coerce.number().int().min(1).max(50).optional();
const cursor = z.string().optional();

export const travelModeSchema = z.enum([
  'walk',
  'drive',
  'cafe',
  'ocean',
  'festival',
  'night',
]);

export const recommendationModeSchema = z.enum(['everyday', 'travel']);

export const moodTagSchema = z.enum([
  'calm',
  'fresh',
  'emotional',
  'active',
  'local',
]);

const mlTravelStateSchema = z.enum(['바다', '드라이브', '산책', '카페', '야경']);
const mlMoodSchema = z.enum(['잔잔한', '신나는', '시원한', '설레는', '감성적인']);

const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const recommendationContextSchema = z
  .object({
    moodFilter: z.string().optional(),
    placeCategory: z.string().optional(),
    placeId: z.string().optional(),
    placeName: z.string().optional(),
    recommendationMode: recommendationModeSchema.optional(),
    topFilter: z.string().optional(),
    travelMode: travelModeSchema.optional(),
  })
  .default({});

export const authValidators = {
  socialLoginBody: z
    .object({
      authorizationCode: z.string().min(1).optional(),
      codeVerifier: z.string().min(1).optional(),
      device: z
        .object({
          appVersion: z.string().optional(),
          deviceId: z.string().optional(),
          platform: z.enum(['ios', 'android', 'web']),
        })
        .optional(),
      deviceId: z.string().optional(),
      idToken: z.string().min(1).optional(),
      provider: z.enum(['kakao', 'apple', 'google']),
      providerAccessToken: z.string().min(1).optional(),
      providerDisplayName: z.string().min(1).max(120).optional(),
      providerToken: z.string().min(1).optional(),
      redirectUri: z.string().optional(),
    })
    .refine(
      (value) =>
        Boolean(
          value.authorizationCode ||
            value.idToken ||
            value.providerAccessToken ||
            value.providerToken ||
            value.device?.deviceId ||
            value.deviceId,
        ),
      {
        message: ERROR_MESSAGES.PROVIDER_CREDENTIALS_REQUIRED,
      },
    ),
  logoutBody: z
    .object({
      refreshToken: z.string().min(1).optional(),
    })
    .default({}),
  refreshBody: z.object({
    refreshToken: z.string().min(1),
  }),
};

export const meValidators = {
  profileBody: z.object({
    birthYear: z.number().int().min(1900).max(2026).optional(),
    companionType: z.enum(['solo', 'friends', 'couple', 'family']).optional(),
    dislikedArtists: z.array(z.string()).optional(),
    gender: z.enum(['female', 'male', 'non_binary', 'undisclosed']).optional(),
    locationRecommendationEnabled: z.boolean(),
    preferredGenres: z.array(z.string()),
    preferredMoods: z.array(z.string()),
    travelStyles: z.array(z.string()),
  }),
  musicPlatformBody: z.object({
    connected: z.boolean().optional().default(false),
    providerUserId: z.string().optional(),
    selectedPlatformId: z.enum(['none', 'spotify', 'melon', 'youtubeMusic']),
  }),
  migrationBody: z.object({
    idempotencyKey: z.string().min(1).max(128),
    libraryTrackCount: z.number().int().min(0).optional().default(0),
    momentLogCount: z.number().int().min(0).optional().default(0),
    recapDraftCount: z.number().int().min(0).optional().default(0),
  }),
};

export const tourValidators = {
  nearbyQuery: z.object({
    contentTypes: z.string().optional(),
    lat: queryNumber.min(-90).max(90),
    limit,
    lng: queryNumber.min(-180).max(180),
    radiusMeters: z.coerce.number().int().min(100).max(20000).optional(),
  }),
};

export const homeValidators = {
  featuredQuery: z.object({
    lat: optionalQueryNumber,
    limit,
    lng: optionalQueryNumber,
    locationRecommendationEnabled: queryBoolean,
    placeId: z.string().optional(),
    recommendationMode: recommendationModeSchema.optional().default('everyday'),
    travelMode: travelModeSchema.optional(),
  }),
  moodQuery: z.object({
    limit,
    moodFilter: z.string().default('전체'),
    preferredGenres: optionalCsvArray,
    preferredMoods: optionalCsvArray,
    recommendationMode: recommendationModeSchema.optional().default('everyday'),
    topFilter: z.string().default('전체'),
    travelMode: travelModeSchema.optional(),
    travelStyles: optionalCsvArray,
  }),
  recentMusicLogsQuery: z.object({
    limit,
  }),
};

export const playlistValidators = {
  detailParams: z.object({
    playlistId: z.string().min(1),
  }),
  detailQuery: z.object({
    lat: optionalQueryNumber,
    lng: optionalQueryNumber,
    moodTags: optionalCsvArray,
    placeId: z.string().optional(),
    travelMode: travelModeSchema.optional(),
  }),
  contextualBody: z.object({
    excludeTrackIds: z.array(z.string()).optional(),
    location: geoPointSchema.optional(),
    mood: mlMoodSchema.optional(),
    moodTags: z.array(moodTagSchema).optional(),
    placeId: z.string().optional(),
    preferredGenres: z.array(z.string()).optional(),
    preferredMoods: z.array(z.string()).optional(),
    state: mlTravelStateSchema.optional(),
    travelMode: travelModeSchema.optional(),
  }),
};

export const libraryValidators = {
  listQuery: z.object({
    cursor,
    kind: z.enum(['liked', 'saved', 'all']).optional().default('all'),
    limit,
  }),
  updateParams: z.object({
    trackId: z.string().min(1),
  }),
  updateBody: z.object({
    action: z.enum(['like', 'unlike', 'save', 'unsave']),
    context: recommendationContextSchema.optional(),
    playlistId: z.string().optional(),
  }),
};

export const momentLogValidators = {
  listQuery: z.object({
    cursor,
    limit,
    sessionId: z.string().optional(),
  }),
  createBody: z.object({
    artistName: z.string().optional(),
    createdAt: z.string().datetime(),
    lat: z.coerce.number().optional(),
    lng: z.coerce.number().optional(),
    moodTags: requiredStringArray.pipe(z.array(moodTagSchema)),
    placeCategory: z.string().optional(),
    placeId: z.string().optional(),
    placeName: z.string().optional(),
    sessionId: z.string().optional(),
    trackId: z.string().optional(),
    trackTitle: z.string().optional(),
    travelMode: travelModeSchema.optional(),
  }),
};

export const recommendationEventValidators = {
  createBody: z.object({
    events: z
      .array(
        z.object({
          context: recommendationContextSchema,
          createdAt: z.string().datetime(),
          id: z.string().min(1),
          playlistId: z.string().optional(),
          sessionId: z.string().min(1),
          trackId: z.string().optional(),
          type: z.enum([
            'track_play',
            'track_pause',
            'track_resume',
            'track_external_open',
            'track_like',
            'track_unlike',
            'track_save',
            'track_unsave',
            'playlist_open',
            'mood_filter_change',
            'recommendation_mode_change',
            'top_filter_change',
            'track_skip',
            'recap_representative_track_select',
          ]),
          value: z.string().optional(),
        }),
      )
      .min(1)
      .max(100),
  }),
};

export const recapValidators = {
  listQuery: z.object({
    cursor,
    limit,
  }),
  createBody: z.object({
    momentLogIds: z.array(z.string()).optional(),
    representativeTrackId: z.string().optional(),
    sessionId: z.string().optional(),
    templateId: z.enum(['album', 'film', 'lp', 'video']),
    title: z.string().optional(),
  }),
  recapParams: z.object({
    recapId: z.string().min(1),
  }),
  shareEventBody: z.object({
    createdAt: z.string().datetime(),
    type: z.enum(['save_image', 'os_share', 'instagram', 'snapchat', 'messages']),
  }),
};

export const travelSessionValidators = {
  createBody: z
    .object({
      location: geoPointSchema.optional(),
      startedAt: z.string().datetime().optional(),
      travelMode: travelModeSchema.optional(),
    })
    .optional()
    .default({}),
  updateParams: z.object({
    sessionId: z.string().min(1),
  }),
  updateBody: z.object({
    endedAt: z.string().datetime().optional(),
    location: geoPointSchema.optional(),
    status: z.enum(['active', 'ended']),
  }),
};

export const trendValidators = {
  params: z.object({
    regionCode: z.string().min(1),
  }),
  query: z.object({
    period: z.enum(['daily', 'weekly', 'monthly']).optional().default('weekly'),
  }),
};
