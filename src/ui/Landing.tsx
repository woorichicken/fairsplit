import { useMemo, useState } from 'react';
import { ApiError, fixtureFromUrl, getApi } from './api';
import type { Navigate } from './App';
import { fixtureProject } from './fixtures';
import { previousProposal, SplitCard, TopBar } from './parts';

const HOW_IT_WORKS = [
  { title: 'The client funds the job', text: 'One PayPal payment is authorized up front and captured only after everyone agrees.' },
  { title: 'AI proposes the split', text: 'It reads the production log and shows the evidence line behind every share.' },
  { title: 'Everyone agrees, PayPal sends', text: 'Anyone can dispute. When all approve, PayPal sends every payout in one batch.' },
];

const noop = () => {};

export function Landing({ navigate }: { navigate: Navigate }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 첫 화면 미리보기 — 실제 Split card 컴포넌트에 기록된 AI 응답(v1 → v2)을 넣는다
  const preview = useMemo(() => fixtureProject('v2'), []);
  const biggestRaise = useMemo(() => {
    const before = previousProposal(preview);
    const rows = (preview.proposal?.shares ?? []).map((s) => ({ s, was: before?.shares.find((b) => b.contributorId === s.contributorId)?.percent ?? s.percent }));
    const top = rows.sort((a, b) => b.s.percent - b.was - (a.s.percent - a.was))[0];
    const name = preview.contributors.find((c) => c.id === top?.s.contributorId)?.name;
    return top && name && top.s.percent > top.was ? { name, was: top.was, now: top.s.percent } : null;
  }, [preview]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const project = await getApi().resetDemo();
      const fixture = fixtureFromUrl();
      navigate(`/p/${encodeURIComponent(project.id)}${fixture ? `?fixture=${fixture}` : ''}`);
    } catch (e) {
      setError(e instanceof ApiError && e.status < 500 ? e.message : 'Could not start the demo. No money was moved. Try again in a moment.');
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <TopBar sample={fixtureFromUrl() !== null} />
      <main className="landing">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">For small creative teams paid by one client</p>
            <h1 className="landing-title">One PayPal payment, split by the work everyone actually did.</h1>
            <p className="landing-lead">
              FairSplit’s AI reads the production log and proposes each person’s share, with evidence. Anyone can dispute. Money moves only
              when everyone agrees.
            </p>
            <div className="hero-cta">
              <button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={busy}>
                {busy ? 'Setting up the demo…' : 'Try the demo'}
              </button>
              <p className="muted small">Sandbox demo — no real money moves.</p>
            </div>
            {error && (
              <p role="alert" className="alert">
                {error}
              </p>
            )}
          </div>
          <div className="hero-preview">
            <SplitCard project={preview} onEvidence={noop} activeEvidence={[]} compact />
            {biggestRaise && (
              <p className="small muted preview-caption">
                A recorded AI answer from the demo: after {biggestRaise.name}’s dispute, it re-read the log and moved that share from {biggestRaise.was}% to{' '}
                {biggestRaise.now}%.
              </p>
            )}
          </div>
        </section>
        <ol className="how">
          {HOW_IT_WORKS.map((step, i) => (
            <li key={step.title} className="how-step">
              <span className="how-num" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <h2 className="how-title">{step.title}</h2>
                <p className="small muted">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
