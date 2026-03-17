import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DiagnosticShell, RootErrorBoundary } from './components/BootFallbacks';
import { storageKeys } from './lib/storage';
import './styles.css';

const params = new URLSearchParams(window.location.search);

if (params.has('reset')) {
  localStorage.removeItem(storageKeys.source);
  localStorage.removeItem(storageKeys.sidecar);
  localStorage.removeItem(storageKeys.history);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      {params.has('safe') ? <DiagnosticShell /> : <App />}
    </RootErrorBoundary>
  </StrictMode>,
);
