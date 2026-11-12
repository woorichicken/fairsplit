import { useEffect, useMemo, useState } from 'react';
import { buildReport, createLassoAdapter, FeedbackQueue, sharedDiagnostics, uuidv4, type ReportParts } from '@solhun/feedback-kit-core';
import { captureWebScreenshot, createWebStorage, FeedbackKit as Widget, webContextProviders, webDiagnosticsOptions } from '@solhun/feedback-kit-web';

export default function FeedbackWidget({ endpoint, token }: { endpoint: string; token: string }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 위젯 자신의 전송은 뺀다 — 안 그러면 다음 제보의 진단이 자기 요청으로 채워진다.
    sharedDiagnostics.install(webDiagnosticsOptions({ excludeMatcher: (req) => req.url.startsWith(endpoint) }));
    setReady(true);
    return () => sharedDiagnostics.uninstall();
  }, [endpoint]);

  // 한 번만 만든다 — 지도가 다시 그려져도 쓰던 글이 사라지지 않게
  const wiring = useMemo(() => {
    const storage = createWebStorage();
    const sessionId = uuidv4();
    return {
      queue: new FeedbackQueue({ storage, adapter: createLassoAdapter({ endpoint, token }) }),
      createReport: (parts: ReportParts) =>
        buildReport(parts, {
          app: 'fairsplit-web',
          platform: 'web',
          sessionId,
          storage,
          // 빼면 url 이 빈 문자열이 되어 400 — 재시도도 안 돼서 제보가 버려진다.
          ...webContextProviders(),
          getDiagnostics: () => sharedDiagnostics.snapshot(),
        }),
      getPathname: () => window.location.pathname,
    };
  }, [endpoint, token]);

  if (!ready) return null;
  return (
    <Widget
      queue={wiring.queue}
      createReport={wiring.createReport}
      capture={captureWebScreenshot}
      getPathname={wiring.getPathname}
      defaultMode="pick"
    />
  );
}
