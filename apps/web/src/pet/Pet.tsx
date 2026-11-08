import { useEffect, useId, useRef, useState } from 'react';
import { PetCommandSchema, SafePetEventSchema, type PetBridge, type PetCommand, type PetState, type SafePetEvent } from '@living-playbooks/contracts';
import { Question } from '../features/checkins/Question';
import './pet-mouse.css';
import './pet-speech.css';
export function Pet({ bridge }: { bridge?: PetBridge }) {
  const [event, setEvent] = useState<SafePetEvent>(), [error, setError] = useState(''), [submitted, setSubmitted] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [phase, setPhase] = useState('opening');
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const toggle = useRef<HTMLButtonElement>(null), bubbleId = useId();
  const checkIn = event?.checkIn;
  const validQuestion = checkIn && checkIn.projectId === event?.projectId && ['available', 'presented'].includes(checkIn.state) && Date.parse(checkIn.expiresAt) > Date.now();
  const hasMessage = !!event && (event.demoTiming || ['offline', 'reviewing', 'milestone'].includes(event.state) || event.preference.hidden || event.preference.focus || (validQuestion && event.state !== 'snoozed') || !!error);
  const messageKey = event ? JSON.stringify([event.projectId, event.state, checkIn?.id, checkIn?.presentationId, checkIn?.revision, event.preference.hidden, event.preference.focus, event.demoTiming, error]) : '';
  const shown = expanded && hasMessage;
  const toggleLabel = shown ? 'Close message' : hasMessage ? 'Open message' : 'No new messages';
  useEffect(() => { if (hasMessage) setExpanded(true); }, [messageKey]);
  const reducedMotion = systemReducedMotion || !!event?.preference.reducedMotion;
  useEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const change = () => setSystemReducedMotion(media.matches);
    change(); media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (reducedMotion) { setPhase(shown ? 'open' : 'closed'); return; }
    setPhase(shown ? 'opening' : 'closing');
    const timer = setTimeout(() => setPhase(shown ? 'open' : 'closed'), shown ? 180 : 130);
    return () => clearTimeout(timer);
  }, [shown, reducedMotion]);
  function closeBubble() { toggle.current?.focus(); setExpanded(false); }
  const signature = useRef(''), pending = useRef(false), current = useRef<SafePetEvent | undefined>(undefined);
  useEffect(() => bridge?.onEvent(raw => {
    const parsed = SafePetEventSchema.safeParse(raw);
    if (!parsed.success) { setError('Pet state unavailable: invalid desktop event.'); return; }
    const next = parsed.data, key = JSON.stringify(next);
    if (key === signature.current) return;
    const previous = current.current;
    if (previous?.projectId === next.projectId && previous.checkIn?.id === next.checkIn?.id && previous.checkIn && next.checkIn && next.checkIn.revision < previous.checkIn.revision) return;
    signature.current = key; current.current = next; setEvent(next); setError('');
    if (previous?.projectId !== next.projectId || previous?.checkIn?.presentationId !== next.checkIn?.presentationId) setSubmitted('');
  }), [bridge]);
  async function invoke(command: PetCommand) {
    if (!bridge || pending.current) throw new Error('Pet command unavailable');
    pending.current = true;
    try { await bridge.invoke(PetCommandSchema.parse(command)); }
    finally { pending.current = false; }
  }
  if (!bridge) return <main className="pet-unavailable"><h1>Pet unavailable</h1><p>Restricted desktop pet bridge required.</p></main>;
  if (!event) return <main className="pet-unavailable" role="status">{error || 'Waiting for desktop pet state…'}</main>;
  const { preference } = event;
  const state: PetState = event.state === 'offline' ? 'offline' : preference.focus || event.state === 'snoozed' ? 'snoozed' : validQuestion ? 'waiting_for_you' : event.state === 'milestone' || event.state === 'reviewing' ? event.state : 'idle';
  const thinking = state === 'reviewing' && !preference.hidden && !error;
  const presentation = checkIn ? `${event.projectId}:${checkIn.id}:${checkIn.presentationId}` : '';
  return <main className="pet-surface pet-speech" data-reduced-motion={preference.reducedMotion} onKeyDown={e => {
    if (e.key === 'Escape' && shown) { e.preventDefault(); e.stopPropagation(); closeBubble(); }
  }}>
    <div className="pet-mouse-controls">
      <button ref={toggle} className="pet-speech-toggle" aria-label={toggleLabel} title={toggleLabel} aria-expanded={shown} disabled={!hasMessage} aria-controls={bubbleId} onClick={() => shown ? closeBubble() : setExpanded(true)}>
      {!preference.hidden && <span className={`pet-art pet-mouse state-${state}`} role="img" aria-label={`${event.managerName || 'Project pet'} · ${state.replaceAll('_', ' ')}`} data-pet-state={state} />}
      {preference.hidden && <span>Pet controls</span>}
      <svg className="pet-speech-mark" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5h14v10H10l-5 4V5Z" /></svg>
    </button>
      <div className="pet-utilities" role="group" aria-label="Pet actions">
      <button aria-label={preference.hidden ? 'Show pet' : 'Hide pet'} title={preference.hidden ? 'Show pet' : 'Hide pet'} onClick={() => void invoke({ type: 'setPreference', preference: { ...preference, hidden: !preference.hidden } }).catch(() => setError('Pet preference not saved.'))}><span aria-hidden="true">{preference.hidden ? '+' : '-'}</span></button>
      <button aria-label="Focus mode" title="Focus mode" aria-pressed={preference.focus} onClick={() => void invoke({ type: 'setPreference', preference: { ...preference, focus: !preference.focus } }).catch(() => setError('Pet preference not saved.'))}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19 15A8 8 0 0 1 9 5a8 8 0 1 0 10 10Z" /></svg></button>
      {event.projectId && <button aria-label="Open project" title="Open project" onClick={() => void invoke({ type: 'openProject', projectId: event.projectId! }).catch(() => setError('Project could not be opened.'))}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M10 5H4v15h15v-6" /></svg></button>}
    </div>
    </div>
    <div id={bubbleId} className="pet-bubble" data-kind={thinking ? 'thought' : 'speech'} data-phase={phase} hidden={phase === 'closed'} inert={!shown} aria-hidden={!shown}>
      {thinking && <svg className="pet-thought-cloud" aria-hidden="true" viewBox="0 0 228 64" preserveAspectRatio="none"><path d="M30 55C6 55 2 33 20 25C16 10 42 3 58 14C70-2 101-1 115 10C136-2 165 2 172 16C194 7 216 18 211 31C235 43 219 60 198 55C179 66 153 60 143 57C118 66 90 61 79 56C58 66 40 61 30 55Z" /></svg>}
      <div className="pet-speech-body" tabIndex={shown ? 0 : -1} role="region" aria-label="Pet message">
      <fieldset disabled={!shown}>
      {event.demoTiming && <small>Demo reminder timing</small>}
      {thinking && <p role="status">thinking.....</p>}
      {((!thinking && state === 'reviewing') || state === 'milestone') && <p>{state === 'reviewing' ? 'Reviewing' : 'Milestone'}</p>}
      {state === 'offline' && <p>Cloud offline · check-in timing unavailable</p>}
      {preference.hidden && <p>Pet hidden</p>}{preference.focus && <p>Focus mode · proactive question hidden</p>}
      {validQuestion && state === 'waiting_for_you' && !preference.hidden && !preference.focus && submitted !== presentation && <Question key={presentation} question={checkIn} answer={async input => {
        await invoke({ type: 'answer', checkInId: checkIn.id, command: { operationId: crypto.randomUUID(), expectedRevision: checkIn.revision, input } });
        if (current.current?.projectId === event.projectId && current.current?.checkIn?.presentationId === checkIn.presentationId) setSubmitted(presentation);
      }} snooze={async input => {
        await invoke({ type: 'snooze', checkInId: checkIn.id, command: { operationId: crypto.randomUUID(), expectedRevision: checkIn.revision, input } });
        if (current.current?.projectId === event.projectId && current.current?.checkIn?.presentationId === checkIn.presentationId) setSubmitted(presentation);
      }} />}
      {validQuestion && submitted === presentation && presentation && <p role="status">Submitted · waiting for canonical desktop state</p>}
      {error && <p role="alert">{error}</p>}

      </fieldset>
      </div>
    </div>
  </main>;
}
