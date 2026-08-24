# echo 서버 배포 절차 — Node API

> 대상 서버: NCP `echo2` (KVM, RAM 7.8GB, 루트 10GB + `/mnt/data` 30GB)
> 이 서버는 **여러 서비스가 함께 도는 공용 서버**입니다.
> 아래를 지키면 기존 서비스는 하나도 건드리지 않고 배포됩니다.

## 0. 이 서버의 제약 (2026-08 확인)

| 자원 | 현황 | 대응 |
|---|---|---|
| 호스트 5432 | PostgreSQL 18 실행 중 | 컨테이너 db 포트를 노출하지 않음 |
| 호스트 8000 | 추천 모델 서비스(uvicorn) | 그대로 둠. 컨테이너에서 호출만 함 |
| 호스트 80/443 | nginx 실행 중 | 지금은 사용 안 함 |
| **호스트 8005** | **비어 있음** | **Node API가 사용** |
| 8001·8002·8004 | ci, echohub, blogstudio | **건드리지 말 것** |
| 8090·8095·8011·8006·1333 | ecocircle, livinglab, ci (java) | 무관 |
| 루트 `/` | 9.8G 중 483M 여유 (95%) | **소스를 루트에 두지 않음** |
| `/mnt/data` | 30G 중 25G 여유 | 여기에 배치 |
| Docker data-root | `/mnt/data/docker` | 설정 완료 |
| swap | `/mnt/data/swapfile` 4GB | 설정 완료 |

**서버를 정지하면 안 됩니다.** 다른 팀 서비스가 함께 멈춥니다.

---

## 1. 소스 업로드 (FileZilla)

루트에 483MB밖에 없으므로 **`/mnt/data` 아래에 둡니다.**

```
/mnt/data/soundlog-server/
├── src/ prisma/ openapi/ scripts/ tests/
├── package.json  pnpm-lock.yaml  tsconfig.json
├── Dockerfile  .dockerignore
├── docker-compose.yml
└── docker-compose.override.yml
```

**FileZilla 제외 필터를 반드시 거세요.** `node_modules`, `dist`, `.git`, `uploads`, `.env`.
`node_modules`를 그냥 올리면 수만 개 파일이라 SFTP로 몇 시간 걸립니다.

```bash
cd /mnt/data/soundlog-server && ls
du -sh .          # 2MB 안팎이면 정상. 수백 MB면 node_modules가 섞인 것
```

---

## 2. `.env` 작성

```bash
cd /mnt/data/soundlog-server

# 시크릿 생성 — 출력값을 아래 .env에 붙여넣는다
echo "JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"

nano .env
```

```dotenv
NODE_ENV=production
API_PORT=8005            # 호스트 공개 포트 (컨테이너 내부는 4000 고정)
PORT=4000

JWT_SECRET=<생성한_값>
JWT_EXPIRES_IN_SECONDS=3600

POSTGRES_USER=soundlog
POSTGRES_PASSWORD=<생성한_값>
POSTGRES_DB=soundlog

USE_MOCK_DB=false
ALLOW_DEV_AUTH_FALLBACK=false

# <공인IP>를 실제 값으로 바꿀 것
CLIENT_URL=http://<공인IP>:8005
CLIENT_URLS=http://<공인IP>:8005,https://soundlog.shop,https://www.soundlog.shop,http://localhost:8081,http://localhost:8082

UPLOAD_DIRECTORY=/app/uploads
UPLOAD_PUBLIC_BASE_URL=http://<공인IP>:8005
UPLOAD_PUBLIC_PATH=/uploads

TOUR_API_SERVICE_KEY=<data.go.kr_Encoding키_%포함_그대로>
TOUR_API_BASE_URL=https://apis.data.go.kr/B551011/KorService2
REVERSE_GEOCODING_BASE_URL=https://nominatim.openstreetmap.org
REVERSE_GEOCODING_USER_AGENT=Soundlog/0.1 (+https://github.com/SoundLogTeam/SoundLogServer)

ML_RECOMMENDATION_TIMEOUT_MS=8000
REQUEST_BODY_LIMIT=1mb
MOMENT_PHOTO_MAX_FILE_SIZE_MB=10
```

```bash
chmod 600 .env
```

세 가지만 짚고 갑니다.

**`JWT_SECRET`은 반드시 직접 생성한 값을 넣으세요.** 비워두면 `docker-compose.yml`의
기본값 `change-me-in-local-development`가 들어가는데, 이 문자열은 저장소에 그대로
적혀 있어서 아는 사람은 아무 계정의 토큰이나 위조할 수 있습니다.

**`UPLOAD_PUBLIC_BASE_URL`에 공인 IP를 꼭 채우세요.** 안 그러면 사진 URL이
`localhost`로 만들어져서 앱에서 이미지가 안 보입니다.

**`ML_RECOMMENDATION_API_URL`은 쓰지 마세요.** override가
`http://host.docker.internal:8000/recommend`로 덮어씁니다. 추천 서비스를 다른 서버로
옮길 때만 여기에 그 주소를 적으면 override보다 우선합니다.

---

## 3. 빌드 & 기동

```bash
cd /mnt/data/soundlog-server
docker compose up --build -d
```

첫 빌드는 5~15분입니다(pnpm install + Prisma generate + tsc).
이미지는 `/mnt/data/docker`로 가므로 루트 용량은 늘지 않습니다.

```bash
docker compose ps
docker compose logs -f api
```

컨테이너가 뜰 때 `prisma migrate deploy` → 공개 카탈로그 시드 → 서버 기동이 자동으로
실행됩니다. **별도로 마이그레이션이나 시드를 돌릴 필요가 없습니다.**

```bash
curl http://127.0.0.1:8005/v1/health
# {"data":{"status":"ok","mode":"database"}}
```

`mode`가 `mock-db`면 `.env`의 `USE_MOCK_DB`가 잘못된 것입니다.

---

## 4. ACG 포트

NCP 콘솔 → `Server` → `ACG` → 해당 ACG → `ACG 설정` → 인바운드 규칙

| 프로토콜 | 접근 소스 | 허용 포트 | 비고 |
|---|---|---|---|
| TCP | `0.0.0.0/0` | **8005** | Node API — 새로 추가 |

```bash
# 외부에서 확인 (본인 PC)
curl http://<공인IP>:8005/v1/health
```

서버 안에서는 되는데 밖에서 안 되면 거의 항상 ACG 문제입니다.

> 추천 서비스(8000)는 앱이 직접 부르지 않고 Node만 호출합니다. 지금은 외부에 열려 있어
> 봇 스캔이 계속 들어오고 있는데, 관광공사 API 쿼터가 그쪽으로 새므로 접근 소스를
> 제한하거나 닫는 편이 낫습니다. 컨테이너는 `host.docker.internal`로 내부에서 호출하므로
> 닫아도 연동에 영향이 없습니다.

---

## 5. 검증

```bash
# 계정 생성 → 토큰
TOKEN=$(curl -s -X POST http://127.0.0.1:8005/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"check@soundlog.test","password":"testpass1234","displayName":"확인"}' \
  | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

# 추천 호출 — 컨테이너에서 추천 서비스까지 닿는지 확인
curl -s -X POST http://127.0.0.1:8005/v1/playlists/contextual \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"location":{"lat":37.5796,"lng":126.9770},"travelMode":"walk","moodTags":["calm"]}'
```

**응답의 `context.source`를 보세요.**

- `"ml-recommendation"` → 추천 서비스까지 정상 연결
- `"seed-fallback"` → 추천 호출이 실패해 시드로 대체된 것

Node는 추천 호출 실패를 조용히 삼키고 시드 플레이리스트로 넘어갑니다. HTTP 상태코드는
둘 다 200이라 `context.source` 말고는 구분할 방법이 없습니다.

`seed-fallback`이 나오면 컨테이너에서 호스트로 닿는지부터 확인합니다.

```bash
docker compose exec api sh -c "curl -s -m 5 -X POST http://host.docker.internal:8000/recommend \
  -H 'Content-Type: application/json' \
  -d '{\"x\":126.9770,\"y\":37.5796,\"state\":\"산책\",\"mood\":\"잔잔한\"}'"
```

여기서 곡 목록이 나오면 연결은 정상이고, 추천 서비스 쪽 문제입니다.

> 현재 추천 서비스는 좌표 주변에 관광지가 없거나 관광공사 API가 흔들릴 때 500을 반환하며,
> 기존 로그 기준 호출 252건 중 32건(12.7%)이 그랬습니다. 그때는 Node가 자동으로
> `seed-fallback`으로 넘어가므로 서비스는 멈추지 않습니다. 이 부분을 개선한 코드는
> 별도로 준비되어 있으니 필요할 때 적용하면 됩니다.

---

## 6. 배포 후 확인

```bash
free -h                    # available이 3GB 이상 남는지
df -h / /mnt/data          # 루트가 늘지 않았는지
docker compose ps          # api, db 모두 healthy
systemctl status nginx postgresql@18-main   # 기존 서비스 정상
ss -tlnp | grep -E "8000|8005"              # 두 포트 모두 살아 있는지
```

**루트 용량이 늘어나면** Docker data-root 설정이 안 먹은 것입니다.

```bash
docker info | grep -i "docker root dir"    # /mnt/data/docker 여야 함
```

---

## 운영 명령

```bash
cd /mnt/data/soundlog-server

docker compose logs -f api          # 로그
docker compose restart api          # 재시작
docker compose up -d --force-recreate api   # .env 변경 반영
docker compose up --build -d        # 코드 변경 후 재빌드

docker compose exec db psql -U soundlog -d soundlog   # DB 접속

# DB 백업
docker compose exec -T db pg_dump -U soundlog soundlog > ~/soundlog-$(date +%Y%m%d).sql
```

**`docker compose down -v`는 절대 쓰지 마세요.** `-v`가 볼륨까지 지워서
DB와 업로드 사진이 전부 사라집니다.

---

## 남은 보안 이슈

`서버-아키텍처-분석.md`에서 나온 것 중 배포 후에도 그대로인 항목입니다.

1. `POST /v1/dev/db-test-records`가 **인증 없이 열려 있습니다.** 임의 JSON을 무제한으로
   DB에 넣을 수 있으니, 공개 전에 `authMiddleware`를 붙이거나 프로덕션에서 라우트를 빼세요.
2. **로그인 rate limit이 없습니다.** bcrypt cost 12라 로그인 요청만 퍼부어도 CPU가
   고갈됩니다. 이 서버는 다른 서비스와 CPU를 공유하므로 영향 범위가 더 큽니다.
3. **평문 HTTP입니다.** 로그인 비밀번호와 Bearer 토큰이 그대로 노출됩니다.
   이 서버에 nginx가 443으로 이미 돌고 있으니, 심사 제출 전에는 그 뒤로 옮기는 것을
   권합니다. override의 `ports`를 `127.0.0.1:8005:4000`으로 바꾸고 nginx에
   `location` 블록을 추가하면 됩니다. 인증서를 새로 받을 필요는 없습니다.
4. **업로드 사진에 접근 제어가 없습니다.** 리캡이 `private`여도 URL만 알면 받을 수 있습니다.
