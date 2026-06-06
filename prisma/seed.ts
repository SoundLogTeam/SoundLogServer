import { PrismaClient } from '@prisma/client';

import {
  defaultUser,
  moodRecommendations,
  places,
  playlists,
  recaps,
  regionSoundTrends,
  seedMomentLogs,
  tracks,
} from '../src/data/seed-data.js';

const prisma = new PrismaClient();

export async function seedDatabase() {
  const user = await prisma.user.upsert({
    where: {
      provider_providerUserId: defaultUser,
    },
    update: {},
    create: {
      ...defaultUser,
      displayName: 'Local Soundlog User',
    },
  });

  await prisma.recapShareEvent.deleteMany({ where: { userId: user.id } });
  await prisma.recap.deleteMany({ where: { userId: user.id } });
  await prisma.recommendationEvent.deleteMany({ where: { userId: user.id } });
  await prisma.momentLog.deleteMany({ where: { userId: user.id } });
  await prisma.travelSession.deleteMany({ where: { userId: user.id } });
  await prisma.libraryTrackState.deleteMany({ where: { userId: user.id } });
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

  await prisma.userProfile.upsert({
    where: { userId: user.id },
    update: {
      companionType: 'friends',
      locationRecommendationEnabled: true,
      preferredGenres: ['K-POP', '인디'],
      preferredMoods: ['청량한', '잔잔한'],
      travelStyles: ['산책', '카페 투어'],
      dislikedArtists: [],
      birthYear: null,
      gender: null,
      completedOnboarding: true,
    },
    create: {
      userId: user.id,
      companionType: 'friends',
      locationRecommendationEnabled: true,
      preferredGenres: ['K-POP', '인디'],
      preferredMoods: ['청량한', '잔잔한'],
      travelStyles: ['산책', '카페 투어'],
      completedOnboarding: true,
    },
  });

  await prisma.musicPlatform.upsert({
    where: { userId: user.id },
    update: {
      selectedPlatformId: 'none',
      connected: false,
      providerUserId: null,
    },
    create: {
      userId: user.id,
      selectedPlatformId: 'none',
      connected: false,
    },
  });

  for (const track of tracks) {
    await prisma.track.upsert({
      where: { id: track.id },
      update: { ...track },
      create: { ...track },
    });
  }

  for (const place of places) {
    await prisma.place.upsert({
      where: { id: place.id },
      update: { ...place },
      create: { ...place },
    });
  }

  for (const playlist of playlists) {
    await prisma.playlist.upsert({
      where: { id: playlist.id },
      update: {
        backgroundImageUrl: playlist.backgroundImageUrl,
        coverImageUrl: playlist.coverImageUrl,
        description: playlist.description,
        durationText: playlist.durationText,
        placeName: playlist.placeName,
        reason: playlist.reason,
        regionName: playlist.regionName,
        source: playlist.source,
        trackCount: playlist.trackIds.length,
      },
      create: {
        id: playlist.id,
        backgroundImageUrl: playlist.backgroundImageUrl,
        coverImageUrl: playlist.coverImageUrl,
        description: playlist.description,
        durationText: playlist.durationText,
        placeName: playlist.placeName,
        reason: playlist.reason,
        regionName: playlist.regionName,
        source: playlist.source,
        trackCount: playlist.trackIds.length,
      },
    });

    await prisma.playlistTrack.deleteMany({
      where: { playlistId: playlist.id },
    });

    for (const [index, trackId] of playlist.trackIds.entries()) {
      await prisma.playlistTrack.create({
        data: {
          playlistId: playlist.id,
          trackId,
          position: index + 1,
          isLiked: trackId === 'seoul-city',
          isSaved: trackId === 'hangang',
        },
      });
    }
  }

  for (const recommendation of moodRecommendations) {
    const data = {
      ...recommendation,
      genres: [...recommendation.genres],
      moods: [...recommendation.moods],
      travelStyles: [...recommendation.travelStyles],
    };

    await prisma.moodRecommendation.upsert({
      where: { id: recommendation.id },
      update: data,
      create: data,
    });
  }

  for (const log of seedMomentLogs) {
    const track = await prisma.track.findUniqueOrThrow({
      where: { id: log.trackId },
    });

    await prisma.momentLog.upsert({
      where: { id: log.id },
      update: {},
      create: {
        id: log.id,
        userId: user.id,
        photoUrl: log.photoUrl,
        createdAt: new Date(log.createdAt),
        sessionId: log.sessionId,
        placeName: log.placeName,
        moodTags: [...log.moodTags],
        source: 'camera',
        syncStatus: 'synced',
        trackSnapshot: {
          id: track.id,
          title: track.title,
          artist: track.artist,
          fallbackColor: track.fallbackColor,
          platformUrls: track.platformUrls,
        },
      },
    });
  }

  for (const recap of recaps) {
    await prisma.recap.upsert({
      where: { id: recap.id },
      update: {},
      create: {
        id: recap.id,
        userId: user.id,
        title: recap.title,
        placeName: recap.placeName,
        representativeTrackId: recap.representativeTrackId,
        createdAt: new Date(recap.createdAt),
        momentCount: recap.momentCount,
        sessionId: recap.sessionId,
        backgroundImageUrl: recap.backgroundImageUrl,
        discImageUrl: recap.discImageUrl,
        recordedAt: new Date(recap.recordedAt),
        moments: recap.moments,
      },
    });
  }

  for (const trend of regionSoundTrends) {
    const data = {
      ...trend,
      topMoodTags: [...trend.topMoodTags],
      topTrackIds: [...trend.topTrackIds],
    };

    await prisma.regionSoundTrend.upsert({
      where: {
        regionCode_period: {
          regionCode: trend.regionCode,
          period: trend.period,
        },
      },
      update: data,
      create: data,
    });
  }

  await prisma.libraryTrackState.upsert({
    where: {
      userId_trackId: {
        userId: user.id,
        trackId: 'seoul-city',
      },
    },
    update: {},
    create: {
      userId: user.id,
      trackId: 'seoul-city',
      playlistId: 'seoul-night',
      isLiked: true,
      likedAt: new Date(),
    },
  });

  await prisma.libraryTrackState.upsert({
    where: {
      userId_trackId: {
        userId: user.id,
        trackId: 'hangang',
      },
    },
    update: {},
    create: {
      userId: user.id,
      trackId: 'hangang',
      playlistId: 'seoul-night',
      isSaved: true,
      savedAt: new Date(),
    },
  });
}

export async function disconnectSeedDatabase() {
  await prisma.$disconnect();
}

if (process.argv[1]?.endsWith('prisma/seed.ts') || process.argv[1]?.endsWith('prisma/seed.js')) {
  seedDatabase()
  .then(async () => {
    await disconnectSeedDatabase();
  })
  .catch(async (error) => {
    console.error(error);
    await disconnectSeedDatabase();
    process.exit(1);
  });
}
