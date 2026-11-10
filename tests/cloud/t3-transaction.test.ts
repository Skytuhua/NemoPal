import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { t3Transaction } from '../../apps/cloud/src/integrations/t3/transaction';

it('holds an unknown commit until a fresh project lock establishes the old transaction has settled', async () => {
  let releaseLock!: () => void;
  const lock = new Promise<void>(resolve => { releaseLock = resolve; });
  const first = { query: vi.fn(async (sql: string) => { if (sql === 'COMMIT') throw Error('lost acknowledgement'); return { rows: [] }; }), release: vi.fn() };
  const second = { query: vi.fn(async (sql: string) => { if (sql.startsWith('SELECT')) await lock; return { rows: [] }; }), release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) } as unknown as Pool;
  let settled = false;
  const result = t3Transaction(pool, 'project', async () => 'value').finally(() => { settled = true; });
  await vi.waitFor(() => expect(second.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), ['project']));
  expect(settled).toBe(false);
  expect(first.release).toHaveBeenCalledWith(true);
  releaseLock();
  await expect(result).rejects.toThrow('lost acknowledgement');
});

it('keeps an unknown rollback pending when reconciliation cannot obtain a database connection', async () => {
  const first = { query: vi.fn(async (sql: string) => { if (sql === 'ROLLBACK') throw Error('connection lost'); return { rows: [] }; }), release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValueOnce(first).mockRejectedValueOnce(Error('database offline')) } as unknown as Pool;
  let settled = false;
  void t3Transaction(pool, 'project', async () => { throw Error('write failed'); }).finally(() => { settled = true; });
  await vi.waitFor(() => expect(pool.connect).toHaveBeenCalledTimes(2));
  expect(first.release).toHaveBeenCalledWith(true);
  expect(settled).toBe(false);
});
