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
const inviteCodeSchema = z
  .string()
  .trim()
  .min(4)
  .max(16)
  .transform((code) => code.toUpperCase());

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

const routePointSchema = geoPointSchema.extend({
  accuracyMeters: z.number().min(0).max(10000).optional(),
  recordedAt: z.string().datetime(),
});

const routePointsSchema = z.array(routePointSchema).max(500);
const recapTemplateSchema = z.enum(['album', 'film', 'lp', 'map']);
const recapVisibilitySchema = z.enum(['private', 'public']);

const optionalLatQuery = z.coerce.number().min(-90).max(90).optional();
const optionalLngQuery = z.coerce.number().min(-180).max(180).optional();

const recommendationContextSchema = z
  .object({
    moodFilter: z.string().optional(),
    placeCategory: z.string().optional(),
    placeId: z.string().optional(),
    placeName: z.string().optional(),
    recommendationMode: recommendationModeSchema.optional(),
    travelMode: travelModeSchema.optional(),
  })
  .default({});

export const authValidators = {
  loginBody: z.object({
    email: z.string().trim().email(),
    password: z.string().min(8).max(128),
  }),
  registerBody: z.object({
    displayName: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email(),
    password: z.string().min(8).max(128),
  }),
  logoutBody: z
    .object({
      refreshToken: z.string().min(1).optional(),
    })
    .default({}),
  refreshBody: z.object({
    refreshToken: z.string().min(1),
  }),
};

export const devDbTestValidators = {
  createBody: z
    .object({
      label: z.string().min(1).max(120).optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
    })
    .default({}),
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
  migrationBody: z.object({
    idempotencyKey: z.string().min(1).max(128),
    libraryTrackCount: z.number().int().min(0).optional().default(0),
    momentLogCount: z.number().int().min(0).optional().default(0),
    recapDraftCount: z.number().int().min(0).optional().default(0),
  }),
};

export const tourValidators = {
  reverseGeocodeQuery: z.object({
    lat: queryNumber.min(-90).max(90),
    lng: queryNumber.min(-180).max(180),
  }),
  searchQuery: z.object({
    limit,
    query: z.string().trim().min(1).max(80),
  }),
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
  recommendationQuery: z.object({
    mood: mlMoodSchema,
    state: mlTravelStateSchema,
    x: queryNumber.min(-180).max(180),
    y: queryNumber.min(-90).max(90),
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
  momentLogParams: z.object({
    momentLogId: z.string().min(1),
  }),
  createBody: z.object({
    artistName: z.string().optional(),
    createdAt: z.string().datetime(),
    lat: z.coerce.number().optional(),
    lng: z.coerce.number().optional(),
    moodTags: requiredStringArray.pipe(z.array(moodTagSchema)),
    note: z.string().trim().max(240).optional(),
    placeCategory: z.string().optional(),
    placeId: z.string().optional(),
    placeName: z.string().optional(),
    sessionId: z.string().optional(),
    templateId: recapTemplateSchema.optional().default('album'),
    trackId: z.string().optional(),
    trackTitle: z.string().optional(),
    travelMode: travelModeSchema.optional(),
    visibility: recapVisibilitySchema.optional().default('private'),
  }),
  updateBody: z.object({
    artistName: z.string().optional(),
    createdAt: z.string().datetime().optional(),
    lat: z.union([z.coerce.number(), z.null()]).optional(),
    lng: z.union([z.coerce.number(), z.null()]).optional(),
    moodTags: requiredStringArray.pipe(z.array(moodTagSchema)).optional(),
    note: z.union([z.string().trim().max(240), z.null()]).optional(),
    placeCategory: z.union([z.string(), z.null()]).optional(),
    placeId: z.union([z.string(), z.null()]).optional(),
    placeName: z.union([z.string(), z.null()]).optional(),
    sessionId: z.union([z.string(), z.null()]).optional(),
    templateId: recapTemplateSchema.optional(),
    trackId: z.string().optional(),
    trackTitle: z.string().optional(),
    travelMode: z.union([travelModeSchema, z.null()]).optional(),
    visibility: recapVisibilitySchema.optional(),
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
            'track_external_open',
            'external_music_open_failed',
            'track_selected',
            'track_like',
            'track_unlike',
            'track_save',
            'track_unsave',
            'moment_log_saved',
            'moment_log_sync_failed',
            'playlist_open',
            'mood_adjusted',
            'mood_filter_change',
            'live_track_shared',
            'nearby_sound_opened',
            'sound_map_viewed',
            'music_match_viewed',
            'music_match_profile_opened',
            'travel_mode_enabled',
            'trip_room_created',
            'trip_room_joined',
            'shared_moment_added',
            'shared_moment_status_updated',
            'shared_moment_commented',
            'collab_recap_created',
            'travel_mate_requested',
            'travel_mate_accepted',
            'travel_mate_declined',
            'travel_mate_cancelled',
            'travel_mate_expired',
            'community_user_blocked',
            'community_user_reported',
            'recommendation_mode_change',
            'top_filter_change',
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
  markerQuery: z.object({
    lat: optionalLatQuery,
    lng: optionalLngQuery,
    radiusMeters: z.coerce.number().int().min(50).max(5000).optional().default(300),
    scope: z.enum(['public', 'mine']).optional().default('public'),
  }),
  listQuery: z.object({
    cursor,
    limit,
    scope: z.enum(['all', 'mine', 'others']).optional().default('mine'),
  }),
  createBody: z.object({
    momentLogIds: z.array(z.string()).optional(),
    representativeTrackId: z.string().optional(),
    routePoints: routePointsSchema.optional(),
    sessionId: z.string().optional(),
    templateId: recapTemplateSchema,
    title: z.string().optional(),
    visibility: recapVisibilitySchema.optional().default('private'),
  }),
  recapParams: z.object({
    recapId: z.string().min(1),
  }),
  visibilityBody: z.object({
    visibility: recapVisibilitySchema,
  }),
  thumbnailBody: z.object({
    momentId: z.string().min(1),
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
      routePoints: routePointsSchema.optional(),
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
    routePoints: routePointsSchema.optional(),
    status: z.enum(['active', 'ended']),
  }),
};

export const communityValidators = {
  roomParams: z.object({
    roomId: z.string().min(1),
  }),
  roomMomentParams: z.object({
    momentId: z.string().min(1),
    roomId: z.string().min(1),
  }),
  createRoomBody: z.object({
    sessionId: z.string().optional(),
    title: z.string().trim().min(1).max(80).default('Soundlog 여행방'),
    visibility: z.enum(['invite_only', 'companions']).optional().default('invite_only'),
  }),
  listRoomsQuery: z.object({
    limit,
    sessionId: z.string().optional(),
  }),
  joinRoomBody: z.object({
    displayName: z.string().trim().min(1).max(40).optional(),
    inviteCode: inviteCodeSchema.optional(),
  }),
  joinRoomByInviteBody: z.object({
    displayName: z.string().trim().min(1).max(40).optional(),
    inviteCode: inviteCodeSchema,
  }),
  addRoomMomentBody: z.object({
    artistName: z.string().trim().max(120).optional(),
    momentLogId: z.string().optional(),
    note: z.string().trim().max(240).optional(),
    placeName: z.string().trim().max(120).optional(),
    status: z.enum(['candidate', 'accepted', 'rejected']).optional().default('candidate'),
    trackId: z.string().optional(),
    trackTitle: z.string().trim().max(160).optional(),
  }),
  updateRoomMomentBody: z.object({
    status: z.enum(['candidate', 'accepted', 'rejected']),
  }),
  addRoomMomentCommentBody: z.object({
    body: z.string().trim().min(1).max(300),
  }),
  createRoomRecapBody: z.object({
    representativeTrackId: z.string().optional(),
    templateId: z.enum(['album', 'film', 'lp']).optional().default('album'),
    title: z.string().trim().max(120).optional(),
  }),
  soundMapQuery: z.object({
    lat: optionalLatQuery,
    lng: optionalLngQuery,
    radiusMeters: z.coerce.number().int().min(100).max(20000).optional().default(3000),
    visibility: z.enum(['companions', 'nearby']).optional(),
  }),
  currentTrackBody: z.object({
    location: geoPointSchema,
    moodTags: z.array(moodTagSchema).optional().default([]),
    placeName: z.string().trim().max(120).optional(),
    sessionId: z.string().optional(),
    trackId: z.string().optional(),
    trackTitle: z.string().trim().max(160).optional(),
    artistName: z.string().trim().max(120).optional(),
    travelMode: travelModeSchema.optional(),
    ttlMinutes: z.number().int().min(5).max(240).optional().default(120),
    visibility: z.enum(['companions', 'nearby', 'private']),
  }),
  musicMatchesQuery: z.object({
    lat: optionalLatQuery,
    lng: optionalLngQuery,
    mood: z.string().optional(),
    radiusMeters: z.coerce.number().int().min(100).max(20000).optional().default(3000),
    state: z.string().optional(),
  }),
  createMateRequestBody: z.object({
    messageTemplate: z
      .enum(['liked_track', 'walk_together', 'cafe_together'])
      .default('liked_track'),
    targetPinId: z.string().optional(),
    targetUserId: z.string().optional(),
  }),
  listMateRequestsQuery: z.object({
    box: z.enum(['all', 'inbox', 'sent']).optional().default('all'),
    limit,
    status: z
      .enum(['accepted', 'cancelled', 'declined', 'expired', 'pending'])
      .optional(),
  }),
  mateRequestParams: z.object({
    requestId: z.string().min(1),
  }),
  updateMateRequestBody: z.object({
    action: z.enum(['accept', 'decline', 'cancel', 'expire']),
  }),
  blockBody: z
    .object({
      targetPinId: z.string().optional(),
      targetUserId: z.string().min(1).optional(),
    })
    .refine((value) => Boolean(value.targetUserId || value.targetPinId), {
      message: ERROR_MESSAGES.TRAVEL_MATE_TARGET_REQUIRED,
    }),
  reportBody: z.object({
    details: z.string().trim().max(500).optional(),
    reason: z.enum(['safety', 'spam', 'inappropriate', 'other']),
    requestId: z.string().optional(),
    targetPinId: z.string().optional(),
    targetUserId: z.string().optional(),
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
