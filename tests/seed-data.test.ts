import { describe, expect, it } from 'vitest';

import {
  moodRecommendations,
  playlists,
  recaps,
  seedMomentLogs,
  tracks,
} from '../src/data/seed-data.js';
import { regionalPlaylistFallbacks } from '../src/data/regional-playlist-data.js';

describe('seed recap/log domain consistency', () => {
  it('keeps one log per travel session and includes every session recap', () => {
    const sessionIds: string[] = recaps.map((recap) => recap.sessionId);

    expect(new Set(sessionIds).size).toBe(sessionIds.length);

    for (const recap of recaps) {
      const sessionMoments = seedMomentLogs.filter(
        (moment) => moment.sessionId === recap.sessionId,
      );
      const storedMomentIds = recap.moments.map((moment) => moment.id).sort();
      const sourceMomentIds = sessionMoments.map((moment) => moment.id).sort();
      const latestRecordedAt = sessionMoments
        .map((moment) => moment.createdAt)
        .sort()
        .at(-1);

      expect(recap.momentCount).toBe(sessionMoments.length);
      expect(storedMomentIds).toEqual(sourceMomentIds);
      expect(recap.recordedAt).toBe(latestRecordedAt);
      expect(recap.routePoints).toHaveLength(sessionMoments.length);
      expect(
        sessionMoments.every((moment) => moment.visibility === recap.visibility),
      ).toBe(true);
    }
  });

  it('connects every supported mood to an existing playlist', () => {
    const supportedMoods = ['잔잔한', '신나는', '시원한', '설레는', '감성적인'];
    const playlistIds = new Set(playlists.map((playlist) => playlist.id));

    for (const mood of supportedMoods) {
      expect(
        moodRecommendations.some((recommendation) =>
          (recommendation.moods as readonly string[]).includes(mood),
        ),
      ).toBe(true);
    }

    for (const recommendation of moodRecommendations) {
      expect(playlistIds.has(recommendation.playlistId)).toBe(true);
      expect(recommendation.imageUrl).toMatch(/^https:\/\//);
    }
  });

  it('keeps a complete regional fallback catalog with valid tracks', () => {
    const playlistIds = new Set(playlists.map((playlist) => playlist.id));
    const trackIds = new Set(tracks.map((track) => track.id));
    const referencedTrackIds = new Set<string>(
      playlists.flatMap((playlist) => [...playlist.trackIds]),
    );
    const regionalPlaylistIds = regionalPlaylistFallbacks.map(
      (region) => region.playlistId,
    );

    expect(regionalPlaylistFallbacks).toHaveLength(17);
    expect(new Set(regionalPlaylistIds).size).toBe(regionalPlaylistIds.length);

    for (const region of regionalPlaylistFallbacks) {
      expect(playlistIds.has(region.playlistId)).toBe(true);
      expect(region.aliases.length).toBeGreaterThanOrEqual(3);

      const playlist = playlists.find((item) => item.id === region.playlistId);
      expect(playlist?.coverImageUrl).toMatch(/^\/assets\/playlists\/[a-z-]+\.webp$/);
      expect(playlist?.backgroundImageUrl).toBe(playlist?.coverImageUrl);
    }

    for (const playlist of playlists) {
      expect(new Set(playlist.trackIds).size).toBe(playlist.trackIds.length);
      expect(playlist.trackIds.length).toBeGreaterThanOrEqual(5);
      expect(playlist.trackIds.every((trackId) => trackIds.has(trackId))).toBe(true);
    }

    expect(tracks.every((track) => referencedTrackIds.has(track.id))).toBe(true);
  });
});
