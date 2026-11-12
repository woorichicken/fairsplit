import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { makeDemoProject } from './demo';
import { applyProposal, invariantErrors, openDispute } from './flow';
import { aiProposal, MAX_ROUNDS, propose, ruleProposal, validateSubmission, type CreateFn } from './split';

type Msg = Anthropic.Beta.Messages.BetaMessage;
const NOW = '2026-11-12T00:00:00Z';
const project = () => makeDemoProject('t1', NOW);

const good = {
  summary: 'Split by logged work.',
  shares: [
    { contributorId: 'mina', percent: 35, reasons: [{ text: 'Wrote script v1-v3', eventIds: ['e02', 'e04', 'e05'] }] },
    { contributorId: 'jun', percent: 45, reasons: [{ text: 'Four edit rounds', eventIds: ['e07', 'e09', 'e11', 'e13'] }] },
    { contributorId: 'sora', percent: 20, reasons: [{ text: 'Voiceover', eventIds: ['e06'] }] },
  ],
};

/** 가짜 모델 — 각 라운드에 돌려줄 tool_use 목록을 순서대로 준다. */
function fakeModel(rounds: { name: string; input: unknown }[][]): { create: CreateFn; calls: () => number } {
  let n = 0;
  const create: CreateFn = async () => {
    const blocks = rounds[Math.min(n, rounds.length - 1)];
    n += 1;
    return { id: `m${n}`, type: 'message', role: 'assistant', model: 'fake-model', stop_reason: blocks.length ? 'tool_use' : 'end_turn', content: blocks.map((b, i) => ({ type: 'tool_use', id: `t${n}_${i}`, name: b.name, input: b.input })) } as unknown as Msg;
  };
  return { create, calls: () => n };
}

describe('submit 검증 (AI 없이)', () => {
  it('정상 제안은 통과하고 기여자 순서로 정렬된다', () => {
    const v = validateSubmission(project(), { ...good, shares: [...good.shares].reverse() });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.shares.map((s) => s.contributorId)).toEqual(['mina', 'jun', 'sora']);
  });
  it.each([
    ['합 ≠ 100', { ...good, shares: good.shares.map((s, i) => (i === 0 ? { ...s, percent: 36 } : s)) }, 'add up to 101'],
    ['없는 eventId', { ...good, shares: good.shares.map((s, i) => (i === 2 ? { ...s, reasons: [{ text: 'x', eventIds: ['e99'] }] } : s)) }, 'e99'],
    ['기여자 빠짐', { ...good, shares: good.shares.slice(0, 2).map((s, i) => (i === 0 ? { ...s, percent: 55 } : s)) }, 'Missing contributors: sora'],
    ['기여자 두 번', { ...good, shares: [...good.shares, good.shares[0]] }, 'more than once'],
    ['소수 percent', { ...good, shares: good.shares.map((s, i) => (i === 0 ? { ...s, percent: 34.5 } : i === 1 ? { ...s, percent: 45.5 } : s)) }, 'whole number'],
    ['근거 없음', { ...good, shares: good.shares.map((s, i) => (i === 0 ? { ...s, reasons: [] } : s)) }, 'reasons'],
    ['근거에 eventId 없음', { ...good, shares: good.shares.map((s, i) => (i === 0 ? { ...s, reasons: [{ text: 'x', eventIds: [] }] } : s)) }, 'cite at least one'],
    ['요약 없음', { ...good, summary: ' ' }, 'summary'],
  ])('%s → 거부', (_n, input, msg) => {
    const v = validateSubmission(project(), input);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain(msg);
  });
  it('이의가 열려 있으면 changedBecause 가 있어야 한다', () => {
    const p = project();
    applyProposal(p, ruleProposal(p, 1, NOW), NOW);
    openDispute(p, 'sora', 'my two re-recordings were not counted', 'd1', NOW);
    expect(validateSubmission(p, good).ok).toBe(false);
    expect(validateSubmission(p, { ...good, changedBecause: 'Found e10 and e12.' }).ok).toBe(true);
  });
});

describe('규칙 제안', () => {
  it('불변식: 합 100 · 금액 합 = 예산 · 전원 한 번 · eventId 는 로그에 있다', () => {
    const p = project();
    const prop = ruleProposal(p, 1, NOW);
    expect(prop.by).toBe('rule');
    applyProposal(p, prop, NOW);
    expect(invariantErrors(p)).toEqual([]);
    expect(prop.shares.every((s) => s.reasons.length > 0)).toBe(true);
  });
  it('가중치 × 분 — 로그를 바꾸면 결과도 바뀐다(하드코딩 아님)', () => {
    const p = project();
    const before = ruleProposal(p, 1, NOW).shares.find((s) => s.contributorId === 'sora')!.percent;
    p.log.push({ id: 'e16', at: NOW, actor: 'sora', kind: 'recording', title: 'extra take', minutes: 120 });
    expect(ruleProposal(p, 1, NOW).shares.find((s) => s.contributorId === 'sora')!.percent).toBeGreaterThan(before);
  });
});

describe('AI 루프', () => {
  it('로그를 읽고 submit → by:ai, 금액은 서버가 계산', async () => {
    const m = fakeModel([[{ name: 'list_log_events', input: {} }], [{ name: 'submit_proposal', input: good }]]);
    const r = await aiProposal(project(), 1, NOW, m.create);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.by).toBe('ai');
      expect(r.proposal.shares.map((s) => s.amount.value)).toEqual(['210.00', '270.00', '120.00']);
      expect(r.proposal.steps?.[0].tool).toBe('list_log_events');
    }
  });
  it('submit 검증 실패 1번 → 오류를 돌려주고 고친 판을 받는다', async () => {
    const bad = { ...good, shares: good.shares.map((s, i) => (i === 0 ? { ...s, percent: 50 } : s)) };
    const m = fakeModel([[{ name: 'submit_proposal', input: bad }], [{ name: 'submit_proposal', input: good }]]);
    const r = await aiProposal(project(), 1, NOW, m.create);
    expect(r.ok).toBe(true);
    expect(m.calls()).toBe(2);
  });
  it('검증 2회 실패 → 규칙 제안', async () => {
    const bad = { ...good, summary: '' };
    const m = fakeModel([[{ name: 'submit_proposal', input: bad }]]);
    const { proposal, aiFailure } = await propose(project(), NOW, m.create);
    expect(proposal.by).toBe('rule');
    expect(aiFailure).toContain('rejected 2');
  });
  it('도구만 끝없이 부르는 모델도 상한에서 멈추고 규칙으로', async () => {
    const m = fakeModel([[{ name: 'list_log_events', input: { actor: 'sora' } }]]);
    const { proposal } = await propose(project(), NOW, m.create);
    expect(m.calls()).toBe(MAX_ROUNDS);
    expect(proposal.by).toBe('rule');
  });
  it('시간 초과 → 규칙', async () => {
    const slow: CreateFn = (_p, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
    const r = await aiProposal(project(), 1, NOW, slow, 'x', 30);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('timed out');
  });
  it('모델 오류·키 없음 → 규칙', async () => {
    const boom: CreateFn = async () => { throw new Error('down'); };
    expect((await propose(project(), NOW, boom)).proposal.by).toBe('rule');
    expect((await propose(project(), NOW, undefined)).proposal.by).toBe('rule');
  });
  it('없는 도구를 불러도 죽지 않는다', async () => {
    const m = fakeModel([[{ name: 'nope', input: {} }], [{ name: 'submit_proposal', input: good }]]);
    const r = await aiProposal(project(), 1, NOW, m.create);
    expect(r.ok).toBe(true);
  });
});
