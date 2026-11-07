import { useState } from 'react';
import { ProjectSnapshotSchema, type DocumentDraft, type PlaybooksClient } from '@living-playbooks/contracts';
import type { DraftStore } from './drafts';
import { useDraft } from './useDraft';

export function DocumentEditor({ document, heading, client, store, disabled, refresh }: { document: DocumentDraft; heading: string; client: PlaybooksClient; store: DraftStore; disabled: boolean; refresh(): Promise<void> }) {
  const local = useDraft(store, `${document.projectId}:document:${document.id}`, document.text, document.revision);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [remote, setRemote] = useState<DocumentDraft>();
  async function save() {
    const sent = local.current.current;
    setBusy(true); setNotice('');
    try {
      await store.flush();
      const result = await client.saveDocument(document.projectId, document.id, { operationId: crypto.randomUUID(), expectedRevision: sent.baseRevision, input: { text: sent.text } });
      await local.saved(sent, result.result.revision, result.result.text);
      setNotice('Document saved'); await refresh();
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'revision_conflict') {
        setNotice('Conflict: your copy is preserved. Review the current document before retrying.');
        try {
          const snapshot = ProjectSnapshotSchema.parse(await client.getSnapshot(document.projectId));
          if (snapshot.project.id !== document.projectId) throw new Error('Wrong project');
          const canonical = snapshot.documents.find(item => item.id === document.id);
          setRemote(canonical);
          if (canonical) local.change({ ...local.current.current, conflict: canonical.text });
        } catch { setNotice('Conflict: your copy is preserved. Current document is unavailable; refresh when connected.'); }
      } else setNotice('Save failed. Your local copy is preserved; refresh before retrying.');
    } finally { setBusy(false); }
  }
  return <>
    <label className="sr-only" htmlFor={`document-${document.id}`}>Document: {heading}</label>
    <textarea id={`document-${document.id}`} data-draft-editor value={local.draft.text} disabled={!local.ready} onChange={event => local.change({ ...local.draft, text: event.target.value })} rows={6} />
    <div className="actions"><button disabled={!local.ready || !local.dirty || busy || disabled || !!local.error} onClick={() => void save()}>{busy ? 'Saving…' : 'Save document'}</button><small>{local.dirty ? 'Local draft · revision ' : 'Saved revision '}{local.draft.baseRevision}</small></div>
    {local.error && <p role="alert">{local.error}</p>}
    {notice && <p role="status">{notice}</p>}
    {(remote || local.draft.conflict !== undefined) && <details open><summary>Current server copy</summary><pre className="document-copy">{remote?.text ?? local.draft.conflict}</pre>{remote && <button onClick={() => { local.change({ text: local.draft.text, baseRevision: remote.revision }); setRemote(undefined); setNotice('Your text is retained against the latest revision. Save explicitly to replace the server copy.'); }}>Keep my text with latest revision</button>}</details>}
  </>;
}
