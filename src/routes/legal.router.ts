import { Router } from 'express';

const SUPPORT_EMAIL = 'support@soundlog.shop';
const EFFECTIVE_DATE = '2026.06.24';

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
  description: 'Soundlog가 수집하는 정보와 이용 목적, 삭제 방법을 안내합니다.',
  sections: [
    {
      title: '수집하는 정보',
      body: 'Soundlog는 이메일 계정 가입과 로그인을 위해 이름, 이메일, 비밀번호 인증 정보를 처리할 수 있습니다. 사용자가 입력한 음악 취향, 여행 스타일, 좋아요와 저장한 음악, 리캡과 여행 로그 생성에 필요한 사진, 위치, 시간, 장소, 음악 정보를 저장할 수 있습니다.',
    },
    {
      title: '위치와 사진 권한',
      body: '위치 권한은 현재 장소에 맞는 추천과 여행 순간의 장소 기록에 사용합니다. 카메라와 사진 보관함 권한은 사용자가 직접 촬영한 순간을 저장하고 Recap 이미지를 보관함에 저장하는 데 사용합니다. 백그라운드 위치 추적은 사용하지 않습니다.',
    },
    {
      title: '이용 목적',
      body: '수집된 정보는 위치 기반 음악 추천, 여행 로그 저장, Recap 생성, 계정 동기화, 오류 대응과 서비스 안정성 개선에 사용됩니다. 광고 추적이나 제3자 광고 목적의 판매에는 사용하지 않습니다.',
    },
    {
      title: '제3자 서비스',
      body: '장소 정보에는 공공 관광 데이터 API가 사용될 수 있습니다. Soundlog는 음악 추천과 기록 UI를 앱 안에서 제공하며 음원 재생 서비스의 계정 정보는 수집하지 않습니다.',
    },
    {
      title: '보관과 삭제',
      body: '계정 데이터와 여행 기록은 사용자가 서비스를 이용하는 동안 보관됩니다. 앱의 My 화면에서 계정 삭제를 실행하면 계정, 인증 토큰, 여행 기록, 리캡, 보관함과 커뮤니티 데이터가 삭제되며 복구할 수 없습니다.',
    },
    {
      title: '문의',
      body: `개인정보와 데이터 삭제 문의는 ${SUPPORT_EMAIL}으로 보낼 수 있습니다.`,
    },
  ],
};

const termsPage: LegalPage = {
  title: '서비스 이용약관',
  description: 'Soundlog 서비스를 사용할 때 적용되는 기본 조건을 안내합니다.',
  sections: [
    {
      title: '서비스 이용',
      body: 'Soundlog는 위치와 여행 맥락을 바탕으로 음악 추천, 순간 기록, 리캡과 여행 로그 생성을 제공하는 서비스입니다. 사용자는 본인의 기기와 계정에서 발생하는 활동에 대한 책임이 있습니다.',
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
      body: '타인의 권리를 침해하는 콘텐츠, 불법적인 목적의 이용, 서비스 안정성을 해치는 행위는 허용되지 않습니다. 필요한 경우 서비스 이용이 제한될 수 있습니다.',
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
    description: 'Soundlog 이용과 데이터 처리에 관한 문의 방법을 안내합니다.',
    sections: [
      {
        title: '이메일 문의',
        body: `앱 이용, 계정, 데이터 삭제와 오류 문의는 ${SUPPORT_EMAIL}으로 보내주세요.`,
      },
      {
        title: '계정 및 데이터 삭제',
        body: '앱의 My 화면에서 계정 삭제를 실행할 수 있습니다. 앱에 접근할 수 없는 경우 가입 이메일과 함께 고객지원 메일로 요청해 주세요.',
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
