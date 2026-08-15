import { describe, expect, it } from 'vitest';

import { findRegionalPlaylistId } from '../src/utils/regional-playlist.js';

describe('findRegionalPlaylistId', () => {
  it('prioritizes a known place name over coordinates', () => {
    expect(
      findRegionalPlaylistId({
        lat: 37.5665,
        lng: 126.978,
        placeText: '부산광역시 광안리해수욕장',
      }),
    ).toBe('busan-ocean');
  });

  it.each([
    [{ lat: 33.4996, lng: 126.5312 }, 'jeju-island'],
    [{ lat: 37.7519, lng: 128.8761 }, 'gangneung-sea'],
    [{ lat: 34.7604, lng: 127.6622 }, 'yeosu-night-sea'],
    [{ lat: 35.8562, lng: 129.2247 }, 'gyeongju-starlight'],
  ])('selects the nearest regional catalog for %o', (location, playlistId) => {
    expect(findRegionalPlaylistId(location)).toBe(playlistId);
  });

  it('uses Seoul when neither place nor complete coordinates are available', () => {
    expect(findRegionalPlaylistId({ lat: 35.1 })).toBe('seoul-night');
  });

  it('does not map an overseas location to the nearest Korean city', () => {
    expect(
      findRegionalPlaylistId({ lat: 37.7858, lng: -122.4064 }),
    ).toBe('seoul-night');
  });
});
