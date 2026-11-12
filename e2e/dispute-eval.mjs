// 이의 실측 — 실제 Claude 가 도는 서버(로컬 wrangler dev 권장)에서 시연 이야기를 N번 돌린다(5회차).
//   1) AI v1 → 2) Jun 약한 이의(몫 그대로여야) → 3) Sora 가 빠진 작업을 붙인 이의(Sora 가 올라야) → 4) Jun 이 같은 판에 또 이의(409 DISPUTE_LIMIT 여야)
//   node e2e/dispute-eval.mjs <apiOrigin> <out.json> [runs=3] [snapshotDir]
// snapshotDir 를 주면 1번째 실행의 단계별 Project 를 story-1.json(v1)·story-2.json(약한 이의 뒤)·story-3.json(빠진 작업 뒤) 로 남긴다(화면 fixture 용).
import { writeFileSync } from 'node:fs';

const [api = 'http://127.0.0.1:8790', out = 'test-results/disputes.json', runsArg = '3', snapshotDir] = process.argv.slice(2);
const RUNS = Number(runsArg);
const WEAK = { contributorId: 'jun', text: 'I should get 70% because editing is the hardest part.' };
// 날짜는 로그와 맞아야 한다 — e12(재녹음 2, 11-06 14:00Z) 뒤 · e13(최종 편집, 11-06 17:30Z) 앞. 지시문 예시(11-08)는 의뢰인 최종 승인(e15, 11-07) 뒤라 AI 가 모순으로 거절했다(5회차 1차 실측).
const MISSING = {
  contributorId: 'sora',
  text: "Re-recording 3 wasn't logged: after Re-recording 2 (e12) I recorded pickup lines for the closing line, and they went into the final cut (e13).",
  missingWork: { kind: 'recording', title: 'Re-recording 3 — pickup lines for the closing line', minutes: 22, at: '2026-11-06T15:20:00Z' },
};

async function call(method, path, body) {
  const res = await fetch(`${api}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  return { status: res.status, data };
}
async function ok(method, path, body) {
  const r = await call(method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
const pct = (proposal) => Object.fromEntries(proposal.shares.map((s) => [s.contributorId, s.percent]));
const same = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

const rows = [];
for (let run = 1; run <= RUNS; run += 1) {
  const p0 = await ok('POST', '/api/demo/reset', { scenario: 'brand-short' });
  const id = p0.id;
  const p1 = await ok('POST', `/api/projects/${id}/propose`);
  let t = Date.now();
  const p2 = await ok('POST', `/api/projects/${id}/disputes`, WEAK);
  const weakMs = Date.now() - t;
  t = Date.now();
  const p3 = await ok('POST', `/api/projects/${id}/disputes`, MISSING);
  const missingMs = Date.now() - t;
  // v3 은 Sora 이의에 대한 답 — Sora 가 또 걸면 409 DISPUTE_LIMIT 여야
  const again = await call('POST', `/api/projects/${id}/disputes`, { contributorId: 'sora', text: 'One more time.' });
  const [v1, v2, v3] = [pct(p1.proposal), pct(p2.proposal), pct(p3.proposal)];
  const added = p3.log.find((e) => e.source === 'dispute');
  const row = {
    run, projectId: id,
    weak: { pass: same(v1, v2), v1, v2, by: p2.proposal.by, answer: p2.proposal.changedBecause ?? null, ms: weakMs },
    missing: { pass: v3.sora > v2.sora, v2, v3, by: p3.proposal.by, answer: p3.proposal.changedBecause ?? null, addedEvent: added ?? null, citesAdded: added ? new RegExp(`\\b${added.id}\\b`).test(p3.proposal.changedBecause ?? '') : false, ms: missingMs },
    limit: { pass: again.status === 409 && again.data?.error?.code === 'DISPUTE_LIMIT', status: again.status, code: again.data?.error?.code, message: again.data?.error?.message },
  };
  rows.push(row);
  console.log(`#${run} weak ${row.weak.pass ? 'PASS' : 'FAIL'} ${JSON.stringify(v1)}→${JSON.stringify(v2)} · missing ${row.missing.pass ? 'PASS' : 'FAIL'} →${JSON.stringify(v3)} cites ${added?.id}=${row.missing.citesAdded} · limit ${row.limit.pass ? 'PASS' : 'FAIL'} ${row.limit.status}`);
  if (snapshotDir && run === 1) {
    writeFileSync(`${snapshotDir}/story-1.json`, JSON.stringify(p1));
    writeFileSync(`${snapshotDir}/story-2.json`, JSON.stringify(p2));
    writeFileSync(`${snapshotDir}/story-3.json`, JSON.stringify(p3));
  }
}
const count = (k) => `${rows.filter((r) => r[k].pass).length}/${RUNS}`;
const summary = { weakUnchanged: count('weak'), missingWorkSoraUp: count('missing'), secondDisputeBlocked: count('limit') };
writeFileSync(out, JSON.stringify({ api, measuredAt: new Date().toISOString(), server: 'local wrangler dev + real Claude (MODEL in worker/split.ts)', summary, weakDispute: WEAK, missingWorkDispute: MISSING, rows }, null, 2));
console.log('summary', JSON.stringify(summary));
