import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { RedeemResultSchema, type PairingResult } from '@living-playbooks/contracts';

type ProtectedStorage = { isEncryptionAvailable(): boolean | Promise<boolean>; encryptString(value: string): Buffer | Promise<Buffer>; decryptString(value: Buffer): string | Promise<string> };
export class CredentialVault {
  private credential?: ReturnType<typeof RedeemResultSchema.parse>;
  constructor(private path: string, private storage: ProtectedStorage, private temporary: boolean) {}
  async load(): Promise<void> {
    if (!await this.storage.isEncryptionAvailable()) return;
    try {
      const bytes = await readFile(this.path);
      if (bytes.length > 8192) throw Error('Invalid protected credential');
      this.credential = RedeemResultSchema.parse(JSON.parse(await this.storage.decryptString(bytes)));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('Protected credential unavailable; re-pair explicitly.'); }
  }
  async save(input: unknown): Promise<PairingResult> {
    const credential = RedeemResultSchema.parse(input);
    const protectedStorage = await this.storage.isEncryptionAvailable();
    if (protectedStorage) {
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.tmp`;
      await writeFile(temp, await this.storage.encryptString(JSON.stringify(credential)), { mode: 0o600, flush: true });
      await rename(temp, this.path);
    } else if (!this.temporary) throw Error('OS protected storage unavailable. Explicit temporary session required.');
    this.credential = credential;
    return { paired: true, deviceId: credential.deviceId, expiresAt: credential.expiresAt, ...(protectedStorage ? {} : { reason: 'Temporary memory session; re-pair after exit.' }) };
  }
  authorization(): string | undefined {
    return this.credential && Date.parse(this.credential.expiresAt) > Date.now() ? `Bearer ${this.credential.token}` : undefined;
  }
  deviceId(): string | undefined { return this.authorization() ? this.credential?.deviceId : undefined; }
  localDeviceId(): string | undefined { return this.credential?.deviceId; }
  clearMemory(): void { this.credential = undefined; }
}
