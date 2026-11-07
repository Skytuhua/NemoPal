import { expect, test } from 'vitest';
import { SafeDesktopEventSchema } from '@living-playbooks/contracts';
import { goldenOpenProjectEvent } from '../../fixtures/contracts/golden';

const projectId = '00000000-0000-4000-8000-000000000001';

test('desktop can request opening exactly one project without adding native powers', () => {
  expect(SafeDesktopEventSchema.parse({ type: 'open_project', projectId })).toEqual({ type: 'open_project', projectId });
  expect(SafeDesktopEventSchema.parse(goldenOpenProjectEvent)).toEqual({ type: 'open_project', projectId });
});

test.each([
  { type: 'open_project', projectId: '/private/path' },
  { type: 'open_project', projectId, command: 'execute' },
])('desktop open-project event rejects invalid identity or extra authority: %j', event => {
  expect(SafeDesktopEventSchema.safeParse(event).success).toBe(false);
});
