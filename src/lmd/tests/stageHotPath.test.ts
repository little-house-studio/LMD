/**
 * StageEngine hot-path contract: spatial cull, live camera, no remount on shell patch.
 * Run: npx --yes tsx src/lmd/tests/stageHotPath.test.ts
 */
import { createStressTestProjectMarkdown } from '..';
import { parseSafe } from '../application/io/documentIo';
import { DEFAULT_CANVAS_POLICY } from '../domain/canvasPolicy';
import { hotPathCounters, resetHotPathCounters } from '../infrastructure/hotpath/sceneHotPath';
import { distPointToCubicBezierSq } from '../shared/curve';
import { StageEngine } from '../presentation/canvas/engine';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

let passed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

console.log('stageHotPath tests');

function loadStressEngine(groupCount = 20, nodesPerGroup = 10) {
  const markdown = createStressTestProjectMarkdown({ groupCount, nodesPerGroup });
  const doc = parseSafe(markdown, 'LMD Stress Test', DEFAULT_CANVAS_POLICY);
  return { doc, engine: new StageEngine(doc) };
}

test('spatial index culls a tight world rect without scanning every node', () => {
  resetHotPathCounters();
  const { doc, engine } = loadStressEngine();
  const minX = Math.min(...doc.nodes.map((node) => node.x));
  const minY = Math.min(...doc.nodes.map((node) => node.y));
  const maxX = Math.max(...doc.nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...doc.nodes.map((node) => node.y + node.height));
  const all = engine.queryVisibleNodeIds({
    x: minX - 80,
    y: minY - 80,
    width: maxX - minX + 160,
    height: maxY - minY + 160,
  });
  const tight = engine.queryVisibleNodeIds({ x: minX, y: minY, width: 360, height: 240 });
  assertEqual(all.length, doc.nodes.length, 'wide query returns every node');
  assert(tight.length > 0, 'tight query still hits something');
  assert(tight.length < all.length, 'tight query must cull');
  assert(hotPathCounters.cullViewport >= 2, 'cull counter increments on live query');
});

test('applyWorkingDocument keeps the live camera (inspector patch contract)', () => {
  const { doc, engine } = loadStressEngine(4, 4);
  engine.camera.offsetX = 88;
  engine.camera.offsetY = -42;
  engine.camera.scale = 1.35;
  const rebuiltBefore = hotPathCounters.rebuildBaseScene;
  engine.applyWorkingDocument({
    ...doc,
    projectName: 'Patched title',
    nodes: doc.nodes.map((node, index) => (
      index === 0 ? { ...node, label: `Renamed\n${node.label}`, width: node.width + 16 } : node
    )),
  });
  assertEqual(engine.camera.offsetX, 88, 'live offsetX');
  assertEqual(engine.camera.offsetY, -42, 'live offsetY');
  assertEqual(engine.camera.scale, 1.35, 'live scale');
  assert(hotPathCounters.rebuildBaseScene > rebuiltBefore, 'topology patch rebuilds the index');
});

test('loadDocument restores saved viewport; camera pan does not rebuild the index', () => {
  const { doc, engine } = loadStressEngine(4, 4);
  engine.loadDocument(doc, { restoreViewport: true, fit: 'never' });
  assertEqual(engine.camera.offsetX, doc.layout.viewport.x, 'restore x');
  assertEqual(engine.camera.scale, doc.layout.viewport.zoom || 1, 'restore zoom');
  const rebuilt = hotPathCounters.rebuildBaseScene;
  const derived = hotPathCounters.rebuildDerivedScene;
  engine.camera.panByViewDelta(120, -60);
  engine.camera.zoomAt({ x: 80, y: 80 }, 0.7);
  assertEqual(hotPathCounters.rebuildBaseScene, rebuilt, 'pan must not rebuild spatial index');
  assertEqual(hotPathCounters.rebuildDerivedScene, derived, 'zoom must not rebuild routes');
});

test('metadata-only working patch skips derived scene rebuild when geometry is unchanged', () => {
  const { doc, engine } = loadStressEngine(4, 4);
  engine.setLockPositions(false);
  engine.applyWorkingDocument(doc);
  const derived = hotPathCounters.rebuildDerivedScene;
  engine.applyWorkingDocument({ ...doc, projectName: 'Only the title changed' });
  assertEqual(hotPathCounters.rebuildDerivedScene, derived, 'same node/edge boxes skip route rebuild');
});

test('cubic hit samples the painted Bézier, not a straight chord', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 200, y: 0 };
  const c1 = { x: 80, y: 0 };
  const c2 = { x: 120, y: 0 };
  const onCurve = { x: 100, y: 0 };
  const offCurve = { x: 100, y: 80 };
  assert(distPointToCubicBezierSq(onCurve, a, c1, c2, b) < 1, 'point on flat curve');
  assert(distPointToCubicBezierSq(offCurve, a, c1, c2, b) > 60 * 60, 'point far from curve');
});

console.log(`\n${passed} tests passed`);
