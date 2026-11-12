// 운영 API 실연결 확인 — 이 브랜치 화면(로컬 vite preview)을 띄우고 `/api/*` 만 운영 주소로 그대로 넘긴다.
// reset → propose → dispute(v2 차이) → 동의 3번(결제 승인이 없으면 마지막이 409 FUNDING_REQUIRED). 실제 Claude 를 부른다.
// 쓰는 법: `node e2e/live-check.mjs <localBase> <liveOrigin> <outDir>` (heavy-run --short 로 감싼다)
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [local = 'http://127.0.0.1:4320', live = 'https://fairsplit.solhun.com', outDir = 'test-results/live'] = process.argv.slice(2);
const AI_WAIT_MS = 45_000; // 서버가 20초에 규칙 제안으로 넘어가므로 넉넉히
const steps = [];
const log = (step, extra = {}) => {
  steps.push({ at: new Date().toISOString(), step, ...extra });
  console.log(step, JSON.stringify(extra));
};

const pct = async (page, id) => (await page.getByTestId(`share-${id}`).locator('.share-num .num').textContent())?.trim();

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const apiCalls = [];
  await ctx.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    const target = `${live}${u.pathname}${u.search}`;
    const res = await route.fetch({ url: target });
    apiCalls.push({ method: route.request().method(), path: u.pathname, status: res.status() });
    await route.fulfill({ response: res });
  });
  const page = await ctx.newPage();

  await page.goto(`${local}/`);
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.waitForURL(/\/p\/[^/]+$/);
  const projectId = new URL(page.url()).pathname.split('/').pop();
  log('reset', { projectId });
  await page.screenshot({ path: `${outDir}/s2r2-live-1-draft.png` });

  let t = Date.now();
  await page.getByRole('button', { name: 'Ask AI to propose a split' }).click();
  await page.getByRole('heading', { name: /Proposed split/ }).waitFor({ timeout: AI_WAIT_MS });
  const v1 = { mina: await pct(page, 'mina'), jun: await pct(page, 'jun'), sora: await pct(page, 'sora') };
  const v1Rule = await page.getByText('Rule-based fallback').count();
  log('propose', { ms: Date.now() - t, v1, ruleBased: v1Rule > 0 });
  await page.screenshot({ path: `${outDir}/s2r2-live-2-v1.png` });

  t = Date.now();
  await page.getByLabel('Viewing as').selectOption('sora');
  await page.getByLabel(/Something missing\? Tell the AI/).fill("My two re-recordings weren't counted.");
  await page.getByRole('button', { name: 'Send dispute' }).click();
  await page.getByRole('heading', { name: /Proposed split/ }).filter({ hasText: 'v2' }).waitFor({ timeout: AI_WAIT_MS });
  const v2 = { mina: await pct(page, 'mina'), jun: await pct(page, 'jun'), sora: await pct(page, 'sora') };
  const changedNote = await page.getByRole('note', { name: /What changed from v1/ }).count();
  const deltas = await page.locator('.delta').allTextContents();
  log('dispute', { ms: Date.now() - t, v2, changedNoteShown: changedNote > 0, deltas });
  await page.screenshot({ path: `${outDir}/s2r2-live-3-v2.png` });

  for (const [id, name] of [['mina', 'Mina'], ['jun', 'Jun'], ['sora', 'Sora']]) {
    await page.getByLabel('Viewing as').selectOption(id);
    await page.getByRole('button', { name: `Approve as ${name}` }).click();
    await page.waitForTimeout(1500);
  }
  const alert = (await page.getByRole('alert').allTextContents()).join(' | ');
  log('approve x3', { alert });
  await page.getByRole('alert').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${outDir}/s2r2-live-4-approve.png` });

  writeFileSync(`${outDir}/s2r2-live.json`, JSON.stringify({ local, live, projectId, steps, apiCalls }, null, 2));
} finally {
  await browser.close();
}
