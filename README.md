# SoundLog Server

SoundLog React Native/Expo 앱과 연동되는 Express + TypeScript API 서버입니다.

API 구현 기준은 `SoundLogTeam/api-docs`의 `openapi/soundlog-api.yaml`이며, MVP/확장 endpoint 25개를 제공합니다.

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

## Frontend Integration

SoundLog 프론트엔드에서 아래 환경변수를 설정하면 로컬 서버를 바라봅니다.

```bash
EXPO_PUBLIC_SOUNDLOG_API_BASE_URL=http://localhost:4000 npm run web
```

웹 기본 주소는 `http://localhost:8081`입니다.

## Production hardening

실제 사용자 배포 전에는 아래 조건을 맞춰야 합니다.

- `ALLOW_DEV_AUTH_FALLBACK=false`
- `GOOGLE_CLIENT_ID`, `APPLE_CLIENT_ID` 등 실제 OAuth provider 설정 완료
- 프론트 앱은 mock provider token 대신 실제 provider token/idToken을 서버로 교환
- `UPLOAD_PUBLIC_BASE_URL`과 앱의 `EXPO_PUBLIC_SOUNDLOG_API_BASE_URL`은 HTTPS 도메인 사용
- iOS 앱 설정에 전체 ATS 예외를 넣지 않기

서버 코드는 `NODE_ENV=production`에서 `ALLOW_DEV_AUTH_FALLBACK=true`가 잘못 설정되어도 dev social-login fallback을 사용하지 않습니다.

## Scripts

```bash
pnpm dev         # 개발 서버
pnpm build       # TypeScript build
pnpm typecheck   # 타입 검사
pnpm test:api    # API 테스트
pnpm db:migrate  # Prisma migration
pnpm db:seed     # 로컬 seed 데이터 적재
```

## API Groups

- System
- Auth
- Me
- Tour
- Home
- Playlists
- Library
- MomentLogs
- RecommendationEvents
- Recaps
- TravelSessions
- Trends

## Verification

구현 시 확인한 검증:

- `pnpm typecheck`
- `pnpm test:api`
- SoundLog Expo web 브라우저 연동
  - `POST /v1/auth/social-login`
  - `GET /v1/home/featured-playlists`
  - `GET /v1/home/mood-recommendations`
  - `GET /v1/home/recent-music-logs`
  - `GET /v1/playlists/busan-ocean`
  - `GET /v1/recaps/log-1/share`
