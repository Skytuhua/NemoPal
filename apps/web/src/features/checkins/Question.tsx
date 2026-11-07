import { useState } from 'react';
import type { CheckIn, CheckInAnswer, SnoozeInput } from '@living-playbooks/contracts';

export function Question({ question, disabled = false, answer, snooze, cancel, openTask }: { question: CheckIn; disabled?: boolean; answer(input: CheckInAnswer): Promise<void>; snooze(input: SnoozeInput): Promise<void>; cancel?: () => Promise<void>; openTask?: () => void }) {
  const [until, setUntil] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const actionable = ['available', 'presented'].includes(question.state) && Date.parse(question.expiresAt) > Date.now();
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch { setError('Question update failed. Refresh before retrying.'); } finally { setBusy(false); }
  }
  return <div className="question">
    <p>{question.question}</p>
    <small>Question {question.state}{!actionable && ['available', 'presented'].includes(question.state) ? ' · expired' : ''}{question.snoozedUntil ? ` · until ${new Date(question.snoozedUntil).toLocaleString()}` : ''}</small>
    {question.answer && <p>Answer saved: {question.answer.kind === 'recorded' ? 'Recorded' : 'Not yet'}</p>}
    {actionable && <>
      <div className="actions"><button disabled={disabled || busy} onClick={() => void run(() => answer({ kind: 'recorded' }))}>Recorded</button><button disabled={disabled || busy} onClick={() => void run(() => answer({ kind: 'not_yet' }))}>Not yet</button>{cancel && <button disabled={disabled || busy} onClick={() => void run(cancel)}>Cancel question</button>}</div>
      <label>Snooze until<input type="datetime-local" value={until} onChange={event => setUntil(event.target.value)} /></label>
      <button disabled={disabled || busy || !until} onClick={() => void run(async () => {
        const date = new Date(until);
        if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error('Choose a future time');
        await snooze({ until: date.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      })}>Snooze question</button>
    </>}
    {openTask && <button onClick={openTask}>Open linked task</button>}
    {busy && <p role="status">Saving answer…</p>}{error && <p role="alert">{error}</p>}
  </div>;
}
