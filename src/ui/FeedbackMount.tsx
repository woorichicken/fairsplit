import { lazy, Suspense } from 'react';

/**
 * 피드백 버튼(라쏘런 feedback-kit)의 관문 — 부착 타입 `global`(허용 호스트형). 공개 서비스라 방문자가 곧 제보자다.
 * 라쏘런 프로젝트 「FairSplit (fairsplit.solhun.com)」 · 소스 `fairsplit-web` 의 허용 호스트와 같은 목록이다
 * (fairsplit.solhun.com · localhost:5173 dev · localhost:4173 preview).
 * 호스트를 늘리려면 소스 허용 호스트부터 넓힌다(`dp update-source-hosts`) — 안 그러면 버튼은 뜨는데 보내면 403 이다.
 * 127.0.0.1 은 일부러 뺐다 — E2E(vite preview 127.0.0.1) 화면에 버튼이 끼지 않게.
 */
const FEEDBACK_HOSTS: readonly string[] = ['fairsplit.solhun.com', 'localhost'];

const ENDPOINT = import.meta.env.VITE_DP_FEEDBACK_URL ?? '';
const TOKEN = import.meta.env.VITE_DP_FEEDBACK_KEY ?? '';

// 조건 안에 import 를 둔다 — 값이 비면 위젯 조각이 번들에서 빠져 첫 화면이 가벼워진다.
const FeedbackWidget = ENDPOINT && TOKEN ? lazy(() => import('./FeedbackWidget')) : null;

/**
 * 켠 사람에게만 붙인다(11-12 팀장 결정) — 위젯 글자가 한국어뿐이라 심사위원 화면(영어)에 섞이지 않게.
 * `?feedback=1` 로 한 번 오면 이 브라우저에 기억하고, `?feedback=0` 이면 지운다.
 */
const OPT_IN_PARAM = 'feedback';
const OPT_IN_STORAGE_KEY = 'fairsplit:feedback';
const OPT_IN_VALUE = '1';

function isFeedbackOptedIn(): boolean {
  const param = new URLSearchParams(window.location.search).get(OPT_IN_PARAM);
  try {
    if (param === OPT_IN_VALUE) window.localStorage.setItem(OPT_IN_STORAGE_KEY, OPT_IN_VALUE);
    else if (param === '0') window.localStorage.removeItem(OPT_IN_STORAGE_KEY);
    return window.localStorage.getItem(OPT_IN_STORAGE_KEY) === OPT_IN_VALUE;
  } catch {
    // 저장소가 막힌 브라우저(사생활 모드 등)는 이번 주소의 값만 본다
    return param === OPT_IN_VALUE;
  }
}

export function FeedbackMount() {
  if (!FeedbackWidget) return null;
  if (!FEEDBACK_HOSTS.includes(window.location.hostname)) return null;
  if (!isFeedbackOptedIn()) return null;
  return (
    <Suspense fallback={null}>
      <FeedbackWidget endpoint={ENDPOINT} token={TOKEN} />
    </Suspense>
  );
}
