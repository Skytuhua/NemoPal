import { useState } from 'react';
import type { CheckIn, CheckInAnswer, SnoozeInput } from '@living-playbooks/contracts';
import { DetailIcon, DetailSurface } from '../details/DetailSurface';
import '../compact-details.css';

export function Question({ question, disabled = false, compact = false, answer, snooze, cancel, openTask }: { question: CheckIn; disabled?: boolean; compact?: boolean; answer(input: CheckInAnswer): Promise<void>; snooze(input: SnoozeInput): Promise<void>; cancel?: () => Promise<void>; openTask?: () => void }) {
  const [until, setUntil] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [options, setOptions] = useState(false);
  const actionable = ['available', 'presented'].includes(question.state) && Date.parse(question.expiresAt) > Date.now();
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch { setError('Question update failed. Refresh before retrying.'); } finally { setBusy(false); }
  }
  if (compact) return <div className="question compact-question">
    <div className="compact-question-copy"><p>{question.question}</p>
      {!actionable && !question.answer && <small>{question.state === 'snoozed' && question.snoozedUntil ? `Snoozed until ${new Date(question.snoozedUntil).toLocaleString()}` : ['available', 'presented'].includes(question.state) ? 'Question expired' : `Question ${question.state}`}</small>}
      {question.answer && <small className="question-saved">Answer saved: {question.answer.kind === 'recorded' ? (compact ? 'Task marked done' : 'Recorded') : 'Not yet'}</small>}
    </div>
    <small className="question-effect">A done answer marks the linked task done.</small>
    <div className="compact-question-actions">
      {actionable && <><button className="detail-primary" disabled={disabled || busy} onClick={() => void run(() => answer({ kind: 'recorded' }))}><DetailIcon kind="check" />Mark task done</button><button disabled={disabled || busy} onClick={() => void run(() => answer({ kind: 'not_yet' }))}>Not yet</button><button className="detail-icon-button" aria-label="More options" aria-haspopup="dialog" aria-expanded={options} onClick={() => setOptions(true)}><DetailIcon kind="more" /></button></>}
      {openTask && <button className="detail-text-button" onClick={openTask}>Open linked task<DetailIcon kind="arrow" /></button>}
    </div>
    {busy && <p role="status">Saving answer…</p>}{error && <p role="alert">{error}</p>}
    <DetailSurface open={options} title="Check-in options" closeLabel="Close check-in options" onClose={() => setOptions(false)} className="question-detail">
      <p>{question.question}</p>
      {actionable && <><label>Snooze until<input type="datetime-local" value={until} onChange={event => setUntil(event.target.value)} /></label>
        <div className="actions"><button className="detail-primary" disabled={disabled || busy || !until} onClick={() => void run(async () => {
          const date = new Date(until);
          if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error('Choose a future time');
          await snooze({ until: date.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
        })}>Snooze question</button>{cancel && <button disabled={disabled || busy} onClick={() => void run(cancel)}>Cancel question</button>}</div></>}
      {!actionable && <p>This question is no longer available to change.</p>}
      {busy && <p role="status">Saving answer…</p>}{error && <p role="alert">{error}</p>}
    </DetailSurface>
  </div>;
  return <div className="question">
    <p>{question.question}</p>
    <small>Question {question.state}{!actionable && ['available', 'presented'].includes(question.state) ? ' · expired' : ''}{question.snoozedUntil ? ` · until ${new Date(question.snoozedUntil).toLocaleString()}` : ''}</small>
    {question.answer && <p>Answer saved: {question.answer.kind === 'recorded' ? (compact ? 'Task marked done' : 'Recorded') : 'Not yet'}</p>}
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
