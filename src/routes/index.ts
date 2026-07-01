import { Router } from 'express';

import {
  authController,
  devDbTestController,
  homeController,
  libraryController,
  meController,
  momentLogController,
  playlistController,
  recapController,
  recommendationEventController,
  systemController,
  tourController,
  travelSessionController,
  trendController,
} from '../controllers/index.js';
import { asyncHandler } from '../utils/async-handler.js';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import { momentPhotoUpload } from '../middlewares/upload.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  authValidators,
  devDbTestValidators,
  homeValidators,
  libraryValidators,
  meValidators,
  momentLogValidators,
  playlistValidators,
  recapValidators,
  recommendationEventValidators,
  tourValidators,
  travelSessionValidators,
  trendValidators,
} from '../validators/api.validators.js';

export function createApiRouter() {
  const router = Router();

  router.get('/v1/health', asyncHandler(systemController.getHealth));
  router.post(
    '/v1/dev/db-test-records',
    validate({ body: devDbTestValidators.createBody }),
    asyncHandler(devDbTestController.createRecord),
  );

  router.post(
    '/v1/auth/social-login',
    validate({ body: authValidators.socialLoginBody }),
    asyncHandler(authController.socialLogin),
  );
  router.post(
    '/v1/auth/refresh',
    validate({ body: authValidators.refreshBody }),
    asyncHandler(authController.refresh),
  );
  router.post(
    '/v1/auth/logout',
    validate({ body: authValidators.logoutBody }),
    asyncHandler(authController.logout),
  );

  router.get('/v1/me', authMiddleware, asyncHandler(meController.getMe));
  router.get('/v1/me/profile', authMiddleware, asyncHandler(meController.getProfile));
  router.put(
    '/v1/me/profile',
    authMiddleware,
    validate({ body: meValidators.profileBody }),
    asyncHandler(meController.upsertProfile),
  );
  router.get(
    '/v1/me/music-platform',
    authMiddleware,
    asyncHandler(meController.getMusicPlatform),
  );
  router.put(
    '/v1/me/music-platform',
    authMiddleware,
    validate({ body: meValidators.musicPlatformBody }),
    asyncHandler(meController.updateMusicPlatform),
  );
  router.post(
    '/v1/me/migrate-local-data',
    authMiddleware,
    validate({ body: meValidators.migrationBody }),
    asyncHandler(meController.migrateLocalData),
  );

  router.get(
    '/v1/tour/nearby-places',
    validate({ query: tourValidators.nearbyQuery }),
    asyncHandler(tourController.getNearbyPlaces),
  );

  router.get(
    '/v1/home/featured-playlists',
    optionalAuthMiddleware,
    validate({ query: homeValidators.featuredQuery }),
    asyncHandler(homeController.getFeaturedPlaylists),
  );
  router.get(
    '/v1/home/mood-recommendations',
    optionalAuthMiddleware,
    validate({ query: homeValidators.moodQuery }),
    asyncHandler(homeController.getMoodRecommendations),
  );
  router.get(
    '/v1/home/recent-music-logs',
    authMiddleware,
    validate({ query: homeValidators.recentMusicLogsQuery }),
    asyncHandler(homeController.getRecentMusicLogs),
  );

  router.post(
    '/v1/playlists/contextual',
    authMiddleware,
    validate({ body: playlistValidators.contextualBody }),
    asyncHandler(playlistController.createContextualPlaylist),
  );
  router.get(
    '/v1/playlists/:playlistId',
    optionalAuthMiddleware,
    validate({
      params: playlistValidators.detailParams,
      query: playlistValidators.detailQuery,
    }),
    asyncHandler(playlistController.getPlaylist),
  );

  router.get(
    '/v1/library/tracks',
    authMiddleware,
    validate({ query: libraryValidators.listQuery }),
    asyncHandler(libraryController.getTracks),
  );
  router.put(
    '/v1/library/tracks/:trackId',
    authMiddleware,
    validate({
      params: libraryValidators.updateParams,
      body: libraryValidators.updateBody,
    }),
    asyncHandler(libraryController.updateTrackState),
  );

  router.get(
    '/v1/moment-logs',
    authMiddleware,
    validate({ query: momentLogValidators.listQuery }),
    asyncHandler(momentLogController.getMomentLogs),
  );
  router.post(
    '/v1/moment-logs',
    authMiddleware,
    momentPhotoUpload.single('photo'),
    validate({ body: momentLogValidators.createBody }),
    asyncHandler(momentLogController.createMomentLog),
  );

  router.post(
    '/v1/recommendation-events',
    authMiddleware,
    validate({ body: recommendationEventValidators.createBody }),
    asyncHandler(recommendationEventController.createEvents),
  );

  router.get(
    '/v1/recaps',
    authMiddleware,
    validate({ query: recapValidators.listQuery }),
    asyncHandler(recapController.getRecaps),
  );
  router.post(
    '/v1/recaps',
    authMiddleware,
    validate({ body: recapValidators.createBody }),
    asyncHandler(recapController.createRecap),
  );
  router.get(
    '/v1/recaps/:recapId/share',
    authMiddleware,
    validate({ params: recapValidators.recapParams }),
    asyncHandler(recapController.getRecapShare),
  );
  router.post(
    '/v1/recaps/:recapId/share-events',
    authMiddleware,
    validate({
      params: recapValidators.recapParams,
      body: recapValidators.shareEventBody,
    }),
    asyncHandler(recapController.createShareEvent),
  );

  router.post(
    '/v1/travel-sessions',
    authMiddleware,
    validate({ body: travelSessionValidators.createBody }),
    asyncHandler(travelSessionController.createTravelSession),
  );
  router.patch(
    '/v1/travel-sessions/:sessionId',
    authMiddleware,
    validate({
      params: travelSessionValidators.updateParams,
      body: travelSessionValidators.updateBody,
    }),
    asyncHandler(travelSessionController.updateTravelSession),
  );

  router.get(
    '/v1/trends/regions/:regionCode/sound',
    validate({
      params: trendValidators.params,
      query: trendValidators.query,
    }),
    asyncHandler(trendController.getRegionSoundTrend),
  );

  return router;
}
