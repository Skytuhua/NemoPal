import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { WorkspaceRoot } from '../../apps/web/src/app/WorkspaceRoot';

afterEach(cleanup);

test('rich demo records require both existing development fixture opt-ins', async () => {
  const view = render(<WorkspaceRoot development fixtureEnabled />);
  expect(await screen.findByRole('heading', { name: 'Product demo', level: 1 })).toBeVisible();
  expect(screen.getByRole('progressbar', { name: 'Tasks marked done' })).toHaveAttribute('value', '3');
  expect(screen.getAllByLabelText(/^Status:/)).toHaveLength(6);
  expect(screen.getByText('Demo', { selector: 'summary' })).toBeVisible();
  view.unmount();
  render(<WorkspaceRoot development={false} fixtureEnabled />);
  expect(screen.getByRole('heading', { name: 'Open your project workspace' })).toBeVisible();
  expect(screen.queryByText('Product demo')).not.toBeInTheDocument();
});
