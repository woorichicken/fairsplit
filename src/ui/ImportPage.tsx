import { useState } from 'react';
import { ApiError, fixtureFromUrl, getApi, type NewProjectInput } from './api';
import type { Navigate } from './App';
import { TopBar } from './parts';

/**
 * 자기 로그로 새 프로젝트 — 기여자 + CSV 로그 + 예산 → `POST /api/projects` → 그 프로젝트 화면.
 * 처음 열면 가상의 예시(팟캐스트 한 회)가 채워져 있어 그대로 눌러도 돈다. 검증은 서버(worker/importer.ts)가 한다.
 */
const CSV_COLUMNS = 'at,actor,kind,title,minutes,detail';
const KINDS = 'brief, draft, revision, review_comment, recording, edit, asset, approval';
const MAX_PEOPLE = 8;
const MIN_PEOPLE = 2;

type Person = NewProjectInput['contributors'][number];

const EXAMPLE_PEOPLE: Person[] = [
  { name: 'Ari', role: 'Host', paypalEmail: 'ari@example.com' },
  { name: 'Bo', role: 'Audio editor', paypalEmail: 'bo@example.com' },
  { name: 'Cleo', role: 'Cover illustrator', paypalEmail: 'cleo@example.com' },
];

const EXAMPLE_CSV = `${CSV_COLUMNS}
2026-11-03T09:00,client,brief,Episode 12 brief: 25-minute interview,,Cover art in the show style
2026-11-04T14:00,Ari,draft,Interview questions,45,
2026-11-05T10:00,Ari,recording,Interview recording,70,Two guests over video call
2026-11-05T16:00,Bo,edit,Rough cut,120,"Removed 18 minutes, fixed levels"
2026-11-06T09:30,client,review_comment,Guest 2 audio is too quiet,,
2026-11-06T13:00,Bo,revision,Noise cleanup and loudness pass,60,
2026-11-06T15:00,Cleo,draft,Cover art sketch,50,
2026-11-07T11:00,Cleo,revision,Final cover art,40,
2026-11-07T15:00,Bo,asset,Exported MP3 and show notes,15,
2026-11-08T10:00,client,approval,Client approved episode 12,,`;

export function ImportPage({ navigate }: { navigate: Navigate }) {
  const [title, setTitle] = useState('Podcast episode 12');
  const [clientName, setClientName] = useState('Quiet Pines Radio');
  const [budget, setBudget] = useState('450.00');
  const [people, setPeople] = useState<Person[]>(EXAMPLE_PEOPLE);
  const [csv, setCsv] = useState(EXAMPLE_CSV);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; problems: string[] } | null>(null);

  const setPerson = (i: number, patch: Partial<Person>) => setPeople((list) => list.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const project = await getApi().createProject({ title, clientName, budget, contributors: people, csv });
      const fixture = fixtureFromUrl();
      navigate(`/p/${encodeURIComponent(project.id)}${fixture ? `?fixture=${fixture}` : ''}`);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError({
        message: err && err.status < 500 ? (err.problems.length ? 'Please fix these and try again:' : err.message) : 'Could not create the project. Try again in a moment.',
        problems: err?.problems ?? [],
      });
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <TopBar sample={fixtureFromUrl() !== null} />
      <main className="importer">
        <p className="eyebrow">Use your own log</p>
        <h1 className="landing-title">Split a job from your own production log</h1>
        <p className="landing-lead">
          List who worked on it, paste the log as CSV, and set the budget. The AI proposes the split from these lines only. The example below is
          made up. Edit it or replace it.
        </p>

        <form
          className="card import-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset className="import-row">
            <legend className="card-title">The job</legend>
            <label className="field">
              <span className="small muted">Project title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
            </label>
            <label className="field">
              <span className="small muted">Client name</span>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} maxLength={200} required />
            </label>
            <label className="field field-narrow">
              <span className="small muted">Budget (USD)</span>
              <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" required />
            </label>
          </fieldset>

          <fieldset>
            <legend className="card-title">Contributors</legend>
            <p className="small muted">The PayPal email is where the payout goes. In sandbox, use sandbox personal accounts or any address (it stays unclaimed).</p>
            <ol className="people">
              {people.map((p, i) => (
                <li key={i} className="person">
                  <label className="field">
                    <span className="small muted">Name</span>
                    <input value={p.name} onChange={(e) => setPerson(i, { name: e.target.value })} aria-label={`Contributor ${i + 1} name`} required />
                  </label>
                  <label className="field">
                    <span className="small muted">Role</span>
                    <input value={p.role} onChange={(e) => setPerson(i, { role: e.target.value })} aria-label={`Contributor ${i + 1} role`} required />
                  </label>
                  <label className="field">
                    <span className="small muted">PayPal email</span>
                    <input type="email" value={p.paypalEmail} onChange={(e) => setPerson(i, { paypalEmail: e.target.value })} aria-label={`Contributor ${i + 1} PayPal email`} required />
                  </label>
                  <button type="button" className="btn btn-quiet" onClick={() => setPeople((list) => list.filter((_, k) => k !== i))} disabled={people.length <= MIN_PEOPLE} aria-label={`Remove contributor ${i + 1}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ol>
            <button type="button" className="btn" onClick={() => setPeople((list) => [...list, { name: '', role: '', paypalEmail: '' }])} disabled={people.length >= MAX_PEOPLE}>
              Add contributor
            </button>
          </fieldset>

          <fieldset>
            <legend className="card-title">Production log (CSV)</legend>
            <p className="small muted">
              First line: <code className="tool">{CSV_COLUMNS}</code>. <b>actor</b> is a contributor name or <code className="tool">client</code>. <b>kind</b> is one of{' '}
              {KINDS}. <b>minutes</b> can be empty. Put commas inside “quotes”.
            </p>
            <textarea className="csv" value={csv} onChange={(e) => setCsv(e.target.value)} rows={12} spellCheck={false} aria-label="Production log CSV" />
          </fieldset>

          {error && (
            <div role="alert" className="alert">
              <p>{error.message}</p>
              {error.problems.length > 0 && (
                <ul className="problems">
                  {error.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="row">
            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
              {busy ? 'Creating…' : 'Create project'}
            </button>
            <button type="button" className="btn" onClick={() => navigate(`/${window.location.search}`)}>
              Back
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
