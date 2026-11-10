import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { setup, command } from './helpers';

let h: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { h = await setup(); });
afterEach(async () => { await h?.close(); });

test.each(['queued', 'running', 'completed', 'failed', 'cancelled', 'superseded'])('snapshot shows the canonical %s reply state without exposing job diagnostics', async state => {
  const { projectId } = await h.create();
  const sent = await h.request('POST', `/v1/projects/${projectId}/messages`, command({ text: 'Keep my question.' }, 0));
  expect(sent.statusCode).toBe(200);
  const { jobId } = sent.json();
  await h.pool.query("UPDATE jobs SET state=$2,data=data || jsonb_build_object('errorClass','private diagnostic') WHERE id=$1", [jobId, state]);
  const response = await h.request('GET', `/v1/projects/${projectId}/snapshot`);
  expect(response.statusCode).toBe(200);
  expect(response.json().messages).toEqual([expect.objectContaining({ text: 'Keep my question.', jobId, replyState: state })]);
  expect(response.body).not.toContain('private diagnostic');
  const stored = (await h.pool.query('SELECT data FROM messages WHERE project_id=$1', [projectId])).rows[0].data;
  expect(stored.replyState).toBeUndefined();
});

test.each([0, 1000])('snapshot follows a replacement job %sms later and leaves legacy messages alone', async delay => {
  const { projectId } = await h.create();
  const sent = await h.request('POST', `/v1/projects/${projectId}/messages`, command({ text: 'Question with a replacement.' }, 0));
  const original = (await h.pool.query('SELECT * FROM jobs WHERE id=$1', [sent.json().jobId])).rows[0];
  await h.pool.query("UPDATE jobs SET state='superseded' WHERE id=$1", [original.id]);
  const replacement = { ...original.data, id: randomUUID(), kind: 'reflection', state: 'failed', runAfter: new Date(Date.parse(original.data.runAfter) + delay).toISOString() };
  await h.pool.query('INSERT INTO jobs(id,project_id,data,state,run_after) VALUES($1,$2,$3,$4,$5)', [replacement.id, projectId, replacement, replacement.state, replacement.runAfter]);
  const legacy = { id: randomUUID(), projectId, role: 'owner', text: 'Legacy question.', createdAt: new Date().toISOString(), observationIds: [] };
  await h.pool.query('INSERT INTO messages(id,project_id,data) VALUES($1,$2,$3)', [legacy.id, projectId, legacy]);
  const messages = (await h.request('GET', `/v1/projects/${projectId}/snapshot`)).json().messages;
  expect(messages.find((message: { jobId?: string }) => message.jobId === original.id)).toMatchObject({ replyState: 'failed' });
  expect(messages.find((message: { id: string }) => message.id === legacy.id)).toEqual(legacy);
});
