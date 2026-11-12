// 계약서(CONTRACT.md 「데이터 모양」) 그대로 — Worker 와 화면이 같이 import 한다. 바꾸려면 계약서부터 고친다.
export type ProjectStatus = 'draft' | 'funded' | 'proposed' | 'disputed' | 'agreed' | 'paying' | 'paid';
export interface Money { value: string; currency: 'USD' } // "600.00" — 문자열, 센트 2자리
export interface Contributor { id: string; name: string; role: string; paypalEmail: string; avatar?: string }
export type LogKind = 'brief' | 'draft' | 'revision' | 'review_comment' | 'recording' | 'edit' | 'asset' | 'approval';
export interface LogEvent {
  id: string; at: string; actor: string; kind: LogKind; title: string; detail?: string; minutes?: number;
  /** 이의로 붙은 줄이면 'dispute' — 당사자 주장이라 화면·AI 에 출처를 드러낸다(5회차) */
  source?: 'log' | 'dispute'; addedBy?: string;
}
export interface Reason { text: string; eventIds: string[] } // eventIds = LogEvent.id — 화면이 근거 줄을 하이라이트
export interface Share { contributorId: string; percent: number; amount: Money; reasons: Reason[] }
export interface Proposal {
  version: number; createdAt: string; by: 'ai' | 'rule'; model?: string; summary: string;
  shares: Share[]; changedBecause?: string; steps?: { tool: string; result: string }[];
}
export interface Dispute {
  id: string; contributorId: string; text: string; at: string; answeredInVersion?: number; answer?: string;
  /** 이의를 건 판 — 사람당 판마다 1번 */
  onVersion?: number; addedEventIds?: string[];
}
export interface PayoutItem { contributorId: string; amount: Money; status: string; payoutItemId?: string; transactionId?: string }
export interface Project {
  id: string; title: string; client: { name: string }; budget: Money; contributors: Contributor[]; log: LogEvent[];
  status: ProjectStatus;
  order?: { id: string; status: string; authorizationId?: string; captureId?: string };
  proposal?: Proposal; history: Proposal[]; disputes: Dispute[];
  approvals: Record<string, { at: string; version: number }>; // contributorId → 동의한 판
  payout?: { batchId: string; status: string; items: PayoutItem[] };
  events: { at: string; text: string }[]; // 화면 「Activity」 타임라인(사람 말로)
}

/** 오류 응답 몸 — `{ error: { code, message } }` */
export interface ApiError { error: { code: string; message: string } }
