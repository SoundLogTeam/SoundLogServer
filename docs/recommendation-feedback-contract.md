# Recommendation Feedback Contract

> Status: Canonical server contract
> Last updated: 2026-09-05

사용자가 음악 추천과 관광지 추천사진에 1~5점 별점과 선택적 의견(300자 이하)을 남긴다.
전송은 기존 분석 이벤트 경로를 그대로 쓰고, 서버가 이를 구조화된 행으로 다시 적재한다.

```text
앱  → POST /v1/recommendation-events  (type=recommendation_feedback, value=JSON 문자열)
서버 → RecommendationEvent      (원본 이벤트, 그대로 보존)
     → RecommendationFeedback   (별점·의견을 컬럼으로 펼친 것)
```

## 왜 전용 엔드포인트를 만들지 않았나

앱이 이미 이 경로로 이벤트를 보내고 있었다. 전송 계약을 바꾸면 앱 배포와 서버 배포가
묶인다. 대신 서버가 받아서 옮겨 담는 쪽을 택했다. 원본 이벤트는 남으므로, 나중에
해석을 바꾸고 싶으면 `RecommendationEvent`에서 다시 만들 수 있다.

## Server invariants

1. `type`이 `recommendation_feedback`인 이벤트는 `value`에 피드백 JSON을 직렬화한 **문자열**로 담는다.
2. `value.version`은 현재 `1`만 지원한다. 그 밖의 값은 나머지 필드를 해석하지 않고 거부한다.
3. `value.subject`는 `music` 또는 `photo`다.
4. `value.rating`은 1 이상 5 이하의 **정수**다. 0, 6, 소수점은 거부한다.
5. `value.opinion`은 선택이다. 앞뒤 공백을 제거한 뒤 1자 이상 300자 이하여야 한다.
6. `subject`가 `music`이면 `playlistId`가 반드시 있어야 한다. 무엇을 평가했는지 없으면 분석에 쓸 수 없다.
7. 사진 피드백에는 이미지 URL, 기기 파일 URI, GPS 좌표를 담지 않는다. 장소 식별자와 장소명만 전달한다.
8. `RecommendationFeedback.id`는 이벤트 `id`를 그대로 쓴다. 같은 이벤트가 다시 와도 한 행만 남는다.
9. 이벤트 적재와 피드백 적재는 같은 트랜잭션에서 일어난다. 한쪽만 남는 상태를 만들지 않는다.
10. 배치 안의 이벤트가 하나라도 잘못되면 배치 전체를 400으로 거부한다. 부분 수용은 하지 않는다.
11. 의견 원문은 운영 로그와 검증 오류 메시지 어디에도 남기지 않는다.

## 10번을 그렇게 정한 이유

앱의 `syncRecommendationEvent`가 이벤트를 한 건씩 보낸다. 부분 수용을 구현해도 지금은
쓰이지 않는 경로가 되고, 응답 형태만 복잡해진다. 배치 전송이 실제로 필요해지면 그때
`acceptedEventIds` / `rejectedEvents` 확장 응답을 도입한다.

## 거부 사유 코드

검증 실패는 `400`이며 `error.details.issues[].params.feedbackCode`에 사유가 담긴다.
같은 위치의 `params.eventId`로 배치 안 어느 이벤트인지 식별한다.

| 코드 | 의미 |
| --- | --- |
| `INVALID_FEEDBACK_VALUE` | `value`가 JSON이 아니거나 rating·subject·opinion이 규칙을 벗어남 |
| `UNSUPPORTED_FEEDBACK_VERSION` | 지원하지 않는 `version` |
| `MISSING_FEEDBACK_TARGET` | `subject=music`인데 `playlistId`가 없음 |

## context.source

`context.source`는 추천이 어느 경로로 나왔는지를 담는다.

- 음악: `ml-recommendation` · `seed-fallback` · `server-contextual`
- 사진: `recommended-photo:<관광 데이터 출처>` (예: `recommended-photo:tour-api`)

사진 쪽 출처는 계속 늘어나므로 OpenAPI에서 enum으로 고정하지 않는다.

> **2026-09-05 이전 데이터 주의**
> 그 전까지 `recommendationContextSchema`에 `source`가 선언돼 있지 않았다.
> zod의 `z.object()`는 모르는 키를 오류 없이 버리고, `validate` 미들웨어는 `req.body`를
> 파싱 결과로 통째 교체한다. 그래서 앱이 보낸 `source`는 400도 없이 사라졌다.
> 이 날짜 이전 이벤트에는 `source`가 없다.

## 스키마

`prisma/models/analytics.prisma`의 `RecommendationFeedback`.

| 컬럼 | 비고 |
| --- | --- |
| `id` | 이벤트 id. 재전송 멱등성의 근거 |
| `subject` `rating` `opinion` | `value`를 펼친 것 |
| `playlistId` `placeId` `placeName` `source` | 조인·집계용으로 뽑아둔 것 |
| `context` | 이벤트 context 원본 JSON. 위 컬럼으로 안 뽑은 값이 여기 남는다 |
| `version` | 재해석이 필요할 때 세대를 가르는 값 |

## 아직 없는 것

별점만으로는 **왜** 나쁜지 알 수 없다. ML 응답의 `meta`(`photo.gate`, `photo.source`,
`place.place_applied`, `poiSource`)가 `Playlist.context`에 저장되면,
`RecommendationFeedback.playlistId` → `Playlist.context` 조인만으로
"낮은 별점이 어느 게이트에 몰리는가"를 볼 수 있다. 그때 이 스키마는 바꿀 필요가 없다.

## 관련 파일

```text
prisma/models/analytics.prisma          RecommendationFeedback
prisma/migrations/20260905000000_recommendation_feedback/
src/validators/api.validators.ts        parseRecommendationFeedbackValue, superRefine
src/services/soundlog.service.ts        buildRecommendationFeedbackRows
src/services/mock-soundlog.service.ts   mock 모드 동등 구현 (빠지면 두 경로가 갈라진다)
tests/recommendation-feedback.test.ts   수용 시나리오 12건
openapi/soundlog-api.yaml               RecommendationFeedbackValue
```
