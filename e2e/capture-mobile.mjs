// 모바일 한 턴(11-12) — 운영(또는 지정한 주소)을 390×844 로 찍는다. 첫 화면(뷰포트) + 전체 길이 둘 다.
//   node e2e/capture-mobile.mjs <base> <outDir> [prefix] [apiOrigin]  — apiOrigin 을 주면 /api/* 를 그 서버로 넘긴다(로컬 화면 + 운영 데이터)
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [base = 'https://fairsplit.solhun.com', outDir = '/tmp', prefix = 'm', api = ''] = process.argv.slice(2);
const SCREENS = [
  { name: 'landing', path: '/', ready: (p) => p.getByRole('region', { name: 'Example split' }).waitFor() },
  { name: 'fund', path: '/p/31c064d0bb7e', ready: (p) => p.getByRole('button', { name: /PayPal/ }).first().waitFor() },
  { name: 'decide', path: '/p/5d69abc2abb9', ready: (p) => p.getByRole('heading', { name: /Proposed split/ }).waitFor() },
  { name: 'paid', path: '/p/797aad12a5a3', ready: (p) => p.getByRole('heading', { name: /Payout receipt/ }).waitFor({ timeout: 20_000 }) },
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'en-US', reducedMotion: 'reduce' });
if (api) {
  await ctx.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    const res = await route.fetch({ url: `${api}${u.pathname}${u.search}` });
    await route.fulfill({ response: res });
  });
}
const out = {};
for (const s of SCREENS) {
  const page = await ctx.newPage();
  await page.goto(`${base}${s.path}`);
  try { await s.ready(page); } catch (e) { out[s.name] = { error: e.message.slice(0, 120) }; }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/${prefix}-${s.name}.png` });
  await page.screenshot({ path: `${outDir}/${prefix}-${s.name}-full.png`, fullPage: true });
  out[s.name] = { ...(out[s.name] ?? {}), overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), height: await page.evaluate(() => document.documentElement.scrollHeight) };
  await page.close();
}
writeFileSync(`${outDir}/${prefix}-capture.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
await browser.close();
