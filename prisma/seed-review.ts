import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

import { CURRENT_TERMS_VERSION } from '../src/constants/legal.constants.js';
import { seedDemoCommunity, seedPublicCatalog } from './seed.js';

const prisma = new PrismaClient();

const reviewEmail = process.env.APP_REVIEW_EMAIL?.trim().toLowerCase();
const reviewPassword = process.env.APP_REVIEW_PASSWORD;

async function seedReviewExperience() {
  if (!reviewEmail || !reviewPassword) {
    throw new Error('APP_REVIEW_EMAIL and APP_REVIEW_PASSWORD are required.');
  }
  if (reviewPassword.length < 8) {
    throw new Error('APP_REVIEW_PASSWORD must be at least 8 characters.');
  }

  await seedPublicCatalog();
  await seedDemoCommunity();

  const demoUser = await prisma.user.findUniqueOrThrow({
    where: {
      provider_providerUserId: {
        provider: 'seed',
        providerUserId: 'demo-minji',
      },
    },
  });
  const secondDemoUser = await prisma.user.findUniqueOrThrow({
    where: {
      provider_providerUserId: {
        provider: 'seed',
        providerUserId: 'demo-seoyeon',
      },
    },
  });
  const reviewUser = await prisma.user.upsert({
    where: {
      provider_providerUserId: {
        provider: 'email',
        providerUserId: reviewEmail,
      },
    },
    update: {
      displayName: 'Soundlog Reviewer',
      moderationStatus: 'active',
      passwordHash: await bcrypt.hash(reviewPassword, 12),
      suspendedAt: null,
      suspensionReason: null,
      termsAcceptedAt: new Date(),
      termsVersion: CURRENT_TERMS_VERSION,
    },
    create: {
      displayName: 'Soundlog Reviewer',
      moderationStatus: 'active',
      passwordHash: await bcrypt.hash(reviewPassword, 12),
      provider: 'email',
      providerUserId: reviewEmail,
      termsAcceptedAt: new Date(),
      termsVersion: CURRENT_TERMS_VERSION,
    },
  });

  await prisma.userProfile.upsert({
    where: { userId: reviewUser.id },
    update: {
      companionType: 'solo',
      completedOnboarding: true,
      dislikedArtists: [],
      locationRecommendationEnabled: true,
      preferredGenres: ['K-POP', '인디'],
      preferredMoods: ['설레는', '잔잔한'],
      travelStyles: ['산책', '야경'],
    },
    create: {
      companionType: 'solo',
      completedOnboarding: true,
      dislikedArtists: [],
      locationRecommendationEnabled: true,
      preferredGenres: ['K-POP', '인디'],
      preferredMoods: ['설레는', '잔잔한'],
      travelStyles: ['산책', '야경'],
      userId: reviewUser.id,
    },
  });
  await prisma.musicPlatform.upsert({
    where: { userId: reviewUser.id },
    update: { connected: false, providerUserId: null, selectedPlatformId: 'none' },
    create: { connected: false, selectedPlatformId: 'none', userId: reviewUser.id },
  });

  await prisma.$transaction([
    prisma.communityBlock.deleteMany({
      where: {
        OR: [
          { blockerId: reviewUser.id },
          { blockedUserId: reviewUser.id },
        ],
      },
    }),
    prisma.communityReport.deleteMany({
      where: {
        OR: [
          { reporterId: reviewUser.id },
          { targetUserId: reviewUser.id },
        ],
      },
    }),
    prisma.travelMateRequest.deleteMany({
      where: {
        OR: [
          { requesterId: reviewUser.id },
          { targetUserId: reviewUser.id },
        ],
      },
    }),
  ]);

  const reviewTrack = await prisma.track.findUniqueOrThrow({ where: { id: 'seoul-city' } });
  const trackSnapshot = {
    albumImageUrl: reviewTrack.albumImageUrl,
    artist: reviewTrack.artist,
    externalUrl: reviewTrack.externalUrl,
    fallbackColor: reviewTrack.fallbackColor,
    id: reviewTrack.id,
    platformUrls: reviewTrack.platformUrls,
    title: reviewTrack.title,
  };

  const reviewPins = [
    {
      id: 'app-review-sound-pin-namsan',
      lat: 37.5512,
      lng: 126.9882,
      moodTags: ['설레는', '감성적인'],
      placeName: '남산서울타워',
      userId: demoUser.id,
    },
    {
      id: 'app-review-sound-pin-haebangchon',
      lat: 37.5436,
      lng: 126.9878,
      moodTags: ['잔잔한', '야경'],
      placeName: '해방촌',
      userId: secondDemoUser.id,
    },
  ];
  for (const pin of reviewPins) {
    await prisma.soundMapPin.upsert({
      where: { userId: pin.userId },
      update: {
        approxLat: Number(pin.lat.toFixed(3)),
        approxLng: Number(pin.lng.toFixed(3)),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        lat: pin.lat,
        lng: pin.lng,
        moodTags: pin.moodTags,
        placeName: pin.placeName,
        trackSnapshot,
        travelMode: 'walk',
        visibility: 'nearby',
      },
      create: {
        approxLat: Number(pin.lat.toFixed(3)),
        approxLng: Number(pin.lng.toFixed(3)),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        id: pin.id,
        lat: pin.lat,
        lng: pin.lng,
        moodTags: pin.moodTags,
        placeName: pin.placeName,
        trackSnapshot,
        travelMode: 'walk',
        userId: pin.userId,
        visibility: 'nearby',
      },
    });
  }

  await prisma.travelRoom.upsert({
    where: { id: 'app-review-travel-room' },
    update: { ownerId: demoUser.id, title: '서울 야경 같이 듣기' },
    create: {
      id: 'app-review-travel-room',
      inviteCode: 'REVIEW26',
      ownerId: demoUser.id,
      title: '서울 야경 같이 듣기',
    },
  });
  await prisma.travelRoomMember.upsert({
    where: {
      roomId_userId: { roomId: 'app-review-travel-room', userId: demoUser.id },
    },
    update: { displayName: '민지', role: 'owner' },
    create: {
      displayName: '민지',
      role: 'owner',
      roomId: 'app-review-travel-room',
      userId: demoUser.id,
    },
  });
  await prisma.travelRoomMember.upsert({
    where: {
      roomId_userId: { roomId: 'app-review-travel-room', userId: reviewUser.id },
    },
    update: { displayName: 'Soundlog Reviewer', role: 'member' },
    create: {
      displayName: 'Soundlog Reviewer',
      role: 'member',
      roomId: 'app-review-travel-room',
      userId: reviewUser.id,
    },
  });
  await prisma.travelRoomMoment.upsert({
    where: { id: 'app-review-room-moment' },
    update: {
      moderationStatus: 'approved',
      note: '남산에서 함께 들은 오늘의 곡이에요.',
      placeName: '남산서울타워',
      roomId: 'app-review-travel-room',
      status: 'accepted',
      trackSnapshot,
      userId: demoUser.id,
    },
    create: {
      id: 'app-review-room-moment',
      moderationStatus: 'approved',
      note: '남산에서 함께 들은 오늘의 곡이에요.',
      placeName: '남산서울타워',
      roomId: 'app-review-travel-room',
      status: 'accepted',
      trackSnapshot,
      userId: demoUser.id,
    },
  });
  await prisma.travelRoomMomentComment.upsert({
    where: { id: 'app-review-room-comment' },
    update: {
      body: '야경과 정말 잘 어울리는 노래였어요.',
      moderationStatus: 'approved',
      userId: demoUser.id,
    },
    create: {
      body: '야경과 정말 잘 어울리는 노래였어요.',
      id: 'app-review-room-comment',
      moderationStatus: 'approved',
      momentId: 'app-review-room-moment',
      userId: demoUser.id,
    },
  });

  console.log(`App review experience seeded for ${reviewEmail}.`);
}

seedReviewExperience()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
