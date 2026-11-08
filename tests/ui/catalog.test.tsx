import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { createFixtureClient } from '@living-playbooks/api-client';
import { WorkspaceCatalog } from '@living-playbooks/project-ui';
import userEvent from '@testing-library/user-event';
import { App } from '../../apps/web/src/app/App';
import { memoryDrafts, snapshot } from './helpers';
afterEach(cleanup);
test('all six trusted panel variants resolve canonical records and expose evidence labels', async () => {
  const seed = snapshot();
  const { container } = render(<WorkspaceCatalog snapshot={seed} panels={seed.project.workspace.panels} disabled={false} correctTask={() => {}} openTask={() => {}} document={id => <p>{seed.documents.find(record => record.id === id)?.text}</p>} question={record => <p>{record.question}</p>} />);
  expect(screen.getByRole('heading', { name: 'Demo notes' })).toBeVisible();
  expect([...container.querySelectorAll('[data-panel-type]')].map(el => el.getAttribute('data-panel-type'))).toEqual(['checklist', 'milestone_timeline', 'evidence_card', 'question_card', 'document_editor', 'next_action']);
  expect(screen.getByText(/Agent reported/)).toBeVisible();
  await userEvent.click(screen.getByText(/Agent reported/, { selector: 'summary' }));
  expect(screen.getByText(/Observed at/)).toBeVisible();
});
test('untrusted layout is rejected and the canonical task board remains usable', async () => {
  const client = createFixtureClient();
  client.getSnapshot = async () => {
    const result = snapshot();
    (result.project.workspace.panels as unknown[]).push({ id: crypto.randomUUID(), type: 'html', heading: 'Bad', html: '<script>bad()</script>' });
    return result;
  };
  const { container } = render(<App client={client} drafts={memoryDrafts()} fixture />);
  expect(await screen.findByText(/Layout rejected/)).toBeVisible();
  expect(screen.getByLabelText(/^Status: Record the demo/)).toBeVisible();
  expect(container.querySelector('script')).toBeNull();
});
