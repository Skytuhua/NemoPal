import { useEffect, useRef, useState } from 'react';
import { PetCommandSchema, SafePetEventSchema, type PetBridge, type PetCommand, type PetState, type SafePetEvent } from '@living-playbooks/contracts';
import './pet-mouse.css';
import './pet-speech.css';

export function Pet({ bridge }: { bridge?: PetBridge }) {
  const [event, setEvent] = useState<SafePetEvent>(), [error, setError] = useState('');
  const mouse = useRef<HTMLButtonElement>(null), current = useRef<SafePetEvent | undefined>(undefined);
  useEffect(() => bridge?.onEvent(raw => {
    const parsed = SafePetEventSchema.safeParse(raw);
    if (!parsed.success) { setError('Pet state unavailable: invalid desktop event.'); return; }
    const previous = current.current, next = parsed.data;
    if (previous?.projectId === next.projectId && previous.checkIn?.id === next.checkIn?.id && previous.checkIn && next.checkIn && next.checkIn.revision < previous.checkIn.revision) return;
    current.current = next; setEvent(next); setError('');
  }), [bridge]);
  useEffect(() => bridge?.onFocusControls?.(() => mouse.current?.focus()), [bridge]);
  async function invoke(command: PetCommand) {
    const context = current.current;
    try { await bridge?.invoke(PetCommandSchema.parse(command)); }
    catch { if (context === current.current) setError(command.type === 'openChat' ? 'Conversation unavailable. Try again after reconnecting.' : 'Pet preference not saved.'); }
  }
  if (!bridge) return <main className="pet-unavailable"><h1>Pet unavailable</h1><p>Restricted desktop pet bridge required.</p></main>;
  if (!event) return <main className="pet-unavailable" role="status">{error || 'Waiting for desktop pet state…'}</main>;
  const { preference } = event;
  if (preference.hidden) return <main className="pet-surface pet-speech" aria-label="Pet hidden; restore from tray" />;
  const question = event.checkIn;
  const validQuestion = question && question.projectId === event.projectId && ['available', 'presented'].includes(question.state) && Date.parse(question.expiresAt) > Date.now();
  const state: PetState = event.state === 'offline' ? 'offline' : preference.focus || event.state === 'snoozed' ? 'snoozed' : validQuestion ? 'waiting_for_you' : event.state;
  const thinking = event.state === 'reviewing' && !validQuestion;
  const speech = error || (validQuestion && state === 'waiting_for_you' ? question.question : state === 'milestone' ? 'Milestone reached.' : '');
  const passive = !preference.focus && !event.chatOpen && (thinking || !!speech);
  return <main className="pet-surface pet-speech" data-reduced-motion={preference.reducedMotion}>
    <div className="pet-mouse-controls">
      <button ref={mouse} className="pet-speech-toggle" aria-label="Open conversation" title="Open conversation" onClick={() => event.chatContextId ? void invoke({ type: 'openChat', contextId: event.chatContextId }) : setError('Conversation unavailable. Waiting for desktop context.')}>
        <span className={`pet-art pet-mouse state-${state}`} role="img" aria-label={`${event.managerName || 'Project pet'} · ${state.replaceAll('_', ' ')}`} data-pet-state={state} />
      </button>
      <div className="pet-utilities" role="group" aria-label="Pet actions">
        <button aria-label="Hide pet" title="Hide pet" onClick={() => void invoke({ type: 'setPreference', preference: { ...preference, hidden: true } })}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg></button>
        <button aria-label="Focus mode" title="Focus mode" aria-pressed={preference.focus} onClick={() => void invoke({ type: 'setPreference', preference: { ...preference, focus: !preference.focus } })}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19 15A8 8 0 0 1 9 5a8 8 0 1 0 10 10Z" /></svg></button>
      </div>
    </div>
    {passive && <div className="pet-bubble" data-kind={thinking && !error ? 'thought' : 'speech'}>
      {thinking && !error && <svg className="pet-thought-cloud" aria-hidden="true" viewBox="0 0 228 64" preserveAspectRatio="none"><path d="M30 55C6 55 2 33 20 25C16 10 42 3 58 14C70-2 101-1 115 10C136-2 165 2 172 16C194 7 216 18 211 31C235 43 219 60 198 55C179 66 153 60 143 57C118 66 90 61 79 56C58 66 40 61 30 55Z" /></svg>}
      <div className="pet-speech-body" role="region" aria-label="Pet message" tabIndex={0}>
        {event.demoTiming && <small>Demo reminder timing</small>}
        <p role={error ? 'alert' : 'status'}>{thinking && !error ? 'thinking.....' : speech}</p>
      </div>
    </div>}
  </main>;
}
