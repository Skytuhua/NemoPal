import { expect, it } from 'vitest';
import { ConsentSelections } from '../../apps/desktop/src/main/consent';
import { fixtureIds } from '../../fixtures/contracts/golden';

it('renderer paths cannot select sources and unconfigured receiving endpoints cannot enable sharing', () => {
  const consent = new ConsentSelections(null, null);
  const preview = consent.offer(fixtureIds.project, '019aa000-0000-7000-8000-000000000001', 'C:\\synthetic-project');
  if (!preview.available) throw Error('Expected native selection preview');
  expect(preview.disclosure).toContain('OFF');
  expect(() => consent.confirm({ selectionId: preview.selectionId, projectId: fixtureIds.project, allowLocalRead: true, exportPolicy: 'approved_excerpts', acknowledgedBestEffortFiltering: true })).toThrow('endpoint');
  expect(() => consent.confirm({ selectionId: preview.selectionId, projectId: fixtureIds.owner, allowLocalRead: true, exportPolicy: 'off', acknowledgedBestEffortFiltering: true })).toThrow();
  expect(consent.confirm({ selectionId: preview.selectionId, projectId: fixtureIds.project, allowLocalRead: true, exportPolicy: 'off', acknowledgedBestEffortFiltering: true })).toMatchObject({ threadId: '019aa000-0000-7000-8000-000000000001' });
  expect(() => consent.confirm({ selectionId: preview.selectionId, projectId: fixtureIds.project, allowLocalRead: true, exportPolicy: 'off', acknowledgedBestEffortFiltering: true })).toThrow();
});
it('an API origin without receiving-model disclosure does not advertise export choices', () => {
  const preview = new ConsentSelections('http://127.0.0.1:4310', null).offer(fixtureIds.project, '019aa000-0000-7000-8000-000000000001', 'C:\\synthetic-project');
  expect(preview.available && preview.cloudOrigin).toBe('');
});
