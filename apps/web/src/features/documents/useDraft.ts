import { useEffect, useMemo, useRef, useState } from 'react';
import type { DraftStore, LocalDraft } from './drafts';

export function useDraft(store: DraftStore, key: string, text: string, revision: number) {
  const [draft, setDraft] = useState<LocalDraft>({ text, baseRevision: revision });
  const current = useRef(draft);
  const lifetime = useMemo(() => ({ active: false, sequence: 0 }), [key, store]);
  const [ready, setReady] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    lifetime.active = true;
    store.read(key).then(saved => {
      if (!active) return;
      if (saved) { current.current = saved; setDraft(saved); setDirty(true); }
      setReady(true);
    }).catch(() => { if (active) setError('Draft storage unavailable. Copy your work before leaving.'); });
    return () => { active = false; lifetime.active = false; };
  }, [key, store, lifetime]);
  useEffect(() => {
    if (!dirty && revision >= current.current.baseRevision) {
      const next = { text, baseRevision: revision };
      current.current = next; setDraft(next);
    }
  }, [text, revision, dirty]);
  async function persist(next: LocalDraft) {
    const sequence = ++lifetime.sequence;
    try {
      await store.write(key, next);
      if (lifetime.active && lifetime.sequence === sequence && current.current === next) setError('');
    } catch (error) {
      if (lifetime.active && lifetime.sequence === sequence) setError('Draft could not be persisted. Copy your work before leaving.');
      throw error;
    }
  }
  function change(next: LocalDraft) {
    if (!lifetime.active) return;
    current.current = next; setDraft(next); setDirty(true);
    void persist(next).catch(() => {});
  }
  async function saved(sent: LocalDraft, newRevision: number, savedText: string) {
    if (!lifetime.active) return;
    if (current.current === sent) {
      await store.remove(key);
      if (!lifetime.active) return;
      // Edits made during the storage transaction must survive too.
      if (current.current === sent) {
        current.current = { text: savedText, baseRevision: newRevision };
        setDraft(current.current); setDirty(false);
        return;
      }
    }
    change({ ...current.current, baseRevision: newRevision });
  }
  return { draft, current, ready, dirty, error, change, saved, retry: () => persist(current.current) };
}
