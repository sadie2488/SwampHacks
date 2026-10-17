import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthGate } from './AuthGate';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <AuthGate>
    <App />
  </AuthGate>,
);
