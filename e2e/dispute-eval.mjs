// 이의 실측 — 실제 Claude 가 도는 서버(로컬 wrangler dev 권장)에 시연 프로젝트를 새로 만들고 제안 → 이의를 N번 돌린다.
// 약한 이의(Jun 70%)는 몫이 그대로여야, 강한 이의(Sora 재녹음 2회)는 Sora 가 올라야 통과다.
//   node e2e/dispute-eval.mjs <apiOrigin> <out.json> [runs=3]
import { writeFileSync } from 'node:fs';

const [api = 'http://127.0.0.1:8790', out = 'test-results/disputes.json', runsArg = '3'] = process.argv.slice(2);
const RUNS = Number(runsArg);
function STRONG_EVIDENCE_TEXT() {
  return 'The client asked twice for a warmer voice (e08, e12). Each re-recording (e10, e12) redid the whole voiceover, and the final cut was approved on that voice (e15). v1 counts my minutes like any other minutes, not as client-requested rework that redid the deliverable.';
}
const CASES = [
  { name: 'weak', contributorId: 'jun', text: 'I should get 70% because editing is the hardest part.', expect: 'unchanged' },
  { name: 'strong', contributorId: 'sora', text: "My two re-recordings weren't counted.", expect: 'sora-up' },
  // 로그 줄을 짚는 이의 — 「셌다/안 셌다」가 아니라 무게(재작업·영향)를 근거 줄로 다툰다
  { name: 'strong-evidence', contributorId: 'sora', text: STRONG_EVIDENCE_TEXT(), expect: 'sora-up' },
].filter((c) => !process.env.CASES || process.env.CASES.split(',').includes(c.name));

async function call(method, path, body) {
  const res = await fetch(`${api}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const pct = (proposal) => Object.fromEntries(proposal.shares.map((s) => [s.contributorId, s.percent]));

const rows = [];
for (const c of CASES) {
  for (let run = 1; run <= RUNS; run += 1) {
    const p0 = await call('POST', '/api/demo/reset', { scenario: 'brand-short' });
    let t = Date.now();
    const p1 = await call('POST', `/api/projects/${p0.id}/propose`);
    const proposeMs = Date.now() - t;
    t = Date.now();
    const p2 = await call('POST', `/api/projects/${p0.id}/disputes`, { contributorId: c.contributorId, text: c.text });
    const disputeMs = Date.now() - t;
    const v1 = pct(p1.proposal);
    const v2 = pct(p2.proposal);
    const unchanged = Object.keys(v1).every((k) => v1[k] === v2[k]);
    const pass = c.expect === 'unchanged' ? unchanged : v2.sora > v1.sora;
    const row = {
      case: c.name, run, projectId: p0.id, pass,
      v1, v2, v1By: p1.proposal.by, v2By: p2.proposal.by,
      answer: p2.proposal.changedBecause ?? null,
      rejectedSubmits: (p2.proposal.steps ?? []).filter((s) => String(s.result).startsWith('rejected')).map((s) => s.result),
      proposeMs, disputeMs,
    };
    rows.push(row);
    console.log(`${c.name} #${run} ${pass ? 'PASS' : 'FAIL'} v1=${JSON.stringify(v1)} v2=${JSON.stringify(v2)} by=${row.v2By} ${disputeMs}ms rejected=${row.rejectedSubmits.length}`);
  }
}
const summary = Object.fromEntries(CASES.map((c) => [c.name, `${rows.filter((r) => r.case === c.name && r.pass).length}/${RUNS}`]));
writeFileSync(out, JSON.stringify({ api, measuredAt: new Date().toISOString(), model: 'claude-sonnet-5-5 (server MODEL)', rule: 'weak → shares unchanged · strong → Sora up', summary, rows }, null, 2));
console.log('summary', JSON.stringify(summary));
