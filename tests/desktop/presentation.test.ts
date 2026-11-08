import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { QuestionPresentation } from '../../apps/desktop/src/main/presentation';
import { goldenSnapshot, fixtureIds as ids } from '../../fixtures/contracts/golden';
import { ProjectSnapshotSchema, type PlaybooksClient, type SafePetEvent } from '@living-playbooks/contracts';

it('deduplicates repeated SSE presentation, rejects a stale or foreign answer and reflects real answers to both surfaces', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-presentation-'));
  try {
    const store = await JournalStore.open(join(dir, 'journal'));
    const events: SafePetEvent[] = []; const refreshes: string[] = []; const calls: string[] = [];
    const snapshot = ProjectSnapshotSchema.parse(goldenSnapshot);
    const client = { presentCheckIn: async () => { calls.push('present'); return { result: snapshot.checkIns[0] }; }, answerCheckIn: async () => { calls.push('answer'); return { result: { ...snapshot.checkIns[0], state: 'answered', answer: { kind: 'recorded' }, revision: 1 } }; } } as unknown as PlaybooksClient;
    const presentation = new QuestionPresentation(store, client, event => { events.push(event); }, project => { refreshes.push(project); }, () => Date.parse('2026-11-07T12:30:00.000Z'));
    await presentation.refresh(snapshot, true);
    await presentation.refresh(snapshot, true);
    expect(calls).toEqual(['present']);
    expect(events.filter(e => e.checkIn !== null)).toHaveLength(1);
    await expect(presentation.command({ type: 'answer', checkInId: ids.owner, command: { operationId: ids.owner, expectedRevision: 0, input: { kind: 'recorded' } } })).rejects.toThrow();
    await expect(presentation.command({ type: 'answer', checkInId: ids.checkIn, command: { operationId: ids.owner, expectedRevision: 9, input: { kind: 'recorded' } } })).rejects.toThrow();
    await presentation.command({ type: 'answer', checkInId: ids.checkIn, command: { operationId: ids.owner, expectedRevision: 0, input: { kind: 'recorded' } } });
    expect(calls).toEqual(['present', 'answer']);
    expect(events.at(-1)?.checkIn).toBeNull();
    expect(refreshes).toEqual([ids.project]);
    expect(await store.recordPresentation(ids.checkIn, ids.presentation)).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('offline and focus preferences suppress questions; stale source alone does not mean cloud offline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-presentation-'));
  try {
    const store = await JournalStore.open(join(dir, 'journal')); const events: SafePetEvent[] = [];
    const presentation = new QuestionPresentation(store, {} as PlaybooksClient, event => { events.push(event); }, () => {}, () => Date.parse('2026-11-07T12:30:00.000Z'));
    const snapshot = ProjectSnapshotSchema.parse(goldenSnapshot);
    await presentation.refresh(snapshot, false);
    expect(events.at(-1)).toMatchObject({ state: 'offline', checkIn: null });
    await store.setPreference({ hidden: false, focus: true, reducedMotion: true, pinnedProjectId: null });
    await presentation.refresh(snapshot, true);
    expect(events.at(-1)).toMatchObject({ state: 'snoozed', checkIn: null, preference: { reducedMotion: true } });
    await store.setPreference({ hidden: false, focus: false, reducedMotion: false, pinnedProjectId: null });
    snapshot.sourceBindings[0]!.state = 'stale'; snapshot.checkIns = []; snapshot.project.workspace.panels = [];
    await presentation.refresh(snapshot, true);
    expect(events.at(-1)?.state).toBe('idle');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('disconnect during a pending presentation cannot reveal a stale question', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-presentation-'));
  try {
    const store = await JournalStore.open(join(dir, 'journal')); const events: SafePetEvent[] = [];
    let finish!: (value: unknown) => void;
    const client = { presentCheckIn: () => new Promise(resolve => { finish = resolve; }) } as unknown as PlaybooksClient;
    const presentation = new QuestionPresentation(store, client, event => { events.push(event); }, () => {}, () => Date.parse('2026-11-07T12:30:00.000Z'));
    const pending = presentation.refresh(ProjectSnapshotSchema.parse(goldenSnapshot), true);
    await Promise.resolve();
    presentation.offline();
    finish({ result: goldenSnapshot.checkIns[0] }); await pending;
    expect(events.every(event => event.checkIn === null)).toBe(true);
    await expect(presentation.command({ type: 'answer', checkInId: ids.checkIn, command: { operationId: ids.owner, expectedRevision: 0, input: { kind: 'recorded' } } })).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
