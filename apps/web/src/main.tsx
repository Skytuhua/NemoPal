import { createRoot } from 'react-dom/client';
import { WorkspaceRoot } from './app/WorkspaceRoot';
import { Pet } from './pet/Pet';
import './styles.css';
import './workspace-ui.css';
const root = createRoot(document.getElementById('root')!);
if (new URLSearchParams(location.search).get('surface') === 'pet') {
  document.body.classList.add('pet-window');
  document.documentElement.classList.add('pet-window');
  root.render(<Pet bridge={window.pet} />);
} else {
  root.render(<WorkspaceRoot bridge={window.playbooks} development={import.meta.env.DEV} fixtureEnabled={import.meta.env.VITE_DEV_FIXTURES === 'true'} />);
}
