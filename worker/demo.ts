// 시연 데이터 — 가상 브랜드·인물만(요강: 실제 상표 금지). 결과 수치(누가 몇 %)는 여기 없다 — AI·규칙이 로그에서 정한다.
// 로그 순서는 실제 제작 순서 그대로다. 재녹음을 일부러 숨기거나 늦게 두지 않는다(계약서 「정직하게」).
import type { Contributor, LogEvent, Project } from '../src/shared/types';
import { usd } from './money';

export const DEMO_SCENARIO = 'brand-short';
export const DEMO_BUDGET = '600.00';

const CONTRIBUTORS: Omit<Contributor, 'paypalEmail'>[] = [
  { id: 'mina', name: 'Mina', role: 'Scriptwriter', avatar: 'M' },
  { id: 'jun', name: 'Jun', role: 'Video editor', avatar: 'J' },
  { id: 'sora', name: 'Sora', role: 'Voice actor', avatar: 'S' },
];

// 시각은 고정값 — 시연 때마다 같은 로그가 보여야 근거 줄 비교가 된다.
const LOG: LogEvent[] = [
  { id: 'e01', at: '2026-11-02T09:00:00Z', actor: 'client', kind: 'brief', title: 'Brief: 30-second spring launch short for Moonbrew Coffee', detail: 'Vertical 1080x1920, warm and cozy mood, subtitles on, voiceover required.' },
  { id: 'e02', at: '2026-11-02T13:10:00Z', actor: 'mina', kind: 'draft', title: 'Script v1', detail: 'Three-scene script with a 4-line voiceover.', minutes: 90 },
  { id: 'e03', at: '2026-11-02T16:40:00Z', actor: 'client', kind: 'review_comment', title: 'Script feedback: intro is too long, end on the spring blend', detail: 'Cut the first scene in half and close on the product shot.' },
  { id: 'e04', at: '2026-11-03T10:05:00Z', actor: 'mina', kind: 'revision', title: 'Script v2', detail: 'Shorter intro, new closing line.', minutes: 45 },
  { id: 'e05', at: '2026-11-03T14:30:00Z', actor: 'mina', kind: 'revision', title: 'Script v3 (final)', detail: 'Tightened voiceover to fit 28 seconds.', minutes: 30 },
  { id: 'e06', at: '2026-11-04T10:00:00Z', actor: 'sora', kind: 'recording', title: 'Voiceover recording, take 1', detail: 'Full script, 3 takes, best take delivered.', minutes: 40 },
  { id: 'e07', at: '2026-11-04T15:20:00Z', actor: 'jun', kind: 'edit', title: 'Edit cut 1', detail: 'First assembly with voiceover and music.', minutes: 120 },
  { id: 'e08', at: '2026-11-05T09:30:00Z', actor: 'client', kind: 'review_comment', title: 'Cut 1 feedback: subtitles overflow 2 lines, voice feels too flat', detail: 'Subtitles should stay on one line. Client asked for a warmer tone in the voiceover.' },
  { id: 'e09', at: '2026-11-05T13:00:00Z', actor: 'jun', kind: 'edit', title: 'Edit cut 2: subtitles fixed to one line', minutes: 60 },
  { id: 'e10', at: '2026-11-05T16:00:00Z', actor: 'sora', kind: 'recording', title: 'Re-recording 1', detail: 'Client asked for warmer tone. Re-recorded the full voiceover.', minutes: 18 },
  { id: 'e11', at: '2026-11-06T10:15:00Z', actor: 'jun', kind: 'edit', title: 'Edit cut 3: new voiceover synced', minutes: 45 },
  { id: 'e12', at: '2026-11-06T14:00:00Z', actor: 'sora', kind: 'recording', title: 'Re-recording 2', detail: 'Client asked for warmer tone again on the closing line. Re-recorded the full voiceover.', minutes: 18 },
  { id: 'e13', at: '2026-11-06T17:30:00Z', actor: 'jun', kind: 'edit', title: 'Edit cut 4 (final)', detail: 'Final voiceover synced, color pass.', minutes: 30 },
  { id: 'e14', at: '2026-11-07T09:00:00Z', actor: 'jun', kind: 'asset', title: 'Exported master file 1080x1920', minutes: 10 },
  { id: 'e15', at: '2026-11-07T11:00:00Z', actor: 'client', kind: 'approval', title: 'Client approved the final cut' },
];

/** 기여자 PayPal 이메일 — 팀장이 `DEMO_RECIPIENTS`(JSON {mina, jun, sora}) 로 sandbox 계정을 준다. 없으면 example.com(UNCLAIMED 로 남는다). */
export function parseRecipients(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

export function makeDemoProject(id: string, now: string, recipients: Record<string, string> = {}): Project {
  return {
    id,
    title: 'Spring launch short — Moonbrew Coffee',
    client: { name: 'Moonbrew Coffee' },
    budget: usd(DEMO_BUDGET),
    contributors: CONTRIBUTORS.map((c) => ({ ...c, paypalEmail: recipients[c.id] ?? `${c.id}.fairsplit@example.com` })),
    log: LOG.map((e) => ({ ...e })),
    status: 'draft',
    history: [],
    disputes: [],
    approvals: {},
    events: [{ at: now, text: 'Project created with the demo production log (15 events).' }],
  };
}
