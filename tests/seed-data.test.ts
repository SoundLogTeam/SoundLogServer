import { describe, expect, it } from 'vitest';

import {
  moodRecommendations,
  playlists,
  recaps,
  seedMomentLogs,
} from '../src/data/seed-data.js';

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
});
