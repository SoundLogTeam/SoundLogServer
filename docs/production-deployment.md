# Soundlog 운영 배포 안내

이 문서는 `https://api.soundlog.p-e.kr` 운영 API를 안전하게 배포하고 앱 심사 전에 동작을 확인하는 절차를 설명합니다. 운영 앞단은 nginx가 HTTPS를 처리하고 API 컨테이너는 외부에 4000 포트를 직접 공개하지 않습니다.

## 배포 실행 방식

GitHub Actions의 `Deploy API to production` 워크플로를 수동으로 실행합니다. `main` 브랜치 푸시만으로 자동 배포하지 않습니다. 실행하면 서버 검증과 Docker 이미지 생성을 마친 뒤 운영 서버의 공인 IP가 `api.soundlog.p-e.kr`의 DNS 주소와 같은지 확인합니다. 주소가 다르면 이전 서버에 잘못 배포하지 않도록 즉시 중단합니다.

워크플로 파일은 `.github/workflows/deploy-gcp.yml`입니다. 파일명과 `GCP_` 접두사는 기존 설정과의 호환을 위해 유지하지만 각 시크릿은 현재 `api.soundlog.p-e.kr` 서버를 가리켜야 합니다.

## GitHub Actions 시크릿

다음 Repository secret이 필요합니다.

- `DOCKERHUB_USERNAME`에는 운영 이미지를 올릴 Docker Hub 사용자명을 넣습니다.
- `DOCKERHUB_TOKEN`에는 이미지 push와 운영 서버 pull에 사용할 토큰을 넣습니다.
- `GCP_HOST`에는 현재 운영 서버 주소를 넣습니다.
- `GCP_USER`에는 현재 운영 서버 SSH 사용자를 넣습니다.
- `GCP_SSH_PORT`에는 SSH 포트를 넣습니다.
- `GCP_SSH_KEY`에는 해당 서버에 접속할 개인키를 넣습니다.
- `GCP_APP_DIR`에는 서버에서 compose 파일과 `.env`를 관리할 절대 경로를 넣습니다.
- `PRODUCTION_ENV`에는 DB와 API의 기본 운영 환경변수를 여러 줄 형식으로 넣습니다.
- `MODERATION_ADMIN_KEY`에는 32자 이상의 신고 운영 API 비밀키를 넣습니다.
- `APP_REVIEW_EMAIL`과 `APP_REVIEW_PASSWORD`에는 Apple 심사 전용 로그인 정보를 넣습니다.
- `SUPPORT_EMAIL`에는 약관과 지원 페이지에 공개할 실제 수신 가능한 메일 주소를 넣습니다.

시크릿 값은 저장소 파일이나 Pull Request 본문에 기록하지 않습니다.

## PRODUCTION_ENV 필수값

`PRODUCTION_ENV`에는 최소한 다음 값을 포함해야 합니다.

```dotenv
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=
JWT_SECRET=
USE_MOCK_DB=false
ALLOW_DEV_AUTH_FALLBACK=false
```

심사 운영값은 각각 별도 Repository secret으로 관리합니다. 워크플로가 기존 `PRODUCTION_ENV`에서 같은 이름의 오래된 값을 제거하고 별도 시크릿을 최종 환경 파일에 덧붙입니다. 신고 알림 방식은 `cloud_logging`으로 설정하고 nginx 프록시 단계는 `1`로 고정합니다.

`SUPPORT_EMAIL`에는 실제로 메일을 받을 수 있고 심사 대응에 사용할 주소를 넣습니다. 수신 설정이 확인되지 않은 `@soundlog.shop` 주소는 운영 검사에서 거부합니다. `DOCKER_IMAGE`, `DATABASE_URL`, `NODE_ENV`, `CLIENT_URL`, `CLIENT_URLS`, `UPLOAD_PUBLIC_BASE_URL`, `MODERATION_ALERT_MODE`, `TRUST_PROXY_HOPS`는 워크플로가 안전하게 생성하므로 `PRODUCTION_ENV`에 직접 넣지 않습니다. 클라이언트와 업로드 공개 주소는 `https://api.soundlog.p-e.kr`로 고정됩니다.

`ML_RECOMMENDATION_API_URL`은 API 서버가 내부적으로 호출할 HTTPS 추천 엔드포인트입니다. 앱은 이 내부 주소를 직접 호출하지 않고 `https://api.soundlog.p-e.kr/v1/recommendations/playlists`만 호출합니다. 배포 후 공개 계약 검사는 이 경로가 폴백이 아닌 `ml-recommendation` 결과와 HTTPS 커버 이미지를 반환하는지 확인합니다.

추천 서비스 코드와 `/recommend` 응답 계약은
[`SoundLogTeam/soundlog-ml`](https://github.com/SoundLogTeam/soundlog-ml)을 기준으로
관리합니다. `backgroundImageUrl` 계약을 변경할 때는 ML 저장소의 `API.md`와 이
서버의 응답 변환 테스트를 같은 작업에서 확인합니다.

## 배포 중 보호 절차

워크플로는 새 compose 파일을 복사하기 전에 기존 `.env`와 `docker-compose.prod.yml`을 `.deploy-backups/<GitHub run id>`에 보관합니다. 새 API가 시작되지 않거나 내부 계약 검사가 실패하면 이전 파일로 되돌리고 기존 컨테이너를 다시 시작합니다.

새 컨테이너가 정상 상태가 되면 운영 환경 검사와 Prisma migration을 확인합니다. 이어서 앱 심사용 계정과 시연 데이터를 멱등 방식으로 준비하고 내부 API 계약을 검사합니다. 마지막에는 공개 HTTPS 주소에서 상태와 OpenAPI와 법적 문서와 관리자 인증 경계를 확인합니다.

## 배포 후 확인

배포 성공 뒤 아래 주소가 모두 기대한 상태인지 확인합니다.

```bash
curl -fsS https://api.soundlog.p-e.kr/v1/health
curl -fsS https://api.soundlog.p-e.kr/openapi.yaml > /dev/null
curl -fsS https://api.soundlog.p-e.kr/legal/privacy > /dev/null
curl -fsS https://api.soundlog.p-e.kr/legal/terms > /dev/null
curl -fsS https://api.soundlog.p-e.kr/support > /dev/null
PUBLIC_API_BASE_URL=https://api.soundlog.p-e.kr node scripts/check-public-api-contract.mjs
```

관리자 키가 없는 요청으로 `/v1/admin/moderation/reports`를 호출하면 `401`이어야 합니다. `404`라면 운영 서버가 아직 관리자 신고 API가 포함된 최신 버전이 아닙니다.

## 앱 심사 전 추가 확인

심사용 계정으로 iOS 시뮬레이터 또는 TestFlight 앱에 로그인합니다. 공개 리캡 신고와 사용자 차단을 각각 실행하고 차단된 콘텐츠가 피드와 지도에서 즉시 숨겨지는지 확인합니다. 운영 담당자는 관리자 API에서 신고가 접수됐는지 확인하고 24시간 대응 절차를 `docs/moderation-operations.md`에 따라 점검합니다.
