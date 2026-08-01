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

  it('describes the app privacy answers and the data flows implemented by the API', async () => {
    const response = await request(app).get('/legal/privacy');

    expect(response.text).toContain('계정 이름, 이메일 주소, 사용자 ID');
    expect(response.text).toContain('정확한 위도·경도');
    expect(response.text).toContain('사용자 콘텐츠');
    expect(response.text).toContain('제품 상호작용 정보');
    expect(response.text).toContain('Soundlog 계정과 연결');
    expect(response.text).toContain('추적하지 않습니다');
    expect(response.text).toContain('백그라운드 위치 추적은 사용하지 않습니다');
    expect(response.text).toContain('Nominatim(OpenStreetMap)');
    expect(response.text).toContain('한국관광공사 공공데이터 API');
    expect(response.text).toContain('외부 음악 링크');
    expect(response.text).toContain('영상 업로드 기능을 제공하지 않습니다');
  });

  it('keeps the public pages scoped to native-app support and legal notices', async () => {
    const [privacy, support, terms] = await Promise.all([
      request(app).get('/legal/privacy'),
      request(app).get('/support'),
      request(app).get('/legal/terms'),
    ]);

    expect(privacy.text).toContain('공개 법적 고지');
    expect(support.text).toContain('별도의 웹 서비스나 웹 계정 기능을 제공하지 않습니다');
    expect(terms.text).toContain('별도의 웹 서비스를 제공하지 않습니다');
  });
});
