import { useEffect, useRef } from 'react';
import type { Contributor, LogEvent, PayoutItem, Project, Proposal, Share } from '../shared/types';
import { formatMoney, formatTime, initials, KIND_LABEL, payoutStatusLabel, personName, stepsDone } from './format';

export function TopBar({ sample }: { sample: boolean }) {
  return (
    <header className="topbar">
      <a href="/" className="wordmark">
        FairSplit
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
  return (
    <ol className={`stepper${project.status === 'paid' ? ' is-paid' : ''}`} aria-label="Progress">
      {STEPS.map((label, i) => {
        const state = i < done ? 'done' : i === done ? 'current' : 'todo';
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

export function LogPanel({ project, highlight }: { project: Project; highlight: readonly string[] }) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!highlight.length) return;
    const first = listRef.current?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(highlight[0])}"]`);
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
}: {
  project: Project;
  onEvidence: (ids: string[]) => void;
  activeEvidence: readonly string[];
}) {
  const proposal = project.proposal!;
  const prev = previousProposal(project);
  const version = proposal.version;

  return (
    <section className="card split" aria-labelledby="split-title">
      <div className="card-head">
        <h2 id="split-title" className="card-title">
          Proposed split <span className="version">v{version}</span>
        </h2>
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
      <p className="small">{proposal.summary}</p>

      {prev && proposal.changedBecause && (
        <div className="changed" role="note" aria-label={`What changed from v${prev.version}`}>
          <strong className="changed-title">
            What changed from v{prev.version} → v{version}
          </strong>
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
            />
          );
        })}
      </ul>

      {proposal.steps && proposal.steps.length > 0 && (
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
}: {
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
      {before && delta !== 0 && (
        <p className={`delta ${delta > 0 ? 'delta-up' : 'delta-down'}`}>
          <span aria-hidden="true">{delta > 0 ? '▲' : '▼'}</span> {before.percent}% → {share.percent}% ({delta > 0 ? '+' : '−'}
          {Math.abs(delta)} pts · was {formatMoney(before.amount)})
        </p>
      )}
      {before && delta === 0 && <p className="delta muted">No change from {previousVersionLabel(project)}</p>}
      <div className="bar" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(100, share.percent))}%` }} />
      </div>
      <ul className="reasons">
        {share.reasons.map((r, i) => (
          <li key={i} className="reason">
            <span className="small">{r.text}</span>
            <span className="chips">
              {r.eventIds.map((id) => {
                const ev = project.log.find((e) => e.id === id);
                const on = activeEvidence.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => onEvidence(r.eventIds)}
                    title={ev ? `${ev.id}: ${ev.title}` : `Log event ${id}`}
                  >
                    {id} · {ev ? shorten(ev.title) : 'missing event'}
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
export function ThinkingCard({ title, line }: { title: string; line: string }) {
  return (
    <section className="card split thinking" aria-busy="true" aria-live="polite">
      <div className="card-head">
        <h2 className="card-title">{title}</h2>
        <span className="spinner" aria-hidden="true" />
      </div>
      <p className="small" role="status">
        {line}
      </p>
      <div className="skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

// ───────── Payout receipt ─────────

export function Receipt({ project }: { project: Project }) {
  const payout = project.payout!;
  const sending = project.status === 'paying';
  const n = payout.items.length;
  return (
    <section className="card receipt" aria-labelledby="receipt-title">
      <div className="card-head">
        <h2 id="receipt-title" className="card-title">
          {sending ? `PayPal is sending ${n} payouts…` : 'Payout receipt'}
        </h2>
        {sending ? <span className="spinner" aria-hidden="true" /> : <span className="badge badge-ok">Paid</span>}
      </div>
      <p className="small muted">
        One PayPal Payouts batch · <code className="tool">{payout.batchId}</code>
        {project.order?.captureId && (
          <>
            {' '}
            · capture <code className="tool">{project.order.captureId}</code>
          </>
        )}
      </p>
      <ul className="receipt-list">
        {payout.items.map((item) => (
          <ReceiptRow key={item.contributorId} item={item} project={project} />
        ))}
      </ul>
    </section>
  );
}

function ReceiptRow({ item, project }: { item: PayoutItem; project: Project }) {
  const person = project.contributors.find((c) => c.id === item.contributorId);
  const ok = item.status.toUpperCase() === 'SUCCESS';
  return (
    <li className="receipt-row" data-testid={`payout-${item.contributorId}`}>
      {person && <Avatar contributor={person} />}
      <div className="share-who">
        <strong>{person?.name ?? item.contributorId}</strong>
        <span className="muted small">{person?.paypalEmail}</span>
      </div>
      <div className="receipt-right">
        <span className="num">{formatMoney(item.amount)}</span>
        <span className={`small ${ok ? 'ok' : 'warn'}`}>{payoutStatusLabel(item.status)}</span>
        <code className="tool">{item.payoutItemId ?? '—'}</code>
      </div>
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
