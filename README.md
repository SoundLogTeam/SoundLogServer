# Soundlog API Docs

Soundlog React Native 앱과 백엔드 서버를 연결하기 위한 API 명세 저장소입니다.

현재 문서는 앱의 mock-server, React Query 호출부, 화면 기획서를 기준으로 작성했습니다. 서버 개발자는 `openapi/soundlog-api.yaml`을 Swagger UI, Redoc, Stoplight 등에 올려서 확인할 수 있습니다.

운영/테스트 API origin은 `https://api.soundlog.shop`을 사용합니다.

## 문서 구성

- [openapi/soundlog-api.yaml](openapi/soundlog-api.yaml): OpenAPI 3.1 기반 API 명세
- `README.md`: 구현 우선순위, 공통 정책, 프론트 연결 포인트

## 서버 구현 우선순위

### 1차 MVP

앱이 현재 화면에서 바로 필요로 하는 API입니다.

| 우선순위 | API | 목적 | 앱 연결 화면 |
| --- | --- | --- | --- |
| 1 | `GET /v1/tour/nearby-places` | 현재 좌표 주변 관광지 조회 | 홈, 추천 |
| 2 | `GET /v1/home/featured-playlists` | 홈 상단 대표 플레이리스트 | 홈 |
| 3 | `GET /v1/home/mood-recommendations` | 무드 기반 추천 카드 | 홈 |
| 4 | `GET /v1/playlists/{playlistId}` | 플레이리스트 상세 | 음악 큐레이션 |
| 5 | `GET /v1/home/recent-music-logs` | 최근 Music Log | 홈 |
| 6 | `GET /v1/recaps` | 리캡 리스트 | Recap |
| 7 | `GET /v1/recaps/{recapId}/share` | 공유용 리캡 상세 | Recap 공유 |
| 8 | `PUT /v1/me/profile` | 온보딩 취향 저장 | 온보딩, 마이 |
| 9 | `POST /v1/moment-logs` | 카메라 순간 저장 | 카메라, Music Log |
| 10 | `POST /v1/recommendation-events` | 재생/좋아요/무드 조정 로그 | 추천 고도화 |
| 11 | `PUT /v1/library/tracks/{trackId}` | 좋아요/저장 상태 변경 | 플레이리스트, 보관함 |
| 12 | `PUT /v1/me/music-platform` | 음악 플랫폼 선택/연동 상태 저장 | 마이 |

### 2차 확장

MVP 이후 추천 품질과 서비스 완성도를 높이기 위한 API입니다.

| API | 목적 |
| --- | --- |
| `POST /v1/playlists/contextual` | 좌표/장소/무드 기반 즉시 플레이리스트 생성 |
| `POST /v1/travel-sessions` | 여행 세션 시작 |
| `PATCH /v1/travel-sessions/{sessionId}` | 여행 세션 종료 및 상태 변경 |
| `POST /v1/recaps` | 저장된 로그 기반 리캡 생성 |
| `POST /v1/recaps/{recapId}/share-events` | 공유/저장 이벤트 집계 |
| `GET /v1/trends/regions/{regionCode}/sound` | 지역 기반 사운드 트렌드 |
| `POST /v1/auth/register` | 자체 계정 가입 |
| `POST /v1/auth/login` | 자체 계정 로그인 |

## 공통 정책

### 인증

- MVP PoC에서는 인증 없이 mock-server로 동작할 수 있습니다.
- 실제 서버에서는 `Authorization: Bearer <accessToken>` 헤더를 기본으로 가정합니다.
- 공개 관광 조회 API는 인증 없이도 열 수 있지만, 프로필/로그/보관함/리캡 API는 사용자 식별이 필요합니다.

### 응답 형식

성공 응답은 기본적으로 `data` envelope을 사용합니다.

```json
{
  "data": {}
}
```

목록 응답은 `data`와 `page`를 함께 반환합니다.

```json
{
  "data": [],
  "page": {
    "limit": 20,
    "nextCursor": "cursor_..."
  }
}
```

실패 응답은 아래 형식으로 통일합니다.

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "요청한 리소스를 찾을 수 없습니다.",
    "details": {}
  }
}
```

### 좌표와 시간

- 좌표는 `lat`, `lng` 숫자 필드를 사용합니다.
- 거리 단위는 meter입니다.
- 시간은 ISO 8601 문자열을 사용합니다.

### 쓰기 API 멱등성

네트워크 재시도와 중복 터치를 고려해 주요 쓰기 API는 `Idempotency-Key` 헤더를 받을 수 있어야 합니다.

대상:

- `POST /v1/moment-logs`
- `POST /v1/recommendation-events`
- `PUT /v1/library/tracks/{trackId}`
- `POST /v1/recaps`

### 한국관광공사 OpenAPI 정규화

서버는 한국관광공사 OpenAPI 원본 응답을 그대로 앱에 전달하지 않고, Soundlog 도메인 타입으로 정규화해서 내려줍니다.

예시:

- `contentid` -> `PlaceContext.id`
- `title` -> `PlaceContext.title`
- `addr1` -> `PlaceContext.address`
- `mapx`, `mapy` -> `PlaceContext.location.lng`, `PlaceContext.location.lat`
- `firstimage` -> `PlaceContext.imageUrl`
- `contenttypeid` -> `PlaceContext.contentType`

## 프론트 연결 포인트

현재 앱에서 mock-server로 대체 중인 영역은 아래 API로 교체하면 됩니다.

| 앱 파일 | 교체 대상 |
| --- | --- |
| `src/api/homeApi.ts` | `/v1/home/*` |
| `src/api/playlistApi.ts` | `/v1/playlists/*` |
| `src/api/recapApi.ts` | `/v1/recaps/*` |
| `src/api/tourApi.ts` | `/v1/tour/nearby-places` 또는 서버의 TourAPI proxy |
| `src/store/userProfileStore.ts` | `/v1/me/profile` |
| `src/store/momentLogStore.ts` | `/v1/moment-logs` |
| `src/store/recommendationEventStore.ts` | `/v1/recommendation-events` |
| `src/store/libraryStore.ts` | `/v1/library/tracks` |
| `src/store/musicPlatformStore.ts` | `/v1/me/music-platform` |

## Swagger UI로 확인하기

로컬에서 빠르게 확인하려면 아래처럼 Swagger UI 컨테이너에 YAML 파일을 연결하면 됩니다.

```bash
docker run -p 8088:8080 \
  -e SWAGGER_JSON=/docs/soundlog-api.yaml \
  -v "$PWD/openapi:/docs" \
  swaggerapi/swagger-ui
```

브라우저에서 `http://localhost:8088`로 접속하면 됩니다.
