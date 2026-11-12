import { lazy, Suspense } from 'react';

/**
 * 피드백 버튼(라쏘런 feedback-kit)의 관문 — 부착 타입 `global`(허용 호스트형). 공개 서비스라 방문자가 곧 제보자다.
 * 호스트를 늘리려면 라쏘런 소스 <앱>-web 의 허용 호스트부터 넓힌다 — 안 그러면 버튼은 뜨는데 보내면 403 이다.
 */
const FEEDBACK_HOSTS: readonly string[] = ['localhost'];

const ENDPOINT = import.meta.env.VITE_DP_FEEDBACK_URL ?? '';
const TOKEN = import.meta.env.VITE_DP_FEEDBACK_KEY ?? '';

// 조건 안에 import 를 둔다 — 값이 비면 위젯 조각이 번들에서 빠져 첫 화면이 가벼워진다.
const FeedbackWidget = ENDPOINT && TOKEN ? lazy(() => import('./FeedbackWidget')) : null;

export function FeedbackMount() {
  if (!FeedbackWidget) return null;
  if (!FEEDBACK_HOSTS.includes(window.location.hostname)) return null;
  return (
    <Suspense fallback={null}>
      <FeedbackWidget endpoint={ENDPOINT} token={TOKEN} />
    </Suspense>
  );
}
