import { useEffect, useRef, useState } from 'react';
import type { DraftStore, LocalDraft } from './drafts';

export function useDraft(store: DraftStore, key: string, text: string, revision: number) {
  const [draft, setDraft] = useState<LocalDraft>({ text, baseRevision: revision });
  const current = useRef(draft);
  const [ready, setReady] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    store.read(key).then(saved => {
      if (!active) return;
      if (saved) { current.current = saved; setDraft(saved); setDirty(true); }
      setReady(true);
    }).catch(() => { if (active) setError('Draft storage unavailable. Copy your work before leaving.'); });
    return () => { active = false; };
  }, [key, store]);
  useEffect(() => {
    if (!dirty && revision >= current.current.baseRevision) {
      const next = { text, baseRevision: revision };
      current.current = next; setDraft(next);
    }
  }, [text, revision, dirty]);
  function change(next: LocalDraft) {
    current.current = next; setDraft(next); setDirty(true);
    void store.write(key, next).catch(() => setError('Draft could not be persisted. Copy your work before leaving.'));
  }
  async function saved(sent: LocalDraft, newRevision: number, savedText: string) {
    if (current.current === sent) {
      await store.remove(key);
      // Edits made during the storage transaction must survive too.
      if (current.current === sent) {
        current.current = { text: savedText, baseRevision: newRevision };
        setDraft(current.current); setDirty(false);
        return;
      }
    }
    change({ ...current.current, baseRevision: newRevision });
  }
  return { draft, current, ready, dirty, error, change, saved };
}
