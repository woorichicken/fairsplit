import { useState } from 'react';
import { ApiError, fixtureFromUrl, getApi } from './api';
import type { Navigate } from './App';
import { TopBar } from './parts';

const HOW_IT_WORKS = [
  { title: 'The client funds the job', text: 'One PayPal payment is authorized up front. It is captured only after everyone agrees.' },
  { title: 'AI proposes the split', text: 'It reads the production log — drafts, edit rounds, review notes, re-recordings — and shows the evidence line for every share.' },
  { title: 'Everyone agrees, PayPal sends', text: 'Anyone can dispute and the AI re-reads the log. When all approve, PayPal sends every payout in one batch.' },
];

export function Landing({ navigate }: { navigate: Navigate }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const project = await getApi().resetDemo();
      const fixture = fixtureFromUrl();
      navigate(`/p/${encodeURIComponent(project.id)}${fixture ? `?fixture=${fixture}` : ''}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the demo. Try again in a moment.');
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <TopBar sample={fixtureFromUrl() !== null} />
      <main className="landing">
        <p className="eyebrow">For small creative teams paid by one client</p>
        <h1 className="landing-title">One PayPal payment, split by the work everyone actually did.</h1>
        <p className="landing-lead">
          FairSplit’s AI reads the production log and proposes each person’s share, with evidence. Anyone can dispute. Money moves only
          when everyone agrees.
        </p>
        <button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={busy}>
          {busy ? 'Setting up the demo…' : 'Try the demo'}
        </button>
        <p className="muted small">Sandbox demo — no real money moves.</p>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        <ol className="how">
          {HOW_IT_WORKS.map((step, i) => (
            <li key={step.title} className="card how-step">
              <span className="how-num" aria-hidden="true">
                {i + 1}
              </span>
              <h2 className="how-title">{step.title}</h2>
              <p className="small muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
