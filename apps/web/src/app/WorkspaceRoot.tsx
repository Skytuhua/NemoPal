import { useState } from 'react';
import type { DesktopBridge } from '@living-playbooks/contracts';
import { App } from './App';
import { runtime } from './runtime';
import { createDraftStore } from '../features/documents/drafts';
import { PairingBootstrap } from '../features/pairing/PairingBootstrap';

type WorkspaceProps = { bridge?: DesktopBridge; development: boolean; fixtureEnabled: boolean };

export function WorkspaceRoot(props: WorkspaceProps) {
  return props.bridge ? <PairingBootstrap bridge={props.bridge}><Workspace {...props} /></PairingBootstrap> : <Workspace {...props} />;
}

function Workspace({ bridge, development, fixtureEnabled }: WorkspaceProps) {
  const [mode] = useState(() => runtime(bridge, development, fixtureEnabled));
  const [drafts] = useState(() => mode.client ? createDraftStore() : undefined);
  if (mode.client && drafts) return <App client={mode.client} bridge={bridge} fixture={mode.fixture} drafts={drafts} />;
  return <main className="unavailable"><h1>Open your project workspace</h1><p>Living Playbooks turns a goal into steps you can follow, with tasks, notes and a project manager in one place.</p><p>Open the Living Playbooks desktop application to get started. This browser window isn’t connected to your projects.</p><details><summary>Connection details</summary><p>Desktop capability unavailable. The desktop app manages the connection and permissions to read your selected sources. No connection or model availability has been established.</p>{development && <p>For intentional synthetic development only, set VITE_DEV_FIXTURES=true before starting Vite. Fixture mode never activates automatically.</p>}</details></main>;
}
