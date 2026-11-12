import { describe, expect, it } from 'vitest';
import { makeDemoProject } from './demo';
import { applyProposal, approve, assertCanFund, assertCanPropose, FlowError, invariantErrors, markCaptured, markFunded, markPaying, openDispute, startFunding, updatePayout } from './flow';
import { ruleProposal } from './split';

const NOW = '2026-11-12T00:00:00Z';
const fresh = () => makeDemoProject('t1', NOW);
const code = (fn: () => unknown): string | undefined => {
  try { fn(); } catch (e) { return e instanceof FlowError ? e.code : 'OTHER'; }
  return undefined;
};

function funded() {
  const p = fresh();
  startFunding(p, 'O1', 'PAYER_ACTION_REQUIRED', NOW);
  markFunded(p, 'O1', 'COMPLETED', 'A1', NOW);
  return p;
}

describe('상태 기계', () => {
  it('draft → funded → proposed → disputed → proposed(v2) → agreed → paying → paid', () => {
    const p = funded();
    expect(p.status).toBe('funded');
    applyProposal(p, ruleProposal(p, 1, NOW), NOW);
    expect(p.status).toBe('proposed');
    approve(p, 'mina', NOW);
    openDispute(p, 'sora', 'my two re-recordings were not counted', 'd1', NOW);
    expect(p.status).toBe('disputed');
    applyProposal(p, ruleProposal(p, 2, NOW), NOW);
    expect(p.status).toBe('proposed');
    expect(p.approvals).toEqual({}); // 판이 바뀌면 동의 비움
    expect(p.history.map((h) => h.version)).toEqual([1]);
    expect(p.disputes[0].answeredInVersion).toBe(2);
    expect(approve(p, 'mina', NOW)).toBe(false);
    expect(approve(p, 'jun', NOW)).toBe(false);
    expect(p.payout).toBeUndefined();
    expect(approve(p, 'sora', NOW)).toBe(true);
    expect(p.status).toBe('agreed');
    markCaptured(p, 'C1', NOW);
    markPaying(p, 'B1', 'PENDING', [], NOW);
    expect(p.status).toBe('paying');
    updatePayout(p, 'PENDING', [], NOW);
    expect(p.status).toBe('paying');
    updatePayout(p, 'SUCCESS', [], NOW);
    expect(p.status).toBe('paid');
    expect(invariantErrors(p)).toEqual([]);
  });

  it('결제 승인 없이도 제안·이의·동의 2명까지는 간다 — 마지막 동의는 409 FUNDING_REQUIRED 이고 기록되지 않는다', () => {
    const p = fresh();
    startFunding(p, 'O1', 'PAYER_ACTION_REQUIRED', NOW);
    assertCanPropose(p);
    applyProposal(p, ruleProposal(p, 1, NOW), NOW);
    approve(p, 'mina', NOW);
    approve(p, 'jun', NOW);
    expect(code(() => approve(p, 'sora', NOW))).toBe('FUNDING_REQUIRED');
    expect(p.approvals.sora).toBeUndefined();
    expect(p.status).toBe('proposed');
    // 승인이 들어오면 상태는 proposed 그대로 두고 마지막 동의가 통과한다.
    markFunded(p, 'O1', 'COMPLETED', 'A1', NOW);
    expect(p.status).toBe('proposed');
    expect(approve(p, 'sora', NOW)).toBe(true);
  });

  it('전이 밖 호출은 409 류 오류', () => {
    const p = fresh();
    expect(code(() => openDispute(p, 'sora', 'x', 'd1', NOW))).toBe('BAD_STATE'); // 제안 전 이의
    expect(code(() => approve(p, 'sora', NOW))).toBe('BAD_STATE'); // 제안 전 동의
    expect(code(() => markCaptured(p, 'C', NOW))).toBe('BAD_STATE');
    expect(code(() => markPaying(p, 'B', 'PENDING', [], NOW))).toBe('BAD_STATE');
    expect(code(() => updatePayout(p, 'SUCCESS', [], NOW))).toBe('BAD_STATE');
    const f = funded();
    expect(code(() => assertCanFund(f))).toBe('ALREADY_FUNDED');
    applyProposal(f, ruleProposal(f, 1, NOW), NOW);
    expect(code(() => assertCanPropose(f))).toBe('ALREADY_PROPOSED');
    openDispute(f, 'sora', 'x', 'd1', NOW);
    expect(code(() => approve(f, 'sora', NOW))).toBe('BAD_STATE'); // 이의 중엔 동의 못 함
    expect(code(() => openDispute(f, 'jun', 'y', 'd2', NOW))).toBe('BAD_STATE');
  });

  it('없는 기여자·빈 이의·다른 주문은 400', () => {
    const p = funded();
    applyProposal(p, ruleProposal(p, 1, NOW), NOW);
    expect(code(() => approve(p, 'nobody', NOW))).toBe('UNKNOWN_CONTRIBUTOR');
    expect(code(() => openDispute(p, 'sora', '   ', 'd1', NOW))).toBe('EMPTY_DISPUTE');
    const q = fresh();
    startFunding(q, 'O1', 'X', NOW);
    expect(code(() => markFunded(q, 'O2', 'COMPLETED', 'A', NOW))).toBe('ORDER_MISMATCH');
  });

  it('같은 사람이 두 번 동의해도 한 번으로 센다', () => {
    const p = funded();
    applyProposal(p, ruleProposal(p, 1, NOW), NOW);
    approve(p, 'mina', NOW);
    approve(p, 'mina', NOW);
    expect(Object.keys(p.approvals)).toEqual(['mina']);
    expect(p.events.filter((e) => e.text.startsWith('Mina approved')).length).toBe(1);
  });

  it('불변식 검사가 깨진 판을 잡는다', () => {
    const p = funded();
    const prop = ruleProposal(p, 1, NOW);
    prop.shares[0].percent += 1;
    prop.shares[0].reasons[0].eventIds.push('e99');
    applyProposal(p, prop, NOW);
    p.approvals.mina = { at: NOW, version: 0 };
    const errs = invariantErrors(p).join(' | ');
    expect(errs).toContain('percent 합 101');
    expect(errs).toContain('e99');
    expect(errs).toContain('지난 판');
  });
});
