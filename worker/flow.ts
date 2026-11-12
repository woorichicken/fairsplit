// 상태 기계 — 순수 함수만 둔다(PayPal·AI·저장 없음). 그래서 유닛 테스트로 전이 규칙을 다 볼 수 있다.
// 전이 밖 호출은 FlowError(409). index.ts 가 이걸 { error: { code, message } } 로 바꾼다.
import type { Dispute, LogEvent, LogKind, PayoutItem, Project, Proposal, ProjectStatus } from '../src/shared/types';

export class FlowError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message);
  }
}

const SETTLED: ProjectStatus[] = ['agreed', 'paying', 'paid'];

export const isFunded = (p: Project): boolean => Boolean(p.order?.authorizationId);

function log(p: Project, at: string, text: string): void {
  p.events.push({ at, text });
}

function name(p: Project, contributorId: string): string {
  return p.contributors.find((c) => c.id === contributorId)?.name ?? contributorId;
}

export function contributorOrThrow(p: Project, contributorId: unknown): string {
  const id = String(contributorId ?? '');
  if (!p.contributors.some((c) => c.id === id)) throw new FlowError('UNKNOWN_CONTRIBUTOR', `No contributor "${id}" on this project.`, 400);
  return id;
}

/** 결제 시작 — 아직 승인(authorize) 안 됐고 정산 전이면 몇 번이든 새 주문을 만들 수 있다(창을 닫고 다시 누르는 경우). */
export function assertCanFund(p: Project): void {
  if (isFunded(p)) throw new FlowError('ALREADY_FUNDED', 'The client has already authorized this payment.');
  if (SETTLED.includes(p.status)) throw new FlowError('BAD_STATE', `Cannot fund a project that is ${p.status}.`);
}

export function startFunding(p: Project, orderId: string, status: string, at: string): void {
  assertCanFund(p);
  p.order = { id: orderId, status };
  log(p, at, `${p.client.name} opened PayPal checkout for $${p.budget.value}.`);
}

/** authorize 끝 — draft 면 funded 로. 제안이 이미 있으면(승인 없이 먼저 제안한 길) 상태는 그대로 둔다. */
export function markFunded(p: Project, orderId: string, orderStatus: string, authorizationId: string, at: string): void {
  if (p.order?.id !== orderId) throw new FlowError('ORDER_MISMATCH', 'This PayPal order does not belong to this project.', 400);
  assertCanFund(p);
  p.order = { id: orderId, status: orderStatus, authorizationId };
  if (p.status === 'draft') p.status = 'funded';
  log(p, at, `${p.client.name} authorized $${p.budget.value} on PayPal. The money is held until everyone agrees.`);
}

export function assertCanPropose(p: Project): void {
  if (p.proposal) throw new FlowError('ALREADY_PROPOSED', 'A proposal already exists. Open a dispute to get a revision.');
  if (p.status !== 'draft' && p.status !== 'funded') throw new FlowError('BAD_STATE', `Cannot propose while ${p.status}.`);
}

/** 새 판을 건다 — 이전 판은 history 로, 동의는 전부 비운다(판이 바뀌면 다시 동의해야 한다). */
export function applyProposal(p: Project, proposal: Proposal, at: string): void {
  if (p.proposal) p.history.push(p.proposal);
  p.proposal = proposal;
  p.approvals = {};
  p.status = 'proposed';
  // 화면에 모델 id 를 보이지 않는다(plain-words) — 모델은 proposal.model 에 남아 있다
  const who = proposal.by === 'ai' ? 'AI (Claude)' : 'Rule-based fallback';
  log(p, at, proposal.version === 1 ? `${who} proposed split v1 from the production log.` : `${who} revised the split to v${proposal.version}. Approvals were reset.`);
  for (const d of p.disputes) {
    if (d.answeredInVersion === undefined) {
      d.answeredInVersion = proposal.version;
      d.answer = proposal.changedBecause ?? proposal.summary;
    }
  }
}

/** 이의로 붙일 수 있는 일의 종류 — 의뢰인 몫(brief·review_comment·approval)은 기여자가 붙일 수 없다 */
export const MISSING_WORK_KINDS: readonly LogKind[] = ['draft', 'revision', 'recording', 'edit', 'asset'];
const MAX_MISSING_MINUTES = 24 * 60;
const MAX_MISSING_TITLE = 200;

export interface MissingWorkInput { kind?: unknown; title?: unknown; minutes?: unknown; at?: unknown }

/** 이의에 붙은 「빠진 작업」을 로그 줄로 — 당사자 주장이므로 source 'dispute' · addedBy 로 표시한다 */
function missingWorkEvent(p: Project, cid: string, raw: MissingWorkInput): LogEvent {
  const kind = String(raw.kind ?? '') as LogKind;
  if (!MISSING_WORK_KINDS.includes(kind)) throw new FlowError('BAD_MISSING_WORK', `Missing work kind must be one of ${MISSING_WORK_KINDS.join(', ')}.`, 400);
  const title = String(raw.title ?? '').trim().slice(0, MAX_MISSING_TITLE);
  if (!title) throw new FlowError('BAD_MISSING_WORK', 'Missing work needs a short title.', 400);
  const when = new Date(String(raw.at ?? ''));
  if (Number.isNaN(when.getTime())) throw new FlowError('BAD_MISSING_WORK', 'Missing work needs a date and time.', 400);
  let minutes: number | undefined;
  if (raw.minutes !== undefined && raw.minutes !== null && raw.minutes !== '') {
    minutes = Number(raw.minutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_MISSING_MINUTES) throw new FlowError('BAD_MISSING_WORK', `Minutes must be a whole number from 0 to ${MAX_MISSING_MINUTES}.`, 400);
  }
  // 다음 번호 — 시연(e01..)·가져오기(e01..) 둘 다 e+두 자리 꼴이다
  const next = p.log.reduce((n, e) => Math.max(n, Number(/^e(\d+)$/.exec(e.id)?.[1] ?? 0)), 0) + 1;
  return { id: `e${String(next).padStart(2, '0')}`, at: when.toISOString(), actor: cid, kind, title, ...(minutes !== undefined ? { minutes } : {}), source: 'dispute', addedBy: cid };
}

export function openDispute(p: Project, contributorId: unknown, text: unknown, id: string, at: string, missing?: MissingWorkInput | null): Dispute {
  if (p.status !== 'proposed' || !p.proposal) throw new FlowError('BAD_STATE', `Disputes are only open while a proposal is waiting (now ${p.status}).`);
  const cid = contributorOrThrow(p, contributorId);
  const version = p.proposal.version;
  // 사람당 판마다 1번 — 이의를 거듭 걸어 남의 동의를 계속 비우는 지연을 막는다(5회차).
  // 이의마다 새 판이 생기므로 「같은 판에 또」만 막으면 효과가 없다 → 자기 이의에 대한 답으로 나온 판에도 다시 못 건다.
  const mine = p.disputes.find((d) => d.contributorId === cid && (d.onVersion === version || d.answeredInVersion === version));
  if (mine) {
    const why = mine.onVersion === version ? `already disputed v${version}` : `got an answer to their dispute in v${version}`;
    throw new FlowError('DISPUTE_LIMIT', `${name(p, cid)} ${why}. Each person gets one dispute per version — approve it, or wait until someone else's dispute brings a new version.`);
  }
  const body = String(text ?? '').trim();
  if (!body) throw new FlowError('EMPTY_DISPUTE', 'Write what you think is wrong.', 400);
  const added = missing ? missingWorkEvent(p, cid, missing) : undefined;
  const dispute: Dispute = { id, contributorId: cid, text: body.slice(0, MAX_DISPUTE_CHARS), at, onVersion: version, ...(added ? { addedEventIds: [added.id] } : {}) };
  if (added) p.log.push(added);
  p.disputes.push(dispute);
  p.status = 'disputed';
  log(p, at, `${name(p, cid)} disputed v${version}: “${dispute.text}”${added ? ` and added missing work to the log (${added.id}: ${added.title}).` : ''}`);
  return dispute;
}

export const MAX_DISPUTE_CHARS = 500;

/**
 * 동의 하나. 마지막 동의는 결제 승인이 있어야 받는다 — 돈이 묶여 있지 않으면 「모두 동의」가 지급으로 이어질 수 없다.
 * 돌려주는 값: 이번 동의로 전원이 동의했는지.
 */
export function approve(p: Project, contributorId: unknown, at: string): boolean {
  if (p.status !== 'proposed' || !p.proposal) throw new FlowError('BAD_STATE', `Nothing to approve while ${p.status}.`);
  const cid = contributorOrThrow(p, contributorId);
  const version = p.proposal.version;
  const already = p.approvals[cid]?.version === version;
  const others = p.contributors.filter((c) => c.id !== cid).every((c) => p.approvals[c.id]?.version === version);
  if (others && !isFunded(p)) throw new FlowError('FUNDING_REQUIRED', 'Everyone else agreed, but the client has not authorized the PayPal payment yet.');
  if (!already) {
    p.approvals[cid] = { at, version };
    log(p, at, `${name(p, cid)} approved v${version}.`);
  }
  if (others) {
    p.status = 'agreed';
    log(p, at, `Everyone agreed on v${version}.`);
    return true;
  }
  return false;
}

export function markCaptured(p: Project, captureId: string, at: string): void {
  if (p.status !== 'agreed' || !p.order) throw new FlowError('BAD_STATE', `Cannot capture while ${p.status}.`);
  p.order.captureId = captureId;
  p.order.status = 'CAPTURED';
  log(p, at, `PayPal captured $${p.budget.value} from ${p.client.name}.`);
}

export function markPaying(p: Project, batchId: string, status: string, items: PayoutItem[], at: string): void {
  if (p.status !== 'agreed') throw new FlowError('BAD_STATE', `Cannot send payouts while ${p.status}.`);
  p.payout = { batchId, status, items };
  p.status = 'paying';
  log(p, at, `PayPal Payouts batch sent to ${items.length} contributors in one call.`);
}

const BATCH_DONE = 'SUCCESS';

export function updatePayout(p: Project, status: string, items: PayoutItem[], at: string): void {
  if (!p.payout || (p.status !== 'paying' && p.status !== 'paid')) throw new FlowError('BAD_STATE', `No payout to refresh while ${p.status}.`);
  const changed = p.payout.status !== status;
  p.payout = { ...p.payout, status, items: items.length ? items : p.payout.items };
  if (status === BATCH_DONE && p.status === 'paying') {
    p.status = 'paid';
    // UNCLAIMED = 받는 사람이 아직 PayPal 계정이 없어 청구 링크 메일로 기다리는 중 — 「모두 받았다」고 쓰지 않는다
    const waiting = p.payout.items.filter((i) => i.status.toUpperCase() === 'UNCLAIMED').length;
    log(p, at, waiting ? `PayPal finished the payout batch. ${waiting} of ${p.payout.items.length} payouts are waiting for the receiver to claim them.` : 'PayPal finished the payout batch. Everyone has been paid.');
  } else if (changed) log(p, at, `Payout batch is ${status}.`);
}

/** 불변식 — 테스트와 저장 직전 검사가 같이 쓴다. 깨지면 메시지 목록을 돌려준다. */
export function invariantErrors(p: Project): string[] {
  const errs: string[] = [];
  const ids = new Set(p.log.map((e) => e.id));
  for (const prop of [p.proposal, ...p.history].filter((x): x is Proposal => Boolean(x))) {
    const pct = prop.shares.reduce((a, s) => a + s.percent, 0);
    if (pct !== 100) errs.push(`v${prop.version}: percent 합 ${pct}`);
    const cents = prop.shares.reduce((a, s) => a + Math.round(Number(s.amount.value) * 100), 0);
    if (cents !== Math.round(Number(p.budget.value) * 100)) errs.push(`v${prop.version}: 금액 합 ${cents}센트`);
    const seen = prop.shares.map((s) => s.contributorId).sort().join(',');
    if (seen !== p.contributors.map((c) => c.id).sort().join(',')) errs.push(`v${prop.version}: 기여자 ${seen}`);
    for (const s of prop.shares) for (const r of s.reasons) for (const id of r.eventIds) if (!ids.has(id)) errs.push(`v${prop.version}: 없는 eventId ${id}`);
  }
  for (const [cid, a] of Object.entries(p.approvals)) if (a.version !== p.proposal?.version) errs.push(`${cid} 의 동의가 지난 판(v${a.version})`);
  if (p.payout && p.status !== 'paying' && p.status !== 'paid') errs.push(`${p.status} 인데 payout 이 있다`);
  return errs;
}
