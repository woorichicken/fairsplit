import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LogKind, Project } from '../shared/types';
import { ApiError, fixtureFromUrl, getApi, type MissingWork } from './api';
import { EXAMPLE_MISSING, EXAMPLE_WEAK } from './fixtures';
import type { Navigate } from './App';
import { formatMoney, KIND_LABEL, plainText } from './format';
import { Activity, Avatar, LogPanel, Receipt, SplitCard, StatusBadge, Stepper, ThinkingCard, TopBar } from './parts';

// Payouts 는 PENDING 으로 시작해 몇 초~몇 분 뒤 끝난다(12:30 실측) — 그동안 이 간격으로 refresh 한다
const PAYOUT_POLL_MS = 2000;
const DISPUTE_MAX = 500;
// 「AI 가 근거 없는 이의는 받아 주지 않는다」를 보여 주는 예시(시연 데이터의 Jun 만) — 결과는 실제 AI 가 정한다
// 예시는 실측 때 보낸 값과 같다(fixtures.ts EXAMPLE_* ← samples/story-*.json ← e2e/dispute-eval.mjs)
const MISSING_KINDS: LogKind[] = ['recording', 'edit', 'revision', 'draft', 'asset'];

interface MissingDraft { open: boolean; kind: LogKind; title: string; minutes: string; at: string }
const EMPTY_MISSING: MissingDraft = { open: false, kind: 'recording', title: '', minutes: '', at: '' };

/** ISO → <input type="datetime-local"> 값(보는 사람 시간대) */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// 서버는 20초에 규칙 제안으로 넘어간다(계약서) — 15초가 지나면 「오래 걸린다」를 미리 말해 둔다
const SLOW_AI_MS = 15_000;

type Busy = null | 'load' | 'fund' | 'complete' | 'propose' | 'dispute' | 'approve';

const errorText = (e: unknown) => (e instanceof ApiError ? e : new ApiError('unknown', 'Something went wrong. Try again in a moment.', 0));

/** 서버 오류를 사람 말로 — 5xx 의 기술 문구는 보이지 않고, 돈이 움직이지 않았다는 것부터 말한다 */
export function humanError(e: ApiError): string {
  if (e.code === 'FUNDING_REQUIRED') return e.message || 'The client has not authorized the PayPal payment yet. Fund the job first, then approve again.';
  if (e.status >= 500) return 'FairSplit’s server had a problem. No money was moved. Try again in a moment.';
  return e.message;
}

export function ProjectPage({ id, navigate }: { id: string; navigate: Navigate }) {
  const api = useMemo(getApi, []);
  const sample = fixtureFromUrl() !== null;
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<Busy>('load');
  const [viewerId, setViewerId] = useState('');
  const [highlight, setHighlight] = useState<string[]>([]);
  const [disputeText, setDisputeText] = useState('');
  const [missing, setMissing] = useState<MissingDraft>(EMPTY_MISSING);
  // 이의 폼은 누를 때만 — 처음 보는 사람에게 결정 카드의 할 일은 「동의」 하나로 보이게(6회차)
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [slow, setSlow] = useState(false);

  // 첫 로드 — PayPal 에서 돌아온 경우(?paypal=return&token=<orderId>)면 fund/complete 를 먼저 부른다
  const load = useCallback(async () => {
    setBusy('load');
    setLoadError(null);
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('paypal') === 'return' ? params.get('token') : null;
    try {
      let p: Project;
      if (orderId) {
        setBusy('complete');
        p = await api.completeFund(id, orderId);
        // 새로고침해도 다시 complete 를 부르지 않게 주소에서 돌아오기 표시를 뗀다
        params.delete('paypal');
        params.delete('token');
        params.delete('PayerID');
        const rest = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
      } else {
        p = await api.getProject(id);
      }
      setProject(p);
    } catch (e) {
      setLoadError(errorText(e));
    } finally {
      setBusy(null);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // 보는 사람 기본값 = 첫 기여자. 기여자 목록이 바뀌어 사라졌으면 다시 고른다
  useEffect(() => {
    if (!project) return;
    if (!project.contributors.some((c) => c.id === viewerId)) setViewerId(project.contributors[0]?.id ?? '');
  }, [project, viewerId]);

  // 보내는 중이면 끝날 때까지 상태를 묻는다
  useEffect(() => {
    if (project?.status !== 'paying') return;
    const timer = setInterval(() => {
      api.refresh(id).then(setProject, (e) => setActionError(errorText(e)));
    }, PAYOUT_POLL_MS);
    return () => clearInterval(timer);
  }, [api, id, project?.status]);

  // AI 를 기다리는 시간이 길어지면 안내를 더한다
  useEffect(() => {
    setSlow(false);
    if (busy !== 'propose' && busy !== 'dispute') return;
    const timer = setTimeout(() => setSlow(true), SLOW_AI_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  async function act(kind: Exclude<Busy, null | 'load'>, run: () => Promise<Project>) {
    setBusy(kind);
    setActionError(null);
    try {
      const p = await run();
      setProject(p);
      return true;
    } catch (e) {
      setActionError(errorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function fund() {
    setBusy('fund');
    setActionError(null);
    try {
      const { approveUrl } = await api.fund(id);
      // PayPal 승인 화면으로 간다 — 돌아오면 load() 가 fund/complete 를 부른다
      if (approveUrl.startsWith('/')) navigate(approveUrl);
      else window.location.assign(approveUrl);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function sendDispute() {
    const text = disputeText.trim();
    if (!text || !viewerId) return;
    setHighlight([]);
    // 시간 칸이 비면 toISOString 이 RangeError 로 죽어 버튼이 무반응이 된다(r2 사용자 시험) — 만들기 전에 먼저 막고 말로 알린다
    if (missing.open && missing.title.trim() && Number.isNaN(new Date(missing.at).getTime())) {
      setActionError(new ApiError('BAD_MISSING_WORK', 'Add when the missing work happened (date and time), then send again.', 400));
      return;
    }
    // 빠진 작업은 칸을 열고 제목을 쓴 경우에만 보낸다 — 검증(종류·시간·분)은 서버가 한다
    const work: MissingWork | undefined =
      missing.open && missing.title.trim()
        ? { kind: missing.kind, title: missing.title.trim(), at: new Date(missing.at).toISOString(), ...(missing.minutes ? { minutes: Number(missing.minutes) } : {}) }
        : undefined;
    if (await act('dispute', () => api.dispute(id, viewerId, text, work))) {
      setDisputeText('');
      setMissing(EMPTY_MISSING);
      setDisputeOpen(false);
    }
  }

  // ───────── 큰 상태: 로딩 · 오류 ─────────
  if (!project) {
    return (
      <div className="page">
        <TopBar sample={sample} />
        <main className="project">
          {loadError ? (
            <div className="card">
              <p role="alert" className="alert">
                {loadError.status === 404 ? 'This project does not exist. It may have been reset. Start a new demo.' : humanError(loadError)}
              </p>
              <div className="row">
                <button type="button" className="btn btn-primary" onClick={() => void load()}>
                  Try again
                </button>
                <button type="button" className="btn" onClick={() => navigate('/')}>
                  Start a new demo
                </button>
              </div>
            </div>
          ) : (
            <ThinkingCard title={busy === 'complete' ? 'Confirming your PayPal payment…' : 'Loading the project…'} line="One moment." />
          )}
        </main>
      </div>
    );
  }

  const viewer = project.contributors.find((c) => c.id === viewerId);
  const version = project.proposal?.version ?? 0;
  const viewerApproved = !!viewer && project.approvals[viewer.id]?.version === version;
  const waitingFor = project.contributors.filter((c) => project.approvals[c.id]?.version !== version);
  const canDecide = !!project.proposal && (project.status === 'proposed' || project.status === 'disputed');
  const thinking = busy === 'propose' || busy === 'dispute';
  const moneyMoving = project.status === 'agreed' || project.status === 'paying' || project.status === 'paid';
  const needsFunding = !project.order?.authorizationId && !moneyMoving;
  // 오류는 누른 버튼 가까이에 — 폰에서 화면 맨 위 알림은 안 보인다
  const showDecide = canDecide && !!viewer && !thinking;
  // 예시 버튼은 시연 데이터(그 사람이 있을 때)에만
  const weakDisputer = project.contributors.find((c) => c.id === EXAMPLE_WEAK.contributorId);
  const missingDisputer = project.contributors.find((c) => c.id === EXAMPLE_MISSING.contributorId);
  // 사람당 판마다 1번 — 이 판에 이미 걸었거나 이 판이 자기 이의의 답이면 폼 대신 안내(서버도 409 DISPUTE_LIMIT)
  const disputeOf = (personId: string) => project.disputes.find((d) => d.contributorId === personId && (d.onVersion === version || d.answeredInVersion === version));
  const blockedOn = (personId: string) => Boolean(disputeOf(personId));
  const viewerDispute = viewer ? disputeOf(viewer.id) : undefined;
  const n = project.log.length;

  return (
    <div className="page">
      <TopBar sample={sample} />
      <main className="project">
        <header className="project-head">
          <div>
            <p className="title-row">
              <span className="eyebrow">Client: {project.client.name}</span>
              <StatusBadge status={project.status} />
            </p>
            <h1 className="project-title">{project.title}</h1>
            <p className="muted small">
              Budget {formatMoney(project.budget)} · {project.contributors.length} contributors
            </p>
          </div>
          <label className="viewer">
            <span className="small muted">Viewing as</span>
            <select value={viewerId} onChange={(e) => setViewerId(e.target.value)} aria-label="Viewing as">
              {project.contributors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.role})
                </option>
              ))}
            </select>
          </label>
        </header>

        {/* 폰 첫 화면 — 브랜드 색 면 + 큰 숫자 + 상태별 주 버튼 하나(모바일 한 턴 11-12, 700px 이하에만 보인다) */}
        <MoneyHero
          project={project}
          waitingFor={waitingFor.length}
          busy={busy}
          action={
            needsFunding && !project.proposal
              ? { label: busy === 'fund' ? 'Opening PayPal…' : `Pay ${formatMoney(project.budget)} on PayPal (sandbox)`, run: () => void fund() }
              : !project.proposal && (project.status === 'draft' || project.status === 'funded') && n > 0 && !thinking
                ? { label: 'Let the AI propose the split', run: () => void act('propose', () => api.propose(id)) }
                : showDecide && waitingFor.length > 0
                  ? { label: viewerApproved ? 'See who still has to approve' : `Review v${version} and decide`, run: () => document.getElementById('decide-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
                  : null
          }
        />

        <Stepper project={project} />

        {/* 첫 화면에서 할 일이 한 문장으로 읽히게(toss-lens one-thing) — 주 버튼을 늘리지 않으려고 링크로 */}
        {showDecide && waitingFor.length > 0 && (
          <p className="next-step small">
            Next: {waitingFor.map((c) => c.name).join(', ')} approve v{version}.{' '}
            <a href="#decide-title" onClick={(e) => { e.preventDefault(); document.getElementById('decide-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
              Go to your decision ↓
            </a>
          </p>
        )}

        {actionError && !showDecide && <ActionAlert error={actionError} />}

        <div className="layout">
          <div className="col-log">
            <LogPanel project={project} highlight={highlight} />
          </div>

          <div className="col-main">
            {needsFunding && (
              <section className="card fund" aria-labelledby="fund-title">
                <div className="card-head">
                  <h2 id="fund-title" className="card-title">
                    {project.client.name} funds the job
                  </h2>
                  <span className="badge status-draft">Not funded yet</span>
                </div>
                <p className="small muted">
                  {formatMoney(project.budget)} is authorized on PayPal now. PayPal holds an authorization for up to 29 days (3-day honor period);
                  FairSplit captures only after everyone agrees. If agreement takes longer than that, the client authorizes again. The AI can propose
                  before funding. The payment is needed only for the last approval.
                </p>
                <div className="fund-row">
                  <button type="button" className="btn" onClick={fund} disabled={busy !== null}>
                    {busy === 'fund' ? 'Opening PayPal…' : 'Fund with PayPal (sandbox)'}
                  </button>
                  <p className="small sandbox-hint">
                    Sandbox: choose <b>Pay with debit or credit card</b>, country <b>United States</b>, card <code className="tool">4005 5192 0000 0004</code>, any future
                    expiry, any CVV.
                  </p>
                </div>
              </section>
            )}

            {project.payout && <Receipt project={project} />}

            {thinking ? (
              <ThinkingCard
                title={busy === 'dispute' ? `AI is re-checking for ${viewer?.name ?? 'the dispute'}` : 'AI is proposing a split'}
                line={busy === 'dispute' ? `Re-reading ${n} log events with ${viewer?.name ?? 'the'}’s dispute…` : `Reading ${n} log events…`}
                note={slow ? 'This is taking longer than usual. If the AI does not answer within 20 seconds, FairSplit uses a rule-based split instead. You will see a “Rule-based fallback” badge.' : undefined}
              />
            ) : project.proposal ? (
              <SplitCard project={project} onEvidence={setHighlight} activeEvidence={highlight} />
            ) : (
              (project.status === 'draft' || project.status === 'funded') && (
                <section className="card" aria-labelledby="propose-title">
                  <h2 id="propose-title" className="card-title">
                    No split yet
                  </h2>
                  {n === 0 ? (
                    <p className="empty">This project has no production log yet, so there is nothing for the AI to read.</p>
                  ) : (
                    <p className="small">The AI will read all {n} log events and propose each person’s share, with evidence lines.</p>
                  )}
                  <button type="button" className="btn btn-primary" onClick={() => void act('propose', () => api.propose(id))} disabled={busy !== null || n === 0}>
                    Ask AI to propose a split
                  </button>
                </section>
              )
            )}

            {showDecide && viewer && (
              <section className="card decide" aria-labelledby="decide-title">
                <div className="card-head">
                  <h2 id="decide-title" className="card-title">
                    Your decision on v{version}
                  </h2>
                  <span className="viewer-chip">
                    <Avatar contributor={viewer} /> {viewer.name}
                  </span>
                </div>
                {actionError && <ActionAlert error={actionError} />}
                {viewerApproved ? (
                  <p className="approved">✓ {viewer.name} approved v{version}.</p>
                ) : (
                  <button type="button" className="btn btn-primary btn-lg" onClick={() => void act('approve', () => api.approve(id, viewer.id))} disabled={busy !== null}>
                    {busy === 'approve' ? 'Saving…' : `Approve as ${viewer.name}`}
                  </button>
                )}
                <p className="small muted">
                  {waitingFor.length === 0
                    ? 'Everyone has approved.'
                    : `Waiting for ${waitingFor.map((c) => c.name).join(', ')}. PayPal sends money only when all ${project.contributors.length} approve. Switch “Viewing as” to act for someone else (demo only).`}
                </p>

                <div className="row try-row">
                  {!viewerDispute && (
                    <button type="button" className="btn" aria-expanded={disputeOpen} aria-controls="dispute-form" onClick={() => setDisputeOpen((o) => !o)} disabled={busy !== null}>
                      {disputeOpen ? 'Close dispute' : 'Dispute this split'}
                    </button>
                  )}
                    {weakDisputer && !blockedOn(weakDisputer.id) && (
                      <button
                        type="button"
                        className="btn btn-quiet try-weak"
                        onClick={() => {
                          setViewerId(weakDisputer.id);
                          setDisputeText(EXAMPLE_WEAK.text);
                          setMissing(EMPTY_MISSING);
                          setDisputeOpen(true);
                        }}
                        disabled={busy !== null}
                      >
                        Try a weak dispute (as {weakDisputer.name})
                      </button>
                    )}
                    {missingDisputer && !blockedOn(missingDisputer.id) && (
                      <button
                        type="button"
                        className="btn btn-quiet try-weak"
                        onClick={() => {
                          const w = EXAMPLE_MISSING.missingWork;
                          setViewerId(missingDisputer.id);
                          setDisputeText(EXAMPLE_MISSING.text);
                          setMissing({ open: true, kind: w.kind, title: w.title, minutes: w.minutes === undefined ? '' : String(w.minutes), at: toLocalInput(w.at) });
                          setDisputeOpen(true);
                        }}
                        disabled={busy !== null}
                      >
                        Try adding missing work (as {missingDisputer.name})
                      </button>
                    )}
                </div>
                {viewerDispute ? (
                  <p className="small muted dispute-used">
                    {viewer.name} already {viewerDispute.onVersion === version ? `disputed v${version}` : `got an answer in v${version}`}. Each person gets one dispute per version
                    . Approve it, or wait until someone else’s dispute brings a new version.
                  </p>
                ) : (
                  disputeOpen && (
                <form
                  id="dispute-form"
                  className="dispute"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendDispute();
                  }}
                >
                  <label htmlFor="dispute-text" className="small">
                    Something missing? Tell the AI (as {viewer.name})
                  </label>
                  <textarea
                    id="dispute-text"
                    rows={2}
                    maxLength={DISPUTE_MAX}
                    value={disputeText}
                    onChange={(e) => setDisputeText(e.target.value)}
                    placeholder="e.g. My two re-recordings weren't counted."
                  />
                  {/* 말만 하면 AI 는 로그에 없는 일을 셀 수 없다 — 보내기 전에 알린다(이의는 판마다 1번이라 뒤에 알면 늦다, r2 사용자 시험) */}
                  <p className="small muted">
                    Words alone can’t change a share: the AI only counts work it can find in the log. If work is missing, add it below. You get one dispute per version.
                  </p>
                  <details className="missing" open={missing.open} onToggle={(e) => setMissing((m) => ({ ...m, open: (e.target as HTMLDetailsElement).open }))}>
                    <summary className="small">Add missing work (optional)</summary>
                    <p className="small muted">
                      It goes into the log marked “Added by {viewer.name} in a dispute”. The AI treats it as {viewer.name}’s own claim and checks it against the rest of the log.
                    </p>
                    <div className="missing-grid">
                      <label className="field">
                        <span className="small muted">Kind</span>
                        <select value={missing.kind} onChange={(e) => setMissing((m) => ({ ...m, kind: e.target.value as LogKind }))} aria-label="Missing work kind">
                          {MISSING_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field missing-title">
                        <span className="small muted">What was done</span>
                        <input value={missing.title} onChange={(e) => setMissing((m) => ({ ...m, title: e.target.value }))} maxLength={200} aria-label="Missing work title" />
                      </label>
                      <label className="field">
                        <span className="small muted">Minutes</span>
                        <input value={missing.minutes} onChange={(e) => setMissing((m) => ({ ...m, minutes: e.target.value }))} inputMode="numeric" aria-label="Missing work minutes" />
                      </label>
                      <label className="field">
                        <span className="small muted">When</span>
                        <input type="datetime-local" value={missing.at} onChange={(e) => setMissing((m) => ({ ...m, at: e.target.value }))} aria-label="Missing work time" />
                      </label>
                    </div>
                  </details>
                  <button type="submit" className="btn" disabled={busy !== null || !disputeText.trim()}>
                    Send dispute
                  </button>
                  <p className="small muted">The AI re-reads the log and proposes a new version. Shares change only if the log supports it. Approvals reset with every new version.</p>
                </form>
                  )
                )}
              </section>
            )}

            {project.status === 'agreed' && !project.payout && (
              <ThinkingCard title="Everyone agreed" line="Capturing the payment and asking PayPal to send the payouts…" />
            )}

            {project.disputes.length > 0 && (
              <section className="card" aria-labelledby="disputes-title">
                <h2 id="disputes-title" className="card-title">
                  Disputes
                </h2>
                <ul className="disputes">
                  {project.disputes.map((d) => (
                    <li key={d.id} className="small">
                      <strong>{project.contributors.find((c) => c.id === d.contributorId)?.name ?? d.contributorId}:</strong> “{d.text}”
                      {d.answeredInVersion ? <span className="muted"> (answered in v{d.answeredInVersion})</span> : <span className="muted"> (open)</span>}
                      {d.answer && <p className="dispute-answer">AI: {plainText(d.answer)}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <Activity project={project} />
          </div>
        </div>
        <p className="foot small muted">
          Demo: one screen lets you act as each contributor. In real use, each person gets their own link. AI proposes; money moves only after
          everyone agrees, and PayPal sends it.
        </p>
      </main>
    </div>
  );
}

function ActionAlert({ error }: { error: ApiError }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);
  return (
    <p role="alert" className="alert" ref={ref}>
      {humanError(error)}
    </p>
  );
}

// ───────── 폰 첫 화면 요약 — 「얼마가 어디 있고, 누가 얼마 받나」를 큰 숫자로(모바일 한 턴 11-12) ─────────
// 레퍼런스: Cash App·Wise·Venmo 모바일 첫 화면(브랜드 색 면 + 굵은 숫자 + 버튼 하나). 데스크톱은 기존 화면 그대로라 CSS 로 숨긴다.
type HeroAction = { label: string; run: () => void } | null;

function heroLine(project: Project, waitingFor: number): { kicker: string; line: string } {
  const funded = !!project.order?.authorizationId;
  const total = project.contributors.length;
  const version = project.proposal?.version ?? 0;
  switch (project.status) {
    case 'paid':
      return { kicker: 'Paid', line: `PayPal sent all ${total} shares in one Payouts batch.` };
    case 'agreed':
    case 'paying':
      return { kicker: 'Everyone agreed', line: 'PayPal is capturing the payment and sending the payouts.' };
    case 'proposed':
    case 'disputed':
      return {
        kicker: funded ? 'Held on PayPal' : 'Waiting for PayPal funding',
        line: `AI split v${version} · ${total - waitingFor} of ${total} approved. Money moves only when all ${total} agree.`,
      };
    case 'funded':
      return { kicker: 'Held on PayPal', line: 'Authorized, not captured. Next, the AI reads the log and proposes a split.' };
    default:
      return { kicker: 'Waiting for PayPal funding', line: `${project.client.name} pays on PayPal first. Nobody is paid until everyone agrees.` };
  }
}

function MoneyHero({ project, waitingFor, busy, action }: { project: Project; waitingFor: number; busy: Busy; action: HeroAction }) {
  const { kicker, line } = heroLine(project, waitingFor);
  const shares = project.proposal?.shares ?? [];
  return (
    <section className={`money-hero money-hero-${project.status}`} aria-label="Summary">
      <p className="money-kicker">{kicker}</p>
      <p className="money-total">{formatMoney(project.budget)}</p>
      <p className="money-line">{line}</p>
      {shares.length > 0 && (
        <ul className="money-shares">
          {shares.map((s) => {
            const who = project.contributors.find((c) => c.id === s.contributorId);
            return (
              <li key={s.contributorId} className="money-share">
                <span className="money-name">{who?.name ?? s.contributorId}</span>
                <span className="money-pct">{s.percent}%</span>
                <span className="money-amt">{formatMoney(s.amount)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {action && (
        <button type="button" className="btn btn-lg money-cta" onClick={action.run} disabled={busy !== null}>
          {action.label}
        </button>
      )}
    </section>
  );
}
