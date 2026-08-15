import { Router } from 'express';

const SUPPORT_EMAIL = 'support@soundlog.shop';
const EFFECTIVE_DATE = '2026.08.15';

type LegalSection = {
  body: string;
  title: string;
};

type LegalPage = {
  description: string;
  sections: LegalSection[];
  title: string;
};

const privacyPage: LegalPage = {
  title: '개인정보 처리방침',
  description:
    'Soundlog iOS 및 Android 앱의 정보 처리, 삭제 방법과 앱 지원용 공개 고지를 안내합니다.',
  sections: [
    {
      title: '적용 범위',
      body: '이 페이지는 Soundlog 모바일 앱의 개인정보 처리와 지원을 위한 공개 법적 고지입니다. Soundlog는 별도의 웹 서비스나 웹 계정 기능을 제공하지 않으며, 이 페이지는 앱 설치 전후에 정책과 지원 방법을 확인할 수 있도록 제공됩니다.',
    },
    {
      title: '수집하는 정보',
      body: 'Soundlog는 이메일 계정 가입과 로그인을 위해 계정 이름, 이메일 주소, 사용자 ID와 비밀번호 인증 정보를 처리합니다. 앱 기능을 위해 사용자가 선택하거나 입력한 음악 취향, 여행 스타일, 좋아요와 저장한 음악, 장소와 시간, 음악 정보, 메모·댓글 등 사용자 콘텐츠를 처리할 수 있습니다. 리캡 기록에는 사용자가 촬영하거나 선택한 사진과 리캡 이미지가 포함될 수 있으며, 현재 앱은 영상 업로드 기능을 제공하지 않습니다.',
    },
    {
      title: '계정 연결과 추적',
      body: '계정 이름, 이메일 주소, 사용자 ID, 위치, 사진, 사용자 콘텐츠와 제품 상호작용 정보는 계정의 기록·동기화·개인화 기능을 위해 Soundlog 계정과 연결하여 처리할 수 있습니다. Soundlog는 이 정보를 다른 회사의 앱 또는 웹사이트 데이터와 결합해 맞춤 광고를 제공하거나 광고 효과를 측정하는 방식으로 추적하지 않습니다.',
    },
    {
      title: '위치와 사진 권한',
      body: '위치 권한은 현재 장소에 맞는 추천, 여행 순간의 장소 기록과 여행 경로 기록에 사용합니다. 이 과정에서 정확한 위도·경도와 기록 시각을 처리할 수 있습니다. 위치는 앱 사용 중에만 요청하며 백그라운드 위치 추적은 사용하지 않습니다. 카메라와 사진 보관함 권한은 사용자가 직접 촬영하거나 선택한 사진을 리캡에 저장하고, 사용자가 요청한 리캡 이미지를 사진 보관함에 저장하는 데 사용합니다.',
    },
    {
      title: '제품 상호작용 분석과 이용 목적',
      body: 'Soundlog는 곡 선택·좋아요·저장, 플레이리스트 열기, 무드 변경, 리캡 저장·공유·이미지 저장과 같은 제품 상호작용 정보를 분석할 수 있습니다. 이 정보는 음악 추천과 기록 기능 제공, 계정 동기화, 서비스 사용성 및 안정성 개선을 위해 사용하며, 제3자 광고 목적의 판매에는 사용하지 않습니다.',
    },
    {
      title: '제3자 서비스',
      body: '사용자가 현재 장소 확인, 역지오코딩 또는 주변 관광지 추천 기능을 이용하면 정확한 좌표가 Nominatim(OpenStreetMap)과 한국관광공사 공공데이터 API에 전달될 수 있습니다. HTTPS로 설정된 추천 서버를 사용하는 경우에는 음악 추천을 위해 좌표와 무드·여행 상태가 해당 서버에 전달될 수 있습니다. 각 제공자의 정책이 적용될 수 있습니다.',
    },
    {
      title: '외부 음악 링크',
      body: 'Soundlog는 외부 음악 서비스의 검색 또는 재생 링크를 열 수 있습니다. 링크를 열면 해당 서비스의 정책이 적용되며, Soundlog는 외부 음악 서비스 계정 정보나 재생 계정을 수집하지 않습니다.',
    },
    {
      title: '보관과 삭제',
      body: '계정 데이터와 여행 기록은 계정 기반 앱 기능을 제공하는 동안 처리합니다. 앱의 My 화면에서 계정 삭제를 실행하면 계정, 인증 토큰, 여행 기록, 리캡, 보관함, 커뮤니티 데이터와 서버에 저장된 리캡 사진을 삭제하며 복구할 수 없습니다. 운영 로그 또는 백업의 보관 기간은 이 페이지에서 구체적으로 정하지 않으며, 해당 정보의 처리 기준이 필요한 경우 고객지원으로 문의할 수 있습니다.',
    },
    {
      title: '문의',
      body: `개인정보와 데이터 삭제 문의는 ${SUPPORT_EMAIL}으로 보낼 수 있습니다.`,
    },
  ],
};

const termsPage: LegalPage = {
  title: '서비스 이용약관',
  description: 'Soundlog 모바일 앱을 사용할 때 적용되는 기본 조건을 안내합니다.',
  sections: [
    {
      title: '서비스 이용',
      body: 'Soundlog는 위치와 여행 맥락을 바탕으로 음악 추천, 순간 기록, 리캡과 여행 로그 생성을 제공하는 모바일 앱 서비스입니다. 이 공개 페이지는 앱 지원과 법적 고지용이며 별도의 웹 서비스를 제공하지 않습니다. 사용자는 본인의 기기와 계정에서 발생하는 활동에 대한 책임이 있습니다.',
    },
    {
      title: '계정 기반 이용',
      body: 'Soundlog의 추천, 좋아요, 여행 기록과 Recap 기능은 로그인된 Soundlog 계정에서 사용할 수 있습니다. 온보딩과 약관 확인은 로그인 전에도 볼 수 있지만 주요 기능 이용에는 계정 로그인이 필요합니다.',
    },
    {
      title: '사용자 콘텐츠',
      body: '사용자가 촬영하거나 저장한 사진, 장소, 음악 메모와 Recap 자료의 권리는 사용자에게 있습니다. Soundlog는 서비스 제공, 동기화와 공유 기능 제공에 필요한 범위에서만 이를 처리합니다.',
    },
    {
      title: '외부 서비스',
      body: '장소 정보 등 공공 관광 데이터 제공자의 서비스가 사용될 수 있으며 해당 제공자의 정책이 함께 적용될 수 있습니다. Soundlog는 외부 음원 재생을 보장하지 않습니다.',
    },
    {
      title: '제한 사항',
      body: 'Soundlog는 불쾌하거나 폭력적이거나 혐오적이거나 성적인 콘텐츠를 용납하지 않습니다. 타인을 괴롭히거나 사칭하거나 위협하거나 스팸을 보내는 행위와 불법적인 목적의 이용도 허용하지 않습니다. 위반 콘텐츠는 즉시 숨김 또는 삭제될 수 있으며 위반 사용자는 서비스 이용이 정지될 수 있습니다.',
    },
    {
      title: '신고와 차단',
      body: `사용자는 앱에서 부적절한 콘텐츠를 신고하고 해당 사용자를 차단할 수 있습니다. 차단한 사용자의 콘텐츠는 즉시 피드와 지도에서 숨겨집니다. 신고는 ${SUPPORT_EMAIL}으로도 접수할 수 있으며 Soundlog는 신고 접수 후 24시간 안에 검토하고 필요한 콘텐츠 삭제와 사용자 제재를 진행합니다.`,
    },
    {
      title: '문의와 변경',
      body: `약관 또는 서비스 이용 문의는 ${SUPPORT_EMAIL}으로 보낼 수 있습니다. 약관이 변경되는 경우 앱 또는 스토어 고지를 통해 안내합니다.`,
    },
  ],
};

function renderPage(page: LegalPage) {
  const sections = page.sections
    .map(
      ({ body, title }) => `
        <section>
          <h2>${title}</h2>
          <p>${body}</p>
        </section>`,
    )
    .join('');

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${page.description}" />
    <title>${page.title} | Soundlog</title>
    <style>
      :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #f5f7f8; color: #182022; line-height: 1.7; }
      main { width: min(100% - 40px, 760px); margin: 0 auto; padding: 56px 0 72px; }
      header { border-bottom: 1px solid #dce2e4; padding-bottom: 28px; }
      .brand { margin: 0 0 8px; color: #18794e; font-size: 14px; font-weight: 700; }
      h1 { margin: 0; font-size: clamp(28px, 7vw, 42px); line-height: 1.2; }
      .description { margin: 16px 0 0; color: #4c5a5d; }
      .date { margin: 10px 0 0; color: #657477; font-size: 14px; }
      section { padding: 28px 0 0; }
      h2 { margin: 0 0 8px; font-size: 20px; }
      p { margin: 0; overflow-wrap: anywhere; }
      footer { margin-top: 44px; border-top: 1px solid #dce2e4; padding-top: 24px; font-size: 14px; }
      a { color: #126a43; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <p class="brand">Soundlog</p>
        <h1>${page.title}</h1>
        <p class="description">${page.description}</p>
        <p class="date">시행일 ${EFFECTIVE_DATE}</p>
      </header>
      ${sections}
      <footer>
        <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
        · <a href="/legal/privacy">개인정보 처리방침</a>
        · <a href="/legal/terms">서비스 이용약관</a>
        · <a href="/support">고객지원</a>
      </footer>
    </main>
  </body>
</html>`;
}

function renderSupportPage() {
  return renderPage({
    title: '고객지원',
    description:
      'Soundlog 모바일 앱 이용과 데이터 처리에 관한 문의 방법을 안내하는 공개 지원 페이지입니다.',
    sections: [
      {
        title: '앱 지원 페이지',
        body: '이 페이지는 Soundlog iOS 및 Android 앱의 고객지원과 법적 고지를 위한 공개 페이지입니다. 별도의 웹 서비스나 웹 계정 기능을 제공하지 않습니다.',
      },
      {
        title: '이메일 문의',
        body: `앱 이용, 계정, 개인정보 처리, 데이터 삭제와 오류 문의는 ${SUPPORT_EMAIL}으로 보내주세요.`,
      },
      {
        title: '계정 및 데이터 삭제',
        body: '앱의 My 화면에서 계정 삭제를 실행할 수 있습니다. 계정 삭제는 계정과 연관된 기록·리캡·보관함·커뮤니티 데이터 및 서버에 저장된 리캡 사진을 삭제합니다. 앱에 접근할 수 없는 경우 가입 이메일과 함께 고객지원 메일로 요청해 주세요.',
      },
    ],
  });
}

export function createLegalRouter() {
  const router = Router();

  router.get('/legal/privacy', (_request, response) => {
    response.set('Cache-Control', 'public, max-age=300');
    response.type('html').send(renderPage(privacyPage));
  });
  router.get('/legal/terms', (_request, response) => {
    response.set('Cache-Control', 'public, max-age=300');
    response.type('html').send(renderPage(termsPage));
  });
  router.get('/support', (_request, response) => {
    response.set('Cache-Control', 'public, max-age=300');
    response.type('html').send(renderSupportPage());
  });

  return router;
}
