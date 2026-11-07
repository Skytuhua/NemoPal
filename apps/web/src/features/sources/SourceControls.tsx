import { useEffect, useState } from 'react';
import { DesktopCapabilitiesSchema, SourceSelectionPreviewSchema, type DesktopBridge, type DesktopCapabilities, type ExportPolicy, type ProjectSnapshot, type SourceSelectionPreview } from '@living-playbooks/contracts';
export function SourceControls({ bridge, snapshot, refresh }: { bridge?: DesktopBridge; snapshot: ProjectSnapshot; refresh(): Promise<void> }) {
  const [capabilities, setCapabilities] = useState<DesktopCapabilities>(), [preview, setPreview] = useState<SourceSelectionPreview>();
  const [read, setRead] = useState(false), [acknowledge, setAcknowledge] = useState(false), [sharing, setSharing] = useState(false);
  const [policy, setPolicy] = useState<ExportPolicy>('off'), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  useEffect(() => { let active = true; bridge?.capabilities().then(raw => { if (active) setCapabilities(DesktopCapabilitiesSchema.parse(raw)); }).catch(() => { if (active) setStatus('Desktop capabilities unavailable.'); }); return () => { active = false; }; }, [bridge]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setStatus('');
    try { await action(); await refresh(); } catch { setStatus('Source operation not confirmed. Inspect source status before retrying.'); } finally { setBusy(false); }
  }
  const observer = capabilities?.sourceObservation;
  return <details className="source-controls"><summary>Sources & privacy</summary>
    <p>Only an explicitly selected source can be read. Source text and model replies cannot grant consent.</p>
    {!bridge && <p>Source observation unavailable: desktop bridge required.</p>}
    {bridge && <p>{observer?.available ? observer.coverage : observer?.reason ?? 'Checking desktop capability…'}</p>}
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
  </details>;
}
