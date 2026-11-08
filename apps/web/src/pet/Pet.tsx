import { useEffect, useRef, useState } from 'react';
import { PetCommandSchema, SafePetEventSchema, type PetBridge, type PetCommand, type PetState, type SafePetEvent } from '@living-playbooks/contracts';
import { Question } from '../features/checkins/Question';
import './pet-mouse.css';
export function Pet({ bridge }: { bridge?: PetBridge }) {
  const [event, setEvent] = useState<SafePetEvent>(), [error, setError] = useState(''), [submitted, setSubmitted] = useState('');
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
  const { preference, checkIn } = event;
  const validQuestion = checkIn && checkIn.projectId === event.projectId && ['available', 'presented'].includes(checkIn.state) && Date.parse(checkIn.expiresAt) > Date.now();
  const state: PetState = event.state === 'offline' ? 'offline' : preference.focus || event.state === 'snoozed' ? 'snoozed' : validQuestion ? 'waiting_for_you' : event.state === 'milestone' || event.state === 'reviewing' ? event.state : 'idle';
  const presentation = checkIn ? `${event.projectId}:${checkIn.id}:${checkIn.presentationId}` : '';
  return <main className="pet-surface" data-reduced-motion={preference.reducedMotion}>
    {!preference.hidden && <div className={`pet-art pet-mouse state-${state}`} role="img" aria-label={`${event.managerName || 'Project pet'} · ${state.replaceAll('_', ' ')}`} data-pet-state={state} />}
    <div className="pet-bubble"><strong>{event.managerName || 'No project selected'}</strong>
      {event.demoTiming && <small>Demo reminder timing</small>}
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
      <div className="actions">{event.projectId && <button onClick={() => void invoke({ type: 'openProject', projectId: event.projectId! }).catch(() => setError('Project could not be opened.'))}>Open project</button>}<button onClick={() => void invoke({ type: 'setPreference', preference: { ...preference, hidden: !preference.hidden } }).catch(() => setError('Pet preference not saved.'))}>{preference.hidden ? 'Show pet' : 'Hide pet'}</button><button aria-pressed={preference.focus} onClick={() => void invoke({ type: 'setPreference', preference: { ...preference, focus: !preference.focus } }).catch(() => setError('Pet preference not saved.'))}>Focus mode</button></div>
    </div>
  </main>;
}
