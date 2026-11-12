import { useMemo, useState } from 'react';
import { ApiError, fixtureFromUrl, getApi } from './api';
import { NEW_PATH, type Navigate } from './App';
import { recordedStoryProject } from './fixtures';
import { formatMoney } from './format';
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
  // 첫 화면 미리보기 — 실제 Split card 컴포넌트에 시연 이야기의 실측 응답을 넣는다(약한 이의는 그대로 · 빠진 작업을 붙인 이의로 몫 조정)
  const preview = useMemo(() => recordedStoryProject(), []);
  const caption = useMemo(() => {
    const nameOf = (id: string) => preview.contributors.find((c) => c.id === id)?.name ?? id;
    const [weak, missing] = preview.disputes;
    const before = previousProposal(preview);
    const moved = preview.proposal!.shares.find((s) => (before?.shares.find((b) => b.contributorId === s.contributorId)?.percent ?? s.percent) < s.percent);
    if (!weak || !missing || !moved || !before) return null;
    const was = before.shares.find((b) => b.contributorId === moved.contributorId)!.percent;
    return { weak: nameOf(weak.contributorId), missing: nameOf(missing.contributorId), added: missing.addedEventIds?.[0], was, now: moved.percent };
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
            {/* 폰 첫 화면에 분배 결과 숫자를 크게(모바일 한 턴 11-12) — 데스크톱은 오른쪽 카드가 이미 보여서 CSS 로 숨긴다 */}
            {preview.proposal && (
              <div className="hero-shares" aria-label="Recorded example split">
                <p className="money-kicker">Recorded example · {formatMoney(preview.budget)} from {preview.client.name}</p>
                <ul className="money-shares">
                  {preview.proposal.shares.map((s) => (
                    <li key={s.contributorId} className="money-share">
                      <span className="money-name">{preview.contributors.find((c) => c.id === s.contributorId)?.name ?? s.contributorId}</span>
                      <span className="money-pct">{s.percent}%</span>
                      <span className="money-amt">{formatMoney(s.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="landing-lead">
              FairSplit’s AI reads the production log and proposes each person’s share, with evidence. Anyone can dispute. Money moves only
              when everyone agrees.
            </p>
            <div className="hero-cta">
              <button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={busy}>
                {busy ? 'Setting up the demo…' : 'Try the demo'}
              </button>
              <button type="button" className="btn btn-lg" onClick={() => navigate(`${NEW_PATH}${window.location.search}`)}>
                Split your own job
              </button>
            </div>
            <p className="muted small">
              Sandbox demo. No real money moves. To split your own job, paste your team’s work log (CSV).
            </p>
            {error && (
              <p role="alert" className="alert">
                {error}
              </p>
            )}
          </div>
          <div className="hero-preview">
            <SplitCard project={preview} onEvidence={noop} activeEvidence={[]} compact />
          </div>
          {caption && (
            <p className="small muted preview-caption hero-caption">
              Recorded AI answers from the demo: {caption.weak} asked for 70% with no new evidence, so nothing changed. {caption.missing} added
              missing work to the log ({caption.added}, marked as added in a dispute), so the share went from {caption.was}% to {caption.now}%.
            </p>
          )}
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
