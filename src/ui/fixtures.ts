import type { Dispute, PayoutItem, Project, Proposal } from '../shared/types';
import type { Api, FundStart } from './api';
import recordedV1 from './samples/recorded-v1.json' with { type: 'json' };
import recordedV2 from './samples/recorded-v2.json' with { type: 'json' };
import recordedWeak from './samples/recorded-weak.json' with { type: 'json' };

/**
 * 가짜 흐름 — 서버 없이 화면·E2E·캡처를 돌리려고 둔다. `?fixture=draft|v1|v2|paid` 로 켠다.
 * 분배 숫자는 지어내지 않았다: samples/recorded-v*.json 은 S1 이 운영 엔진으로 실제 Claude 를 불러 받은 응답
 * (team/evidence/s1-ai-03-propose.json · s1-ai-04-dispute.json) 그대로다. 결제·송금 부분(order·payout id)만 「SAMPLE-」 가짜다.
 * 화면 위에는 「Sample data」 배지가 뜬다.
 */
export type FixtureName = 'draft' | 'v1' | 'v2' | 'paid';
export const FIXTURE_NAMES: readonly FixtureName[] = ['draft', 'v1', 'v2', 'paid'];

const FIXTURE_ID = 'sample';
// AI 가 생각하는 동안의 화면(스켈레톤)이 보이게 일부러 늦춘다
const THINK_MS = 1500;
const NETWORK_MS = 250;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const V1 = recordedV1 as unknown as Project;
const V2 = recordedV2 as unknown as Project;
// 「약한 이의」 실측(s2r3-weak-dispute.json) — Jun 의 70% 요구에 AI 가 답한 그대로. 그 실행의 v1·v2 를 통째로 쓴다(숫자를 섞지 않는다)
const WEAK = recordedWeak as unknown as Project;
const WEAK_DISPUTER = WEAK.disputes[0].contributorId;
const SAMPLE_ORDER = { id: 'SAMPLE-ORDER-1', status: 'COMPLETED', authorizationId: 'SAMPLE-AUTH-1' };
const CREATED_EVENT = V1.events[0];

/** 기록에서 제안·이의만 걷어 낸 처음 상태 */
function draftProject(): Project {
  return { ...clone(V1), id: FIXTURE_ID, status: 'draft', order: undefined, proposal: undefined, history: [], disputes: [], approvals: {}, events: [CREATED_EVENT] };
}

const funded = (p: Project): Project => ({
  ...p,
  status: p.status === 'draft' ? 'funded' : p.status,
  order: SAMPLE_ORDER,
  events: [...p.events, { at: p.events[p.events.length - 1].at, text: `${p.client.name} authorized $${p.budget.value} with PayPal (sample).` }],
});

const withV1 = (p: Project): Project => ({
  ...p,
  status: 'proposed',
  proposal: clone(V1.proposal!),
  events: [...p.events, { at: V1.proposal!.createdAt, text: `AI (${V1.proposal!.model}) proposed split v1 from the production log.` }],
});

const withV2 = (p: Project, text = V2.disputes[0].text): Project => {
  const recorded = V2.disputes[0];
  const dispute: Dispute = { ...recorded, text };
  return {
    ...p,
    status: 'proposed',
    proposal: clone(V2.proposal!),
    history: [...p.history, ...(p.proposal ? [p.proposal] : [])],
    disputes: [...p.disputes, dispute],
    approvals: {},
    events: [
      ...p.events,
      { at: recorded.at, text: `Sora disputed v1: “${text}”` },
      { at: V2.proposal!.createdAt, text: `AI (${V2.proposal!.model}) revised the split to v2. Approvals were reset.` },
    ],
  };
};

function payoutItems(p: Project, done: boolean): PayoutItem[] {
  return (p.proposal?.shares ?? []).map((s, i) => ({
    contributorId: s.contributorId,
    amount: s.amount,
    status: done ? 'SUCCESS' : 'PENDING',
    ...(done ? { payoutItemId: `SAMPLE-ITEM-${i + 1}`, transactionId: `SAMPLE-TX-${i + 1}` } : {}),
  }));
}

const withPaid = (p: Project): Project => {
  const version = p.proposal?.version ?? 0;
  const at = p.events[p.events.length - 1].at;
  const approvals = Object.fromEntries(p.contributors.map((c) => [c.id, { at, version }]));
  return {
    ...p,
    status: 'paid',
    approvals,
    order: { ...SAMPLE_ORDER, captureId: 'SAMPLE-CAPTURE-1' },
    payout: { batchId: 'SAMPLE-BATCH-1', status: 'SUCCESS', items: payoutItems(p, true) },
    events: [
      ...p.events,
      { at, text: `Everyone approved v${version}. FairSplit captured the payment (sample).` },
      { at, text: `PayPal sent ${p.contributors.length} payouts in one batch (sample).` },
    ],
  };
};

export function fixtureProject(name: FixtureName): Project {
  const draft = draftProject();
  if (name === 'draft') return draft;
  if (name === 'v1') return withV1(funded(draft));
  if (name === 'v2') return withV2(withV1(funded(draft)));
  return withPaid(withV2(withV1(funded(draft))));
}

/** 메모리 안에서 서버 흐름을 흉내 낸다 — 이의 → v2, 전원 동의 → paying → paid. 같은 탭 안에서만 유지된다. */
export function createFixtureApi(name: FixtureName): Api {
  let state = fixtureProject(name);
  const now = () => new Date().toISOString();
  const reply = async (ms = NETWORK_MS) => {
    await wait(ms);
    return clone(state);
  };

  return {
    resetDemo: async () => {
      state = fixtureProject(name);
      return reply();
    },
    getProject: async () => reply(),
    // 샘플 모드에는 서버 검증이 없다 — 이름만 바꾼 처음 상태를 돌려준다(실제 검증은 worker/importer.ts)
    createProject: async (input) => {
      state = { ...fixtureProject('draft'), title: input.title || 'Untitled project', client: { name: input.clientName || 'Client' } };
      return reply();
    },
    fund: async (): Promise<FundStart> => {
      await wait(NETWORK_MS);
      // 실제 PayPal 대신 같은 화면으로 돌아오는 주소 — 돌아오기 흐름(fund/complete)을 그대로 탄다
      return { orderId: SAMPLE_ORDER.id, approveUrl: `/p/${state.id}?fixture=${name}&paypal=return&token=${SAMPLE_ORDER.id}` };
    },
    completeFund: async () => {
      if (state.status === 'draft') state = funded(state);
      return reply();
    },
    propose: async () => {
      state = withV1(funded(state));
      return reply(THINK_MS);
    },
    dispute: async (_projectId, contributorId, text) => {
      if (state.proposal?.version === 1 && contributorId === WEAK_DISPUTER) {
        state = {
          ...state,
          proposal: clone(WEAK.proposal!),
          history: clone(WEAK.history),
          approvals: {},
          disputes: [...state.disputes, { ...clone(WEAK.disputes[0]), text }],
          events: [...state.events, { at: now(), text: `${WEAK_DISPUTER === 'jun' ? 'Jun' : WEAK_DISPUTER} disputed v1: “${text}”` }, { at: now(), text: 'AI re-checked the split as v2 (recorded answer).' }],
        };
      } else if (state.proposal?.version === 1) {
        state = withV2(state, text);
      } else {
        // 기록에 v3 응답은 없다 — 지어내지 않고 판만 올리고 몫은 그대로 둔다(동의는 비운다)
        const prev = state.proposal!;
        const next: Proposal = { ...prev, version: prev.version + 1, createdAt: now(), changedBecause: 'Sample mode has no recorded answer for a second dispute, so the split stays the same. The live app asks the AI again.' };
        state = {
          ...state,
          proposal: next,
          history: [...state.history, prev],
          approvals: {},
          disputes: [...state.disputes, { id: `d${state.disputes.length + 1}`, contributorId, text, at: now(), answeredInVersion: next.version, answer: next.changedBecause }],
          events: [...state.events, { at: now(), text: `Split re-checked as v${next.version}. No change (sample).` }],
        };
      }
      return reply(THINK_MS);
    },
    approve: async (_projectId, contributorId) => {
      const version = state.proposal?.version ?? 0;
      const person = state.contributors.find((c) => c.id === contributorId)?.name ?? contributorId;
      state = {
        ...state,
        approvals: { ...state.approvals, [contributorId]: { at: now(), version } },
        events: [...state.events, { at: now(), text: `${person} approved v${version}.` }],
      };
      const everyone = state.contributors.every((c) => state.approvals[c.id]?.version === version);
      if (everyone) {
        state = {
          ...state,
          status: 'paying',
          order: { ...SAMPLE_ORDER, captureId: 'SAMPLE-CAPTURE-1' },
          payout: { batchId: 'SAMPLE-BATCH-1', status: 'PENDING', items: payoutItems(state, false) },
          events: [...state.events, { at: now(), text: `Everyone approved v${version}. FairSplit captured the payment and asked PayPal to send ${state.contributors.length} payouts.` }],
        };
      }
      return reply();
    },
    refresh: async () => {
      if (state.status === 'paying' && state.payout) {
        state = {
          ...state,
          status: 'paid',
          payout: { ...state.payout, status: 'SUCCESS', items: payoutItems(state, true) },
          events: [...state.events, { at: now(), text: `PayPal sent ${state.contributors.length} payouts in one batch (sample).` }],
        };
      }
      return reply();
    },
  };
}
