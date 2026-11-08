import { describe, expect, it, vi } from 'vitest';
import { createHttpClient } from '@living-playbooks/api-client';
import { desktopOrigin, unavailableDesktopClient } from '../../apps/desktop/src/main/desktop-origin';

describe('desktop API origin', () => {
  it.each([undefined, '', 'not a URL', 'http://127.0.0.1:4310', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?q=1', 'https://example.com/#x'])(
    'disables invalid or insecure packaged origin %s', (raw) => {
      expect(desktopOrigin(raw, true)).toBeNull();
    },
  );
  it('permits HTTPS and development-only loopback with the same rules as the HTTP client', () => {
    for (const [raw, packaged] of [['https://example.com:443', true], ['http://127.0.0.1:4310', false], ['http://localhost:4310', false]] as const) {
      expect(desktopOrigin(raw, packaged)).toBe(new URL(raw).origin);
      expect(() => createHttpClient({ origin: raw, allowInsecureLoopback: !packaged })).not.toThrow();
    }
    expect(desktopOrigin('http://example.com', false)).toBeNull();
  });
  it('rejects every unavailable-client operation without network or credentials', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const client = unavailableDesktopClient();
    for (const method of Object.values(client)) await expect(Reflect.apply(method, undefined, [])).rejects.toThrow('Desktop API origin unavailable');
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });
});
