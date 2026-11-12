import { useEffect, useRef } from 'react';
import type { Contributor, LogEvent, PayoutItem, Project, Proposal, Share } from '../shared/types';
import { formatMoney, formatTime, initials, KIND_LABEL, payoutStatusLabel, personName, stepsDone } from './format';

export function TopBar({ sample }: { sample: boolean }) {
  return (
    <header className="topbar">
      <a href="/" className="wordmark" aria-label="FairSplit home">
        <img src="/logo/wordmark.svg" alt="FairSplit" width="118" height="32" />
      </a>
      {sample && (
        <span className="badge badge-warn" title="Shown from built-in sample data, not the live server">
          Sample data
        </span>
      )}
    </header>
  );
}

const STEPS = ['Funded', 'Proposed', 'Agreed', 'Paid'] as const;

export function Stepper({ project }: { project: Project }) {
  const done = stepsDone(project.status);
  // 결제 승인 전에도 제안·이의가 돈다(계약서) — 「Funded」 칸은 상태가 아니라 승인 여부로 칠한다
  const funded = !!project.order?.authorizationId || done >= 3;
  return (
    <ol className={`stepper${project.status === 'paid' ? ' is-paid' : ''}`} aria-label="Progress">
      {STEPS.map((label, i) => {
        const isDone = i === 0 ? funded : i < done;
        const state = isDone ? 'done' : i === done || (i === 0 && !funded) ? 'current' : 'todo';
        return (
          <li key={label} className={`step step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="step-dot" aria-hidden="true">
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className="step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Avatar({ contributor }: { contributor: Contributor }) {
  return (
    <span className="avatar" aria-hidden="true">
      {initials(contributor)}
    </span>
  );
}

// ───────── Production log (왼쪽) — 근거 칩을 누르면 해당 줄이 밝아진다 ─────────

const LOG_SCROLL_GAP = 8;

export function LogPanel({ project, highlight }: { project: Project; highlight: readonly string[] }) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!highlight.length || !list) return;
    const first = list.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(highlight[0])}"]`);
    if (!first) return;
    // 데스크톱은 목록만 스크롤된다(제목은 고정) — 고른 줄이 잘리지 않게 줄 머리를 목록 위쪽에 맞춘다. 폰은 페이지가 스크롤된다.
    if (list.scrollHeight > list.clientHeight) list.scrollTo({ top: Math.max(0, first.offsetTop - LOG_SCROLL_GAP), behavior: 'smooth' });
    else first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight]);

  return (
    <section className="card log" aria-labelledby="log-title">
      <div className="card-head">
        <h2 id="log-title" className="card-title">
          Production log
        </h2>
        <span className="muted small">{project.log.length} events</span>
      </div>
      {project.log.length === 0 ? (
        <p className="empty">No log events yet. The AI needs the production log to propose a split.</p>
      ) : (
        <ol className="log-list" ref={listRef}>
          {project.log.map((e) => (
            <LogRow key={e.id} event={e} who={personName(project, e.actor)} on={highlight.includes(e.id)} />
          ))}
        </ol>
      )}
    </section>
  );
}

function LogRow({ event, who, on }: { event: LogEvent; who: string; on: boolean }) {
  return (
    <li className={`log-row${on ? ' is-on' : ''}`} data-event-id={event.id} data-testid={`log-${event.id}`} data-highlight={on ? 'true' : 'false'}>
      <span className="log-id">{event.id}</span>
      <div className="log-body">
        <div className="log-line">
          <span className="kind">{KIND_LABEL[event.kind] ?? event.kind}</span>
          <span className="log-title">{event.title}</span>
        </div>
        <div className="muted small">
          {who} · {formatTime(event.at)}
          {event.minutes ? ` · ${event.minutes} min` : ''}
        </div>
        {event.detail && <div className="small log-detail">{event.detail}</div>}
      </div>
    </li>
  );
}

// ───────── Split card (오른쪽) ─────────

/** 지금 판 바로 앞의 판 — history 에 지금 판이 들어 있어도 되게 version 으로 고른다 */
export function previousProposal(project: Project): Proposal | undefined {
  const now = project.proposal?.version ?? 0;
  return [...project.history].filter((p) => p.version < now).sort((a, b) => b.version - a.version)[0];
}

export function SplitCard({
  project,
  onEvidence,
  activeEvidence,
  compact = false,
}: {
  project: Project;
  onEvidence: (ids: string[]) => void;
  activeEvidence: readonly string[];
  /** 첫 화면 미리보기 — 같은 카드를 줄여서 쓴다(오름 화살표 · 사람당 근거 칩 1개 · 요약·과정 숨김) */
  compact?: boolean;
}) {
  const proposal = project.proposal!;
  const prev = previousProposal(project);
  const version = proposal.version;
  // 이의가 몫을 바꿨는지 — 안 바꿨으면 「거절」 답으로 보인다
  const splitMoved = !!prev && proposal.shares.some((s) => prev.shares.find((x) => x.contributorId === s.contributorId)?.percent !== s.percent);
  const answered = [...project.disputes].reverse().find((d) => d.answeredInVersion === version);
  const disputerName = answered ? (project.contributors.find((c) => c.id === answered.contributorId)?.name ?? answered.contributorId) : undefined;

  return (
    <section className={`card split${compact ? ' split-compact' : ''}`} aria-labelledby={compact ? undefined : 'split-title'} aria-label={compact ? 'Example split' : undefined}>
      <div className="card-head">
        <h2 id={compact ? undefined : 'split-title'} className="card-title">
          Proposed split <span className="version">v{version}</span>
        </h2>
        {compact && (
          <span className="badge badge-warn" title="A recorded AI answer from the demo project, not live">
            Recorded example
          </span>
        )}
        {proposal.by === 'rule' ? (
          <span className="badge badge-rule" title="The AI did not answer in time, so a fixed rule (role weight × minutes) proposed this split">
            Rule-based fallback
          </span>
        ) : (
          <span className="badge badge-ai">AI proposal{proposal.model ? ` · ${proposal.model}` : ''}</span>
        )}
      </div>
      <p className="split-total">
        <span className="num">{formatMoney(project.budget)}</span> <span className="muted">from {project.client.name}</span>
      </p>
      {!compact && <p className="small">{proposal.summary}</p>}

      {!compact && <ApprovalStrip project={project} />}

      {!compact && prev && proposal.changedBecause && (
        <div className="changed" role="note" aria-label={splitMoved ? `What changed from v${prev.version}` : `AI answer to ${disputerName ?? 'the dispute'}`}>
          <strong className="changed-title">
            {splitMoved ? `What changed from v${prev.version} → v${version}` : `AI answer to ${disputerName ?? 'the'}’s dispute — split unchanged`}
          </strong>
          {answered && (
            <p className="small muted">
              {disputerName}: “{answered.text}”
            </p>
          )}
          <p className="small">{proposal.changedBecause}</p>
        </div>
      )}

      <ul className="shares">
        {proposal.shares.map((s) => {
          const person = project.contributors.find((c) => c.id === s.contributorId);
          const before = prev?.shares.find((x) => x.contributorId === s.contributorId);
          return (
            <ShareRow
              key={s.contributorId}
              share={s}
              before={before}
              person={person}
              project={project}
              approvedThisVersion={project.approvals[s.contributorId]?.version === version}
              onEvidence={onEvidence}
              activeEvidence={activeEvidence}
              compact={compact}
            />
          );
        })}
      </ul>

      {!compact && proposal.steps && proposal.steps.length > 0 && (
        <details className="steps">
          <summary className="small">How the {proposal.by === 'rule' ? 'rule' : 'AI'} checked ({proposal.steps.length} steps)</summary>
          <ol>
            {proposal.steps.map((st, i) => (
              <li key={`${st.tool}-${i}`} className="small">
                <code className="tool">{st.tool}</code> {st.result}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

function ShareRow({
  share,
  before,
  person,
  project,
  approvedThisVersion,
  onEvidence,
  activeEvidence,
  compact,
}: {
  compact: boolean;
  share: Share;
  before?: Share;
  person?: Contributor;
  project: Project;
  approvedThisVersion: boolean;
  onEvidence: (ids: string[]) => void;
  activeEvidence: readonly string[];
}) {
  const delta = before ? share.percent - before.percent : 0;
  const name = person?.name ?? share.contributorId;
  // 미리보기: 마지막 근거에서 그 사람이 직접 한 일 한 줄만
  const lastReason = share.reasons[share.reasons.length - 1];
  const ownEvent = lastReason?.eventIds.find((eid) => project.log.find((e) => e.id === eid)?.actor === share.contributorId) ?? lastReason?.eventIds[0];
  const reasons = compact ? (lastReason && ownEvent ? [{ text: lastReason.text, eventIds: [ownEvent] }] : []) : share.reasons;
  const showDelta = before && delta !== 0 && (!compact || delta > 0);
  return (
    <li className="share" data-testid={`share-${share.contributorId}`}>
      <div className="share-top">
        {person && <Avatar contributor={person} />}
        <div className="share-who">
          <strong>{name}</strong>
          <span className="muted small">{person?.role}</span>
        </div>
        <div className="share-num">
          <span className="num">{share.percent}%</span>
          <span className="small">{formatMoney(share.amount)}</span>
        </div>
      </div>
      {showDelta && (
        <p className={`delta ${delta > 0 ? 'delta-up' : 'delta-down'}`}>
          <span aria-hidden="true">{delta > 0 ? '▲' : '▼'}</span> {before.percent}% → {share.percent}% ({delta > 0 ? '+' : '−'}
          {Math.abs(delta)} pts · was {formatMoney(before.amount)})
        </p>
      )}
      {!compact && before && delta === 0 && <p className="delta muted">No change from {previousVersionLabel(project)}</p>}
      <div className="bar" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, share.percent))}%` }} />
      </div>
      <ul className="reasons">
        {reasons.map((r, i) => (
          <li key={i} className="reason">
            <span className="small">{r.text}</span>
            <span className="chips">
              {r.eventIds.map((id) => {
                const ev = project.log.find((e) => e.id === id);
                const on = activeEvidence.includes(id);
                const label = `${id} · ${ev ? shorten(ev.title) : 'missing event'}`;
                if (compact) {
                  return (
                    <span key={id} className="chip chip-static">
                      {label}
                    </span>
                  );
                }
                return (
                  <button
                    key={id}
                    type="button"
                    className={`chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => onEvidence(r.eventIds)}
                    title={ev ? `${ev.id}: ${ev.title}` : `Log event ${id}`}
                  >
                    {label}
                  </button>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
      {approvedThisVersion && <p className="approved small">✓ {name} approved this version</p>}
    </li>
  );
}

const CHIP_MAX = 22;
const shorten = (t: string) => (t.length > CHIP_MAX ? `${t.slice(0, CHIP_MAX - 1)}…` : t);
const previousVersionLabel = (p: Project) => `v${previousProposal(p)?.version ?? ''}`;

/** AI 가 생각하는 동안 — 스켈레톤 + 몇 줄을 읽는 중인지 */
export function ThinkingCard({ title, line, note }: { title: string; line: string; note?: string }) {
  return (
    <section className="card split thinking" aria-busy="true" aria-live="polite">
      <div className="card-head">
        <h2 className="card-title">{title}</h2>
        <span className="spinner" aria-hidden="true" />
      </div>
      <p className="small" role="status">
        {line}
      </p>
      {note && <p className="small slow-note">{note}</p>}
      <div className="skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

// ───────── Payout receipt ─────────

/** 영수증 — PayPal 이 돌려준 실제 ID 를 그대로 보인다(주문·승인·capture·배치·항목·거래). 심사위원이 「진짜 돈길」을 확인할 수 있게. */
export function Receipt({ project }: { project: Project }) {
  const payout = project.payout!;
  const sending = project.status === 'paying';
  const n = payout.items.length;
  const unclaimed = payout.items.filter((i) => i.status.toUpperCase() === 'UNCLAIMED').length;
  const ids: [string, string | undefined][] = [
    ['PayPal order', project.order?.id],
    ['Authorization', project.order?.authorizationId],
    ['Capture', project.order?.captureId],
    ['Payouts batch', payout.batchId],
  ];
  return (
    <section className="card receipt" aria-labelledby="receipt-title">
      <div className="card-head">
        <h2 id="receipt-title" className="card-title">
          {sending ? `PayPal is sending ${n} payouts…` : 'Payout receipt'}
        </h2>
        {sending ? <span className="spinner" aria-hidden="true" /> : <span className="badge badge-ok">Batch {payout.status}</span>}
      </div>
      <p className="small muted">One PayPal Payouts batch for all {n} contributors. IDs below come straight from PayPal (sandbox).</p>
      <dl className="ids">
        {ids
          .filter((x): x is [string, string] => Boolean(x[1]))
          .map(([label, value]) => (
            <div key={label}>
              <dt className="small muted">{label}</dt>
              <dd>
                <code className="tool">{value}</code>
              </dd>
            </div>
          ))}
      </dl>
      <ul className="receipt-list">
        {payout.items.map((item) => (
          <ReceiptRow key={item.contributorId} item={item} project={project} />
        ))}
      </ul>
      {unclaimed > 0 && (
        <p className="small muted unclaimed-note">
          Unclaimed means PayPal sent the money and emailed the receiver a claim link. It waits for them to sign in to PayPal. In this sandbox demo
          the receivers have no sandbox accounts, so {unclaimed === n ? 'all' : unclaimed} {unclaimed === 1 ? 'payout stays' : 'payouts stay'} unclaimed.
        </p>
      )}
    </section>
  );
}

function ReceiptRow({ item, project }: { item: PayoutItem; project: Project }) {
  const person = project.contributors.find((c) => c.id === item.contributorId);
  const ok = item.status.toUpperCase() === 'SUCCESS';
  return (
    <li className="receipt-row" data-testid={`payout-${item.contributorId}`}>
      <div className="receipt-top">
        {person && <Avatar contributor={person} />}
        <div className="share-who">
          <strong>{person?.name ?? item.contributorId}</strong>
          <span className="muted small email" title={person?.paypalEmail}>
            {person?.paypalEmail}
          </span>
        </div>
        <span className="num">{formatMoney(item.amount)}</span>
      </div>
      <p className={`small ${ok ? 'ok' : 'warn'}`}>{payoutStatusLabel(item.status)}</p>
      <p className="small muted receipt-ids">
        Payout item <code className="tool">{item.payoutItemId ?? '—'}</code> · Transaction <code className="tool">{item.transactionId ?? '—'}</code>
      </p>
    </li>
  );
}

// ───────── Activity ─────────

export function Activity({ project }: { project: Project }) {
  const items = [...project.events].reverse();
  return (
    <section className="card activity" aria-labelledby="activity-title">
      <h2 id="activity-title" className="card-title">
        Activity
      </h2>
      {items.length === 0 ? (
        <p className="empty">Nothing has happened yet.</p>
      ) : (
        <ol className="activity-list">
          {items.map((e, i) => (
            <li key={`${e.at}-${i}`} className="small">
              <span className="muted">{formatTime(e.at)}</span> {e.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const STATUS_LABEL: Record<Project['status'], string> = {
  draft: 'Waiting for funds',
  funded: 'Funded',
  proposed: 'Waiting for approvals',
  disputed: 'Disputed — AI revising',
  agreed: 'Everyone agreed',
  paying: 'PayPal is sending',
  paid: 'Paid',
};

export function StatusBadge({ status }: { status: Project['status'] }) {
  return <span className={`badge status-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** 이 판에 누가 동의했는지 — 분배 카드 맨 위에서 바로 보이게 */
function ApprovalStrip({ project }: { project: Project }) {
  const version = project.proposal?.version ?? 0;
  const done = project.contributors.filter((c) => project.approvals[c.id]?.version === version);
  if (project.status !== 'proposed' && project.status !== 'disputed') return null;
  return (
    <p className="approvals small" aria-label={`Approvals for v${version}`}>
      <span className="muted">
        Approvals {done.length} of {project.contributors.length}:
      </span>{' '}
      {project.contributors.map((c, i) => {
        const ok = done.includes(c);
        return (
          <span key={c.id} className={ok ? 'ok' : 'muted'}>
            {i > 0 && ' · '}
            {ok ? '✓' : '○'} {c.name}
          </span>
        );
      })}
    </p>
  );
}
