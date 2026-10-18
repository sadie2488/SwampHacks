import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthGate } from './AuthGate';
import '@/styles/fonts.css';
import '@/styles/tokens.css';
import './styles.css';
import '@/styles/text.css';
import '@/styles/layout.css';
import '@/styles/grid.css';
import '@/styles/panels.css';
import '@/styles/devices.css';
import '@/styles/sheet.css';
import '@/styles/player-bar.css';
import '@/styles/controls.css';
import '@/styles/hands.css';
import '@/styles/lab.css';
import '@/styles/compact.css';
import '@/styles/shell.css';
import '@/styles/mode-title.css';
import '@/styles/overlays.css';
import '@/styles/wireframe.css';
import '@/styles/stage-fit.css';
import '@/styles/stage-fit-wide.css';
import '@/ui/overture/entrance.css';
import '@/ui/overture/bloom.css';
import '@/ui/overture/menu.css';
import '@/ui/overture/big-words.css';
import '@/ui/overture/menu-corners.css';
import '@/ui/overture/transitions.css';

createRoot(document.getElementById('root')!).render(
  <AuthGate>
    <App />
  </AuthGate>,
);
