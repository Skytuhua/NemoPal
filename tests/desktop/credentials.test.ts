import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CredentialVault } from '../../apps/desktop/src/main/credentials';

it('persists only OS ciphertext, exposes no token in the public pairing result, and reloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-credential-'));
  const crypto = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from([...s].reverse().join('')), decryptString: (b: Buffer) => [...b.toString()].reverse().join('') };
  try {
    const vault = new CredentialVault(join(dir, 'credential'), crypto, false);
    const result = await vault.save({ token: 'private-token', deviceId: '00000000-0000-4000-8000-000000000007', expiresAt: '2099-01-01T00:00:00.000Z' });
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect((await readFile(join(dir, 'credential'))).toString()).not.toContain('private-token');
    const restarted = new CredentialVault(join(dir, 'credential'), crypto, false);
    await restarted.load();
    expect(restarted.authorization()).toBe('Bearer private-token');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('requires explicit temporary memory session when protected storage is unavailable', async () => {
  const crypto = { isEncryptionAvailable: () => false, encryptString: () => { throw Error(); }, decryptString: () => { throw Error(); } };
  const input = { token: 'private-token', deviceId: '00000000-0000-4000-8000-000000000007', expiresAt: '2099-01-01T00:00:00.000Z' };
  await expect(new CredentialVault('unused', crypto, false).save(input)).rejects.toThrow('protected');
  const temporary = new CredentialVault('unused', crypto, true);
  await temporary.save(input);
  expect(temporary.authorization()).toBe('Bearer private-token');
  expect(new CredentialVault('unused', crypto, true).authorization()).toBeUndefined();
});
