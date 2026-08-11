import { PrismaClient, type Track } from '@prisma/client';

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

type DemoCaptureSeed = {
  id: string;
  imageUrl: string;
  lat: number;
  lng: number;
  moodTags: string[];
  note: string;
  placeName: string;
  recordedAt: string;
  templateId: 'album' | 'film' | 'lp' | 'map';
  trackId: string;
  visibility: 'private' | 'public';
};

type DemoUserSeed = {
  companionType: string;
  displayName: string;
  preferredGenres: string[];
  preferredMoods: string[];
  providerUserId: string;
  travelStyles: string[];
};

type DemoTravelLogSeed = {
  captures: DemoCaptureSeed[];
  id: string;
  placeName: string;
  sessionId: string;
  templateId: DemoCaptureSeed['templateId'];
  title: string;
  travelMode: string;
  userProviderId: string;
};

const demoImages = {
  busanBeach: 'https://tong.visitkorea.or.kr/cms2/website/76/2012176.jpg',
  busanCoast: 'https://tong.visitkorea.or.kr/cms2/website/75/2012175.jpg',
  cityNight: 'https://tong.visitkorea.or.kr/cms2/website/75/2012175.jpg',
  cityWalk: 'https://tong.visitkorea.or.kr/cms2/website/82/1870082.jpg',
  islandRoad: 'https://tong.visitkorea.or.kr/cms2/website/82/1870082.jpg',
};

const demoCommunityUsers: DemoUserSeed[] = [
  {
    companionType: 'friends',
    displayName: '민지',
    preferredGenres: ['K-POP', 'R&B'],
    preferredMoods: ['설레는', '감성적인'],
    providerUserId: 'demo-minji',
    travelStyles: ['야경', '카페'],
  },
  {
    companionType: 'solo',
    displayName: '준호',
    preferredGenres: ['인디', '록'],
    preferredMoods: ['시원한', '신나는'],
    providerUserId: 'demo-junho',
    travelStyles: ['바다', '드라이브'],
  },
  {
    companionType: 'couple',
    displayName: '서연',
    preferredGenres: ['발라드', '인디'],
    preferredMoods: ['잔잔한', '감성적인'],
    providerUserId: 'demo-seoyeon',
    travelStyles: ['산책', '사진'],
  },
  {
    companionType: 'family',
    displayName: '도윤',
    preferredGenres: ['K-POP', '팝'],
    preferredMoods: ['신나는', '시원한'],
    providerUserId: 'demo-doyoon',
    travelStyles: ['드라이브', '맛집'],
  },
];

const demoTravelLogs: DemoTravelLogSeed[] = [
  {
    id: 'demo-log-minji-seoul-night',
    placeName: '서울',
    sessionId: 'demo-session-minji-seoul-night',
    templateId: 'film',
    title: '민지의 서울 야경 산책',
    travelMode: 'walk',
    userProviderId: 'demo-minji',
    captures: [
      {
        id: 'demo-capture-minji-namsan',
        imageUrl: demoImages.cityNight,
        lat: 37.5512,
        lng: 126.9882,
        moodTags: ['설레는', '감성적인'],
        note: '해가 지기 시작한 남산에서 첫 곡을 골랐다.',
        placeName: '남산서울타워',
        recordedAt: '2026-07-05T10:10:00.000Z',
        templateId: 'film',
        trackId: 'seoul-city',
        visibility: 'public',
      },
      {
        id: 'demo-capture-minji-haebangchon',
        imageUrl: demoImages.cityWalk,
        lat: 37.5425,
        lng: 126.987,
        moodTags: ['잔잔한'],
        note: '골목을 천천히 걷던 조용한 시간.',
        placeName: '해방촌',
        recordedAt: '2026-07-05T10:42:00.000Z',
        templateId: 'album',
        trackId: 'night-letter',
        visibility: 'public',
      },
      {
        id: 'demo-capture-minji-itaewon',
        imageUrl: demoImages.cityNight,
        lat: 37.5345,
        lng: 126.9946,
        moodTags: ['신나는'],
        note: '불빛이 켜진 거리에서 여행을 마무리했다.',
        placeName: '이태원',
        recordedAt: '2026-07-05T11:18:00.000Z',
        templateId: 'map',
        trackId: 'seoul-night-track',
        visibility: 'public',
      },
    ],
  },
  {
    id: 'demo-log-minji-seongsu',
    placeName: '성수',
    sessionId: 'demo-session-minji-seongsu',
    templateId: 'album',
    title: '성수 카페와 서울숲',
    travelMode: 'cafe',
    userProviderId: 'demo-minji',
    captures: [
      {
        id: 'demo-capture-minji-seoulforest',
        imageUrl: demoImages.cityWalk,
        lat: 37.5444,
        lng: 127.0374,
        moodTags: ['잔잔한', '시원한'],
        note: '나무 사이로 바람이 좋았던 오후.',
        placeName: '서울숲',
        recordedAt: '2026-07-08T05:20:00.000Z',
        templateId: 'album',
        trackId: 'hangang',
        visibility: 'public',
      },
      {
        id: 'demo-capture-minji-seongsu-cafe',
        imageUrl: demoImages.cityNight,
        lat: 37.5447,
        lng: 127.0557,
        moodTags: ['감성적인'],
        note: '창가에 앉아 한 곡을 반복해서 들었다.',
        placeName: '성수 카페거리',
        recordedAt: '2026-07-08T06:05:00.000Z',
        templateId: 'lp',
        trackId: 'geoje-seasons',
        visibility: 'public',
      },
    ],
  },
  {
    id: 'demo-log-junho-san-francisco',
    placeName: '샌프란시스코',
    sessionId: 'demo-session-junho-san-francisco',
    templateId: 'map',
    title: '샌프란시스코 도심 산책',
    travelMode: 'walk',
    userProviderId: 'demo-junho',
    captures: [
      {
        id: 'demo-capture-junho-union-square',
        imageUrl: demoImages.cityWalk,
        lat: 37.7877,
        lng: -122.4075,
        moodTags: ['설레는'],
        note: '도심 산책을 시작하며 고른 첫 곡.',
        placeName: '유니언 스퀘어',
        recordedAt: '2026-07-13T02:10:00.000Z',
        templateId: 'album',
        trackId: 'seoul-city',
        visibility: 'public',
      },
      {
        id: 'demo-capture-junho-yerba-buena',
        imageUrl: demoImages.cityNight,
        lat: 37.7859,
        lng: -122.4042,
        moodTags: ['잔잔한'],
        note: '공원 벤치에서 잠깐 쉬어간 시간.',
        placeName: '예르바 부에나 가든',
        recordedAt: '2026-07-13T02:38:00.000Z',
        templateId: 'film',
        trackId: 'hangang',
        visibility: 'public',
      },
      {
        id: 'demo-capture-junho-market-street',
        imageUrl: demoImages.cityNight,
        lat: 37.7851,
        lng: -122.407,
        moodTags: ['감성적인'],
        note: '도시의 불빛과 음악으로 산책을 마무리했다.',
        placeName: '마켓 스트리트',
        recordedAt: '2026-07-13T03:04:00.000Z',
        templateId: 'map',
        trackId: 'moon-seoul',
        visibility: 'public',
      },
    ],
  },
  {
    id: 'demo-log-junho-busan-ocean',
    placeName: '부산',
    sessionId: 'demo-session-junho-busan-ocean',
    templateId: 'map',
    title: '부산 해변 드라이브',
    travelMode: 'drive',
    userProviderId: 'demo-junho',
    captures: [
      {
        id: 'demo-capture-junho-gwangalli',
        imageUrl: demoImages.busanBeach,
        lat: 35.1532,
        lng: 129.1186,
        moodTags: ['시원한', '신나는'],
        note: '광안대교가 보이기 시작한 순간.',
        placeName: '광안리해수욕장',
        recordedAt: '2026-07-09T08:05:00.000Z',
        templateId: 'map',
        trackId: 'geoje-travel',
        visibility: 'public',
      },
      {
        id: 'demo-capture-junho-dalmaji',
        imageUrl: demoImages.busanCoast,
        lat: 35.1588,
        lng: 129.1719,
        moodTags: ['시원한'],
        note: '창문을 열고 달맞이길을 달렸다.',
        placeName: '달맞이길',
        recordedAt: '2026-07-09T08:44:00.000Z',
        templateId: 'film',
        trackId: 'geoje-summer',
        visibility: 'private',
      },
      {
        id: 'demo-capture-junho-haeundae',
        imageUrl: demoImages.busanCoast,
        lat: 35.1587,
        lng: 129.1604,
        moodTags: ['감성적인'],
        note: '해운대의 늦은 밤과 잘 맞았던 노래.',
        placeName: '해운대해수욕장',
        recordedAt: '2026-07-09T09:30:00.000Z',
        templateId: 'lp',
        trackId: 'geoje-everything',
        visibility: 'public',
      },
    ],
  },
  {
    id: 'demo-log-seoyeon-jeju-walk',
    placeName: '제주',
    sessionId: 'demo-session-seoyeon-jeju-walk',
    templateId: 'album',
    title: '제주 동쪽의 느린 하루',
    travelMode: 'walk',
    userProviderId: 'demo-seoyeon',
    captures: [
      {
        id: 'demo-capture-seoyeon-seongsan',
        imageUrl: demoImages.islandRoad,
        lat: 33.4581,
        lng: 126.9425,
        moodTags: ['잔잔한'],
        note: '성산일출봉 아래에서 들은 첫 곡.',
        placeName: '성산일출봉',
        recordedAt: '2026-07-10T00:20:00.000Z',
        templateId: 'album',
        trackId: 'geoje-tree',
        visibility: 'public',
      },
      {
        id: 'demo-capture-seoyeon-seopjikoji',
        imageUrl: demoImages.busanBeach,
        lat: 33.4249,
        lng: 126.9294,
        moodTags: ['시원한', '감성적인'],
        note: '바람이 세게 불어도 계속 걷고 싶었다.',
        placeName: '섭지코지',
        recordedAt: '2026-07-10T01:32:00.000Z',
        templateId: 'film',
        trackId: 'geoje-wi-ing',
        visibility: 'public',
      },
      {
        id: 'demo-capture-seoyeon-woljeongri',
        imageUrl: demoImages.busanCoast,
        lat: 33.5565,
        lng: 126.7958,
        moodTags: ['설레는'],
        note: '월정리에서 바다를 오래 바라봤다.',
        placeName: '월정리해변',
        recordedAt: '2026-07-10T03:15:00.000Z',
        templateId: 'map',
        trackId: 'geoje-seasons',
        visibility: 'public',
      },
    ],
  },
  {
    id: 'demo-log-doyoon-gyeongju',
    placeName: '경주',
    sessionId: 'demo-session-doyoon-gyeongju',
    templateId: 'lp',
    title: '경주 밤 드라이브',
    travelMode: 'drive',
    userProviderId: 'demo-doyoon',
    captures: [
      {
        id: 'demo-capture-doyoon-daereungwon',
        imageUrl: demoImages.cityWalk,
        lat: 35.838,
        lng: 129.2122,
        moodTags: ['잔잔한'],
        note: '대릉원 돌담길을 따라 천천히 걸었다.',
        placeName: '대릉원',
        recordedAt: '2026-07-11T09:15:00.000Z',
        templateId: 'film',
        trackId: 'moon-seoul',
        visibility: 'public',
      },
      {
        id: 'demo-capture-doyoon-cheomseongdae',
        imageUrl: demoImages.cityNight,
        lat: 35.8347,
        lng: 129.2191,
        moodTags: ['감성적인'],
        note: '첨성대에 불이 켜진 뒤의 풍경.',
        placeName: '첨성대',
        recordedAt: '2026-07-11T09:48:00.000Z',
        templateId: 'lp',
        trackId: 'night-letter',
        visibility: 'public',
      },
      {
        id: 'demo-capture-doyoon-donggung',
        imageUrl: demoImages.cityNight,
        lat: 35.8341,
        lng: 129.2266,
        moodTags: ['설레는', '신나는'],
        note: '물에 비친 야경을 마지막 리캡으로 남겼다.',
        placeName: '동궁과 월지',
        recordedAt: '2026-07-11T10:24:00.000Z',
        templateId: 'map',
        trackId: 'seoul-night-track',
        visibility: 'public',
      },
    ],
  },
];

const demoStandaloneRecaps: Array<DemoCaptureSeed & { userProviderId: string }> = [
  {
    id: 'demo-standalone-minji-gwanghwamun',
    imageUrl: demoImages.cityWalk,
    lat: 37.5759,
    lng: 126.9768,
    moodTags: ['잔잔한'],
    note: '광화문을 지나며 잠깐 멈춘 순간.',
    placeName: '광화문광장',
    recordedAt: '2026-07-12T03:12:00.000Z',
    templateId: 'film',
    trackId: 'seoul-city',
    userProviderId: 'demo-minji',
    visibility: 'public',
  },
  {
    id: 'demo-standalone-seoyeon-namsan',
    imageUrl: demoImages.cityNight,
    lat: 37.5513,
    lng: 126.9883,
    moodTags: ['감성적인', '잔잔한'],
    note: '서울 야경이 시작되는 시간의 음악.',
    placeName: '남산서울타워',
    recordedAt: '2026-07-12T04:20:00.000Z',
    templateId: 'map',
    trackId: 'seoul-city',
    userProviderId: 'demo-seoyeon',
    visibility: 'public',
  },
  {
    id: 'demo-standalone-junho-gwangalli',
    imageUrl: demoImages.busanBeach,
    lat: 35.1534,
    lng: 129.1188,
    moodTags: ['시원한'],
    note: '파도 소리와 함께 남긴 한 장.',
    placeName: '광안리해수욕장',
    recordedAt: '2026-07-12T06:40:00.000Z',
    templateId: 'map',
    trackId: 'geoje-travel',
    userProviderId: 'demo-junho',
    visibility: 'public',
  },
  {
    id: 'demo-standalone-seoyeon-seongsu',
    imageUrl: demoImages.cityNight,
    lat: 37.5448,
    lng: 127.0558,
    moodTags: ['감성적인'],
    note: '저녁이 된 성수의 작은 카페.',
    placeName: '성수 카페거리',
    recordedAt: '2026-07-12T10:08:00.000Z',
    templateId: 'album',
    trackId: 'geoje-seasons',
    userProviderId: 'demo-seoyeon',
    visibility: 'public',
  },
  {
    id: 'demo-standalone-doyoon-cheomseongdae',
    imageUrl: demoImages.cityNight,
    lat: 35.8348,
    lng: 129.2192,
    moodTags: ['설레는'],
    note: '경주에서 발견한 오늘의 사운드.',
    placeName: '첨성대',
    recordedAt: '2026-07-12T11:00:00.000Z',
    templateId: 'lp',
    trackId: 'night-letter',
    userProviderId: 'demo-doyoon',
    visibility: 'public',
  },
  {
    id: 'demo-standalone-doyoon-noksapyeong',
    imageUrl: demoImages.cityNight,
    lat: 37.53485,
    lng: 126.99485,
    moodTags: ['감성적인'],
    note: '서울의 불빛이 한눈에 들어온 순간.',
    placeName: '녹사평 전망대',
    recordedAt: '2026-07-13T11:10:00.000Z',
    templateId: 'map',
    trackId: 'seoul-night-track',
    userProviderId: 'demo-doyoon',
    visibility: 'public',
  },
  {
    id: 'demo-standalone-seoyeon-haebangchon',
    imageUrl: demoImages.cityWalk,
    lat: 37.53555,
    lng: 126.99415,
    moodTags: ['잔잔한'],
    note: '골목을 걷다가 노래와 풍경이 잘 맞았다.',
    placeName: '해방촌 오거리',
    recordedAt: '2026-07-13T11:22:00.000Z',
    templateId: 'film',
    trackId: 'night-letter',
    userProviderId: 'demo-seoyeon',
    visibility: 'public',
  },
  {
    id: 'demo-standalone-junho-gyeongridan',
    imageUrl: demoImages.cityNight,
    lat: 37.53675,
    lng: 126.9938,
    moodTags: ['신나는'],
    note: '경리단길 초입에서 여행 기분을 남겼다.',
    placeName: '경리단길 입구',
    recordedAt: '2026-07-13T11:35:00.000Z',
    templateId: 'lp',
    trackId: 'seoul-city',
    userProviderId: 'demo-junho',
    visibility: 'public',
  },
  {
    id: 'demo-standalone-doyoon-moscone',
    imageUrl: demoImages.cityWalk,
    lat: 37.7847,
    lng: -122.4058,
    moodTags: ['시원한'],
    note: '넓은 거리와 잘 어울리는 곡을 골랐다.',
    placeName: '모스콘 센터 앞',
    recordedAt: '2026-07-13T03:20:00.000Z',
    templateId: 'album',
    trackId: 'geoje-travel',
    userProviderId: 'demo-doyoon',
    visibility: 'public',
  },
  {
    id: 'demo-standalone-seoyeon-maiden-lane',
    imageUrl: demoImages.cityNight,
    lat: 37.787,
    lng: -122.406,
    moodTags: ['설레는'],
    note: '짧은 골목에서 발견한 오늘의 음악.',
    placeName: '메이든 레인',
    recordedAt: '2026-07-13T03:32:00.000Z',
    templateId: 'film',
    trackId: 'geoje-seasons',
    userProviderId: 'demo-seoyeon',
    visibility: 'public',
  },
  {
    id: 'demo-standalone-minji-market-street',
    imageUrl: demoImages.cityNight,
    lat: 37.785,
    lng: -122.4073,
    moodTags: ['감성적인'],
    note: '트램이 지나가는 소리와 음악을 함께 남겼다.',
    placeName: '마켓 스트리트',
    recordedAt: '2026-07-13T03:45:00.000Z',
    templateId: 'map',
    trackId: 'hangang',
    userProviderId: 'demo-minji',
    visibility: 'public',
  },
];

async function seedTracks() {
  for (const track of tracks) {
    await prisma.track.upsert({
      where: { id: track.id },
      update: { ...track },
      create: { ...track },
    });
  }
}

async function seedPlaces() {
  for (const place of places) {
    await prisma.place.upsert({
      where: { id: place.id },
      update: { ...place },
      create: { ...place },
    });
  }
}

async function seedPlaylists() {
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
}

async function seedMoodRecommendations() {
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
}

async function seedRegionSoundTrends() {
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
}

function createDemoTrackSnapshot(track: Track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    ...(track.albumImageUrl ? { albumImageUrl: track.albumImageUrl } : {}),
    ...(track.externalUrl ? { externalUrl: track.externalUrl } : {}),
    ...(track.fallbackColor ? { fallbackColor: track.fallbackColor } : {}),
    ...(track.platformUrls ? { platformUrls: track.platformUrls } : {}),
  };
}

function createDemoRecapMoment(capture: DemoCaptureSeed, track: Track) {
  return {
    id: capture.id,
    imageUrl: capture.imageUrl,
    location: { lat: capture.lat, lng: capture.lng },
    placeName: capture.placeName,
    recordedAt: capture.recordedAt,
    templateId: capture.templateId,
    track: createDemoTrackSnapshot(track),
    trackTitle: track.title,
    artistName: track.artist,
    visibility: capture.visibility,
  };
}

export async function seedDemoCommunity() {
  const demoTrackIds = Array.from(
    new Set([
      ...demoTravelLogs.flatMap((log) => log.captures.map((capture) => capture.trackId)),
      ...demoStandaloneRecaps.map((capture) => capture.trackId),
    ]),
  );
  const demoTracks = await prisma.track.findMany({
    where: { id: { in: demoTrackIds } },
  });
  const trackById = new Map(demoTracks.map((track) => [track.id, track]));

  if (trackById.size !== demoTrackIds.length) {
    throw new Error('Demo community seed requires the public track catalog first.');
  }

  for (const userSeed of demoCommunityUsers) {
    const user = await prisma.user.upsert({
      where: {
        provider_providerUserId: {
          provider: 'seed',
          providerUserId: userSeed.providerUserId,
        },
      },
      update: { displayName: userSeed.displayName },
      create: {
        displayName: userSeed.displayName,
        provider: 'seed',
        providerUserId: userSeed.providerUserId,
      },
    });

    await prisma.userProfile.upsert({
      where: { userId: user.id },
      update: {
        companionType: userSeed.companionType,
        completedOnboarding: true,
        dislikedArtists: [],
        locationRecommendationEnabled: true,
        preferredGenres: userSeed.preferredGenres,
        preferredMoods: userSeed.preferredMoods,
        travelStyles: userSeed.travelStyles,
      },
      create: {
        companionType: userSeed.companionType,
        completedOnboarding: true,
        locationRecommendationEnabled: true,
        preferredGenres: userSeed.preferredGenres,
        preferredMoods: userSeed.preferredMoods,
        travelStyles: userSeed.travelStyles,
        userId: user.id,
      },
    });

    await prisma.musicPlatform.upsert({
      where: { userId: user.id },
      update: {
        connected: false,
        providerUserId: null,
        selectedPlatformId: 'none',
      },
      create: {
        connected: false,
        selectedPlatformId: 'none',
        userId: user.id,
      },
    });

    await prisma.recapShareEvent.deleteMany({ where: { userId: user.id } });
    await prisma.recap.deleteMany({ where: { userId: user.id } });
    await prisma.momentLog.deleteMany({ where: { userId: user.id } });
    await prisma.travelSession.deleteMany({ where: { userId: user.id } });

    const userLogs = demoTravelLogs.filter(
      (log) => log.userProviderId === userSeed.providerUserId,
    );

    for (const log of userLogs) {
      const firstCapture = log.captures[0];
      const representativeCapture = log.captures.at(-1);

      if (!firstCapture || !representativeCapture) {
        throw new Error(`Demo travel log ${log.id} requires at least one capture.`);
      }

      const routePoints = log.captures.map((capture) => ({
        lat: capture.lat,
        lng: capture.lng,
        recordedAt: capture.recordedAt,
      }));

      await prisma.travelSession.create({
        data: {
          endedAt: new Date(representativeCapture.recordedAt),
          id: log.sessionId,
          routePoints,
          startedAt: new Date(firstCapture.recordedAt),
          status: 'ended',
          travelMode: log.travelMode,
          userId: user.id,
        },
      });

      for (const capture of log.captures) {
        const track = trackById.get(capture.trackId)!;

        await prisma.momentLog.create({
          data: {
            createdAt: new Date(capture.recordedAt),
            id: capture.id,
            lat: capture.lat,
            lng: capture.lng,
            moodTags: capture.moodTags,
            note: capture.note,
            photoUrl: capture.imageUrl,
            placeName: capture.placeName,
            sessionId: log.sessionId,
            source: 'camera',
            templateId: capture.templateId,
            trackSnapshot: createDemoTrackSnapshot(track),
            travelMode: log.travelMode,
            userId: user.id,
            visibility: capture.visibility,
          },
        });
      }

      const representativeTrack = trackById.get(representativeCapture.trackId)!;

      await prisma.recap.create({
        data: {
          backgroundImageUrl: firstCapture.imageUrl,
          createdAt: new Date(firstCapture.recordedAt),
          discImageUrl: representativeCapture.imageUrl,
          id: log.id,
          lat: representativeCapture.lat,
          lng: representativeCapture.lng,
          momentCount: log.captures.length,
          moments: log.captures.map((capture) =>
            createDemoRecapMoment(capture, trackById.get(capture.trackId)!),
          ),
          placeName: log.placeName,
          recordedAt: new Date(representativeCapture.recordedAt),
          representativeTrackId: representativeTrack.id,
          routePoints,
          sessionId: log.sessionId,
          templateId: log.templateId,
          thumbnailMomentId: firstCapture.id,
          title: log.title,
          travelSessionId: log.sessionId,
          userId: user.id,
          visibility: 'public',
        },
      });
    }

    const userStandaloneRecaps = demoStandaloneRecaps.filter(
      (capture) => capture.userProviderId === userSeed.providerUserId,
    );

    for (const capture of userStandaloneRecaps) {
      const track = trackById.get(capture.trackId)!;

      await prisma.momentLog.create({
        data: {
          createdAt: new Date(capture.recordedAt),
          id: capture.id,
          lat: capture.lat,
          lng: capture.lng,
          moodTags: capture.moodTags,
          note: capture.note,
          photoUrl: capture.imageUrl,
          placeName: capture.placeName,
          source: 'camera',
          templateId: capture.templateId,
          trackSnapshot: createDemoTrackSnapshot(track),
          userId: user.id,
          visibility: capture.visibility,
        },
      });

      await prisma.recap.create({
        data: {
          backgroundImageUrl: capture.imageUrl,
          createdAt: new Date(capture.recordedAt),
          discImageUrl: capture.imageUrl,
          id: `demo-recap-${capture.id}`,
          lat: capture.lat,
          lng: capture.lng,
          momentCount: 1,
          moments: [createDemoRecapMoment(capture, track)],
          placeName: capture.placeName,
          recordedAt: new Date(capture.recordedAt),
          representativeTrackId: track.id,
          templateId: capture.templateId,
          thumbnailMomentId: capture.id,
          title: `${capture.placeName} 리캡`,
          userId: user.id,
          visibility: capture.visibility,
        },
      });
    }
  }
}

export async function seedPublicCatalog() {
  await seedTracks();
  await seedPlaylists();
  await seedMoodRecommendations();
  await seedRegionSoundTrends();
  await seedPlaces();
}

export async function seedDatabase() {
  await prisma.communityReport.deleteMany({});
  await prisma.communityBlock.deleteMany({});
  await prisma.travelMateRequest.deleteMany({});
  await prisma.soundMapPin.deleteMany({});
  await prisma.travelRoomMoment.deleteMany({});
  await prisma.travelRoomMember.deleteMany({});
  await prisma.travelRoom.deleteMany({});

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

  await seedPublicCatalog();

  const seedRoutePoints = recaps[0]?.routePoints ?? [];

  await prisma.travelSession.create({
    data: {
      id: 'seed-session',
      userId: user.id,
      status: 'ended',
      startedAt: new Date(seedRoutePoints[0]?.recordedAt ?? seedMomentLogs[0].createdAt),
      endedAt: new Date(
        seedRoutePoints.at(-1)?.recordedAt ?? seedMomentLogs.at(-1)!.createdAt,
      ),
      routePoints: seedRoutePoints,
      travelMode: 'walk',
    },
  });

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
        lat: log.lat,
        lng: log.lng,
        sessionId: log.sessionId,
        placeName: log.placeName,
        note: log.note,
        moodTags: [...log.moodTags],
        source: 'camera',
        templateId: log.templateId,
        travelMode: log.travelMode,
        visibility: log.visibility,
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
        travelSessionId: recap.sessionId,
        backgroundImageUrl: recap.backgroundImageUrl,
        discImageUrl: recap.discImageUrl,
        lat: recap.lat,
        lng: recap.lng,
        recordedAt: new Date(recap.recordedAt),
        moments: recap.moments,
        routePoints: recap.routePoints,
        templateId: recap.templateId,
        thumbnailMomentId: recap.thumbnailMomentId,
        visibility: recap.visibility,
      },
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

  await seedDemoCommunity();
}

export async function disconnectSeedDatabase() {
  await prisma.$disconnect();
}

if (process.argv[1]?.endsWith('prisma/seed.ts') || process.argv[1]?.endsWith('prisma/seed.js')) {
  const seed = process.argv.includes('--public-catalog') ? seedPublicCatalog : seedDatabase;

  seed()
  .then(async () => {
    await disconnectSeedDatabase();
  })
  .catch(async (error) => {
    console.error(error);
    await disconnectSeedDatabase();
    process.exit(1);
  });
}
