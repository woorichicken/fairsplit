import type { PayoutItem, Project, Proposal } from '../shared/types';
import { ApiError, type Api, type FundStart, type MissingWork } from './api';
import story1 from './samples/story-1.json' with { type: 'json' };
import story2 from './samples/story-2.json' with { type: 'json' };
import story3 from './samples/story-3.json' with { type: 'json' };

/**
 * 가짜 흐름 — 서버 없이 화면·E2E·캡처를 돌리려고 둔다. `?fixture=draft|v1|v2|paid` 로 켠다.
 * 분배 숫자는 지어내지 않았다: samples/story-*.json 은 운영(fairsplit.solhun.com)에서 시연 영상을 찍은 실제 실행
 * (프로젝트 0b8e5bd102a5, 실제 Claude · 실제 PayPal 샌드박스)의 판들을 그대로 옮겼다 — 영상·랜딩·영수증 숫자를 하나로(품질 r2, 11-12):
 *   story-1 = AI v1 · story-2 = Jun 약한 이의 뒤 v2(몫 그대로) · story-3 = Sora 가 빠진 작업(e16)을 붙인 이의 뒤 v3(Sora 오름).
 * 결제·송금 부분(order·payout id)만 「SAMPLE-」 가짜다. 화면 위에는 「Sample data」 배지가 뜬다.
 * fixture 이름 'v2' 는 「이의 두 개가 끝난 판」(story-3, v3)이다 — 캡처·E2E 가 쓰던 이름을 유지한다.
 */
export type FixtureName = 'draft' | 'v1' | 'v2' | 'paid';
export const FIXTURE_NAMES: readonly FixtureName[] = ['draft', 'v1', 'v2', 'paid'];

const FIXTURE_ID = 'sample';
// AI 가 생각하는 동안의 화면(스켈레톤)이 보이게 일부러 늦춘다
const THINK_MS = 1500;
const NETWORK_MS = 250;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const STORY = [story1, story2, story3] as unknown as Project[];
const WEAK_DISPUTER = STORY[1].disputes[0].contributorId; // jun
const MISSING_DISPUTER = STORY[2].disputes[1].contributorId; // sora
const SAMPLE_ORDER = { id: 'SAMPLE-ORDER-1', status: 'COMPLETED', authorizationId: 'SAMPLE-AUTH-1' };

/** 시연 화면의 예시 버튼이 채우는 값 — 실측 때 보낸 것과 같다(e2e/dispute-eval.mjs) */
export const EXAMPLE_WEAK = { contributorId: WEAK_DISPUTER, text: STORY[1].disputes[0].text };
export const EXAMPLE_MISSING = (() => {
  const d = STORY[2].disputes[1];
  const e = STORY[2].log.find((x) => x.id === d.addedEventIds?.[0])!;
  const missingWork: MissingWork = { kind: e.kind, title: e.title, minutes: e.minutes, at: e.at };
  return { contributorId: d.contributorId, text: d.text, missingWork };
})();

/** 기록된 단계 그대로(결제만 SAMPLE 로 승인된 상태) */
function stage(i: 0 | 1 | 2): Project {
  const p = clone(STORY[i]);
  return { ...p, id: FIXTURE_ID, order: SAMPLE_ORDER, events: [...p.events, { at: p.events[0].at, text: `${p.client.name} authorized $${p.budget.value} with PayPal (sample).` }] };
}

function draftProject(): Project {
  const p = clone(STORY[0]);
  return { ...p, id: FIXTURE_ID, status: 'draft', order: undefined, proposal: undefined, history: [], disputes: [], approvals: {}, events: [p.events[0]] };
}

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
  return {
    ...p,
    status: 'paid',
    approvals: Object.fromEntries(p.contributors.map((c) => [c.id, { at, version }])),
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
  if (name === 'draft') return draftProject();
  if (name === 'v1') return stage(0);
  if (name === 'v2') return stage(2);
  return withPaid(stage(2));
}

/** 첫 화면 미리보기 — 시연 이야기 끝(v3: 약한 이의는 그대로 · 빠진 작업으로 Sora 오름) */
export function recordedStoryProject(): Project {
  return stage(2);
}

/** 메모리 안에서 서버 흐름을 흉내 낸다 — 기록된 이야기 순서(Jun 약한 이의 → Sora 빠진 작업)면 그 응답을, 아니면 몫 그대로의 새 판을. */
export function createFixtureApi(name: FixtureName): Api {
  let state = fixtureProject(name);
  const now = () => new Date().toISOString();
  const reply = async (ms = NETWORK_MS) => {
    await wait(ms);
    return clone(state);
  };
  // 기록된 판으로 넘어가되 이 탭의 id·결제·활동은 이어 간다
  const advanceTo = (next: Project): Project => ({
    ...next,
    id: state.id,
    order: state.order,
    events: [...state.events, ...next.events.filter((e) => !state.events.some((x) => x.at === e.at && x.text === e.text))],
  });

  return {
    resetDemo: async () => {
      state = fixtureProject(name);
      return reply();
    },
    // 샘플 모드에는 서버 검증이 없다 — 이름만 바꾼 처음 상태를 돌려준다(실제 검증은 worker/importer.ts)
    createProject: async (input) => {
      state = { ...draftProject(), title: input.title || 'Untitled project', client: { name: input.clientName || 'Client' } };
      return reply();
    },
    getProject: async () => reply(),
    fund: async (): Promise<FundStart> => {
      await wait(NETWORK_MS);
      // 실제 PayPal 대신 같은 화면으로 돌아오는 주소 — 돌아오기 흐름(fund/complete)을 그대로 탄다
      return { orderId: SAMPLE_ORDER.id, approveUrl: `/p/${state.id}?fixture=${name}&paypal=return&token=${SAMPLE_ORDER.id}` };
    },
    completeFund: async () => {
      if (state.status === 'draft') state = { ...state, status: 'funded', order: SAMPLE_ORDER };
      return reply();
    },
    propose: async () => {
      state = { ...stage(0), title: state.title, client: state.client };
      return reply(THINK_MS);
    },
    dispute: async (_projectId, contributorId, text, missingWork) => {
      const v = state.proposal!.version;
      const person = state.contributors.find((c) => c.id === contributorId)?.name ?? contributorId;
      if (state.disputes.some((d) => d.contributorId === contributorId && (d.onVersion === v || d.answeredInVersion === v))) {
        await wait(NETWORK_MS);
        throw new ApiError('DISPUTE_LIMIT', `${person} already has an answer in v${v}. Each person gets one dispute per version — approve it, or wait until someone else's dispute brings a new version.`, 409);
      }
      if (v === 1 && contributorId === WEAK_DISPUTER && !missingWork) {
        state = advanceTo(stage(1));
      } else if (v === 2 && contributorId === MISSING_DISPUTER && missingWork) {
        state = advanceTo(stage(2));
      } else {
        // 기록에 없는 순서 — 지어내지 않고 판만 올리고 몫은 그대로 둔다(동의는 비운다)
        const prev = state.proposal!;
        const next: Proposal = { ...prev, version: v + 1, createdAt: now(), changedBecause: 'No change: sample mode only has recorded answers for the demo order (Jun first, then Sora with missing work). The live app asks the AI.' };
        state = {
          ...state,
          proposal: next,
          history: [...state.history, prev],
          approvals: {},
          disputes: [...state.disputes, { id: `d${state.disputes.length + 1}`, contributorId, text, at: now(), onVersion: v, answeredInVersion: next.version, answer: next.changedBecause }],
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
