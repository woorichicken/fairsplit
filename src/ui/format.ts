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
      return 'Unclaimed — waiting for the recipient';
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
