// 증거 캡처 — fixture 로 v1 · v2 차이 · paid 를 390 · 1280 폭에서 찍는다.
// 쓰는 법: vite preview 를 띄운 뒤 `node e2e/capture.mjs <baseURL> <outDir>` (무거운 일이라 heavy-run 으로 감싼다)
import { chromium } from '@playwright/test';

const [base = 'http://127.0.0.1:4320', outDir = 'test-results/capture'] = process.argv.slice(2);
const WIDTHS = [
  { name: '390', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: '1280', viewport: { width: 1280, height: 860 } },
];

async function scrollTo(page, selector) {
  await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -70)); // 위 띠(sticky) 아래로
  await page.waitForTimeout(400);
}

const browser = await chromium.launch();
try {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: w.viewport, isMobile: w.isMobile, hasTouch: w.hasTouch, deviceScaleFactor: 2, locale: 'en-US', reducedMotion: 'reduce' });
    const page = await ctx.newPage();

    await page.goto(`${base}/p/sample?fixture=v1`);
    await page.getByTestId('share-sora').waitFor();
    await page.screenshot({ path: `${outDir}/s2-${w.name}-v1.png` });

    await page.goto(`${base}/p/sample?fixture=v2`);
    await page.getByTestId('share-sora').getByRole('button', { name: /e11/ }).click();
    if (w.name === '390') await scrollTo(page, '[data-testid="share-sora"]');
    else await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${outDir}/s2-${w.name}-v2-diff.png` });

    await page.goto(`${base}/p/sample?fixture=paid`);
    await page.getByTestId('payout-sora').waitFor();
    // 데스크톱은 맨 위(스텝퍼 + 영수증이 한 화면) · 폰은 영수증으로 내린다
    if (w.name === '390') await scrollTo(page, '.receipt');
    await page.screenshot({ path: `${outDir}/s2-${w.name}-paid.png` });
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log('captured 6');
