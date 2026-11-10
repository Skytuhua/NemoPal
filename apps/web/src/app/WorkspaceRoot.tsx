import { useState } from 'react';
import type { DesktopBridge } from '@living-playbooks/contracts';
import { App } from './App';
import { runtime } from './runtime';
import { createDraftStore } from '../features/documents/drafts';
import { PairingBootstrap } from '../features/pairing/PairingBootstrap';
import { LocalThread } from '../features/chat/LocalThread';

type WorkspaceProps = { bridge?: DesktopBridge; development: boolean; fixtureEnabled: boolean };

export function WorkspaceRoot(props: WorkspaceProps) {
  const [local, setLocal] = useState(false), [visited, setVisited] = useState(false);
  const workspace = props.bridge ? <PairingBootstrap bridge={props.bridge}><Workspace {...props} /></PairingBootstrap> : <Workspace {...props} />;
  if (!props.bridge?.localThread) return workspace;
  return <>
    <nav className="desktop-view-nav" aria-label="Desktop views">
      <button aria-pressed={!local} onClick={() => setLocal(false)}>Project workspace</button>
      <button aria-pressed={local} onClick={() => { setVisited(true); setLocal(true); }}>Local coding thread</button>
    </nav>
    <div hidden={local}>{workspace}</div>
    <div hidden={!local}>{visited && <LocalThread bridge={props.bridge.localThread} />}</div>
  </>;
}

function Workspace({ bridge, development, fixtureEnabled }: WorkspaceProps) {
  const [mode] = useState(() => runtime(bridge, development, fixtureEnabled));
  const [drafts] = useState(() => mode.client ? createDraftStore() : undefined);
  if (mode.client && drafts) return <App client={mode.client} bridge={bridge} fixture={mode.fixture} drafts={drafts} />;
  return <main className="unavailable"><h1>Desktop capability unavailable</h1><p>Open Living Playbooks in its desktop application to use the project workspace.</p><p>Cloud credentials and source controls are managed by desktop main. No connection or model availability has been established.</p>{development && <p>For intentional synthetic development only, set VITE_DEV_FIXTURES=true before starting Vite. Fixture mode never activates automatically.</p>}</main>;
}
