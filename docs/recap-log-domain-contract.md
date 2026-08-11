# Recap / Log Server Domain Contract

> Status: Canonical server contract
> Last updated: 2026-07-13

Soundlog 제품에서 `Recap`은 카메라 저장 1회로 만든 단일 기록이고, `Log`는 같은 여행모드 세션에서 생성한 Recap의 집합이다.

```text
Product Recap = one capture
Product Log = Recap[] grouped by exactly one TravelSession
```

## Server invariants

1. Product Recap 하나는 `sessionId`가 없거나 정확히 하나만 가진다.
2. `sessionId`가 없는 Product Recap은 독립 리캡이며 Log가 아니다.
3. `sessionId`가 있는 Product Recap은 그 세션의 Product Log 구성원이다.
4. Product Log는 `sessionId`로 식별한다. 날짜, 장소, 거리, 음악으로 자동 병합하지 않는다.
5. 여행 세션에 Product Recap이 하나만 있어도 Product Log다.
6. Product Recap이 0개인 여행 세션은 Log 목록에 노출할 결과를 만들지 않는다.
7. Log 상세의 `moments`에는 해당 세션의 Product Recap만 포함한다.
8. Log 상세의 `routePoints`에는 해당 세션에서 수집한 GPS 경로만 포함한다.
9. 다른 사용자의 정확한 `routePoints`는 응답하지 않는다.
10. 위치가 없는 Product Recap 또는 Product Log는 public 지도 마커로 전환할 수 없다.
11. Product Recap의 `templateId`와 `visibility`는 원본 `MomentLog`에 저장하며 집계 JSON만 신뢰하지 않는다.
12. 공개 Log의 비소유자 응답은 public 구성 Recap만 포함하고 대표 장소, 이미지, 음악, 개수도 그 공개 구성원에서 다시 계산한다.

## Legacy technical names

현재 DB와 API에는 과거 이름이 남아 있다.

| Product meaning | Server name | Notes |
| --- | --- | --- |
| Recap | Prisma `MomentLog`, `/v1/recap-captures` 또는 `/v1/moment-logs` | 카메라 저장 1회 원본 |
| Log | Prisma `Recap`, `/v1/recaps` | 여행 세션 리캡 집합과 공유 결과. 일반 여행 로그는 `travelSessionId`로 1:1 보장 |
| Travel session | Prisma `TravelSession`, `/v1/travel-sessions` | 로그의 그룹 경계와 경로 수집 상태 |
| GPS route | `routePoints` JSON | 여행모드 중 수집한 경로점 |

API/DB 호환성 때문에 기술 이름을 즉시 바꾸지 않더라도 제품 의미는 이 표를 따른다. `MomentLog`라는 이름을 근거로 별도의 사용자-facing Moment 개념을 만들면 안 된다.

## Write flow

### Standalone Recap

1. 신규 클라이언트가 `POST /v1/recap-captures`에 `sessionId` 없이 `createStandaloneRecap: true`를 보내 Product Recap을 저장한다.
2. 서버는 독립 리캡 원본과 공유 및 지도용 서버 `Recap` row를 함께 만든다.
3. 응답은 독립 리캡의 공유 식별자를 `recapId`로 반환한다.
4. 같은 idempotency key로 재요청하면 기존 원본과 공유 데이터를 반환한다.
5. 이 결과는 Product Log 목록에서 제외한다.

기존 클라이언트는 이 옵션을 보내지 않으므로 서버가 원본만 만들고 기존의 후속 `POST /v1/recaps` 요청을 처리한다. 신규 클라이언트가 이전 서버를 호출해 응답에 `recapId`가 없으면 같은 멱등성 키로 후속 요청을 한 번 수행한다. 이 호환 계약으로 앱과 서버의 배포 순서에 따른 중복 리캡을 막는다.

### Travel Log

1. `POST /v1/travel-sessions`로 세션을 시작한다.
2. Product Recap 저장 시 활성 세션의 `sessionId`를 전달한다.
3. 세션 중 `routePoints`를 동기화한다.
4. 여행 종료 시 같은 `sessionId`의 Product Recap ID만 사용해 서버 `Recap` row를 생성한다.
5. 서버는 일반 여행 로그의 `Recap.travelSessionId`를 여행 세션과 1:1로 저장하고 외부 DTO에는 `sessionId`로 응답한다.
6. 서버 저장에 실패하면 클라이언트는 여행 종료를 완료하지 않고 사용자가 다시 시도할 수 있게 한다.

## Server-first policy

- 서버 저장이 끝난 Product Recap과 Product Log만 사용자 기록으로 취급한다.
- 클라이언트의 로컬 기록 이관 API와 저장 대기 큐를 서버 계약에 포함하지 않는다.
- 서버에 저장된 `MomentLog`는 별도의 동기화 상태를 갖지 않는다. 이전 앱 배포 호환을 위한 응답의 `syncStatus: synced` 상수는 한시적으로 유지한다.
- 활성 여행의 GPS 경로 버퍼는 센서 데이터 복구 목적으로 기기에 남을 수 있지만 서버 기록을 대신하지 않는다.

## Read flow

Product Log 목록의 판별 조건:

```text
Recap.travelSessionId IS NOT NULL
```

Product Log 상세 응답:

- `sessionId`: 로그의 여행 세션 ID
- `moments`: 해당 세션 Product Recap을 촬영 시각 오름차순으로 직렬화
- `routePoints`: 소유자에게만 제공하는 세션 GPS 경로
- `momentCount`: 현재 포함된 Product Recap 개수
- `templateId`: 저장된 표현 결과. 상세 조회에서 편집 계약으로 사용하지 않음

`GET /v1/recaps`는 Product Log 목록 전용이며 `sessionId`가 없는 독립 리캡을 반환하지 않는다. 독립 리캡 원본은 `GET /v1/recap-captures`에서 조회하고, 공개·내 지도 핀은 `GET /v1/recap-markers`에서 조회한다. Log 목록과 상세 응답에서는 `sessionId`를 누락하면 안 된다.

## Log map contract

Log 상세 지도는 다음 데이터만 사용한다.

- `moments[].location`: 현재 Log 구성 Recap 핀
- `routePoints[]`: 현재 Log 여행 세션의 경로선

Log 상세 응답에 다음 데이터를 섞지 않는다.

- 주변 공개 Recap
- 다른 여행 세션의 Recap
- 관광지 추천 핀
- Live Sound Map 사용자 핀

소유자가 아닌 사용자에게는 전체 경로를 반환하지 않는다. 공개 Log를 보여줄 때는 공개가 허용된 Recap 위치만 `moments`에 포함해야 하며 private Recap의 개수나 위치를 추론할 수 있는 데이터도 제외한다.

## Deletion and consistency

- Product Recap 삭제 시 관련 Log의 `moments`와 `momentCount`를 갱신한다.
- 구성 Recap이 하나 남아도 Log를 유지한다.
- 구성 Recap이 0개가 되면 Log 목록에서 제외하거나 일관된 삭제 정책을 적용한다.
- 대표 장소, 대표 이미지, 대표 음악이 삭제된 Recap에서 파생됐다면 남은 Recap 기준으로 재계산한다.
- idempotency key로 재시도 중 중복 Product Recap과 중복 Log 생성을 막는다.
- Product Recap 수정, 사진 교체/삭제, 삭제 직후 같은 트랜잭션에서 대표 장소, 이미지, 음악, 개수, 공개 상태를 재계산한다.
- 마지막 Product Recap이 삭제되면 집계 Log row를 삭제한다.

## Verification checklist

- [x] `sessionId = null` 독립 리캡이 Product Log 목록에서 제외되는가?
- [x] 리캡 1개짜리 여행 세션도 `sessionId`가 있는 Log로 응답하는가?
- [x] Log 상세 `moments`가 모두 Log의 `sessionId`와 일치하는가?
- [x] Log 상세 `routePoints`가 다른 세션 경로와 섞이지 않는가?
- [x] 비소유자 상세 응답에서 `routePoints`가 제거되는가?
- [x] public 전환 시 공개 구성 리캡과 위치 존재를 검증하는가?
- [x] 삭제 후 `momentCount`와 대표 정보가 실제 구성원과 일치하는가?

전체 제품/UI 규칙은 프론트엔드 저장소의 `docs/product/RECAP_LOG_DOMAIN_MODEL.md`를 함께 따른다.
