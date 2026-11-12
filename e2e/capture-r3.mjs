// 3회차 증거 — 이 브랜치 화면(로컬)에서 `/api/*` 를 지정한 서버로 넘겨 실제 데이터로 찍는다.
//   node e2e/capture-r3.mjs <localBase> <apiOrigin> <outDir> <screens: landing,live,weak,import> [liveProjectId]
// weak: 새 시연 프로젝트 → AI 제안 → 「Try a weak dispute」 → 실제 AI 답을 찍고 프로젝트 JSON 을 남긴다(지어내지 않는다).
// import: /new 예시 그대로 「Create project」 → 새 프로젝트 화면(apiOrigin 에 POST /api/projects 가 있어야 한다).
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [local, api, outDir, which = 'landing,live,weak,import', liveId = '4f6a8d4cdc3f'] = process.argv.slice(2);
const screens = new Set(which.split(','));
const AI_WAIT_MS = 45_000;
const WIDTHS = [
  { w: 1440, h: 900, phone: false },
  { w: 390, h: 844, phone: true },
];

const browser = await chromium.launch();
const results = {};
async function context(width) {
  const ctx = await browser.newContext({ viewport: { width: width.w, height: width.h }, isMobile: width.phone, hasTouch: width.phone, deviceScaleFactor: width.phone ? 2 : 1, locale: 'en-US', reducedMotion: 'reduce' });
  await ctx.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    const res = await route.fetch({ url: `${api}${u.pathname}${u.search}` });
    await route.fulfill({ response: res });
  });
  return ctx;
}
const shot = (page, name, w, full = false) => page.screenshot({ path: `${outDir}/s2r3-${w}-${name}.png`, fullPage: full });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

try {
  // 약한 이의는 한 번만 실제로 건다 — 두 폭은 같은 프로젝트를 다시 연다
  let weakId = null;
  for (const width of WIDTHS) {
    const ctx = await context(width);
    const page = await ctx.newPage();
    const w = width.w;

    if (screens.has('landing')) {
      await page.goto(`${local}/`);
      await page.getByRole('region', { name: 'Example split' }).waitFor();
      await shot(page, 'landing', w);
      results[`landing-${w}`] = { overflow: await overflow(page) };
    }

    if (screens.has('live')) {
      await page.goto(`${local}/p/${liveId}`);
      await page.getByRole('heading', { name: /Payout receipt|PayPal is sending/ }).waitFor({ timeout: 20_000 });
      await shot(page, 'project-live', w);
      results[`live-${w}`] = { overflow: await overflow(page), sampleBadge: await page.getByText('Sample data').count() };
    }

    if (screens.has('weak')) {
      if (!weakId) {
        await page.goto(`${local}/`);
        await page.getByRole('button', { name: 'Try the demo' }).click();
        await page.waitForURL(/\/p\/[^/]+$/);
        weakId = new URL(page.url()).pathname.split('/').pop();
        let t = Date.now();
        await page.getByRole('button', { name: 'Ask AI to propose a split' }).click();
        await page.getByRole('heading', { name: /Proposed split/ }).waitFor({ timeout: AI_WAIT_MS });
        const proposeMs = Date.now() - t;
        await page.getByRole('button', { name: /Try a weak dispute/ }).click();
        t = Date.now();
        await page.getByRole('button', { name: 'Send dispute' }).click();
        await page.getByRole('heading', { name: /Proposed split/ }).filter({ hasText: 'v2' }).waitFor({ timeout: AI_WAIT_MS });
        const project = await page.evaluate(async (id) => (await fetch(`/api/projects/${id}`)).json(), weakId);
        writeFileSync(`${outDir}/s2r3-weak-dispute.json`, JSON.stringify(project, null, 2));
        const pct = (p) => Object.fromEntries((p?.shares ?? []).map((s) => [s.contributorId, s.percent]));
        results.weak = { projectId: weakId, proposeMs, disputeMs: Date.now() - t, v1: pct(project.history.at(-1)), v2: pct(project.proposal), by: project.proposal.by, answer: project.disputes.at(-1)?.answer };
      } else {
        await page.goto(`${local}/p/${weakId}`);
      }
      await page.getByRole('note').first().waitFor();
      await page.getByRole('note').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -140));
      await page.waitForTimeout(400);
      await shot(page, 'dispute-weak', w);
      results[`weak-${w}`] = { overflow: await overflow(page) };
    }

    if (screens.has('import')) {
      await page.goto(`${local}/new`);
      await page.getByRole('button', { name: 'Create project' }).waitFor();
      results[`import-form-${w}`] = { overflow: await overflow(page) };
      await shot(page, 'import-form', w);
      await page.getByRole('button', { name: 'Create project' }).click();
      await page.waitForURL(/\/p\/[^/]+$/, { timeout: 15_000 });
      await page.getByText('Podcast episode 12').first().waitFor();
      // 만든 프로젝트로 실제 AI 제안까지 — 「가져온 로그로도 근거 달린 분배가 나온다」
      const t = Date.now();
      await page.getByRole('button', { name: 'Ask AI to propose a split' }).click();
      await page.getByRole('heading', { name: /Proposed split/ }).waitFor({ timeout: AI_WAIT_MS });
      results[`import-propose-${w}`] = { ms: Date.now() - t, rule: await page.getByText('Rule-based fallback').count() };
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, 'import', w);
      results[`import-${w}`] = { overflow: await overflow(page), projectId: new URL(page.url()).pathname.split('/').pop() };
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${outDir}/s2r3-capture-${which.replace(/,/g, '-')}.json`, JSON.stringify({ local, api, at: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify(results, null, 1));
}
