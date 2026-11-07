import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { runtime } from './app/runtime';
import { createDraftStore } from './features/documents/drafts';
import { Pet } from './pet/Pet';
import './styles.css';
const root = createRoot(document.getElementById('root')!);
if (new URLSearchParams(location.search).get('surface') === 'pet') {
  document.body.classList.add('pet-window');
  document.documentElement.classList.add('pet-window');
  root.render(<Pet bridge={window.pet} />);
} else {
  const mode = runtime(window.playbooks, import.meta.env.DEV, import.meta.env.VITE_DEV_FIXTURES === 'true');
  root.render(mode.client ? <App client={mode.client} bridge={window.playbooks} fixture={mode.fixture} drafts={createDraftStore()} /> : <main className="unavailable"><h1>Desktop capability unavailable</h1><p>Open Living Playbooks in its desktop application to use the project workspace.</p><p>Cloud credentials and source controls are managed by desktop main. No connection or model availability has been established.</p>{import.meta.env.DEV && <p>For intentional synthetic development only, set VITE_DEV_FIXTURES=true before starting Vite. Fixture mode never activates automatically.</p>}</main>);
}
