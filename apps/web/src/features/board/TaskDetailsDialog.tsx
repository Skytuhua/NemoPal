import { useEffect, useRef, useState } from 'react';
import { OwnerActionSchema, TaskSchema, revisionedCommandSchema, type OwnerAction, type ProjectSnapshot, type RevisionedCommandEnvelope, type Task, type TaskChecklistItem, type TaskStatus } from '@living-playbooks/contracts';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@living-playbooks/project-ui';
import type { DraftStore } from '../documents/drafts';
import { useDraft } from '../documents/useDraft';
import { statusLabels } from './board-view';
import { TaskStatusMenu } from './TaskStatusControl';
import './task-details.css';

export type TaskDetailsCommand = RevisionedCommandEnvelope<Extract<OwnerAction, { type: 'update_task_details' }>>;
export type SaveTaskDetails = (command: TaskDetailsCommand) => Promise<Task>;
export type ReviewTaskDetails = () => Promise<{ task: Task; projectRevision: number }>;
type Details = { version: 1; description: string; dueAt: string; checklist: TaskChecklistItem[]; pending?: TaskDetailsCommand; rejected?: 'revision_conflict' };
type Props = { snapshot: ProjectSnapshot; task: Task; disabled: boolean; store?: DraftStore; saveTaskDetails?: SaveTaskDetails; reviewTaskDetails?: ReviewTaskDetails; close(): void; correctTask(id: string, status: TaskStatus): void };
const evidenceLabels = { none: 'No evidence yet', agent_reported: 'Agent reported', user_reported: 'Owner reported', source_tool_observed: 'Source tool observed' };
const origins = { brief: 'Project brief', owner: 'Owner requested', model_suggestion: 'Manager suggested' };
const detailsOf = (task: Task): Details => ({ version: 1, description: task.description ?? '', dueAt: task.dueAt ?? '', checklist: task.checklist ?? [] });
const encode = (details: Details) => JSON.stringify(details);
function decode(text: string, taskId: string): Details {
  const value = JSON.parse(text) as Details;
  if (value.version !== 1 || typeof value.description !== 'string' || typeof value.dueAt !== 'string' || !Array.isArray(value.checklist) || value.checklist.length > 40) throw new Error('Invalid task draft');
  // Blank item text is allowed while composing; the command schema validates before dispatch.
  if (value.checklist.some(item => typeof item.id !== 'string' || typeof item.text !== 'string' || typeof item.completed !== 'boolean')) throw new Error('Invalid checklist draft');
  if (value.pending) {
    const command = revisionedCommandSchema(OwnerActionSchema).parse(value.pending);
    if (command.input.type !== 'update_task_details' || command.input.taskId !== taskId) throw new Error('Task draft belongs to another task');
    value.pending = command as TaskDetailsCommand;
  }
  return value;
}
function localDate(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function DetailFields({ value, editable, change }: { value: Details; editable: boolean; change?(next: Details): void }) {
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const description = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (descriptionEditing) description.current?.focus(); }, [descriptionEditing]);
  const checked = value.checklist.filter(item => item.completed).length;
  const updateItem = (id: string, patch: Partial<TaskChecklistItem>) => change?.({ ...value, checklist: value.checklist.map(item => item.id === id ? { ...item, ...patch } : item) });
  return <>
    <div className="task-details-due"><label htmlFor="task-details-due">Due date</label><div><input id="task-details-due" type="datetime-local" value={localDate(value.dueAt)} disabled={!editable} onChange={event => { const date = event.target.value && new Date(event.target.value); if (!date || !Number.isNaN(date.getTime())) change?.({ ...value, dueAt: date ? date.toISOString() : '' }); }} />{editable && value.dueAt && <button type="button" onClick={() => change?.({ ...value, dueAt: '' })}>Remove due date</button>}</div>{!value.dueAt && !editable && <p>No due date</p>}</div>
    <section className="task-details-description">
      <div className="task-details-section-heading"><h3><label htmlFor="task-details-description">Description</label></h3>{change && (!!value.description || descriptionEditing) && <button type="button" disabled={!editable} aria-label={descriptionEditing ? 'Done editing description' : 'Edit description'} onClick={() => setDescriptionEditing(!descriptionEditing)}>{descriptionEditing ? 'Done' : 'Edit'}</button>}</div>
      {!descriptionEditing && (value.description ? <p>{value.description}</p> : change ? <button type="button" className="task-details-add-description" disabled={!editable} onClick={() => setDescriptionEditing(true)}>Add description</button> : <p className="task-details-empty">No description yet.</p>)}
      <textarea ref={description} id="task-details-description" hidden={!descriptionEditing} value={value.description} placeholder="Add context for this task…" disabled={!editable} rows={3} onChange={event => change?.({ ...value, description: event.target.value })} />
    </section>
    <section className="task-details-checklist" aria-label="Task checklist"><div className="task-details-section-heading"><h3>Checklist</h3><span aria-label={`${checked} of ${value.checklist.length} checklist items complete`}>{checked}/{value.checklist.length}</span></div>
      {value.checklist.length ? <ul>{value.checklist.map((item, index) => <li key={item.id} data-checklist-item={item.id}><input type="checkbox" checked={item.completed} disabled={!editable} aria-label={item.text || `Checklist item ${index + 1}`} onChange={event => updateItem(item.id, { completed: event.target.checked })} /><input type="text" aria-label={`Checklist item ${index + 1} text`} value={item.text} readOnly={!editable} placeholder="What needs to happen?" onChange={event => updateItem(item.id, { text: event.target.value })} />{editable && <button className="task-details-remove" type="button" aria-label={`Remove checklist item ${index + 1}`} onClick={() => change?.({ ...value, checklist: value.checklist.filter(entry => entry.id !== item.id) })}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m7 7 10 10M7 17 17 7" /></svg></button>}</li>)}</ul> : <p>No checklist items yet.</p>}
      {editable && <button type="button" disabled={value.checklist.length >= 40} onClick={() => change?.({ ...value, checklist: [...value.checklist, { id: crypto.randomUUID(), text: '', completed: false }] })}>Add an item</button>}
    </section>
  </>;
}

function DetailsEditor({ snapshot, task, disabled, store, saveTaskDetails, reviewTaskDetails }: Props & { store: DraftStore; saveTaskDetails: SaveTaskDetails }) {
  const [confirmed, setConfirmed] = useState(task);
  const [reviewed, setReviewed] = useState<Awaited<ReturnType<ReviewTaskDetails>>>(), [reviewing, setReviewing] = useState(false);
  const latest = task.revision >= confirmed.revision ? task : confirmed;
  const canonical = reviewed && reviewed.task.revision >= latest.revision ? reviewed.task : latest;
  const local = useDraft(store, `${snapshot.project.id}:task:${task.id}`, encode(detailsOf(canonical)), canonical.revision);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const active = useRef(false), revoked = useRef(disabled), sending = useRef(false);
  revoked.current = disabled;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  let value = detailsOf(canonical), invalid = false;
  try { value = decode(local.draft.text, task.id); } catch { invalid = true; }
  const conflict = local.dirty && (local.draft.baseRevision !== canonical.revision || local.draft.conflict !== undefined);
  const editable = local.ready && !disabled && !invalid;
  const change = (next: Details) => local.change({ ...local.current.current, text: encode(next) });

  async function save() {
    if (sending.current || reviewing || !editable || local.error || (conflict && !value.pending)) return;
    sending.current = true; setBusy(true); setNotice('');
    try {
      let sent = local.current.current;
      const current = decode(sent.text, task.id);
      // Persist the exact original request before transport; even a lost reply remains replayable.
      if (!current.pending) {
        const input = OwnerActionSchema.safeParse({ type: 'update_task_details', taskId: task.id, expectedTaskRevision: sent.baseRevision, description: current.description, dueAt: current.dueAt || null, checklist: current.checklist });
        if (!input.success || input.data.type !== 'update_task_details') { setNotice('Check the details: description allows 4096 bytes; each checklist item needs text of at most 512 bytes.'); return; }
        current.pending = { operationId: crypto.randomUUID(), expectedRevision: Math.max(snapshot.project.revision, reviewed?.projectRevision ?? 0), input: input.data };
        local.change({ ...sent, text: encode(current) }); sent = local.current.current;
      }
      try { await store.flush(); } catch { if (active.current) setNotice('Task details could not be persisted. Keep this dialog open and copy your work.'); return; }
      if (!active.current || revoked.current) return;
      const result = TaskSchema.parse(await saveTaskDetails(current.pending!));
      if (!active.current) return;
      if (result.id !== task.id || result.revision <= current.pending!.input.expectedTaskRevision) throw new Error('Task acknowledgement did not match');
      setConfirmed(result);
      const input = current.pending!.input;
      const sentMatchesRequest = current.description === input.description && (current.dueAt || null) === input.dueAt && JSON.stringify(current.checklist) === JSON.stringify(input.checklist);
      if (local.current.current === sent && !sentMatchesRequest) {
        // A replay acknowledges its original payload, not newer edits already present before this retry.
        const retained = { ...current }; delete retained.pending;
        delete retained.rejected;
        local.change({ text: encode(retained), baseRevision: result.revision });
      } else await local.saved(sent, result.revision, encode(detailsOf(result)));
      if (!active.current) return;
      // useDraft keeps edits made during dispatch or its storage transaction. Retire only this acknowledged envelope.
      const remaining = decode(local.current.current.text, task.id);
      if (remaining.pending?.operationId === current.pending!.operationId) {
        delete remaining.pending;
        delete remaining.rejected;
        local.change({ text: encode(remaining), baseRevision: result.revision });
      }
      setNotice('Task details saved.');
    } catch (error) {
      if (!active.current) return;
      if (error && typeof error === 'object' && 'code' in error && error.code === 'revision_conflict') {
        const rejected = decode(local.current.current.text, task.id);
        rejected.rejected = 'revision_conflict';
        local.change({ ...local.current.current, text: encode(rejected), conflict: encode(detailsOf(canonical)) });
      }
      setNotice('Save not confirmed. Your local copy and original request are preserved. Retry the original save when connected.');
    } finally { sending.current = false; if (active.current) setBusy(false); }
  }
  async function review() {
    if (!reviewTaskDetails || busy || reviewing || !editable) return;
    const pending = decode(local.current.current.text, task.id).pending;
    if (!pending) return;
    setReviewing(true);
    try {
      const result = await reviewTaskDetails(), currentTask = TaskSchema.parse(result.task);
      if (!active.current || revoked.current || decode(local.current.current.text, task.id).pending?.operationId !== pending.operationId) return;
      if (currentTask.id !== task.id || currentTask.revision < canonical.revision || !Number.isSafeInteger(result.projectRevision) || result.projectRevision < snapshot.project.revision) throw new Error('Current task did not match');
      setReviewed({ task: currentTask, projectRevision: result.projectRevision });
      local.change({ ...local.current.current, conflict: encode(detailsOf(currentTask)) });
      setNotice('The previous save is still unconfirmed. Review the current task before preparing a replacement.');
    } catch { if (active.current) setNotice('Current task could not be loaded. Your draft and original save are preserved.'); }
    finally { if (active.current) setReviewing(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(); }} onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
    <DetailFields value={value} editable={editable} change={change} />
    {conflict && <section className="task-details-conflict" aria-label="Review changed task"><h3>This task changed while you were editing</h3><p>Your draft is preserved. Review the current details before keeping your edits.</p><h4>Current description</h4><p>{canonical.description || 'No description'}</p><p>Due: {canonical.dueAt ? new Date(canonical.dueAt).toLocaleString() : 'No due date'}</p><ul>{canonical.checklist?.map(item => <li key={item.id}>{item.completed ? 'Complete: ' : 'Open: '}{item.text}</li>)}</ul>{value.pending ? value.rejected === 'revision_conflict' ? <><p>The original request was rejected because its revision changed. Review the current version before preparing another save.</p><button type="button" disabled={!editable || busy} onClick={() => { const reviewed = { ...value }; delete reviewed.pending; delete reviewed.rejected; local.change({ ...local.current.current, text: encode(reviewed) }); setNotice('The rejected request is retired. Review the current details, then explicitly keep your edits.'); }}>Review current version</button></> : reviewed ? <><p>The previous save may have reached the server. Preparing a replacement stops retrying that request and keeps your edits; it does not confirm the previous save.</p><button type="button" disabled={!editable || busy || reviewing} onClick={() => { const replacement = decode(local.current.current.text, task.id); delete replacement.pending; delete replacement.rejected; local.change({ text: encode(replacement), baseRevision: reviewed.task.revision }); setNotice('Replacement draft prepared. Save details explicitly to apply your edits to the version you reviewed.'); }}>Prepare replacement save</button></> : <p>The original save is still unconfirmed. Retry it, or review the current task before explicitly preparing a replacement.</p> : <button type="button" disabled={!editable || busy} onClick={() => { local.change({ text: encode(value), baseRevision: canonical.revision }); setNotice('Your edits are retained against the current task revision. Save explicitly to apply them.'); }}>Keep my edits with current revision</button>}</section>}
    {invalid && <p role="alert">This local task draft could not be read. Keep it in storage and recover it before editing this task.</p>}
    {local.error && <p role="alert">{local.error}</p>}
    <footer className="task-details-save"><span>{local.dirty ? 'Unsaved changes · kept on this device' : 'All changes saved'}</span><button type="submit" disabled={!editable || !local.dirty || busy || reviewing || !!local.error || (conflict && !value.pending)}>{busy ? 'Saving…' : value.pending ? 'Retry original save' : 'Save details'}</button></footer>
    {value.pending && !value.rejected && reviewTaskDetails && <button type="button" disabled={!editable || busy || reviewing} onClick={() => void review()}>{reviewing ? 'Loading current task?' : 'Review current task'}</button>}
    {notice && <p className="task-details-notice" role="status">{notice}</p>}
  </form>;
}

export function TaskDetailsDialog(props: Props) {
  const { task, snapshot, disabled, close, correctTask, store, saveTaskDetails } = props;
  const heading = useRef<HTMLHeadingElement>(null);
  const evidence = snapshot.observations.filter(observation => task.evidenceIds.includes(observation.id));
  return <Sheet open onOpenChange={open => { if (!open) close(); }}><SheetContent className="task-details-dialog" aria-labelledby={`board-detail-${task.id}`} side="top" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus(); }} onCloseAutoFocus={event => event.preventDefault()} onEscapeKeyDown={event => { if (event.isComposing || event.keyCode === 229) event.preventDefault(); }}>
    <header className="task-details-header"><div className="task-details-title-row"><div className="task-details-status"><TaskStatusMenu task={task} disabled={disabled} correctTask={correctTask} /></div><div><SheetTitle ref={heading} id={`board-detail-${task.id}`} tabIndex={-1}>{task.title}</SheetTitle><span className="task-details-status-label">{statusLabels[task.status]}</span><SheetDescription className="task-details-sr-only">Task details</SheetDescription></div></div><button type="button" className="task-details-close" aria-label="Close task details" onClick={close}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button></header>
    <div className="task-details-scroll"><div className="task-details-main">
      {store && saveTaskDetails ? <DetailsEditor {...props} store={store} saveTaskDetails={saveTaskDetails} /> : <DetailFields value={detailsOf(task)} editable={false} />}
    </div><details className="task-details-supporting"><summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>Supporting updates{evidence.length > 0 && <span>{evidence.length}</span>}</summary><aside className="task-details-evidence" aria-label="Task evidence"><dl><div><dt>Requested by</dt><dd>{origins[task.requirementOrigin]}</dd></div><div><dt>Evidence</dt><dd>{evidenceLabels[task.evidenceLevel]}</dd></div>{task.ownerOverride && <div><dt>Authority</dt><dd>Owner correction</dd></div>}</dl>
      {evidence.length ? evidence.map(observation => <article key={observation.id}><strong>{evidenceLabels[observation.provenance.evidenceLevel]}</strong><p>{observation.excerpt ?? 'Metadata only. No source text was shared.'}</p><time dateTime={observation.observedAt}>{new Date(observation.observedAt).toLocaleString()}</time><details><summary>Source details</summary><p>Observation {observation.id}</p><p>{observation.provenance.adapterId} · {observation.provenance.adapterVersion}</p><p>{observation.provenance.mode === 'fixture' ? 'Sample data' : observation.provenance.mode.replaceAll('_', ' ')}</p></details></article>) : <p>No supporting updates are linked to this task.</p>}
    </aside></details></div>
  </SheetContent></Sheet>;
}
