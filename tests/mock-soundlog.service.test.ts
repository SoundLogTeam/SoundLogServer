import { beforeEach, describe, expect, it } from 'vitest';

import { mockDb, resetMockDb } from '../src/mock/mock-db.js';
import { mockSoundlogService } from '../src/services/mock-soundlog.service.js';

const ownerId = 'mock-user-local';
const peerId = 'mock-user-peer';

function expectHttpError(error: unknown, statusCode: number) {
  expect(error).toMatchObject({ statusCode });
}

function requireValue<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();

  if (value === null || value === undefined) {
    throw new Error('Expected test value to be defined');
  }

  return value;
}

describe('mockSoundlogService', () => {
  beforeEach(() => {
    resetMockDb();
  });

  it('updates profile, ranks nearby places, and prioritizes travel playlists by location', async () => {
    const profile = await mockSoundlogService.upsertMyProfile(ownerId, {
      birthYear: 1998,
      companionType: 'friends',
      dislikedArtists: ['skip-me'],
      gender: 'none',
      locationRecommendationEnabled: false,
      preferredGenres: ['인디'],
      preferredMoods: ['잔잔한'],
      travelStyles: ['산책'],
    });
    const places = await mockSoundlogService.getNearbyPlaces({ lat: 35.1532, limit: 2 });
    const playlists = await mockSoundlogService.getFeaturedPlaylists(undefined, {
      lat: 35.1532,
      limit: 3,
      locationRecommendationEnabled: true,
      recommendationMode: 'travel',
    });
    const placeScopedPlaylists = await mockSoundlogService.getFeaturedPlaylists(undefined, {
      limit: 1,
      locationRecommendationEnabled: true,
      placeId: 'seed-gwangalli',
      recommendationMode: 'travel',
    });
    const recommendations = await mockSoundlogService.getMoodRecommendations(undefined, {
      limit: 1,
      moodFilter: '청량한',
      preferredGenres: ['K-POP'],
      preferredMoods: ['청량한'],
      recommendationMode: 'travel',
      travelStyles: ['산책'],
    });
    const contextualPlaylist = await mockSoundlogService.createContextualPlaylist(ownerId, {
      mood: '잔잔한',
      state: '산책',
      travelMode: 'walk',
    });
    const recommendedPlaylist = await mockSoundlogService.getRecommendedPlaylist(ownerId, {
      location: { lat: 35.1532, lng: 129.1186 },
      mood: '시원한',
      state: '바다',
    });

    expect(profile.completedOnboarding).toBe(true);
    expect(profile.preferredGenres).toEqual(['인디']);
    expect(profile.dislikedArtists).toEqual(['skip-me']);
    expect(places).toHaveLength(2);
    expect(places[0].source).toBe('seed');
    expect(places[0].id).toMatch(/^seed-/);
    expect(playlists[0].id).toBe('busan-ocean');
    expect(placeScopedPlaylists[0].id).toBe('busan-ocean');
    expect(recommendations[0].track.id).toEqual(expect.any(String));
    expect(contextualPlaylist.context).toMatchObject({
      source: 'seed-fallback',
      state: '산책',
      travelMode: 'walk',
    });
    expect(recommendedPlaylist.context).toMatchObject({
      source: 'seed-fallback',
      state: '바다',
    });
  });

  it('stores library state and paginates saved or liked tracks', async () => {
    const saved = await mockSoundlogService.updateLibraryTrackState(ownerId, 'moon-seoul', {
      action: 'save',
      playlistId: 'seoul-night',
    });
    const liked = await mockSoundlogService.updateLibraryTrackState(ownerId, 'moon-seoul', {
      action: 'like',
    });
    const savedTracks = await mockSoundlogService.getLibraryTracks(ownerId, {
      kind: 'saved',
      limit: 1,
    });
    const nextPage = await mockSoundlogService.getLibraryTracks(ownerId, {
      cursor: savedTracks.page.nextCursor ?? undefined,
      kind: 'all',
      limit: 1,
    });
    const unliked = await mockSoundlogService.updateLibraryTrackState(ownerId, 'moon-seoul', {
      action: 'unlike',
    });

    expect(saved.isSaved).toBe(true);
    expect(liked.isLiked).toBe(true);
    expect(savedTracks.data[0].track.id).toEqual(expect.any(String));
    expect(savedTracks.data[0].playlist).toMatchObject({
      id: 'seoul-night',
      regionName: '서울',
    });
    expect(savedTracks.page.limit).toBe(1);
    expect(nextPage.data).toHaveLength(1);
    expect(unliked.isLiked).toBe(false);
    await expect(
      mockSoundlogService.updateLibraryTrackState(ownerId, 'missing-track', { action: 'save' }),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 404);
      return true;
    });
  });

  it('creates moment logs with optional photo, custom track fallback, pagination, and idempotency', async () => {
    const first = await mockSoundlogService.createMomentLog(
      ownerId,
      {
        artistName: 'Unknown Artist',
        createdAt: '2026-07-09T10:00:00.000Z',
        lat: 37.51,
        lng: 126.99,
        moodTags: ['잔잔한'],
        note: '바다 앞 산책',
        photoPath: '/uploads/photo-a.jpg',
        placeCategory: 'beach',
        placeId: 'seed-gwangalli',
        placeName: '광안리해수욕장',
        sessionId: 'session-a',
        trackTitle: '새로 발견한 곡',
        travelMode: '산책',
      },
      'moment-key-a',
    );
    const repeated = await mockSoundlogService.createMomentLog(
      ownerId,
      {
        createdAt: '2026-07-09T11:00:00.000Z',
        moodTags: ['신나는'],
        placeName: '다른 장소',
      },
      'moment-key-a',
    );
    const withoutPhoto = await mockSoundlogService.createMomentLog(ownerId, {
      createdAt: '2026-07-09T12:00:00.000Z',
      moodTags: [],
      placeName: '사진 없는 기록',
      sessionId: 'session-a',
      trackId: 'seoul-city',
    });
    const logs = await mockSoundlogService.getMomentLogs(ownerId, {
      limit: 1,
      sessionId: 'session-a',
    });
    const recent = await mockSoundlogService.getRecentMusicLogs(ownerId, { limit: 2 });
    const firstId = requireValue(first.id);
    const withoutPhotoId = requireValue(withoutPhoto.id);
    const updated = await mockSoundlogService.updateMomentLog(ownerId, firstId, {
      moodTags: ['calm'],
      note: '수정된 산책 메모',
      placeName: '수정된 광안리',
      trackTitle: '수정된 추천곡',
    });
    const cleared = await mockSoundlogService.updateMomentLog(ownerId, firstId, {
      note: null,
    });
    const photoUpdated = await mockSoundlogService.updateMomentLogPhoto(
      ownerId,
      firstId,
      '/uploads/photo-b.jpg',
    );
    const photoDeleted = await mockSoundlogService.deleteMomentLogPhoto(ownerId, firstId);

    expect(first.id).toBe(repeated.id);
    expect(first.photoUrl).toContain('/uploads/photo-a.jpg');
    expect(requireValue(first.track).title).toBe('새로 발견한 곡');
    expect(first.note).toBe('바다 앞 산책');
    expect(withoutPhoto.photoUrl).toBeUndefined();
    expect(logs.data).toHaveLength(1);
    expect(logs.page.nextCursor).toEqual(expect.any(String));
    expect(recent[0].placeName).toEqual(expect.any(String));
    expect(updated.placeName).toBe('수정된 광안리');
    expect(requireValue(updated.track).title).toBe('수정된 추천곡');
    expect(cleared.note).toBeUndefined();
    expect(photoUpdated.photoUrl).toContain('/uploads/photo-b.jpg');
    expect(photoDeleted.photoUrl).toBeUndefined();

    await mockSoundlogService.deleteMomentLog(ownerId, withoutPhotoId);
    const afterDelete = await mockSoundlogService.getMomentLogs(ownerId, {
      sessionId: 'session-a',
    });
    expect(afterDelete.data.some((item) => item.id === withoutPhotoId)).toBe(false);
    await expect(
      mockSoundlogService.deleteMomentLog(ownerId, withoutPhotoId),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 404);
      return true;
    });
  });

  it('records recommendation events once per event id', async () => {
    await mockSoundlogService.createRecommendationEvents(ownerId, {
      events: [
        {
          context: { placeName: '서울숲' },
          createdAt: '2026-07-09T10:00:00.000Z',
          id: 'event-a',
          playlistId: 'seoul-night',
          sessionId: 'session-a',
          trackId: 'seoul-city',
          type: 'track_external_open',
          value: 'search',
        },
        {
          context: { duplicate: true },
          createdAt: '2026-07-09T10:01:00.000Z',
          id: 'event-a',
          sessionId: 'session-a',
          type: 'track_external_open',
        },
      ],
    });

    expect(mockDb.recommendationEvents.filter((event) => event.id === 'event-a')).toHaveLength(1);
    expect(mockDb.recommendationEvents[0].userId).toBe(ownerId);
  });

  it('creates recaps, share payloads, share events, and validates representative tracks', async () => {
    const moment = await mockSoundlogService.createMomentLog(ownerId, {
      createdAt: '2026-07-09T10:00:00.000Z',
      lat: 37.5444,
      lng: 127.0374,
      moodTags: ['감성적인'],
      photoPath: '/uploads/recap.jpg',
      placeName: '서울숲',
      sessionId: 'recap-session',
      trackId: 'seoul-city',
    });
    const momentId = requireValue(moment.id);
    const recap = await mockSoundlogService.createRecap(
      ownerId,
      {
        momentLogIds: [momentId],
        sessionId: 'recap-session',
        title: '서울숲 사운드',
      },
      'recap-key-a',
    );
    const recapId = requireValue(recap.id);
    const repeated = await mockSoundlogService.createRecap(
      ownerId,
      {
        title: '다른 제목',
      },
      'recap-key-a',
    );
    const list = await mockSoundlogService.getRecaps(ownerId, { limit: 1 });
    const share = await mockSoundlogService.getRecapShare(ownerId, recapId);

    await mockSoundlogService.createRecapShareEvent(ownerId, recapId, {
      createdAt: '2026-07-09T10:10:00.000Z',
      type: 'save_image',
    });

    expect(recap.id).toBe(repeated.id);
    expect(recap.title).toBe('서울숲 사운드');
    expect(list.data[0].id).toBe(recapId);
    expect((share.moments as Array<{ location?: { lat: number; lng: number } }>)[0].location).toEqual({
      lat: 37.5444,
      lng: 127.0374,
    });
    expect(share.moments).toHaveLength(1);
    expect(mockDb.recapShareEvents).toHaveLength(1);

    const otherMoment = await mockSoundlogService.createMomentLog('other-user', {
      createdAt: '2026-07-09T10:20:00.000Z',
      lat: 37.5446,
      lng: 127.0375,
      moodTags: ['감성적인'],
      photoPath: '/uploads/other-recap.jpg',
      placeName: '다른 사람 서울숲',
      sessionId: 'other-recap-session',
      trackId: 'seoul-city',
    });
    const otherPublicRecap = await mockSoundlogService.createRecap('other-user', {
      momentLogIds: [requireValue(otherMoment.id)],
      sessionId: 'other-recap-session',
      title: '다른 사람 공개 로그',
      visibility: 'public',
    });
    const mineList = await mockSoundlogService.getRecaps(ownerId, { scope: 'mine' });
    const othersList = await mockSoundlogService.getRecaps(ownerId, { scope: 'others' });
    const allList = await mockSoundlogService.getRecaps(ownerId, { scope: 'all' });

    expect(mineList.data.map((item) => item.id)).toContain(recapId);
    expect(mineList.data.map((item) => item.id)).not.toContain(otherPublicRecap.id);
    expect(othersList.data.map((item) => item.id)).toContain(otherPublicRecap.id);
    expect(othersList.data.map((item) => item.id)).not.toContain(recapId);
    expect(allList.data.map((item) => item.id)).toEqual(
      expect.arrayContaining([recapId, otherPublicRecap.id]),
    );

    await expect(
      mockSoundlogService.createRecap(ownerId, { representativeTrackId: 'missing-track' }),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 404);
      return true;
    });
    await expect(
      mockSoundlogService.getRecapShare(ownerId, 'missing-recap'),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 404);
      return true;
    });
  });

  it('handles collaborative travel rooms, invite validation, comments, and room recaps', async () => {
    const room = await mockSoundlogService.createTravelRoom(ownerId, {
      sessionId: 'trip-session',
      title: '강릉 여행방',
      visibility: 'private',
    });

    await expect(
      mockSoundlogService.getTravelRoom(peerId, room.id),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 404);
      return true;
    });
    await expect(
      mockSoundlogService.joinTravelRoom(peerId, room.id, { inviteCode: 'WRONG' }),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 400);
      return true;
    });

    const joined = await mockSoundlogService.joinTravelRoom(peerId, room.id, {
      displayName: '수경',
      inviteCode: room.inviteCode,
    });
    const joinedByInviteCode = await mockSoundlogService.joinTravelRoomByInviteCode(peerId, {
      displayName: '수경',
      inviteCode: room.inviteCode,
    });
    const momentLog = await mockSoundlogService.createMomentLog(ownerId, {
      createdAt: '2026-07-09T10:00:00.000Z',
      moodTags: ['시원한'],
      placeName: '안목해변',
      trackId: 'seoul-city',
    });
    const roomMoment = await mockSoundlogService.addTravelRoomMoment(peerId, room.id, {
      momentLogId: momentLog.id,
      note: '바다 앞에서 듣기 좋았음',
      status: 'candidate',
    });
    const updated = await mockSoundlogService.updateTravelRoomMoment(ownerId, room.id, roomMoment.id, {
      status: 'accepted',
    });
    const comment = await mockSoundlogService.addTravelRoomMomentComment(peerId, room.id, roomMoment.id, {
      body: '이 곡 대표곡으로 좋아요',
    });
    const recap = await mockSoundlogService.createTravelRoomRecap(
      ownerId,
      room.id,
      {
        templateId: 'lp',
        title: '강릉 공동 Recap',
      },
      'room-recap-key',
    );
    const repeatedRecap = await mockSoundlogService.createTravelRoomRecap(
      ownerId,
      room.id,
      {
        title: '다른 제목',
      },
      'room-recap-key',
    );

    expect(joined.memberCount).toBe(2);
    expect(joinedByInviteCode.id).toBe(room.id);
    expect(requireValue(roomMoment.track).id).toBe(requireValue(momentLog.track).id);
    expect(updated.status).toBe('accepted');
    expect(updated.commentCount).toBe(0);
    expect(comment.body).toBe('이 곡 대표곡으로 좋아요');
    expect(recap.id).toBe(repeatedRecap.id);
    expect(recap.roomId).toBe(room.id);
    expect(recap.templateId).toBe('lp');
    await expect(
      mockSoundlogService.addTravelRoomMoment('not-a-member', room.id, { trackTitle: '곡' }),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 404);
      return true;
    });
    await expect(
      mockSoundlogService.addTravelRoomMoment(peerId, room.id, { momentLogId: 'missing-moment' }),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 404);
      return true;
    });
  });

  it('shares current tracks on the sound map and protects exact locations', async () => {
    const ownerSession = await mockSoundlogService.createTravelSession(ownerId, {
      location: { lat: 37.751, lng: 128.875 },
      travelMode: '산책',
    });
    const peerSession = await mockSoundlogService.createTravelSession(peerId, {
      location: { lat: 37.752, lng: 128.876 },
      travelMode: '카페',
    });
    const outsiderId = 'mock-user-outsider';
    const outsiderSession = await mockSoundlogService.createTravelSession(outsiderId, {
      location: { lat: 37.752, lng: 128.876 },
      travelMode: '산책',
    });

    await expect(
      mockSoundlogService.upsertSoundMapCurrentTrack(ownerId, {
        artistName: 'Artist',
        location: { lat: 37.751, lng: 128.875 },
        trackTitle: 'No Session',
        visibility: 'nearby',
      }),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 400);
      return true;
    });

    const ownerPin = await mockSoundlogService.upsertSoundMapCurrentTrack(ownerId, {
      location: { lat: 37.75123, lng: 128.87567 },
      moodTags: ['잔잔한'],
      placeName: '강릉역',
      sessionId: ownerSession.id,
      trackId: 'seoul-city',
      visibility: 'companions',
    });
    const peerPin = await mockSoundlogService.upsertSoundMapCurrentTrack(peerId, {
      artistName: 'Peer Artist',
      location: { lat: 37.75234, lng: 128.87678 },
      moodTags: ['잔잔한'],
      placeName: '안목해변',
      sessionId: peerSession.id,
      trackTitle: 'Peer Track',
      visibility: 'nearby',
    });
    const outsiderCompanionPin = await mockSoundlogService.upsertSoundMapCurrentTrack(outsiderId, {
      artistName: 'Outsider Artist',
      location: { lat: 37.7521, lng: 128.8761 },
      placeName: '비동행자 위치',
      sessionId: outsiderSession.id,
      trackTitle: 'Hidden Companion Track',
      visibility: 'companions',
    });
    const pins = await mockSoundlogService.getSoundMapPins(ownerId, {
      lat: 37.751,
      lng: 128.875,
      radiusMeters: 3000,
    });
    const nearbyWithoutLocation = await mockSoundlogService.getNearbySoundMatches(ownerId, {
      mood: '잔잔한',
      state: '산책',
    });
    const nearby = await mockSoundlogService.getNearbySoundMatches(ownerId, {
      lat: 37.751,
      lng: 128.875,
      mood: '잔잔한',
      radiusMeters: 3000,
      state: '산책',
    });
    const matches = await mockSoundlogService.getMusicMatches(ownerId, {
      lat: 37.751,
      lng: 128.875,
      mood: '잔잔한',
      state: '산책',
    });

    expect(ownerPin.isMine).toBe(true);
    expect(ownerPin.location.lat).toBe(37.75123);
    expect(peerPin.isMine).toBe(true);
    expect(pins.map((pin) => pin.id)).toEqual(expect.arrayContaining([ownerPin.id, peerPin.id]));
    expect(pins.map((pin) => pin.id)).not.toContain(outsiderCompanionPin.id);
    expect(pins.find((pin) => pin.id === peerPin.id)?.location.lat).toBeCloseTo(37.75);
    expect(nearbyWithoutLocation).toEqual([]);
    expect(nearby[0].targetPinId).toBe(peerPin.id);
    expect(nearby[0].matchScore).toBeGreaterThanOrEqual(80);
    expect(matches[0].safety.exactLocationHidden).toBe(true);
  });

  it('deduplicates, authorizes, accepts, blocks, and reports travel mate requests', async () => {
    const ownerSession = await mockSoundlogService.createTravelSession(ownerId, {
      location: { lat: 37.751, lng: 128.875 },
      travelMode: '산책',
    });
    const peerSession = await mockSoundlogService.createTravelSession(peerId, {
      location: { lat: 37.752, lng: 128.876 },
      travelMode: '산책',
    });
    const ownerPin = await mockSoundlogService.upsertSoundMapCurrentTrack(ownerId, {
      location: { lat: 37.751, lng: 128.875 },
      sessionId: ownerSession.id,
      trackId: 'seoul-city',
      visibility: 'nearby',
    });
    const peerPin = await mockSoundlogService.upsertSoundMapCurrentTrack(peerId, {
      location: { lat: 37.752, lng: 128.876 },
      sessionId: peerSession.id,
      trackTitle: 'Peer Track',
      visibility: 'nearby',
    });

    await expect(
      mockSoundlogService.createTravelMateRequest(ownerId, { messageTemplate: 'liked_track' }),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 400);
      return true;
    });
    await expect(
      mockSoundlogService.createTravelMateRequest(ownerId, {
        messageTemplate: 'liked_track',
        targetPinId: ownerPin.id,
      }),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 400);
      return true;
    });

    const request = await mockSoundlogService.createTravelMateRequest(ownerId, {
      messageTemplate: 'liked_track',
      targetPinId: peerPin.id,
    });
    const duplicate = await mockSoundlogService.createTravelMateRequest(ownerId, {
      messageTemplate: 'walk_together',
      targetPinId: peerPin.id,
    });

    await expect(
      mockSoundlogService.updateTravelMateRequest(ownerId, request.id, { action: 'accept' }),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 403);
      return true;
    });

    const accepted = await mockSoundlogService.updateTravelMateRequest(peerId, request.id, {
      action: 'accept',
    });

    await expect(
      mockSoundlogService.updateTravelMateRequest(peerId, request.id, { action: 'decline' }),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 400);
      return true;
    });

    await mockSoundlogService.reportCommunityTarget(ownerId, {
      details: '불편한 메시지',
      reason: 'safety',
      targetPinId: peerPin.id,
    });
    await mockSoundlogService.blockCommunityUser(ownerId, { targetPinId: peerPin.id });

    const afterBlock = await mockSoundlogService.getNearbySoundMatches(ownerId, {
      lat: 37.751,
      lng: 128.875,
      radiusMeters: 3000,
    });

    expect(request.id).toBe(duplicate.id);
    expect(accepted.status).toBe('accepted');
    expect(mockDb.communityReports).toHaveLength(1);
    expect(mockDb.communityBlocks).toHaveLength(1);
    expect(afterBlock).toEqual([]);
  });

  it('updates travel sessions and returns regional sound trends', async () => {
    const session = await mockSoundlogService.createTravelSession(ownerId, {
      location: { lat: 35.1532, lng: 129.1186 },
      routePoints: [
        { lat: 35.1532, lng: 129.1186, recordedAt: '2026-07-09T09:00:00.000Z' },
        { lat: 35.156, lng: 129.119, recordedAt: '2026-07-09T09:20:00.000Z' },
      ],
      startedAt: '2026-07-09T09:00:00.000Z',
      travelMode: '바다',
    });
    const livePin = await mockSoundlogService.upsertSoundMapCurrentTrack(ownerId, {
      location: { lat: 35.1532, lng: 129.1186 },
      sessionId: session.id,
      trackId: 'seoul-city',
      visibility: 'nearby',
    });
    const pinsBeforeEnding = await mockSoundlogService.getSoundMapPins(ownerId, {
      lat: 35.1532,
      lng: 129.1186,
      radiusMeters: 3000,
    });
    const synced = await mockSoundlogService.updateTravelSession(ownerId, session.id, {
      location: { lat: 35.158, lng: 129.1195 },
      routePoints: [
        ...(session.routePoints ?? []),
        { lat: 35.158, lng: 129.1195, recordedAt: '2026-07-09T10:00:00.000Z' },
      ],
      status: 'active',
    });
    const ended = await mockSoundlogService.updateTravelSession(ownerId, session.id, {
      endedAt: '2026-07-09T11:00:00.000Z',
      location: { lat: 35.16, lng: 129.12 },
      routePoints: [
        ...(synced.routePoints ?? []),
        { lat: 35.16, lng: 129.12, recordedAt: '2026-07-09T10:30:00.000Z' },
      ],
      status: 'ended',
    });
    const pinsAfterEnding = await mockSoundlogService.getSoundMapPins(ownerId, {
      lat: 35.1532,
      lng: 129.1186,
      radiusMeters: 3000,
    });
    const trend = await mockSoundlogService.getRegionSoundTrend({
      period: 'weekly',
      regionCode: 'KR-26',
    });

    expect(session.status).toBe('active');
    expect(session.routePoints).toHaveLength(2);
    expect(synced.status).toBe('active');
    expect(synced.routePoints).toHaveLength(3);
    expect(pinsBeforeEnding.map((pin) => pin.id)).toContain(livePin.id);
    expect(ended.status).toBe('ended');
    expect(ended.endedAt).toBe('2026-07-09T11:00:00.000Z');
    expect(ended.routePoints).toHaveLength(4);
    expect(pinsAfterEnding.map((pin) => pin.id)).not.toContain(livePin.id);
    expect(trend.topTracks.length).toBeGreaterThan(0);
    await expect(
      mockSoundlogService.updateTravelSession(ownerId, session.id, { status: 'active' }),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 400);
      return true;
    });
    await expect(
      mockSoundlogService.updateTravelSession(ownerId, 'missing-session', { status: 'ended' }),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 404);
      return true;
    });
    await expect(
      mockSoundlogService.getRegionSoundTrend({ period: 'daily', regionCode: 'missing' }),
    ).rejects.toSatisfy((error) => {
      expectHttpError(error, 404);
      return true;
    });
  });
});
