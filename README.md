# SoundLog Server

SoundLog React Native/Expo 앱과 연동되는 Express + TypeScript API 서버입니다.

API 구현 기준은 `openapi/soundlog-api.yaml`이며, 현재 Express와 OpenAPI에 동기화된 63개 HTTP 연산을 제공합니다.
(`pnpm check:openapi-sync` 실행 결과 기준. 아래 "API Groups" 목록에는 일부 연산이 빠져 있습니다.)

리캡, 여행 로그, 여행 세션, GPS 경로를 변경할 때는 [Recap / Log 서버 도메인 계약](docs/recap-log-domain-contract.md)을 먼저 확인합니다.

## 배포

이 서버는 여러 서비스가 함께 도는 공용 서버입니다. 배포 전 반드시 확인하세요.

- 절차: [echo 서버 배포](docs/deploy/echo-서버-배포.md)
- 서버 구조·이슈: [서버 아키텍처 분석](docs/deploy/서버-아키텍처-분석.md)

`docker compose up -d`는 `docker-compose.yml`과 `docker-compose.override.yml`을
자동 병합합니다. override가 호스트 포트 충돌을 피하고 추천 서비스 연결을 잡아줍니다.

추천 모델 서비스는 이 저장소에 포함되지 않으며, 호스트에서 별도로 운영합니다.

## Stack

- Node.js
- TypeScript
- Express
- Prisma
- PostgreSQL
- Zod
- JWT Bearer Auth
- Vitest + Supertest

## Local Setup

```bash
pnpm install
cp .env.example .env
createdb -h localhost -U postgres soundlog_dev
pnpm db:migrate
pnpm db:seed
pnpm dev
```

서버 기본 주소는 `http://localhost:4000`입니다.

PostgreSQL 없이 서버 응답만 빠르게 확인하려면 mockDB 모드를 사용할 수 있습니다.

```bash
USE_MOCK_DB=true pnpm dev
```

mockDB 모드는 메모리 안의 샘플 데이터로 같은 API 응답을 내려주며, 쓰기 API도 실행 중인 프로세스 안에서 상태가 반영됩니다.

## Docker Compose

PostgreSQL과 API 서버를 함께 실행할 수 있습니다.

```bash
cp .env.example .env
docker compose up --build -d
docker compose --profile seed run --rm seed
curl http://localhost:4000/v1/health
```

API 컨테이너는 시작 시 `prisma migrate deploy`를 먼저 실행합니다. seed는 기존 사용자 데이터를 초기화할 수 있으므로 필요할 때만 별도 프로필로 실행합니다.

## Prisma schema

Prisma schema는 multi-file 구조로 관리합니다. `prisma/schema.prisma`에는 `generator`와 `datasource`만 두고, 모델은 도메인별로 `prisma/models/*.prisma`에 추가합니다.

```text
prisma/
├── schema.prisma
├── models/
│   ├── auth.prisma
│   ├── music.prisma
│   ├── travel.prisma
│   ├── recap.prisma
│   └── analytics.prisma
└── migrations/
```

## Frontend Integration

SoundLog 프론트엔드에서 아래 환경변수를 설정하면 로컬 서버를 바라봅니다.

```bash
EXPO_PUBLIC_SOUNDLOG_API_BASE_URL=http://localhost:4000 npm run web
```

웹 기본 주소는 `http://localhost:8081`입니다.
배포된 앱과 웹은 현재 Vercel의 `/api/soundlog` 프록시를 통해 EC2 API를 호출합니다.

## API Docs

서버 실행 후 Swagger UI와 OpenAPI 원본을 확인할 수 있습니다.

- Swagger UI: `http://localhost:4000/docs`
- OpenAPI YAML: `http://localhost:4000/openapi.yaml`
- 운영 API 프록시: `https://soundlog.shop/api/soundlog`

Swagger에서 바로 DB 쓰기를 확인할 때는 인증 없이 호출 가능한 개발용 API를 사용할 수 있습니다.

- `POST /v1/dev/db-test-records`: `DbTestRecord` row 생성 또는 mock 응답 반환

## Production hardening

실제 사용자 배포 전에는 아래 조건을 맞춰야 합니다.

- `NODE_ENV=production`
- `USE_MOCK_DB=false`
- `ALLOW_DEV_AUTH_FALLBACK=false`
- 자체 이메일/비밀번호 로그인만 사용하며, 서버는 비밀번호 원문 대신 bcrypt hash만 저장
- `CLIENT_URLS`, `UPLOAD_PUBLIC_BASE_URL`, 앱의 `EXPO_PUBLIC_SOUNDLOG_API_BASE_URL`은 HTTPS 도메인 사용
- 운영 기준 frontend origin은 `https://soundlog.shop`입니다. 공개 API URL은 `https://soundlog.shop/api/soundlog`이며, 별도 `api` 서브도메인은 사용하지 않습니다.
- `REQUEST_BODY_LIMIT`, `MOMENT_PHOTO_MAX_FILE_SIZE_MB`, `UPLOAD_DIRECTORY`, `UPLOAD_PUBLIC_PATH`는 운영 파일 업로드 정책에 맞게 조정
- iOS 앱 설정에 전체 ATS 예외를 넣지 않기

서버 코드는 자체 계정 로그인(`POST /v1/auth/login`, `POST /v1/auth/register`)으로 Soundlog access/refresh token을 발급합니다.

운영 배포 전 환경변수는 아래 명령으로 확인합니다.

```bash
NODE_ENV=production npm run check:production-env
```

## Scripts

```bash
pnpm dev         # 개발 서버
pnpm build       # TypeScript build
pnpm typecheck   # 타입 검사
pnpm test:api    # API 테스트
pnpm check:openapi-sync # Express 라우트와 OpenAPI 메서드/경로 동기화 검사
pnpm check:production-env # 운영 환경변수 점검
pnpm db:migrate  # Prisma migration
pnpm db:seed     # 로컬 seed 데이터 적재
```

## API Groups

- System / Dev
  - `GET /v1/health`
  - `POST /v1/dev/db-test-records`
- Auth / Me
  - `POST /v1/auth/register`
  - `POST /v1/auth/login`
  - `POST /v1/auth/refresh`
  - `POST /v1/auth/logout`
  - `GET /v1/me`
  - `PATCH /v1/me/profile`
  - `POST /v1/me/migrate-local-data`
- Tour / Home / Playlists
  - `GET /v1/tour/nearby-places`
  - `GET /v1/tour/reverse-geocode`
  - `GET /v1/home/featured-playlists`
  - `GET /v1/home/mood-recommendations`
  - `GET /v1/home/recent-music-logs`
  - `POST /v1/playlists/contextual`
  - `GET /v1/playlists/:playlistId`
- Moment Logs / Library / Recaps
  - `GET /v1/recap-captures`
  - `POST /v1/recap-captures`
  - `PATCH /v1/recap-captures/:momentLogId`
  - `DELETE /v1/recap-captures/:momentLogId`
  - `PUT /v1/recap-captures/:momentLogId/photo`
  - `DELETE /v1/recap-captures/:momentLogId/photo`
  - `GET /v1/moment-logs`
  - `POST /v1/moment-logs`
  - `GET /v1/library/tracks`
  - `PUT /v1/library/tracks/:trackId`
  - `POST /v1/recommendation-events`
  - `GET /v1/recap-markers`
  - `GET /v1/recaps`
  - `POST /v1/recaps`
  - `GET /v1/recaps/:recapId/share`
  - `PATCH /v1/recaps/:recapId/visibility`
  - `POST /v1/recaps/:recapId/share-events`
- Travel Sessions
  - `POST /v1/travel-sessions`: 서버 기준 여행 모드 시작
  - `PATCH /v1/travel-sessions/:sessionId`: 여행 모드 상태 변경
- Community
  - `POST /v1/travel-rooms`: 방장으로 공동 여행방 생성
  - `GET /v1/travel-rooms/:roomId`: 방장/참여자만 공동 여행방 조회
  - `POST /v1/travel-rooms/:roomId/join`: 신규 참여자는 초대 코드 필요
  - `POST /v1/travel-rooms/:roomId/moments`: 공동 Recap 후보 순간 추가
  - `PATCH /v1/travel-rooms/:roomId/moments/:momentId`: 방장만 후보 상태 변경
  - `POST /v1/travel-rooms/:roomId/moments/:momentId/comments`: 공동 순간 댓글 추가
  - `POST /v1/travel-rooms/:roomId/recaps`: 방장만 공동 Recap 생성
  - `GET /v1/sound-map`: Live Sound Map 핀 조회
  - `POST /v1/sound-map/current-track`: active 여행 세션이 있어야 현재 곡 공개 가능
  - `GET /v1/sound-map/nearby`: 좌표가 없으면 낯선 사용자 핀 없이 빈 목록 반환
  - `GET /v1/music-matches`: 좌표가 없으면 낯선 사용자 매칭 후보 없이 빈 목록 반환
  - `POST /v1/travel-mate-requests`: 공개 매칭 후보에게 동행 요청
  - `PATCH /v1/travel-mate-requests/:requestId`: 수신자/발신자 권한에 따라 요청 상태 변경
  - `POST /v1/community/blocks`
  - `POST /v1/community/reports`
- Trends
  - `GET /v1/trends/regions/:regionCode/sound`

현재 서버는 스포티파이 재생 제어 API와 `/v1/me/music-platform` API를 제공하지 않습니다. Soundlog는 곡 메타데이터와 외부 링크를 기록/추천/Recap에 연결하는 방식으로 동작합니다.

## Verification

구현 시 확인한 검증:

- `pnpm typecheck`
- `pnpm test:api`
- SoundLog Expo web 브라우저 연동
  - `POST /v1/auth/register`
  - `POST /v1/auth/login`
  - `GET /v1/home/featured-playlists`
  - `GET /v1/home/mood-recommendations`
  - `GET /v1/home/recent-music-logs`
  - `POST /v1/playlists/contextual` -> ML 추천 서버 `ML_RECOMMENDATION_API_URL`
  - `GET /v1/playlists/busan-ocean`
  - `GET /v1/recaps/seoul-night/share`
