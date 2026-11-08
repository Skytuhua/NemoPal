import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CheckIn, CheckInAnswer, SnoozeInput } from '@living-playbooks/contracts';

export function Question({ question, disabled = false, compact = false, conversation = false, answer, snooze, cancel, openTask, presentation = 'default', completionLabel = 'Recorded' }: { question: CheckIn; disabled?: boolean; compact?: boolean; conversation?: boolean; answer(input: CheckInAnswer): Promise<void>; snooze(input: SnoozeInput): Promise<void>; cancel?: () => Promise<void>; openTask?: () => void; presentation?: 'default' | 'chat'; completionLabel?: string }) {
  const [until, setUntil] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [view, setView] = useState<'primary' | 'read' | 'snooze'>('primary');
  const [discloseText, setDiscloseText] = useState(false);
  const untilId = useId(), dateInput = useRef<HTMLInputElement>(null), fullText = useRef<HTMLParagraphElement>(null);
  const snoozeButton = useRef<HTMLButtonElement>(null), readButton = useRef<HTMLButtonElement>(null), previousView = useRef(view);
  useEffect(() => {
    if (!compact && !conversation) return;
    if (view === 'snooze') dateInput.current?.focus();
    if (view === 'read') fullText.current?.focus();
    if (view === 'primary' && previousView.current !== 'primary') (previousView.current === 'snooze' ? snoozeButton : readButton).current?.focus();
    previousView.current = view;
  }, [compact, conversation, view]);
  useLayoutEffect(() => {
    const button = readButton.current;
    if (!compact || view !== 'primary' || !button) return;
    const measure = () => { if (button.clientHeight && button.scrollHeight > button.clientHeight) setDiscloseText(true); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(button);
    return () => observer.disconnect();
  }, [compact, view, question.question]);
  const actionable = ['available', 'presented'].includes(question.state) && Date.parse(question.expiresAt) > Date.now();
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    if (compact) setView('primary');
    try { await action(); } catch { setError('Question update failed. Refresh before retrying.'); } finally { setBusy(false); }
  }
  async function submitSnooze() {
    const date = new Date(until);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error('Choose a future time');
    await snooze({ until: date.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  }
  if (conversation) return <div className="pet-chat-question" onKeyDown={event => {
    if (event.key === 'Escape' && view === 'snooze' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setView('primary'); }
  }}>
    <p className="pet-chat-question-text">{question.question}</p>
    {!actionable && <small>Question {question.state}{['available', 'presented'].includes(question.state) ? ' · expired' : ''}{question.snoozedUntil ? ` · until ${new Date(question.snoozedUntil).toLocaleString()}` : ''}</small>}
    {question.answer && <p>Answer saved: {question.answer.kind === 'recorded' ? 'Task marked done' : 'Not yet'}</p>}
    {actionable && <>
      <div className="pet-chat-answers"><button disabled={disabled || busy} onClick={() => void run(() => answer({ kind: 'recorded' }))}>Mark task done</button><button disabled={disabled || busy} onClick={() => void run(() => answer({ kind: 'not_yet' }))}>Not yet</button></div>
      <button ref={snoozeButton} className="pet-chat-snooze-toggle" aria-label="Snooze options" aria-expanded={view === 'snooze'} disabled={disabled || busy} onClick={() => setView(view === 'snooze' ? 'primary' : 'snooze')}>Snooze question</button>
      {view === 'snooze' && <div className="pet-chat-snooze"><label htmlFor={untilId}>Snooze until</label><input ref={dateInput} id={untilId} type="datetime-local" value={until} onChange={event => setUntil(event.target.value)} /><button disabled={disabled || busy || !until} onClick={() => void run(submitSnooze)}>Save snooze</button></div>}
    </>}
    {busy && <p role="status">Saving answer…</p>}{error && <p role="alert">{error}</p>}
  </div>;
  if (compact) return <div className="question question-compact" data-view={view} onKeyDown={event => {
    if (event.key === 'Escape' && view !== 'primary') { event.preventDefault(); event.stopPropagation(); setView('primary'); }
  }}>
    {view === 'primary' && <>
      {busy ? <p className="question-feedback" role="status">Saving answer...</p> : error ? <p className="question-feedback" role="alert" tabIndex={0}>{error}</p> : <button ref={readButton} className="question-preview" aria-label="Read full question" onClick={() => setView('read')}>{discloseText || question.question.length > 52 ? 'Read full question' : question.question}</button>}
      {actionable && <div className="actions">
        <button disabled={disabled || busy} onClick={() => void run(() => answer({ kind: 'recorded' }))}>Recorded</button>
        <button disabled={disabled || busy} onClick={() => void run(() => answer({ kind: 'not_yet' }))}>Not yet</button>
        <button ref={snoozeButton} aria-label="Snooze options" title="Snooze options" disabled={disabled || busy} onClick={() => setView('snooze')}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></svg></button>
      </div>}
    </>}
    {view === 'read' && <>
      <button className="question-back" onClick={() => setView('primary')}>Back to answers</button>
      <p ref={fullText} className="question-full" tabIndex={0} aria-label="Full question">{question.question}</p>
    </>}
    {view === 'snooze' && <>
      <div className="question-snooze-heading"><button aria-label="Back to answers" title="Back to answers" onClick={() => setView('primary')}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14 6-6 6 6 6" /></svg></button><label htmlFor={untilId}>Snooze until</label></div>
      <input ref={dateInput} id={untilId} type="datetime-local" value={until} onChange={event => setUntil(event.target.value)} />
      <button disabled={disabled || busy || !until || !actionable} onClick={() => void run(submitSnooze)}>Snooze question</button>
    </>}
    {!actionable && <small>Question {question.state}{['available', 'presented'].includes(question.state) ? ' - expired' : ''}</small>}
    {question.answer && <p>Answer saved: {question.answer.kind === 'recorded' ? 'Recorded' : 'Not yet'}</p>}
  </div>;
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
