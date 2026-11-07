import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { DesktopCapabilitiesSchema, PairingInputSchema, PairingResultSchema, type DesktopBridge } from '@living-playbooks/contracts';

type Connection =
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'unconfigured' }
  | { state: 'unpaired' | 'pairing' | 'paired'; origin: string };

async function connection(bridge: DesktopBridge): Promise<Connection> {
  const capabilities = DesktopCapabilitiesSchema.parse(await bridge.capabilities());
  if (!capabilities.cloudOrigin) return { state: 'unconfigured' };
  const url = new URL(capabilities.cloudOrigin);
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== capabilities.cloudOrigin) throw new Error('Invalid destination');
  return { state: capabilities.paired ? 'paired' : 'unpaired', origin: url.origin };
}

export function PairingBootstrap({ bridge, children }: { bridge: DesktopBridge; children: ReactNode }) {
  const [current, setCurrent] = useState<Connection>({ state: 'loading' });
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const generation = useRef(0), pending = useRef(false);
  const code = useRef<HTMLInputElement>(null), deviceName = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const request = ++generation.current;
    pending.current = false; setCurrent({ state: 'loading' }); setError('');
    void connection(bridge).then(next => {
      if (request === generation.current) setCurrent(next);
    }).catch(() => { if (request === generation.current) setCurrent({ state: 'unavailable' }); });
    return () => { generation.current++; };
  }, [bridge, retry]);

  // Keep the secret out of React state and clear even the detached input on unmount.
  useEffect(() => {
    const field = code.current;
    return () => { if (field) field.value = ''; };
  }, [current.state === 'unpaired' || current.state === 'pairing']);

  useEffect(() => { if (error && current.state === 'unpaired') code.current?.focus(); }, [error, current.state]);

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || current.state !== 'unpaired') return;
    const input = PairingInputSchema.safeParse({ code: code.current?.value.trim(), deviceName: deviceName.current?.value.trim() });
    if (code.current) code.current.value = '';
    if (!input.success) {
      setError('Enter a pairing code and a short device name. If either is too long, shorten it.'); code.current?.focus(); return;
    }
    const request = ++generation.current, origin = current.origin;
    pending.current = true; setError(''); setCurrent({ state: 'pairing', origin });
    try {
      const result = PairingResultSchema.parse(await bridge.pair(input.data));
      if (request !== generation.current) return;
      if (!result.paired || (result.expiresAt && Date.parse(result.expiresAt) <= Date.now())) throw new Error('Pairing not confirmed');
      const confirmed = await connection(bridge);
      if (request !== generation.current) return;
      if (confirmed.state !== 'paired' || confirmed.origin !== origin) throw new Error('Pairing not confirmed');
      setCurrent(confirmed);
    } catch {
      if (request === generation.current) {
        setCurrent({ state: 'unavailable' });
        setError('Pairing not confirmed. Retry the connection to check this desktop and its destination.');
      }
    } finally {
      if (request === generation.current) pending.current = false;
    }
  }

  if (current.state === 'paired') return children;
  if (current.state === 'loading') return <main className="unavailable"><h1>Connecting this desktop</h1><p role="status">Checking desktop connection…</p></main>;
  if (current.state === 'unavailable' || current.state === 'unconfigured') return <main className="unavailable">
    <h1>Desktop connection unavailable</h1>
    <p role="alert">{error || (current.state === 'unconfigured' ? 'The destination is not configured. Ask your operator to configure this desktop, then retry.' : 'The desktop connection is unavailable. Check the connection and try again.')}</p>
    <div className="actions"><button onClick={() => setRetry(value => value + 1)}>Retry connection</button></div>
  </main>;
  const busy = current.state === 'pairing';
  return <main className="unavailable pairing-bootstrap">
    <h1 id="pairing-title">Pair this desktop</h1>
    <p>Enter the pairing code issued by your operator to open your project workspace.</p>
    <p>Destination: <strong>{current.origin}</strong></p>
    <form aria-labelledby="pairing-title" aria-busy={busy} autoComplete="off" noValidate onSubmit={event => void pair(event)}>
      <label>Pairing code<input ref={code} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={256} required disabled={busy} aria-describedby={error ? 'pairing-code-help pairing-error' : 'pairing-code-help'} /></label>
      <small id="pairing-code-help">Used only for this attempt.</small>
      <label>Device name<input ref={deviceName} autoComplete="off" maxLength={120} required disabled={busy} aria-describedby={error ? 'pairing-name-help pairing-error' : 'pairing-name-help'} /></label>
      <small id="pairing-name-help">A short name you recognize for this desktop.</small>
      {error && <p id="pairing-error" role="alert">{error}</p>}
      {busy && <p role="status">Pairing desktop and checking the connection…</p>}
      <div className="actions"><button type="submit" disabled={busy}>{busy ? 'Pairing desktop…' : 'Pair desktop'}</button></div>
    </form>
  </main>;
}
