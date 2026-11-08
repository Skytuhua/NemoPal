import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { createFixtureClient } from '@living-playbooks/api-client';
import { App } from '../../apps/web/src/app/App';
import { snapshot, memoryDrafts } from './helpers';
afterEach(cleanup);
test('stale source alone leaves cloud distinct; offline and paused states preserve the working surface', async () => {
  const seed = snapshot(); seed.sourceBindings[0]!.state = 'stale'; seed.connection.sync = 'offline'; seed.project.status = 'paused';
  render(<App client={createFixtureClient({ snapshots: [seed] })} drafts={memoryDrafts()} fixture />);
  expect(await screen.findByText(/Cloud offline · writes unavailable\. You can keep drafting notes/)).toBeVisible();
  await userEvent.click(screen.getByText('Connection details', { selector: 'summary' }));
  expect(screen.getByText('Cloud offline · writes unavailable')).toBeVisible();
  expect(screen.getByText(/Source freshness: stale/)).toBeVisible();
  expect(screen.getByText('Project paused')).toBeVisible();
  expect(screen.getByLabelText('Status: Record the demo')).toBeDisabled();
  await waitFor(() => expect(screen.getByLabelText('Document: Demo notes')).toBeEnabled());
});
test('read failure displays recoverable error without implicit fixture success', async () => {
  const client = createFixtureClient(); client.getSnapshot = async () => { throw new Error('offline'); };
  render(<App client={client} drafts={memoryDrafts()} fixture={false} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Project unavailable');
  expect(screen.queryByLabelText('Status: Record the demo')).not.toBeInTheDocument();
  expect(screen.queryByText(/Fixture mode/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.getByRole('alert')).toBeVisible();
});
