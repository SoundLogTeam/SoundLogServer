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
배포된 앱과 웹은 `https://api.soundlog.shop` API 도메인을 사용합니다.

## API Docs

서버 실행 후 Swagger UI와 OpenAPI 원본을 확인할 수 있습니다.

- Swagger UI: `http://localhost:4000/docs`
- OpenAPI YAML: `http://localhost:4000/openapi.yaml`

## Production hardening

실제 사용자 배포 전에는 아래 조건을 맞춰야 합니다.

- `NODE_ENV=production`
- `USE_MOCK_DB=false`
- `ALLOW_DEV_AUTH_FALLBACK=false`
- 자체 이메일/비밀번호 로그인만 사용하며, 서버는 비밀번호 원문 대신 bcrypt hash만 저장
- `CLIENT_URLS`, `UPLOAD_PUBLIC_BASE_URL`, 앱의 `EXPO_PUBLIC_SOUNDLOG_API_BASE_URL`은 HTTPS 도메인 사용
- 운영 기준 frontend origin은 `https://soundlog.shop`, API origin은 `https://api.soundlog.shop`
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
pnpm check:production-env # 운영 환경변수 점검
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
  - `POST /v1/auth/register`
  - `POST /v1/auth/login`
  - `GET /v1/home/featured-playlists`
  - `GET /v1/home/mood-recommendations`
  - `GET /v1/home/recent-music-logs`
  - `POST /v1/playlists/contextual` -> ML 추천 서버 `ML_RECOMMENDATION_API_URL`
  - `GET /v1/playlists/busan-ocean`
  - `GET /v1/recaps/log-1/share`
