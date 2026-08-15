import { describe, expect, it } from 'vitest';

import {
  assertUserTextAllowed,
  inspectUserText,
} from '../src/services/content-moderation.service.js';

describe('content moderation text filter', () => {
  it('allows ordinary Korean travel text', () => {
    expect(inspectUserText('바다 산책하며 듣기 좋은 곡이에요')).toEqual({ allowed: true });
  });

  it.each([
    '시 발 이라고 띄어 쓴 우회 표현',
    'KILL YOURSELF',
    '텔레그램 ID abc_123',
    '연락처는 010-1234-5678',
    '도배도배도배ㅋㅋㅋㅋㅋㅋㅋㅋ',
  ])('rejects objectionable or unsafe input: %s', (value) => {
    expect(inspectUserText(value).allowed).toBe(false);
  });

  it('returns a stable client-facing error code and field', () => {
    expect(() => assertUserTextAllowed({ comment: '시.발' })).toThrowError(
      expect.objectContaining({
        code: 'CONTENT_REJECTED',
        details: expect.objectContaining({ field: 'comment' }),
        statusCode: 422,
      }),
    );
  });
});
