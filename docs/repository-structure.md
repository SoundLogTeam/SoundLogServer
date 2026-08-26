# SoundLog 저장소 구조

SoundLogTeam은 다음 세 저장소만 활성 개발 대상으로 관리합니다.

| 저장소 | 책임 |
| --- | --- |
| `SoundLogTeam/SoundLogApp` | React Native와 Expo 기반 모바일 앱 |
| `SoundLogTeam/SoundLogServer` | Node.js API와 데이터베이스와 배포 |
| `SoundLogTeam/soundlog-ml` | 위치와 무드 기반 음악 및 장소 이미지 추천 |

OpenAPI의 구현 기준은 이 저장소의 `openapi/soundlog-api.yaml`입니다. API 문서만
별도 저장소에서 수정하지 않습니다. 추천 서비스의 `/recommend` 계약은
`SoundLogTeam/soundlog-ml`의 `API.md`를 함께 확인합니다.

## 과거 이력 보존

기존 `SoundLogTeam/api-docs`와 `KimJaegeol1/soundlog-api`의 Git 이력은 삭제하지
않고 이 저장소의 다음 태그로 보존했습니다.

- `archive/api-docs-final-2026-08-26`
- `archive/soundlog-api-personal-main-2026-08-26`

태그의 파일을 확인하려면 새 작업 폴더에서 다음 명령을 사용합니다.

```bash
git worktree add ../soundlog-api-docs-archive archive/api-docs-final-2026-08-26
git worktree add ../soundlog-api-snapshot-archive archive/soundlog-api-personal-main-2026-08-26
```

두 태그는 과거 이력 확인용입니다. 새 브랜치를 만들거나 운영 코드를 수정할
때의 기준으로 사용하지 않습니다.
