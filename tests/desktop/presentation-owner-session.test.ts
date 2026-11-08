import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { ProjectSnapshotSchema, type PlaybooksClient, type SafePetEvent } from '@living-playbooks/contracts';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { QuestionPresentation } from '../../apps/desktop/src/main/presentation';
import { fixtureIds, goldenSnapshot } from '../../fixtures/contracts/golden';
import { deferred } from './main-harness';

it('a reset while an answer is pending clears cached identity and prevents old-owner refreshes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lp-presentation-owner-'));
  const answer = deferred<unknown>();
  try {
    const store = await JournalStore.open(join(directory, 'journal'));
    const events: SafePetEvent[] = [], refresh = vi.fn();
    const client = { presentCheckIn: async () => ({ result: goldenSnapshot.checkIns[0] }), answerCheckIn: () => answer.promise } as unknown as PlaybooksClient;
    const presentation = new QuestionPresentation(store, client, event => events.push(event), refresh, () => Date.parse('2026-11-07T12:30:00.000Z'));
    await presentation.refresh(ProjectSnapshotSchema.parse(goldenSnapshot), true);
    const pending = presentation.command({ type: 'answer', checkInId: fixtureIds.checkIn, command: { operationId: fixtureIds.owner, expectedRevision: 0, input: { kind: 'recorded' } } });
    const outcome = pending.then(() => true, () => false);
    presentation.reset();
    answer.resolve({ result: { ...goldenSnapshot.checkIns[0], state: 'answered', answer: { kind: 'recorded' }, revision: 1 } });
    expect(await outcome).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(presentation.current()).toMatchObject({ projectId: null, managerName: '', checkIn: null, state: 'offline' });
    await presentation.command({ type: 'setPreference', preference: { hidden: false, focus: false, reducedMotion: true, pinnedProjectId: null } });
    expect(events.at(-1)).toMatchObject({ projectId: null, managerName: '', checkIn: null });
    await expect(presentation.command({ type: 'openProject', projectId: fixtureIds.project })).rejects.toThrow();
  } finally { answer.resolve(null); await rm(directory, { recursive: true, force: true }); }
});
