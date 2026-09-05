# SoundLog 저장소 구조

SoundLogTeam은 다음 세 저장소만 활성 개발 대상으로 관리합니다.

| 저장소 | 책임 |
| --- | --- |
| `SoundLogTeam/SoundLogApp` | React Native와 Expo 기반 모바일 앱 |
| `SoundLogTeam/SoundLogServer` | Node.js API와 데이터베이스와 배포 |
| `SoundLogTeam/SoundLogML` | 위치와 무드 기반 음악 및 장소 이미지 추천 |

OpenAPI의 구현 기준은 이 저장소의 `openapi/soundlog-api.yaml`입니다. API 문서만
별도 저장소에서 수정하지 않습니다. 추천 서비스의 `/recommend` 계약은
`SoundLogTeam/SoundLogML`의 `API.md`를 함께 확인합니다.

## 과거 이력 보존

기존 `SoundLogTeam/api-docs`와 `KimJaegeol1/soundlog-api`의 Git 이력은 삭제하지
않고 이 저장소의 다음 태그로 보존했습니다. 두 스냅샷 이후 개인 저장소에 쌓인
작업(리캡 배경 추천 API, 추천 피드백 수집)은 2026-09-05에 이 저장소로 이식했으므로
태그를 다시 뜰 필요는 없습니다.

- `archive/api-docs-final-2026-08-26`
- `archive/soundlog-api-personal-main-2026-08-26`

태그의 파일을 확인하려면 새 작업 폴더에서 다음 명령을 사용합니다.

```bash
git worktree add ../soundlog-api-docs-archive archive/api-docs-final-2026-08-26
git worktree add ../soundlog-api-snapshot-archive archive/soundlog-api-personal-main-2026-08-26
```

두 태그는 과거 이력 확인용입니다. 새 브랜치를 만들거나 운영 코드를 수정할
때의 기준으로 사용하지 않습니다.

## 서버 배치 (echo)

운영 서버에서는 두 저장소를 나란히 둡니다. `.venv` 는 ML 저장소 밖에 있으므로
경로를 옮길 때 함께 옮깁니다.

```
/mnt/data/SoundLog/
├── SoundLogServer   Docker compose, 호스트 8005
├── SoundLogML       systemd(soundlog-ml), 172.17.0.1:8000
└── .venv            ML 가상환경
```

api 컨테이너는 `host.docker.internal:8000` 으로 ML 을 부릅니다. ML 이 docker0
브리지에 바인딩하는 이유이고, 이 경로는 호스트를 벗어나지 않습니다.
