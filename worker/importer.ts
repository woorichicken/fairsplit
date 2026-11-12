// 자기 로그로 새 프로젝트 — `POST /api/projects`. 기여자·예산·CSV 로그를 받아 draft Project 를 만든다.
// 순수 함수만 둔다(저장·AI 없음) → 유닛 테스트로 검증 규칙을 다 본다. 저장 직전에는 index.ts 가 같은 불변식 검사(invariantErrors)를 한 번 더 건다.
import type { Contributor, LogEvent, LogKind, Project } from '../src/shared/types';
import { toCents, usd } from './money';

export const CSV_HEADER = ['at', 'actor', 'kind', 'title', 'minutes', 'detail'] as const;
const LOG_KINDS: readonly LogKind[] = ['brief', 'draft', 'revision', 'review_comment', 'recording', 'edit', 'asset', 'approval'];

// 남용·실수 방지 상한 — 시연용 서비스라 작게 둔다
export const LIMITS = {
  minContributors: 2,
  maxContributors: 8,
  maxRows: 120,
  maxCsvChars: 30_000,
  maxText: 200,
  maxDetail: 500,
  maxMinutes: 24 * 60, // 한 줄이 하루를 넘으면 오타일 가능성이 크다
  maxBudgetCents: 100_000_00, // $100,000 — 샌드박스 시연 범위
} as const;

export class ImportError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join(' '));
  }
}

export interface ImportInput {
  title?: unknown;
  clientName?: unknown;
  budget?: unknown;
  contributors?: unknown;
  csv?: unknown;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLIENT_ACTOR = 'client';

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** 이름 → id(소문자·숫자·하이픈). 같은 id 가 생기면 뒤에 번호를 붙인다. */
function slug(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'person';
  let id = base === CLIENT_ACTOR ? 'client-person' : base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** RFC 4180 꼴 CSV — 큰따옴표 안의 쉼표·줄바꿈·"" 를 받는다. 빈 줄은 건너뛴다. */
export function parseCsv(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** 입력 전체를 검사해 draft Project 를 만든다. 틀린 곳은 모아서 한 번에 돌려준다(몇째 줄·무엇). */
export function buildImportedProject(input: ImportInput, id: string, now: string): Project {
  const problems: string[] = [];
  const title = text(input.title, LIMITS.maxText);
  const clientName = text(input.clientName, LIMITS.maxText);
  if (!title) problems.push('Give the project a title.');
  if (!clientName) problems.push('Give the client a name.');

  let budgetValue = '';
  try {
    const cents = toCents(String(input.budget ?? ''));
    if (cents <= 0 || cents > LIMITS.maxBudgetCents) problems.push(`Budget must be between $0.01 and $${LIMITS.maxBudgetCents / 100}.`);
    else budgetValue = usd(String(input.budget)).value;
  } catch {
    problems.push('Budget must be a number like 600 or 600.00.');
  }

  const rawPeople = Array.isArray(input.contributors) ? (input.contributors as Record<string, unknown>[]) : [];
  const taken = new Set<string>();
  const contributors: Contributor[] = [];
  rawPeople.forEach((raw, i) => {
    const name = text(raw?.name, 60);
    const role = text(raw?.role, 60);
    const paypalEmail = text(raw?.paypalEmail, 120);
    if (!name) return problems.push(`Contributor ${i + 1}: name is required.`);
    if (!role) problems.push(`Contributor ${i + 1} (${name}): role is required.`);
    if (!EMAIL.test(paypalEmail)) problems.push(`Contributor ${i + 1} (${name}): "${paypalEmail}" is not an email address.`);
    if (contributors.some((c) => c.name.toLowerCase() === name.toLowerCase())) problems.push(`Contributor ${i + 1}: the name "${name}" is used twice.`);
    contributors.push({ id: slug(name, taken), name, role, paypalEmail, avatar: name.slice(0, 1).toUpperCase() });
  });
  if (contributors.length < LIMITS.minContributors || contributors.length > LIMITS.maxContributors) {
    problems.push(`Add ${LIMITS.minContributors} to ${LIMITS.maxContributors} contributors (now ${contributors.length}).`);
  }

  const csv = typeof input.csv === 'string' ? input.csv : '';
  const log: LogEvent[] = [];
  if (!csv.trim()) problems.push('Paste the production log as CSV.');
  else if (csv.length > LIMITS.maxCsvChars) problems.push(`The CSV is too long (max ${LIMITS.maxCsvChars} characters).`);
  else {
    const rows = parseCsv(csv);
    const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
    if (header.join(',') !== CSV_HEADER.join(',')) problems.push(`The first line must be exactly: ${CSV_HEADER.join(',')}`);
    else {
      const body = rows.slice(1);
      if (body.length === 0) problems.push('The CSV has a header but no log lines.');
      if (body.length > LIMITS.maxRows) problems.push(`Too many log lines (${body.length}, max ${LIMITS.maxRows}).`);
      const byName = new Map(contributors.map((c) => [c.name.toLowerCase(), c.id]));
      body.slice(0, LIMITS.maxRows).forEach((cells, i) => {
        const line = i + 2; // 사람이 보는 줄 번호(머리 = 1줄)
        const [at, actor, kind, rowTitle, minutes, detail] = CSV_HEADER.map((_, k) => (cells[k] ?? '').trim());
        if (cells.length > CSV_HEADER.length) problems.push(`Line ${line}: ${cells.length} columns — put commas inside "quotes".`);
        const when = new Date(at);
        if (!at || Number.isNaN(when.getTime())) problems.push(`Line ${line}: "${at}" is not a date (use 2026-11-02 or 2026-11-02T09:00).`);
        const actorKey = actor.toLowerCase();
        const actorId = actorKey === CLIENT_ACTOR ? CLIENT_ACTOR : byName.get(actorKey);
        if (!actorId) problems.push(`Line ${line}: actor "${actor}" is not a contributor name or "client".`);
        if (!LOG_KINDS.includes(kind as LogKind)) problems.push(`Line ${line}: kind "${kind}" must be one of ${LOG_KINDS.join(', ')}.`);
        if (!rowTitle) problems.push(`Line ${line}: title is empty.`);
        let mins: number | undefined;
        if (minutes) {
          mins = Number(minutes);
          if (!Number.isInteger(mins) || mins < 0 || mins > LIMITS.maxMinutes) problems.push(`Line ${line}: minutes "${minutes}" must be a whole number from 0 to ${LIMITS.maxMinutes}.`);
        }
        log.push({
          id: `e${String(i + 1).padStart(2, '0')}`,
          at: Number.isNaN(when.getTime()) ? at : when.toISOString(),
          actor: actorId ?? actor,
          kind: kind as LogKind,
          title: rowTitle.slice(0, LIMITS.maxText),
          ...(detail ? { detail: detail.slice(0, LIMITS.maxDetail) } : {}),
          ...(mins !== undefined && Number.isInteger(mins) ? { minutes: mins } : {}),
        });
      });
      for (const c of contributors) {
        if (!log.some((e) => e.actor === c.id)) problems.push(`${c.name} has no lines in the log — the AI would have nothing to read for them.`);
      }
    }
  }

  if (problems.length) throw new ImportError(problems);
  return {
    id,
    title,
    client: { name: clientName },
    budget: usd(budgetValue),
    contributors,
    log,
    status: 'draft',
    history: [],
    disputes: [],
    approvals: {},
    events: [{ at: now, text: `Project created from an imported production log (${log.length} events, ${contributors.length} contributors).` }],
  };
}
