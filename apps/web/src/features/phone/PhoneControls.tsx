import { useEffect, useRef, useState } from 'react';
import { PhoneLinkInputSchema, type PlaybooksClient, type Project } from '@living-playbooks/contracts';

export function PhoneControls({ client, project, disabled, refresh }: { client: PlaybooksClient; project: Project; disabled: boolean; refresh(): Promise<void> }) {
  const [status, setStatus] = useState<Awaited<ReturnType<PlaybooksClient['getPhoneStatus']>>>();
  const [number, setNumber] = useState(''), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  async function read() {
    const current = ++generation.current;
    try { const result = await client.getPhoneStatus(project.id); if (generation.current === current) { setStatus(result); setError(''); } }
    catch { if (generation.current === current) { setStatus(undefined); setError('Phone status unavailable. Refresh before making changes.'); } }
  }
  useEffect(() => { void read(); return () => { generation.current++; }; }, [client, project.id]);
  async function run(action: () => Promise<unknown>) {
    ++generation.current; setBusy(true); setError('');
    try { await action(); setNumber(''); setConsent(false); await refresh(); await read(); }
    catch { setStatus(undefined); setError('Phone change not confirmed. Refresh status and project before trying again.'); }
    finally { setBusy(false); }
  }
  const validNumber = PhoneLinkInputSchema.shape.sender.safeParse(number).success;
  const expired = status?.link && Date.parse(status.link.expiresAt) <= Date.now();
  return <details className="source-controls"><summary>Phone messaging</summary>
    <p>Sendblue configuration: {status?.state ?? 'unknown'}.</p>
    <p>Configuration does not verify sending or receiving. Receiving requires a reachable authenticated webhook; replies require the manager to be available. Delivery is not verified.</p>
    <p>Automatic notifications are not connected yet, even when permission is granted.</p>
    {status && (status.link ? <p>Phone linked {expired ? '(expired)' : `until ${new Date(status.link.expiresAt).toLocaleString()}`} · notification permission {status.link.notifications ? 'on' : 'off'}</p> : <p>No phone linked to this project.</p>)}
    {status?.link ? <button disabled={disabled || busy} onClick={() => void run(() => client.revokePhone(project.id, { operationId: crypto.randomUUID(), expectedRevision: project.revision, input: { linkId: status.link!.id } }))}>Revoke phone access</button> : <>
      <label>Your phone number<input type="tel" autoComplete="tel" value={number} onChange={event => { setNumber(event.target.value); setConsent(false); }} placeholder="+ country code and number" /></label>
      <label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />I consent to link my number to this project for phone messages, manager replies, and notifications for up to 7 days.</label>
      <button disabled={disabled || busy || status?.state !== 'configured' || !validNumber || !consent} onClick={() => void run(() => client.linkPhone(project.id, { operationId: crypto.randomUUID(), expectedRevision: project.revision, input: { sender: number, notifications: true, expiresAt: new Date(Date.now() + 6 * 86400000).toISOString() } }))}>Link phone</button>
    </>}
    <button disabled={busy} onClick={() => void (async () => { await refresh(); await read(); })()}>Refresh phone status</button>
    {error && <p role="alert">{error}</p>}
  </details>;
}
