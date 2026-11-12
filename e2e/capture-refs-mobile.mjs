// 모바일 한 턴(11-12) — 레퍼런스 사이트 첫 화면을 390×844 로 찍는다(공개 페이지만, robots 판정 통과한 것만 넘긴다).
//   node e2e/capture-refs-mobile.mjs <outDir> <slug=url> ...
import { chromium } from '@playwright/test';
const [outDir, ...pairs] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'en-US' });
for (const pair of pairs) {
  const [slug, url] = pair.split('=');
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${outDir}/ref-${slug}.png` });
    console.log('ok', slug);
  } catch (e) { console.log('fail', slug, e.message.slice(0, 80)); }
  await page.close();
}
await browser.close();
