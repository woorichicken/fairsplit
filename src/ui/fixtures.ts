import type { Contributor, Dispute, LogEvent, Money, PayoutItem, Project, Proposal, Share } from '../shared/types';
import type { Api, FundStart } from './api';

/**
 * 가짜 Project 들 — 서버(S1) 없이 화면·E2E·캡처를 돌리려고 둔다. `?fixture=draft|v1|v2|paid` 로 켠다.
 * 여기 숫자는 「시연용 예시」다. 실제 화면에서는 서버가 AI 제안을 계산한다 — 화면 상단에 「Sample data」 배지가 뜬다.
 */
export type FixtureName = 'draft' | 'v1' | 'v2' | 'paid';
export const FIXTURE_NAMES: readonly FixtureName[] = ['draft', 'v1', 'v2', 'paid'];

const FIXTURE_ID = 'sample';
const BUDGET_CENTS = 60000;
// AI 가 생각하는 동안의 화면(스켈레톤)이 보이게 일부러 늦춘다
const THINK_MS = 1500;
const NETWORK_MS = 250;

const usd = (cents: number): Money => ({ value: (cents / 100).toFixed(2), currency: 'USD' });
const percentOfBudget = (percent: number): Money => usd(Math.round((BUDGET_CENTS * percent) / 100));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const contributors: Contributor[] = [
  { id: 'mina', name: 'Mina', role: 'Scriptwriter', paypalEmail: 'mina@example.com' },
  { id: 'jun', name: 'Jun', role: 'Video editor', paypalEmail: 'jun@example.com' },
  { id: 'sora', name: 'Sora', role: 'Voice actor', paypalEmail: 'sora@example.com' },
];

const log: LogEvent[] = [
  { id: 'e1', at: '2026-11-03T09:00:00Z', actor: 'client', kind: 'brief', title: 'Brief: 30-second spring launch short', detail: 'Warm, cozy, morning mood. Voice-over + subtitles.' },
  { id: 'e2', at: '2026-11-03T13:10:00Z', actor: 'mina', kind: 'draft', title: 'Script v1', minutes: 60 },
  { id: 'e3', at: '2026-11-04T08:30:00Z', actor: 'client', kind: 'review_comment', title: 'Too long — cut to 30 seconds' },
  { id: 'e4', at: '2026-11-04T11:00:00Z', actor: 'mina', kind: 'revision', title: 'Script v2', minutes: 45 },
  { id: 'e5', at: '2026-11-04T16:20:00Z', actor: 'mina', kind: 'revision', title: 'Script v3 (final)', minutes: 30 },
  { id: 'e6', at: '2026-11-05T10:00:00Z', actor: 'sora', kind: 'recording', title: 'Voice-over recording', minutes: 40 },
  { id: 'e7', at: '2026-11-05T15:00:00Z', actor: 'jun', kind: 'edit', title: 'Edit cut 1', minutes: 90 },
  { id: 'e8', at: '2026-11-06T09:15:00Z', actor: 'client', kind: 'review_comment', title: 'Subtitles overflow 2 lines' },
  { id: 'e9', at: '2026-11-06T12:00:00Z', actor: 'jun', kind: 'edit', title: 'Edit cut 2', minutes: 60 },
  { id: 'e10', at: '2026-11-06T17:40:00Z', actor: 'client', kind: 'review_comment', title: 'Voice feels cold — warmer tone, please' },
  { id: 'e11', at: '2026-11-07T10:00:00Z', actor: 'sora', kind: 'recording', title: 'Re-recording 1', detail: 'Client asked for warmer tone', minutes: 18 },
  { id: 'e12', at: '2026-11-07T14:30:00Z', actor: 'sora', kind: 'recording', title: 'Re-recording 2', detail: 'Client asked for warmer tone', minutes: 18 },
  { id: 'e13', at: '2026-11-08T10:00:00Z', actor: 'jun', kind: 'edit', title: 'Edit cut 3 (new voice track)', minutes: 45 },
  { id: 'e14', at: '2026-11-08T16:00:00Z', actor: 'jun', kind: 'edit', title: 'Edit cut 4 (final)', minutes: 30 },
  { id: 'e15', at: '2026-11-09T09:00:00Z', actor: 'jun', kind: 'asset', title: 'Exported 9:16 and 1:1 files' },
  { id: 'e16', at: '2026-11-09T15:00:00Z', actor: 'client', kind: 'approval', title: 'Client approved the final cut' },
];

function share(contributorId: string, percent: number, reasons: Share['reasons']): Share {
  return { contributorId, percent, amount: percentOfBudget(percent), reasons };
}

const proposalV1: Proposal = {
  version: 1,
  createdAt: '2026-11-09T15:05:00Z',
  by: 'ai',
  model: 'claude-sonnet-5-5',
  summary: 'Script and edit carried most of the hours. The voice-over was one 40-minute session.',
  shares: [
    share('mina', 40, [
      { text: 'Wrote the script and two revisions after client feedback (135 min).', eventIds: ['e2', 'e4', 'e5'] },
    ]),
    share('jun', 40, [
      { text: 'Four edit cuts, including the subtitle fix (225 min).', eventIds: ['e7', 'e9', 'e13', 'e14'] },
      { text: 'Exported the delivery files.', eventIds: ['e15'] },
    ]),
    share('sora', 20, [{ text: 'Recorded the main voice-over (40 min).', eventIds: ['e6'] }]),
  ],
  steps: [
    { tool: 'list_log_events', result: '16 events from 4 people' },
    { tool: 'get_contributor', result: 'Mina · Jun · Sora' },
    { tool: 'submit_proposal', result: 'Accepted: 40 / 40 / 20' },
  ],
};

const DISPUTE_TEXT = "My two re-recordings weren't counted.";

const proposalV2: Proposal = {
  version: 2,
  createdAt: '2026-11-09T15:20:00Z',
  by: 'ai',
  model: 'claude-sonnet-5-5',
  summary: 'Same budget, re-read with Sora’s dispute. The two re-recordings were real extra work requested by the client.',
  changedBecause: 'Sora said the two re-recordings were not counted. The log shows them (e11, e12: 18 min each, after the client asked for a warmer tone). v2 adds them to Sora’s share and takes the 6 points evenly from Mina and Jun.',
  shares: [
    share('mina', 37, [
      { text: 'Wrote the script and two revisions after client feedback (135 min).', eventIds: ['e2', 'e4', 'e5'] },
    ]),
    share('jun', 37, [
      { text: 'Four edit cuts, including the subtitle fix (225 min).', eventIds: ['e7', 'e9', 'e13', 'e14'] },
      { text: 'Exported the delivery files.', eventIds: ['e15'] },
    ]),
    share('sora', 26, [
      { text: 'Recorded the main voice-over (40 min).', eventIds: ['e6'] },
      { text: 'Two re-recordings after the client asked for a warmer tone (36 min).', eventIds: ['e10', 'e11', 'e12'] },
    ]),
  ],
  steps: [
    { tool: 'get_disputes', result: '1 open dispute from Sora' },
    { tool: 'list_log_events', result: 'kind=recording → 3 events (e6, e11, e12)' },
    { tool: 'submit_proposal', result: 'Accepted: 37 / 37 / 26' },
  ],
};

const baseProject: Project = {
  id: FIXTURE_ID,
  title: 'Spring launch short — Moonbrew Coffee',
  client: { name: 'Moonbrew Coffee' },
  budget: usd(BUDGET_CENTS),
  contributors,
  log,
  status: 'draft',
  history: [],
  disputes: [],
  approvals: {},
  events: [{ at: '2026-11-09T15:00:00Z', text: 'Project created with 3 contributors and 16 log events.' }],
};

const funded = (p: Project): Project => ({
  ...p,
  status: 'funded',
  order: { id: 'SAMPLE-ORDER-1', status: 'COMPLETED', authorizationId: 'SAMPLE-AUTH-1' },
  events: [...p.events, { at: '2026-11-09T15:02:00Z', text: 'Moonbrew Coffee authorized $600.00 with PayPal.' }],
});

const withV1 = (p: Project): Project => ({
  ...p,
  status: 'proposed',
  proposal: proposalV1,
  events: [...p.events, { at: proposalV1.createdAt, text: 'AI proposed split v1: Mina 40% · Jun 40% · Sora 20%.' }],
});

const withV2 = (p: Project): Project => {
  const dispute: Dispute = { id: 'd1', contributorId: 'sora', text: DISPUTE_TEXT, at: '2026-11-09T15:12:00Z', answeredInVersion: 2, answer: proposalV2.changedBecause };
  return {
    ...p,
    status: 'proposed',
    proposal: proposalV2,
    history: [...p.history, ...(p.proposal ? [p.proposal] : [])],
    disputes: [...p.disputes, dispute],
    approvals: {},
    events: [
      ...p.events,
      { at: dispute.at, text: `Sora disputed v1: “${DISPUTE_TEXT}”` },
      { at: proposalV2.createdAt, text: 'AI revised the split to v2: Sora 20% → 26%. Approvals were reset.' },
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
  const approvals = Object.fromEntries(p.contributors.map((c, i) => [c.id, { at: `2026-11-09T15:3${i}:00Z`, version }]));
  return {
    ...p,
    status: 'paid',
    approvals,
    order: { ...p.order!, captureId: 'SAMPLE-CAPTURE-1' },
    payout: { batchId: 'SAMPLE-BATCH-1', status: 'SUCCESS', items: payoutItems(p, true) },
    events: [
      ...p.events,
      { at: '2026-11-09T15:32:00Z', text: 'Everyone approved v2. FairSplit captured the $600.00 payment.' },
      { at: '2026-11-09T15:33:00Z', text: 'PayPal sent 3 payouts in one batch.' },
    ],
  };
};

export function fixtureProject(name: FixtureName): Project {
  const draft = clone(baseProject);
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
    fund: async (): Promise<FundStart> => {
      await wait(NETWORK_MS);
      // 실제 PayPal 대신 같은 화면으로 돌아오는 주소 — 돌아오기 흐름(fund/complete)을 그대로 탄다
      return { orderId: 'SAMPLE-ORDER-1', approveUrl: `/p/${state.id}?fixture=${name}&paypal=return&token=SAMPLE-ORDER-1` };
    },
    completeFund: async () => {
      if (state.status === 'draft') state = funded(state);
      return reply();
    },
    propose: async () => {
      state = withV1(state.status === 'draft' ? funded(state) : state);
      return reply(THINK_MS);
    },
    dispute: async (_projectId, contributorId, text) => {
      if (state.proposal?.version === 1) {
        state = withV2(state);
      } else {
        // v2 뒤의 이의 — 새 근거가 없으면 판만 올리고 몫은 그대로 둔다(동의는 비운다)
        const prev = state.proposal!;
        const next: Proposal = { ...prev, version: prev.version + 1, createdAt: now(), changedBecause: 'Re-read the log for this dispute. No new events support a change, so the split stays the same.' };
        state = {
          ...state,
          proposal: next,
          history: [...state.history, prev],
          approvals: {},
          disputes: [...state.disputes, { id: `d${state.disputes.length + 1}`, contributorId, text, at: now(), answeredInVersion: next.version, answer: next.changedBecause }],
          events: [...state.events, { at: now(), text: `AI re-checked the split as v${next.version}. No change.` }],
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
          order: { ...state.order!, captureId: 'SAMPLE-CAPTURE-1' },
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
          events: [...state.events, { at: now(), text: `PayPal sent ${state.contributors.length} payouts in one batch.` }],
        };
      }
      return reply();
    },
  };
}
