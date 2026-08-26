import { describe, expect, it } from 'vitest';

import { createMlRecommendationArtwork } from '../src/utils/ml-recommendation-artwork.js';

describe('createMlRecommendationArtwork', () => {
  it('uses the ML background image for both playlist artwork fields', () => {
    expect(
      createMlRecommendationArtwork(
        '  http://tong.visitkorea.or.kr/cms/resource/photo.jpg  ',
      ),
    ).toEqual({
      backgroundImageUrl: 'http://tong.visitkorea.or.kr/cms/resource/photo.jpg',
      coverImageUrl: 'http://tong.visitkorea.or.kr/cms/resource/photo.jpg',
    });
  });

  it.each([null, undefined, '', '   ', 123, {}])(
    'omits artwork for an unusable ML value: %p',
    (value) => {
      expect(createMlRecommendationArtwork(value)).toEqual({});
    },
  );
});
