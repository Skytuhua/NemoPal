import { useEffect, useState } from 'react';
import { DesktopCapabilitiesSchema, SafeDesktopEventSchema, SourceSelectionPreviewSchema, type DesktopBridge, type DesktopCapabilities, type ExportPolicy, type ProjectSnapshot, type SourceSelectionPreview } from '@living-playbooks/contracts';
export function SourceControls({ bridge, snapshot, refresh }: { bridge?: DesktopBridge; snapshot: ProjectSnapshot; refresh(): Promise<void> }) {
  const [capabilities, setCapabilities] = useState<DesktopCapabilities>(), [preview, setPreview] = useState<SourceSelectionPreview>();
  const [read, setRead] = useState(false), [acknowledge, setAcknowledge] = useState(false), [sharing, setSharing] = useState(false);
  const [policy, setPolicy] = useState<ExportPolicy>('off'), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [revocation, setRevocation] = useState('');
  const [pet, setPet] = useState({ hidden: false, focus: false, reducedMotion: false, pin: false });
  useEffect(() => { let active = true; bridge?.capabilities().then(raw => { if (active) setCapabilities(DesktopCapabilitiesSchema.parse(raw)); }).catch(() => { if (active) setStatus('Desktop capabilities unavailable.'); }); return () => { active = false; }; }, [bridge]);
  useEffect(() => bridge?.onEvent(raw => {
    const parsed = SafeDesktopEventSchema.safeParse(raw);
    if (parsed.success && parsed.data.type === 'source_state' && parsed.data.binding.projectId === snapshot.project.id) {
      setRevocation(parsed.data.cloudRevocationPending ? 'Local source revoked · cloud revocation pending. Local reading is stopped; cloud deletion is not confirmed.' : '');
    }
  }), [bridge, snapshot.project.id]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setStatus('');
    try { await action(); await refresh(); } catch { setStatus('Source operation not confirmed. Inspect source status before retrying.'); } finally { setBusy(false); }
  }
  const observer = capabilities?.sourceObservation;
  return <details className="source-controls"><summary>Sources & privacy</summary>
    <p>Only an explicitly selected source can be read. Source text and model replies cannot grant consent.</p>
    {!bridge && <p>Source observation unavailable: desktop bridge required.</p>}
    {bridge && <p>{observer?.available ? observer.coverage : observer?.reason ?? 'Checking desktop capability…'}</p>}
    {revocation && <p role="status">{revocation}</p>}
    {snapshot.sourceBindings.length === 0 && <p>No linked sources. Monitoring and export are off.</p>}
    {snapshot.sourceBindings.map(binding => <div className="source-row" key={binding.id}><strong>{binding.adapterId}</strong><p>Source {binding.state} · export {binding.exportPolicy.replaceAll('_', ' ')}</p><small>Last observed: {binding.lastObservedAt ? new Date(binding.lastObservedAt).toLocaleString() : 'Never'}</small><div className="actions"><button disabled={!bridge || busy || binding.state !== 'following'} onClick={() => void run(() => bridge!.pauseSource(binding.id))}>Pause source</button><button disabled={!bridge || busy || binding.state === 'revoked'} onClick={() => void run(() => bridge!.revokeSource(binding.id))}>Revoke source</button></div></div>)}
    <button disabled={!bridge || !observer?.available || busy} onClick={() => void run(async () => {
      const selected = SourceSelectionPreviewSchema.parse(await bridge!.selectSource(snapshot.project.id));
      if (selected.available && selected.projectId !== snapshot.project.id) throw new Error('Wrong project selection');
      setPreview(selected); setRead(false); setAcknowledge(false); setSharing(false); setPolicy('off');
    })}>Select source</button>
    {preview && (!preview.available ? <p role="status">{preview.reason}</p> : <fieldset><legend>Consent for {preview.displayName}</legend><p>{preview.disclosure}</p><p>Receiving endpoint: {preview.cloudOrigin || 'Unconfigured · local only'}</p>
      <label><input type="checkbox" checked={read} onChange={event => setRead(event.target.checked)} />Allow local read of this selected source</label>
      <label><input type="checkbox" checked={acknowledge} onChange={event => setAcknowledge(event.target.checked)} />I understand filtering is best effort; credentials and hidden reasoning are excluded</label>
      <label>Cloud export<select value={policy} onChange={event => { setPolicy(event.target.value as ExportPolicy); setSharing(false); }}><option value="off">Off · local only</option><option value="metadata_only" disabled={!preview.cloudOrigin}>Metadata only</option><option value="approved_excerpts" disabled={!preview.cloudOrigin}>Approved visible excerpts</option></select></label>
      {policy !== 'off' && <label><input type="checkbox" checked={sharing} onChange={event => setSharing(event.target.checked)} />I consent to this export policy and named receiving endpoint</label>}
      <button disabled={busy || !read || !acknowledge || (policy !== 'off' && (!sharing || !preview.cloudOrigin))} onClick={() => void run(async () => {
        await bridge!.confirmSource({ selectionId: preview.selectionId, projectId: snapshot.project.id, allowLocalRead: true, exportPolicy: policy, acknowledgedBestEffortFiltering: true });
        setPreview(undefined); setStatus('Consent sent to desktop. Canonical source status is shown above.');
      })}>Confirm source consent</button><button disabled={busy} onClick={() => setPreview(undefined)}>Cancel selection</button>
    </fieldset>)}
    {status && <p role="status">{status}</p>}
    {bridge && <fieldset><legend>Set local pet preferences</legend>
      {capabilities?.nativePet.available === false && <p>Pet unavailable: {capabilities.nativePet.reason}</p>}
      <p>Apply replaces the local visibility, focus, motion, and pin settings.</p>
      <label><input type="checkbox" checked={pet.hidden} onChange={event => setPet({ ...pet, hidden: event.target.checked })} />Hide desktop pet</label>
      <label><input type="checkbox" checked={pet.focus} onChange={event => setPet({ ...pet, focus: event.target.checked })} />Focus mode for pet</label>
      <label><input type="checkbox" checked={pet.reducedMotion} onChange={event => setPet({ ...pet, reducedMotion: event.target.checked })} />Reduce pet motion</label>
      <label><input type="checkbox" checked={pet.pin} onChange={event => setPet({ ...pet, pin: event.target.checked })} />Pin pet to {snapshot.project.title}</label>
      <button disabled={busy || !capabilities?.nativePet.available} onClick={() => void run(async () => {
        await bridge.setPetPreference({ hidden: pet.hidden, focus: pet.focus, reducedMotion: pet.reducedMotion, pinnedProjectId: pet.pin ? snapshot.project.id : null });
        setStatus('Pet preferences sent to desktop.');
      })}>Apply pet preferences</button>
    </fieldset>}
  </details>;
}
