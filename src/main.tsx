import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DiagnosticShell, RootErrorBoundary } from './components/BootFallbacks';
import FlowApp from './lmd/presentation/shell/FlowApp';
import { setLmdInterpreterHooks } from './lmd';
import { hotPathCounters } from './lmd/infrastructure/hotpath/sceneHotPath';
import { storageKeys } from './lmd/infrastructure/persistence/storage';
import './styles.css';

// Optional: plug canvas hot-path counters into the independent LMD interpreter.
setLmdInterpreterHooks({
  onParseProjectMarkdown: () => {
    hotPathCounters.parseProjectMarkdown += 1;
  },
  onSerializeProjectMarkdown: () => {
    hotPathCounters.serializeProjectMarkdown += 1;
  },
});

const params = new URLSearchParams(window.location.search);

if (params.has('reset')) {
  localStorage.removeItem(storageKeys.project);
  localStorage.removeItem(storageKeys.history);
}

// Legacy monolith App remains at ./App for reference.
// Canvas runtime is Project-Graph style Canvas2D Stage via FlowApp → StageCanvas.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      {params.has('safe') ? <DiagnosticShell /> : <FlowApp />}
    </RootErrorBoundary>
  </StrictMode>,
);
