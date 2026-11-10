import { expect, it, vi } from 'vitest';
import { startSyntheticMain } from './main-harness';

it.each([null, 'not a URL', 'http://127.0.0.1:4310', 'https://example.com/path'])(
  'starts a packaged desktop safely without a usable destination: %s', async apiOrigin => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const main = await startSyntheticMain({ packaged: true, apiOrigin });
    try {
      expect(main.windows.load).toHaveBeenCalled();
      expect(main.dialog.showErrorBox).not.toHaveBeenCalled();
      expect(main.clientConfigurations).toHaveLength(0);
      expect(await main.invoke('capabilities')).toMatchObject({ paired: false, cloudOrigin: null });
      await expect(main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic' })).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await main.close();
      fetcher.mockRestore();
    }
  },
);

it('preserves the configured HTTPS client and pairing state in packaged mode', async () => {
  const main = await startSyntheticMain({ packaged: true, apiOrigin: 'https://example.com' });
  try {
    expect(main.clientConfigurations[0]).toMatchObject({ origin: 'https://example.com', allowInsecureLoopback: false });
    expect(await main.invoke('capabilities')).toMatchObject({ paired: true, cloudOrigin: 'https://example.com' });
  } finally { await main.close(); }
});
