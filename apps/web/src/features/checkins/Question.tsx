import { useState } from 'react';
import type { CheckIn, CheckInAnswer, SnoozeInput } from '@living-playbooks/contracts';

export function Question({ question, disabled = false, answer, snooze, cancel, openTask, presentation = 'default', completionLabel = 'Recorded' }: { question: CheckIn; disabled?: boolean; answer(input: CheckInAnswer): Promise<void>; snooze(input: SnoozeInput): Promise<void>; cancel?: () => Promise<void>; openTask?: () => void; presentation?: 'default' | 'chat'; completionLabel?: string }) {
  const [until, setUntil] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const actionable = ['available', 'presented'].includes(question.state) && Date.parse(question.expiresAt) > Date.now();
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch { setError('Question update failed. Refresh before retrying.'); } finally { setBusy(false); }
  }
  const snoozeControls = <>
    <label>Snooze until<input type="datetime-local" value={until} onChange={event => setUntil(event.target.value)} /></label>
    <button disabled={disabled || busy || !until} onClick={() => void run(async () => {
      const date = new Date(until);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error('Choose a future time');
      await snooze({ until: date.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    })}>Snooze question</button>
  </>;
  return <div className={`question${presentation === 'chat' ? ' question-chat' : ''}`}>
    <p>{question.question}</p>
    {(presentation !== 'chat' || !actionable) && <small>{presentation === 'chat' ? question.state === 'answered' ? 'Answer saved' : question.state === 'cancelled' ? 'Question dismissed' : question.state === 'snoozed' ? 'Reminder snoozed' : question.state === 'scheduled' ? 'Scheduled question' : 'This question has expired' : `Question ${question.state}`}{presentation !== 'chat' && !actionable && ['available', 'presented'].includes(question.state) ? ' · expired' : ''}{question.snoozedUntil ? ` · until ${new Date(question.snoozedUntil).toLocaleString()}` : ''}</small>}
    {question.answer && <p>{presentation === 'chat' ? question.answer.kind === 'recorded' ? 'You marked this task done.' : 'You answered: Not yet.' : `Answer saved: ${question.answer.kind === 'recorded' ? 'Recorded' : 'Not yet'}`}</p>}
    {actionable && <>
      <div className="actions"><button className="question-complete" disabled={disabled || busy} onClick={() => void run(() => answer({ kind: 'recorded' }))}>{presentation === 'chat' && <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>}{completionLabel}</button><button className="question-later" disabled={disabled || busy} onClick={() => void run(() => answer({ kind: 'not_yet' }))}>Not yet</button>{presentation !== 'chat' && cancel && <button disabled={disabled || busy} onClick={() => void run(cancel)}>Cancel question</button>}</div>
      {presentation !== 'chat' && snoozeControls}
    </>}
    {openTask && <button className="question-open" aria-label="Open linked task" onClick={openTask}>{presentation === 'chat' ? 'View task' : 'Open linked task'}{presentation === 'chat' && <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" /></svg>}</button>}
    {busy && <p role="status">Saving answer…</p>}{error && <p role="alert">{error}</p>}
  </div>;
}
