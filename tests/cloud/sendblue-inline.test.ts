import { expect, test } from 'vitest';
import { parseMessage } from '../../apps/cloud/src/integrations/sendblue/payload';

const config = { enabled: true, account: 'synthetic@example.test', line: '+15550000001' };
const message = { accountEmail: config.account, message_handle: 'reply', from_number: '+15550000002', to_number: config.line,
  content: 'My inline question', is_outbound: false, status: 'RECEIVED', message_type: 'message' };

test('accepts documented inline reply part indexes while retaining opaque thread parts', () => {
  const result = parseMessage({ ...message, reply_to: { message_handle: 'parent', part_index: 0 }, thread_originator: { message_handle: 'root', part: 'opaque-apple-part' } }, config);
  expect(result.message.content).toBe('My inline question');
  expect(result.sender).toBe('+15550000002');
});

test.each([-1, 51, 0.5, '0'])('rejects malformed inline reply part index %s', part_index => {
  expect(() => parseMessage({ ...message, reply_to: { message_handle: 'parent', part_index } }, config)).toThrow();
});
