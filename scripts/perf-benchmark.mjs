/**
 * Before/after wall-time benchmark for LMD + LMP hot paths (shipped helpers).
 * Usage: npx tsx scripts/perf-benchmark.mjs [out.json]
 */
import { writeFileSync } from 'node:fs';

const scene = await import(new URL('../src/lib/sceneHotPath.ts', import.meta.url).href);
const layout = await import(new URL('../lmp/src/lib/layoutCache.ts', import.meta.url).href);
const outline = await import(new URL('../lmp/src/lib/outline.ts', import.meta.url).href);

const {
  BaseSceneCache,
  LiveViewportController,
  applyDragPreviewPositions,
  applyWheelPanViewport,
  applyWheelZoomViewport,
  hotPathCounters,
  resetHotPathCounters,
  selectPaintNodesFromTopology,
  topologyRevisionFromGraph,
  viewportToWorldRect,
  runViewportInteractionStress,
  runWheelViewportStress,
} = scene;

const {
  MindMapLayoutCache,
  OutlineSerializeCache,
  resetLmpHotPathCounters,
  lmpHotPathCounters,
  runLmpInteractionStress,
} = layout;

const { computeMindMapLayout, serializeOutline } = outline;

function makeNodes(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    x: (i % 50) * 180,
    y: Math.floor(i / 50) * 100,
    width: 140,
    height: 56,
  }));
}

function makeOutline(roots, children) {
  return Array.from({ length: roots }, (_, r) => ({
    id: `r${r}`,
    text: `Root ${r}`,
    color: null,
    children: Array.from({ length: children }, (_, c) => ({
      id: `r${r}-c${c}`,
      text: `Child ${r}.${c}`,
      color: null,
      children: Array.from({ length: 3 }, (_, g) => ({
        id: `r${r}-c${c}-g${g}`,
        text: `Grand ${r}.${c}.${g}`,
        color: null,
        children: [],
      })),
    })),
  }));
}

function bench(fn, iters = 3) {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i += 1) fn();
  return (performance.now() - t0) / iters;
}

const screen = { width: 1440, height: 900 };
const FRAMES = 120;
const lmdPanBeforeVsAfter = [];

for (const nodeCount of [500, 1000, 2000]) {
  const nodes = makeNodes(nodeCount);
  const edges = Array.from({ length: nodeCount }, (_, i) => ({
    id: `e${i}`,
    from: `n${i % nodeCount}`,
    to: `n${(i + 1) % nodeCount}`,
  }));
  const revision = topologyRevisionFromGraph({ nodes, edges, subgraphs: [] });

  const beforeAvgMs = bench(() => {
    let vp = { x: 0, y: 0, zoom: 1 };
    for (let f = 0; f < FRAMES; f += 1) {
      vp = applyWheelPanViewport(vp, 24, 16);
      const cache = new BaseSceneCache();
      cache.ensure(`${revision}-f${f}`, nodes);
      const world = viewportToWorldRect(vp, screen.width, screen.height, 260);
      const visible = cache.queryViewport(world);
      applyDragPreviewPositions(visible, {
        ids: ['n0', 'n1', 'n2'],
        origin: { x: 0, y: 0 },
        current: { x: f, y: f },
        initialPositions: {
          n0: { x: 0, y: 0 },
          n1: { x: 180, y: 0 },
          n2: { x: 360, y: 0 },
        },
      });
    }
  });

  const afterAvgMs = bench(() => {
    const cache = new BaseSceneCache();
    cache.ensure(revision, nodes);
    let vp = { x: 0, y: 0, zoom: 1 };
    for (let f = 0; f < FRAMES; f += 1) {
      vp = applyWheelPanViewport(vp, 24, 16);
      cache.ensure(revision, nodes);
      const world = viewportToWorldRect(vp, screen.width, screen.height, 260);
      const visible = selectPaintNodesFromTopology(nodes, world);
      applyDragPreviewPositions(visible, {
        ids: ['n0', 'n1', 'n2'],
        origin: { x: 0, y: 0 },
        current: { x: f, y: f },
        initialPositions: {
          n0: { x: 0, y: 0 },
          n1: { x: 180, y: 0 },
          n2: { x: 360, y: 0 },
        },
      });
    }
  });

  lmdPanBeforeVsAfter.push({
    nodeCount,
    frames: FRAMES,
    beforeAvgMs: Number(beforeAvgMs.toFixed(3)),
    afterAvgMs: Number(afterAvgMs.toFixed(3)),
    speedup: Number((beforeAvgMs / Math.max(afterAvgMs, 0.001)).toFixed(2)),
    perFrameBeforeMs: Number((beforeAvgMs / FRAMES).toFixed(4)),
    perFrameAfterMs: Number((afterAvgMs / FRAMES).toFixed(4)),
  });
}

const nodes1k = makeNodes(1000);
const wheelBeforeAvgMs = bench(() => {
  let vp = { x: 0, y: 0, zoom: 1 };
  for (let f = 0; f < 100; f += 1) {
    vp = f % 2 === 0
      ? applyWheelPanViewport(vp, 20, 12)
      : applyWheelZoomViewport(vp, { x: 720, y: 450 }, 1.02, 0.08, 4);
    const cache = new BaseSceneCache();
    cache.ensure(`w-${f}`, nodes1k);
    selectPaintNodesFromTopology(
      nodes1k,
      viewportToWorldRect(vp, 1440, 900, 260),
    );
  }
});

const wheelAfterAvgMs = bench(() => {
  const c = new LiveViewportController({ x: 0, y: 0, zoom: 1 });
  const revision = topologyRevisionFromGraph({ nodes: nodes1k, edges: [], subgraphs: [] });
  const cache = new BaseSceneCache();
  cache.ensure(revision, nodes1k);
  for (let f = 0; f < 100; f += 1) {
    if (f % 2 === 0) c.wheelPan(20, 12);
    else c.wheelZoom({ x: 720, y: 450 }, 1.02);
    cache.ensure(revision, nodes1k);
    c.paintFromTopology(nodes1k, { width: 1440, height: 900 }, 260);
  }
  c.commitDocument();
});

const roots = makeOutline(40, 25);
const lmpBeforeAvgMs = bench(() => {
  for (let f = 0; f < 80; f += 1) {
    computeMindMapLayout(roots, 'balanced');
    serializeOutline(roots, { layoutMode: 'balanced' });
  }
}, 2);

// Cache lives across frames (same as App refs) — measure pan/selection hits only.
const layoutCache = new MindMapLayoutCache();
const serCache = new OutlineSerializeCache();
layoutCache.get(roots, 'balanced');
serCache.get(roots, 'balanced');
const lmpAfterAvgMs = bench(() => {
  for (let f = 0; f < 80; f += 1) {
    layoutCache.get(roots, 'balanced');
    serCache.get(roots, 'balanced');
  }
}, 5);

resetHotPathCounters();
const stress = runViewportInteractionStress({ nodeCount: 500, edgeCount: 500, frames: 120 });
const wheelStress = runWheelViewportStress({ nodeCount: 500, frames: 100 });
resetLmpHotPathCounters();
const lmpStress = runLmpInteractionStress({
  rootCount: 40,
  childrenPerRoot: 25,
  panFrames: 120,
  selectionFrames: 60,
});

const report = {
  when: new Date().toISOString(),
  lmdPanBeforeVsAfter,
  wheelBeforeAvgMs: Number(wheelBeforeAvgMs.toFixed(3)),
  wheelAfterAvgMs: Number(wheelAfterAvgMs.toFixed(3)),
  wheelSpeedup: Number((wheelBeforeAvgMs / Math.max(wheelAfterAvgMs, 0.001)).toFixed(2)),
  lmpBeforeAvgMs: Number(lmpBeforeAvgMs.toFixed(3)),
  lmpAfterAvgMs: Number(lmpAfterAvgMs.toFixed(3)),
  lmpSpeedup: Number((lmpBeforeAvgMs / Math.max(lmpAfterAvgMs, 0.001)).toFixed(2)),
  outlineNodeApprox: 40 + 40 * 25 + 40 * 25 * 3,
  stress,
  wheelStress,
  lmpStress,
  counters: { ...hotPathCounters },
  lmpCounters: { ...lmpHotPathCounters },
};

const out = process.argv[2];
const text = JSON.stringify(report, null, 2);
console.log(text);
if (out) writeFileSync(out, text);
