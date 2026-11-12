import { useState } from 'react';
import { FeedbackMount } from './FeedbackMount';

interface AgentStep { tool: string; result: string }
interface AgentAnswer { text: string; steps: AgentStep[]; by: 'ai' | 'rule' }

// 시연 경로 한 줄: 입력 → 무엇을 했는지 차례로 → 답. 이름·문구는 대회에 맞춰 바꾼다.
export function App() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AgentAnswer | null>(null);
  const [failed, setFailed] = useState(false);

  async function run() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!res.ok) throw new Error(String(res.status));
      setAnswer((await res.json()) as AgentAnswer);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 'var(--panel-w)', margin: '0 auto', padding: 'var(--s-5) var(--s-4)', font: 'var(--t-body)', color: 'var(--ink)' }}>
      <h1 style={{ font: 'var(--t-display)' }}>fairsplit</h1>
      <label htmlFor="ask">무엇을 도와 드릴까요?</label>
      <textarea id="ask" value={text} onChange={(e) => setText(e.target.value)} rows={3} style={{ width: '100%', font: 'var(--t-body)', border: '1px solid var(--line)', borderRadius: 'var(--r-m)', padding: 'var(--s-3)', boxSizing: 'border-box' }} />
      <button type="button" onClick={run} disabled={busy || !text.trim()} style={{ minHeight: 'var(--touch)', padding: '0 var(--s-5)', borderRadius: 'var(--r-pill)', border: 0, background: 'var(--accent)', color: 'var(--on-accent)', font: 'var(--t-subtitle)' }}>
        {busy ? '찾는 중' : '찾기'}
      </button>
      {failed && <p role="alert">지금은 답을 못 드렸어요. 잠시 뒤 다시 해 주세요.</p>}
      {answer && (
        <section aria-label="결과">
          <ol>{answer.steps.map((s) => <li key={s.tool + s.result}>{s.result}</li>)}</ol>
          <p>{answer.text}</p>
          <small>{answer.by === 'ai' ? 'AI가 답했어요' : '규칙으로 답했어요'}</small>
        </section>
      )}
      <FeedbackMount />
    </main>
  );
}
