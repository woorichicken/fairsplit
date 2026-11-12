// 공유 카드(og.png 1200×630) — 색은 src/styles/tokens.css 에서 읽고, 숫자는 기록된 AI 응답(samples/recorded-v2.json)에서 읽는다.
// 쓰는 법: `node e2e/make-og.mjs public/og.png` (heavy-run --short 로 감싼다)
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'public/og.png';
const css = readFileSync('src/styles/tokens.css', 'utf8');
const token = (name) => {
  const value = css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
  if (!value) throw new Error(`token --${name} not found`);
  return value;
};
const mark = readFileSync('public/logo/mark.svg', 'utf8');
const v2 = JSON.parse(readFileSync('src/ui/samples/recorded-v2.json', 'utf8'));
const v1 = v2.history.find((p) => p.version === v2.proposal.version - 1);

const rows = v2.proposal.shares
  .map((s) => {
    const who = v2.contributors.find((c) => c.id === s.contributorId);
    const was = v1?.shares.find((b) => b.contributorId === s.contributorId)?.percent;
    const delta = was !== undefined && was !== s.percent ? `<span class="${s.percent > was ? 'up' : 'down'}">${s.percent > was ? '▲' : '▼'} ${was}% → ${s.percent}%</span>` : '';
    return `<li><b>${who.name}</b><i>${who.role}</i>${delta}<em>${s.percent}% · $${s.amount.value}</em></li>`;
  })
  .join('');

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;background:${token('page')};color:${token('ink')};font-family:Inter,system-ui,sans-serif;display:grid;grid-template-columns:1fr 470px;gap:48px;padding:64px;align-items:center}
.brand{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:500}
.brand svg{width:56px;height:56px}
h1{font-size:58px;line-height:1.12;font-weight:300;letter-spacing:-0.02em;margin:36px 0 22px}
p{font-size:24px;line-height:1.4;color:${token('ink-2')}}
.card{background:${token('surface')};border:1px solid ${token('hair')};border-radius:10px;padding:26px;box-shadow:${token('shadow-float')}}
.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.head strong{font-size:28px;font-weight:300}
.badge{font:500 15px ui-monospace,monospace;color:${token('ai-ink')};background:${token('ai-bg')};border:1px solid ${token('ai-line')};border-radius:999px;padding:5px 12px}
ul{list-style:none;padding:0;display:grid;gap:10px}
li{display:grid;grid-template-columns:1fr auto;grid-template-areas:'n e' 'r e' 'd d';border:1px solid ${token('hair')};border-radius:8px;padding:12px 16px;font-size:20px}
li b{grid-area:n;font-weight:500} li i{grid-area:r;font-style:normal;color:${token('ink-2')};font-size:17px}
li em{grid-area:e;font-style:normal;font-weight:500;font-size:22px;align-self:center}
li span{grid-area:d;font-size:17px;font-weight:500;margin-top:4px}
.up{color:${token('ai-change-up')}} .down{color:${token('ai-change-down')}}
.foot{margin-top:14px;font-size:16px;color:${token('ink-3')}}
</style></head><body>
<div><div class="brand">${mark}FairSplit</div>
<h1>One PayPal payment, split by the work everyone actually did.</h1>
<p>AI proposes each share with evidence. Anyone can dispute. PayPal sends the payouts when everyone agrees.</p></div>
<div class="card"><div class="head"><strong>Proposed split v${v2.proposal.version}</strong><span class="badge">AI proposal</span></div>
<ul>${rows}</ul><div class="foot">$${v2.budget.value} · recorded demo answer after a dispute</div></div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.screenshot({ path: out });
} finally {
  await browser.close();
}
console.log(`og → ${out}`);
