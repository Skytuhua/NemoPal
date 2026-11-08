import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { PhoneLinkInputSchema, RevisionedCommandEnvelope } from '@living-playbooks/contracts';
import type { z } from 'zod';
import { PhoneControls } from '../../apps/web/src/features/phone/PhoneControls';
import { deferred, snapshot } from './helpers';
afterEach(cleanup);

test('phone enrollment requires consent and sends a project-scoped finite grant, then can revoke it', async () => {
  const project = snapshot().project;
  let link: null | { id: string; expiresAt: string; notifications: boolean } = null;
  const client = {
    getPhoneStatus: vi.fn(async () => ({ state: 'configured' as const, link })),
    linkPhone: vi.fn(async (_id: string, command: RevisionedCommandEnvelope<z.infer<typeof PhoneLinkInputSchema>>) => { link = { id: crypto.randomUUID(), expiresAt: command.input.expiresAt, notifications: command.input.notifications }; }),
    revokePhone: vi.fn(async () => { link = null; }),
  };
  render(<PhoneControls project={project} client={client as never} disabled={false} refresh={async () => {}} />);
  await userEvent.click(screen.getByText('Phone messaging'));
  await screen.findByText(/No phone linked/);
  await userEvent.type(screen.getByLabelText('Your phone number'), '+15550000002');
  expect(screen.getByRole('button', { name: 'Link phone' })).toBeDisabled();
  await userEvent.click(screen.getByLabelText(/I consent/));
  await userEvent.click(screen.getByRole('button', { name: 'Link phone' }));
  await screen.findByText(/Phone linked/);
  expect(client.linkPhone).toHaveBeenCalledWith(project.id, expect.objectContaining({ expectedRevision: project.revision, input: expect.objectContaining({ sender: '+15550000002', notifications: true }) }));
  const expiresAt = Date.parse(client.linkPhone.mock.calls[0]![1].input.expiresAt);
  expect(expiresAt - Date.now()).toBeGreaterThan(5 * 86400000);
  expect(expiresAt - Date.now()).toBeLessThan(7 * 86400000);
  await userEvent.click(screen.getByRole('button', { name: 'Revoke phone access' }));
  await waitFor(() => expect(client.revokePhone).toHaveBeenCalledWith(project.id, expect.objectContaining({ input: { linkId: expect.any(String) } })));
  await screen.findByText(/No phone linked/);
});

test('a late status from the previous project cannot replace the selected project status', async () => {
  const pending = deferred<{ state: 'configured'; link: null }>();
  const client = { getPhoneStatus: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ state: 'disabled', link: null }) };
  const first = snapshot().project, second = snapshot(100).project;
  const { rerender } = render(<PhoneControls project={first} client={client as never} disabled={false} refresh={async () => {}} />);
  rerender(<PhoneControls project={second} client={client as never} disabled={false} refresh={async () => {}} />);
  await userEvent.click(screen.getByText('Phone messaging'));
  await screen.findByText(/configuration: disabled/);
  await act(async () => { pending.resolve({ state: 'configured', link: null }); await pending.promise; });
  expect(screen.getByText(/configuration: disabled/)).toBeVisible();
});

test('configuration unavailable prevents linking and does not claim delivery', async () => {
  const client = { getPhoneStatus: async () => ({ state: 'disabled', link: null }) };
  render(<PhoneControls project={snapshot().project} client={client as never} disabled={false} refresh={async () => {}} />);
  await userEvent.click(screen.getByText('Phone messaging'));
  await screen.findByText(/disabled/);
  expect(screen.getByRole('button', { name: 'Link phone' })).toBeDisabled();
  expect(screen.getByText(/not verified/i)).toBeVisible();
});
