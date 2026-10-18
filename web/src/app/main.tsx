import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthGate } from './AuthGate';
import '@/styles/fonts.css';
import '@/styles/tokens.css';
import './styles.css';
import '@/styles/layout.css';
import '@/styles/devices.css';
import '@/styles/sheet.css';
import '@/styles/player-bar.css';
import '@/styles/controls.css';
import '@/styles/hands.css';
import '@/styles/compact.css';

createRoot(document.getElementById('root')!).render(
  <AuthGate>
    <App />
  </AuthGate>,
);
