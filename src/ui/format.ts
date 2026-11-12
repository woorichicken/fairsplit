import type { Contributor, LogKind, Money, Project, ProjectStatus } from '../shared/types';

// 서버 locale 이 ko-KR 이어도 화면 글은 영어다(요강) — 날짜·숫자 형식을 en-US 로 고정한다
const LOCALE = 'en-US';

export function formatMoney(m: Money): string {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: m.currency }).format(Number(m.value));
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(LOCALE, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const KIND_LABEL: Record<LogKind, string> = {
  brief: 'Brief',
  draft: 'Draft',
  revision: 'Revision',
  review_comment: 'Review',
  recording: 'Recording',
  edit: 'Edit',
  asset: 'Asset',
  approval: 'Approval',
};

export function personName(project: Project, actor: string): string {
  const c = project.contributors.find((x) => x.id === actor || x.name === actor);
  if (c) return c.name;
  if (actor === 'client') return project.client.name;
  return actor;
}

export const initials = (c: Contributor) => c.name.slice(0, 1).toUpperCase();

/** 상단 스텝퍼 4칸 중 몇 칸이 끝났는지 */
export function stepsDone(status: ProjectStatus): number {
  switch (status) {
    case 'draft':
      return 0;
    case 'funded':
      return 1;
    case 'proposed':
    case 'disputed':
      return 2;
    case 'agreed':
    case 'paying':
      return 3;
    case 'paid':
      return 4;
  }
}

/** Payouts 항목 상태를 사람 말로 — PENDING 은 「Sending…」(계약서) */
export function payoutStatusLabel(status: string): string {
  switch (status.toUpperCase()) {
    case 'SUCCESS':
      return 'Sent';
    case 'PENDING':
    case 'PROCESSING':
    case 'ONHOLD':
      return 'Sending…';
    case 'UNCLAIMED':
      return 'Sent · PayPal is holding it until the receiver claims it';
    case 'FAILED':
    case 'BLOCKED':
    case 'DENIED':
    case 'RETURNED':
    case 'REFUNDED':
      return `Not sent (${status})`;
    default:
      return status;
  }
}

// ───── 화면에 코드·모델 이름이 그대로 보이지 않게(plain-words, 7회차) ─────

/** 모델 id(claude-sonnet-5-5) → 「Claude」. 서버 기록 문장 안에 들어 있어도 바꾼다 */
const MODEL_ID = /\bclaude-[a-z0-9.-]+\b/gi;
export const plainText = (text: string | undefined): string => (text ?? '').replace(MODEL_ID, 'Claude');
export const modelLabel = (model: string | undefined): string => (model && /claude/i.test(model) ? 'Claude' : 'AI');

/** AI 가 쓴 도구 → 사람 말 */
const STEP_LABEL: Record<string, string> = {
  list_log_events: 'Read the log',
  get_contributor: 'Looked up a person',
  get_disputes: 'Read the disputes',
  submit_proposal: 'Proposed',
  rule: 'Rule',
  fallback: 'Fallback',
};
export const stepLabel = (tool: string): string => STEP_LABEL[tool] ?? tool.replace(/_/g, ' ');
/** 「list_log_events(actor=sora) → 3 events」 의 앞 호출 모양을 떼고 결과만 */
export const stepResult = (result: string): string => result.replace(/^[a-z_]+\([^)]*\)\s*→\s*/i, '');

/** Payouts 배치 상태 → 사람 말 */
export function batchLabel(status: string): string {
  const s = status.toUpperCase();
  if (s === 'SUCCESS') return 'Batch complete';
  if (s === 'PENDING' || s === 'PROCESSING') return 'Batch sending';
  return `Batch ${status.toLowerCase()}`;
}
