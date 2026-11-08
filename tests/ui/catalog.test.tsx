import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { createFixtureClient } from '@living-playbooks/api-client';
import userEvent from '@testing-library/user-event';
import { App } from '../../apps/web/src/app/App';
import { memoryDrafts, snapshot } from './helpers';
afterEach(cleanup);
test('all six trusted panel variants resolve canonical records and expose evidence labels', async () => {
  const { container } = render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  await screen.findByRole('heading', { name: 'Demo notes' });
  expect([...container.querySelectorAll('[data-panel-type]')].map(el => el.getAttribute('data-panel-type'))).toEqual(['next_action', 'checklist', 'question_card', 'document_editor', 'milestone_timeline', 'evidence_card']);
  await userEvent.click(screen.getByText(/Agent reported/));
  expect(screen.getByText(/Observed at/)).toBeVisible();
});
test('untrusted layout is rejected and a plain checklist remains usable', async () => {
  const client = createFixtureClient();
  client.getSnapshot = async () => {
    const result = snapshot();
    (result.project.workspace.panels as unknown[]).push({ id: crypto.randomUUID(), type: 'html', heading: 'Bad', html: '<script>bad()</script>' });
    return result;
  };
  const { container } = render(<App client={client} drafts={memoryDrafts()} fixture />);
  expect(await screen.findByText(/Layout rejected/)).toBeVisible();
  expect(screen.getByLabelText('Status: Record the demo')).toBeVisible();
  expect(container.querySelector('script')).toBeNull();
});
