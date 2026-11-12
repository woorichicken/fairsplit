// 증거 캡처 — fixture 로 화면을 폭마다 찍고 가로 넘침을 잰다.
// 쓰는 법: vite preview 를 띄운 뒤 `node e2e/capture.mjs <baseURL> <outDir>` (heavy-run 으로 감싼다)
// 결과: <outDir>/s2r2-<폭>-<화면>.png + <outDir>/s2r2-responsive.json(폭·화면별 scrollWidth/clientWidth · 넘친 요소)
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [base = 'http://127.0.0.1:4320', outDir = 'test-results/capture'] = process.argv.slice(2);
const WIDTHS = [390, 768, 1280, 1440];
const HEIGHT = 900;

const SCREENS = [
  { name: 'landing', url: '/?fixture=v2', ready: async (page) => page.getByRole('region', { name: 'Example split' }).waitFor() },
  {
    name: 'project-v2',
    url: '/p/sample?fixture=v2',
    ready: async (page) => {
      await page.getByTestId('share-sora').getByRole('button', { name: /e10/ }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
    },
  },
  { name: 'project-paid', url: '/p/sample?fixture=paid', ready: async (page) => page.getByTestId('payout-sora').waitFor() },
];

// 문서가 가로로 넘치는지 + 화면 밖으로 삐져나간 요소 목록(넘침 원인 찾기용)
const measure = () => {
  const doc = document.documentElement;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > doc.clientWidth + 1 || r.left < -1)) out.push(`${el.tagName.toLowerCase()}.${el.className || ''} ${Math.round(r.left)}→${Math.round(r.right)}`);
  }
  return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overflow: doc.scrollWidth > doc.clientWidth, offenders: out.slice(0, 10) };
};

const browser = await chromium.launch();
const report = [];
try {
  for (const width of WIDTHS) {
    const phone = width < 600;
    const ctx = await browser.newContext({ viewport: { width, height: HEIGHT }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, locale: 'en-US', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    for (const s of SCREENS) {
      await page.goto(`${base}${s.url}`);
      await s.ready(page);
      await page.waitForTimeout(500);
      const m = await page.evaluate(measure);
      const file = `${outDir}/s2r2-${width}-${s.name}.png`;
      await page.screenshot({ path: file, fullPage: s.name === 'landing' });
      report.push({ width, screen: s.name, ...m, shot: file });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(`${outDir}/s2r2-responsive.json`, JSON.stringify({ measured: new Date().toISOString(), cases: report }, null, 2));
console.log(report.map((r) => `${r.width} ${r.screen} overflow=${r.overflow} ${r.scrollWidth}/${r.clientWidth} ${r.offenders.join(' | ')}`).join('\n'));
