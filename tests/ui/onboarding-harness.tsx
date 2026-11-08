// Test-only empty-account entry. Never imported by the application or production build.
import { createRoot } from 'react-dom/client';
import { createFixtureClient } from '@living-playbooks/api-client';
import { App } from '../../apps/web/src/app/App';
import { memoryDrafts } from './helpers';
import '../../apps/web/src/styles.css';

createRoot(document.getElementById('root')!).render(<App client={createFixtureClient({ snapshots: [] })} drafts={memoryDrafts()} fixture />);
