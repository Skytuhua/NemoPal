import { useState } from 'react';
import { ProjectSnapshotSchema, type DocumentDraft, type PlaybooksClient } from '@living-playbooks/contracts';
import type { DraftStore } from './drafts';
import { useDraft } from './useDraft';
import { DetailIcon, DetailSurface } from '../details/DetailSurface';
import '../compact-details.css';

export function DocumentEditor({ document, heading, client, store, disabled, refresh, compact = false }: { document: DocumentDraft; heading: string; client: PlaybooksClient; store: DraftStore; disabled: boolean; refresh(): Promise<void>; compact?: boolean }) {
  const local = useDraft(store, `${document.projectId}:document:${document.id}`, document.text, document.revision);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [remote, setRemote] = useState<DocumentDraft>();
  const [open, setOpen] = useState(false);
  async function save() {
    const sent = local.current.current;
    setBusy(true); setNotice('');
    try {
      await store.flush();
      const result = await client.saveDocument(document.projectId, document.id, { operationId: crypto.randomUUID(), expectedRevision: sent.baseRevision, input: { text: sent.text } });
      await local.saved(sent, result.result.revision, result.result.text);
      setNotice('Document saved'); await refresh();
    } catch (error) {
      const conflict = error && typeof error === 'object' && 'code' in error && error.code === 'revision_conflict';
      setNotice('Save not confirmed. Your local copy is preserved; refresh before retrying.');
      try {
        // Native IPC can omit custom error fields; canonical revision remains the fence.
        const snapshot = ProjectSnapshotSchema.parse(await client.getSnapshot(document.projectId));
        if (snapshot.project.id !== document.projectId) throw new Error('Wrong project');
        const canonical = snapshot.documents.find(item => item.id === document.id);
        if (canonical && (conflict || canonical.revision !== sent.baseRevision)) {
          setNotice('Conflict: your copy is preserved. Review the current document before retrying.');
          setRemote(canonical); local.change({ ...local.current.current, conflict: canonical.text });
        }
      } catch { if (conflict) setNotice('Conflict: your copy is preserved. Current document is unavailable; refresh when connected.'); }
    } finally { setBusy(false); }
  }
  const editor = <>
    <label className="sr-only" htmlFor={`document-${document.id}`}>Document: {heading}</label>
    <textarea id={`document-${document.id}`} data-draft-editor value={local.draft.text} disabled={!local.ready} onChange={event => local.change({ ...local.draft, text: event.target.value })} rows={6} />
    <div className="actions"><button disabled={!local.ready || !local.dirty || busy || disabled || !!local.error} onClick={() => void save()}>{busy ? 'Saving…' : 'Save document'}</button><small>{local.dirty ? 'Unsaved changes · kept on this device' : 'Saved notes'}</small></div>
    {local.error && <p role="alert">{local.error}</p>}
    {notice && <p role="status">{notice}</p>}
    {(remote || local.draft.conflict !== undefined) && <details open><summary>Current server copy</summary><pre className="document-copy">{remote?.text ?? local.draft.conflict}</pre>{remote && <button onClick={() => { local.change({ text: local.draft.text, baseRevision: remote.revision }); setRemote(undefined); setNotice('Your text is retained against the latest revision. Save explicitly to replace the server copy.'); }}>Keep my text with latest revision</button>}</details>}
  </>;
  if (!compact) return editor;
  const conflict = !!remote || local.draft.conflict !== undefined;
  return <div className="compact-notes">
    <button type="button" className="notes-preview" aria-label="Open notes" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <span className="notes-preview-icon"><DetailIcon kind="note" /></span>
      <span className="notes-preview-copy"><strong>{heading}</strong><span className="notes-preview-text">{local.draft.text.trim() || 'Add notes for this project'}</span><small className={conflict || local.error ? 'notes-attention' : ''}>{local.error ? 'Draft storage needs attention' : conflict ? 'Review conflict' : busy ? 'Saving…' : local.dirty ? 'Unsaved changes' : 'Saved notes'}</small></span>
      <DetailIcon kind="arrow" />
    </button>
    <DetailSurface open={open} title={heading} closeLabel="Close notes" onClose={() => setOpen(false)} className="notes-detail">{editor}</DetailSurface>
  </div>;
}
