/**
 * Stress harness for LMP layout memoization (pure shipped helpers).
 */
import { writeFileSync } from 'node:fs';

const target = new URL('../lmp/src/lib/layoutCache.ts', import.meta.url).href;
const {
  runLmpInteractionStress,
  resetLmpHotPathCounters,
  lmpHotPathCounters,
} = await import(target);

resetLmpHotPathCounters();
const started = performance.now();
const metrics = runLmpInteractionStress({
  rootCount: 40,
  childrenPerRoot: 25,
  panFrames: 120,
  selectionFrames: 60,
});
const wallMs = performance.now() - started;

const report = {
  name: 'lmp-layout-interaction-stress',
  wallMs,
  metrics,
  counters: { ...lmpHotPathCounters },
  assertions: {
    noLayoutOnPan: metrics.layoutMissesDuringPan === 0,
    noLayoutOnSelection: metrics.layoutMissesDuringSelection === 0,
    noSerializeOnPan: metrics.serializeMissesDuringPan === 0,
    topologyEditOnce: metrics.layoutMissesOnTopologyEdit === 1,
  },
};

const out = JSON.stringify(report, null, 2);
console.log(out);
const dest = process.argv[2];
if (dest) {
  writeFileSync(dest, out);
}
