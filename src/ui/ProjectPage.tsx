import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project } from '../shared/types';
import { ApiError, fixtureFromUrl, getApi } from './api';
import type { Navigate } from './App';
import { formatMoney } from './format';
import { Activity, Avatar, LogPanel, Receipt, SplitCard, StatusBadge, Stepper, ThinkingCard, TopBar } from './parts';

// Payouts 는 PENDING 으로 시작해 몇 초~몇 분 뒤 끝난다(12:30 실측) — 그동안 이 간격으로 refresh 한다
const PAYOUT_POLL_MS = 2000;
const DISPUTE_MAX = 500;

type Busy = null | 'load' | 'fund' | 'complete' | 'propose' | 'dispute' | 'approve';

const errorText = (e: unknown) => (e instanceof ApiError ? e : new ApiError('unknown', 'Something went wrong. Try again in a moment.', 0));

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
    if (await act('dispute', () => api.dispute(id, viewerId, text))) setDisputeText('');
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
                {loadError.status === 404 ? 'This project does not exist. It may have been reset.' : loadError.message}
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

        <Stepper project={project} />

        {actionError && (
          <p role="alert" className="alert">
            {actionError.message} <span className="muted small">({actionError.code})</span>
          </p>
        )}

        <div className="layout">
          <div className="col-log">
            <LogPanel project={project} highlight={highlight} />
          </div>

          <div className="col-main">
            {project.status === 'draft' && (
              <section className="card" aria-labelledby="fund-title">
                <h2 id="fund-title" className="card-title">
                  Step 1 · {project.client.name} funds the job
                </h2>
                <p className="small">
                  {formatMoney(project.budget)} is authorized on PayPal now and captured only after every contributor approves the split.
                </p>
                <div className="row">
                  <button type="button" className="btn btn-primary" onClick={fund} disabled={busy !== null}>
                    {busy === 'fund' ? 'Opening PayPal…' : 'Fund with PayPal (sandbox)'}
                  </button>
                </div>
              </section>
            )}

            {project.payout && <Receipt project={project} />}

            {thinking ? (
              <ThinkingCard
                title={busy === 'dispute' ? `AI is re-checking for ${viewer?.name ?? 'the dispute'}` : 'AI is proposing a split'}
                line={busy === 'dispute' ? `Re-reading ${n} log events with ${viewer?.name ?? 'the'}’s dispute…` : `Reading ${n} log events…`}
              />
            ) : project.proposal ? (
              <SplitCard project={project} onEvidence={setHighlight} activeEvidence={highlight} />
            ) : (
              project.status !== 'draft' && (
                <section className="card" aria-labelledby="propose-title">
                  <h2 id="propose-title" className="card-title">
                    No split yet
                  </h2>
                  <p className="small">The AI will read all {n} log events and propose each person’s share, with evidence lines.</p>
                  <button type="button" className="btn btn-primary" onClick={() => void act('propose', () => api.propose(id))} disabled={busy !== null}>
                    Ask AI to propose a split
                  </button>
                </section>
              )
            )}

            {canDecide && viewer && !thinking && (
              <section className="card decide" aria-labelledby="decide-title">
                <div className="card-head">
                  <h2 id="decide-title" className="card-title">
                    Your decision on v{version}
                  </h2>
                  <span className="viewer-chip">
                    <Avatar contributor={viewer} /> {viewer.name}
                  </span>
                </div>
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

                <form
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
                  <button type="submit" className="btn" disabled={busy !== null || !disputeText.trim()}>
                    Send dispute
                  </button>
                  <p className="small muted">The AI re-reads the log and proposes a new version. Approvals reset when the split changes.</p>
                </form>
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
                      {d.answeredInVersion ? <span className="muted"> — answered in v{d.answeredInVersion}</span> : <span className="muted"> — open</span>}
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
