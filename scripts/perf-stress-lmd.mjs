/**
 * Stress harness for LMD scene hot path (pure shipped helpers).
 * Output: JSON metrics to stdout; also writes path from argv[2] if provided.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { register } from 'node:module';

// Prefer tsx-registered resolution when launched via `npx tsx`.
const target = new URL('../src/lib/sceneHotPath.ts', import.meta.url).href;

const {
  runViewportInteractionStress,
  runWheelViewportStress,
  resetHotPathCounters,
  hotPathCounters,
} = await import(target);

resetHotPathCounters();
const started = performance.now();
const metrics = runViewportInteractionStress({
  nodeCount: 500,
  edgeCount: 500,
  frames: 120,
  screenWidth: 1440,
  screenHeight: 900,
});
const wheel = runWheelViewportStress({
  nodeCount: 500,
  frames: 100,
  screenWidth: 1440,
  screenHeight: 900,
});
const wallMs = performance.now() - started;

const report = {
  name: 'lmd-viewport-interaction-stress',
  wallMs,
  metrics,
  wheel,
  counters: { ...hotPathCounters },
  assertions: {
    rebuildBaseSceneIsOne: metrics.rebuildBaseScene === 1,
    noParse: hotPathCounters.parseProjectMarkdown === 0,
    noSerialize: hotPathCounters.serializeProjectMarkdown === 0,
    cullsBelowFullGraph: metrics.nodesPerFrameAvg < 500,
    oneDocumentCommitAfterPan: metrics.viewportDocumentCommits === 1,
    liveAppliesPerFrame: metrics.viewportLiveApplies >= 120,
    staleCullWouldMiss: metrics.staleCullWouldMiss > 0,
    wheelOneCommit: wheel.documentCommits === 1,
    wheelLiveApplies: wheel.liveApplies >= 100,
    wheelPaintGrew: wheel.paintIdsGrew === true,
  },
};

const out = JSON.stringify(report, null, 2);
console.log(out);
const dest = process.argv[2];
if (dest) {
  writeFileSync(dest, out);
}
