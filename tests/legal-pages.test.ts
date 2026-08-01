import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

const app = createApp();

describe('public legal pages', () => {
  it.each([
    ['/legal/privacy', '개인정보 처리방침'],
    ['/legal/terms', '서비스 이용약관'],
    ['/support', '고객지원'],
  ])('serves %s without authentication', async (path, title) => {
    const response = await request(app).get(path);
    const headResponse = await request(app).head(path);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.text).toContain(`<h1>${title}</h1>`);
    expect(response.text).toContain('support@soundlog.shop');
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers['content-type']).toContain('text/html');
  });
});
