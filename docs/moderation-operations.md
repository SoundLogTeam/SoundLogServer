# Soundlog 신고 운영 안내

이 문서는 신고가 들어온 뒤 24시간 안에 확인하고 조치하기 위한 운영 절차를 설명합니다. 앱 심사 전에 운영 서버에 `MODERATION_ADMIN_KEY`와 `MODERATION_ALERT_MODE`를 반드시 설정해야 합니다.

## 운영 환경 설정

`MODERATION_ADMIN_KEY`는 관리자 API 요청을 인증하는 32자 이상의 비밀 문자열입니다. 앱 코드나 공개 문서에 넣지 않습니다.

`MODERATION_ALERT_MODE=cloud_logging`은 새 신고와 처리 기한 알림을 `source=soundlog_moderation` 구조화 로그로 남깁니다. GCP에서는 이 로그에 Cloud Monitoring 알림 정책을 연결합니다. 외부 알림 도구를 사용할 때는 `MODERATION_ALERT_MODE=webhook`을 설정하고 `MODERATION_ALERT_WEBHOOK_URL`에 HTTPS 웹훅 주소를 넣습니다.

`APP_REVIEW_EMAIL`과 `APP_REVIEW_PASSWORD`는 심사 계정과 시연 데이터를 준비할 때 사용합니다. 아래 명령은 공개 추천 카탈로그와 데모 사용자를 갱신한 뒤 심사 계정이 신고하고 차단할 수 있는 사운드맵 핀과 공유 여행방을 만듭니다.

```bash
pnpm db:seed:review
```

## 신고 확인

아래 예시에서 주소와 비밀키는 운영 환경에 맞게 바꿉니다.

```bash
curl -fsS 'https://api.soundlog.p-e.kr/v1/admin/moderation/reports?status=pending&limit=50' \
  -H 'x-soundlog-admin-key: YOUR_ADMIN_KEY'
```

응답의 `dueAt`이 처리 기한입니다. 신고 내용과 대상 스냅샷을 확인한 뒤 다음 중 하나로 처리합니다.

- `dismiss`는 위반이 아니라고 판단한 신고를 종료합니다.
- `hide_content`는 신고된 콘텐츠를 숨기고 신고를 종료합니다.
- `hide_and_suspend`는 콘텐츠를 숨기고 작성자의 로그인을 중단합니다.

```bash
curl -fsS -X PATCH 'https://api.soundlog.p-e.kr/v1/admin/moderation/reports/REPORT_ID' \
  -H 'content-type: application/json' \
  -H 'x-soundlog-admin-key: YOUR_ADMIN_KEY' \
  --data '{"action":"hide_content","note":"운영 정책 위반 콘텐츠를 숨겼습니다."}'
```

## 공개 사진 검토

사진이 포함된 공개 리캡과 음악 기록은 승인 전까지 다른 사용자에게 보이지 않습니다.

```bash
curl -fsS 'https://api.soundlog.p-e.kr/v1/admin/moderation/content?limit=50' \
  -H 'x-soundlog-admin-key: YOUR_ADMIN_KEY'
```

응답의 `photoUrl` 또는 `backgroundImageUrl` 마지막 경로에 있는 32자리 `fileId`를 관리자 이미지 경로에 넣으면 사용자 로그인 토큰 없이 검토 원본을 확인할 수 있습니다.

```bash
curl -fsS 'https://api.soundlog.p-e.kr/v1/admin/moderation/content-images/FILE_ID' \
  -H 'x-soundlog-admin-key: YOUR_ADMIN_KEY' \
  --output moderation-image
```

```bash
curl -fsS -X PATCH 'https://api.soundlog.p-e.kr/v1/admin/moderation/content/CONTENT_ID' \
  -H 'content-type: application/json' \
  -H 'x-soundlog-admin-key: YOUR_ADMIN_KEY' \
  --data '{"type":"recap","decision":"approved"}'
```

## 알림 점검

서버는 15분마다 처리 기한을 확인합니다. 20시간이 지난 미처리 신고와 24시간을 넘긴 신고를 웹훅으로 다시 알립니다. 배포 직후에는 아래 명령으로 점검 작업을 직접 실행하고 웹훅 수신 여부를 확인합니다.

```bash
curl -fsS -X POST 'https://api.soundlog.p-e.kr/v1/admin/moderation/sweep' \
  -H 'x-soundlog-admin-key: YOUR_ADMIN_KEY'
```

웹훅이 오지 않더라도 신고 데이터는 저장됩니다. 다만 24시간 대응을 보장할 수 없으므로 심사 제출 전에는 실제 신고 한 건을 접수하고 운영 담당자가 알림과 관리자 API를 모두 확인해야 합니다.
