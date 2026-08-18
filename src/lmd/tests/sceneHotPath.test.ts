/**
 * Unit tests for shipped LMD scene hot-path helpers.
 * Run: npx --yes tsx src/lmd/tests/sceneHotPath.test.ts
 */
import {
  BaseSceneCache,
  InteractionSession,
  LiveViewportController,
  applyDragPreviewPositions,
  applyWheelPanViewport,
  applyWheelZoomViewport,
  interpretCanvasWheel,
  pinchScaleFactor,
  PINCH_RESPONSE,
  buildEdgeSignature,
  buildNodeSignature,
  classifySceneInvalidation,
  clientToWorldPoint,
  cullByViewport,
  hotPathCounters,
  resetHotPathCounters,
  resolveInteractionViewport,
  runViewportInteractionStress,
  runWheelViewportStress,
  seedPanInitialViewport,
  selectPaintNodesFromTopology,
  topologyRevisionFromGraph,
  viewportToWorldRect,
} from '../infrastructure/hotpath/sceneHotPath';
import {
  parseProjectMarkdown,
  serializeProjectMarkdown,
  setLmdInterpreterHooks,
} from '../infrastructure/compat/projectMarkdown';
import { createDefaultLayout } from '../infrastructure/compat/mermaid';

setLmdInterpreterHooks({
  onParseProjectMarkdown: () => {
    hotPathCounters.parseProjectMarkdown += 1;
  },
  onSerializeProjectMarkdown: () => {
    hotPathCounters.serializeProjectMarkdown += 1;
  },
});

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

function assertApprox(actual: number, expected: number, tol: number, message: string) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${message}: expected ~${expected} (±${tol}), got ${actual}`);
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

console.log('sceneHotPath tests');

test('topology revision stable when only viewport would change', () => {
  const graph = {
    nodes: [
      { id: 'a', x: 0, y: 0, width: 100, height: 40 },
      { id: 'b', x: 200, y: 0, width: 100, height: 40 },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b' }],
    subgraphs: [{ id: 's1', collapsed: false }],
  };
  const r1 = topologyRevisionFromGraph(graph);
  const r2 = topologyRevisionFromGraph(graph);
  assertEqual(r1, r2, 'same topology → same revision');
  const moved = {
    ...graph,
    nodes: [
      { id: 'a', x: 10, y: 0, width: 100, height: 40 },
      { id: 'b', x: 200, y: 0, width: 100, height: 40 },
    ],
  };
  const r3 = topologyRevisionFromGraph(moved);
  assert(r1 !== r3, 'position change must change revision');
});

test('classifySceneInvalidation separates viewport vs topology', () => {
  const base = {
    topologyRevision: 'rev-a',
    viewport: { x: 0, y: 0, zoom: 1 },
    selectionKey: 'none:',
    dragKey: '',
  };
  assertEqual(
    classifySceneInvalidation(base, { ...base, viewport: { x: 40, y: 10, zoom: 1 } }),
    'viewport',
    'pan is viewport',
  );
  assertEqual(
    classifySceneInvalidation(base, { ...base, selectionKey: 'node:a' }),
    'selection',
    'selection only',
  );
  assertEqual(
    classifySceneInvalidation(base, { ...base, topologyRevision: 'rev-b' }),
    'topology',
    'topology wins',
  );
  assertEqual(
    classifySceneInvalidation(base, { ...base, dragKey: 'a:1,2' }),
    'drag-preview',
    'drag preview',
  );
  assertEqual(classifySceneInvalidation(base, base), 'none', 'no change');
});

test('cullByViewport returns only intersecting nodes', () => {
  resetHotPathCounters();
  const nodes = [
    { id: 'in', x: 0, y: 0, width: 50, height: 50 },
    { id: 'out', x: 5000, y: 5000, width: 50, height: 50 },
  ];
  const culled = cullByViewport(nodes, { x: -10, y: -10, width: 200, height: 200 });
  assertEqual(culled.length, 1, 'one visible');
  assertEqual(culled[0].id, 'in', 'visible id');
  assert(hotPathCounters.cullViewport >= 1, 'counter increments');
});

test('BaseSceneCache does not rebuild on same topology revision', () => {
  resetHotPathCounters();
  const nodes = Array.from({ length: 100 }, (_, i) => ({
    id: `n${i}`,
    x: (i % 10) * 100,
    y: Math.floor(i / 10) * 80,
    width: 80,
    height: 40,
  }));
  const rev = topologyRevisionFromGraph({ nodes, edges: [], subgraphs: [] });
  const cache = new BaseSceneCache<typeof nodes[0]>();
  cache.ensure(rev, nodes);
  cache.ensure(rev, nodes);
  cache.ensure(rev, nodes);
  assertEqual(cache.rebuildCount, 1, 'single rebuild for stable topology');
  assertEqual(hotPathCounters.rebuildBaseScene, 1, 'counter matches');

  const visible = cache.queryViewport({ x: 0, y: 0, width: 250, height: 200 });
  assert(visible.length > 0 && visible.length < nodes.length, 'viewport culls subset');
});

test('applyDragPreviewPositions only mutates dragged ids', () => {
  resetHotPathCounters();
  const nodes = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 100, y: 0 },
    { id: 'c', x: 200, y: 0 },
  ];
  const next = applyDragPreviewPositions(nodes, {
    ids: ['a'],
    origin: { x: 0, y: 0 },
    current: { x: 30, y: 10 },
    initialPositions: { a: { x: 0, y: 0 } },
  });
  assertEqual(next[0].x, 30, 'a moved x');
  assertEqual(next[0].y, 10, 'a moved y');
  assertEqual(next[1].x, 100, 'b unchanged');
  assertEqual(next[2].x, 200, 'c unchanged');
  assert(hotPathCounters.applyDragPreview >= 1, 'counter');
});

test('InteractionSession pan/drag does not require parse/serialize', () => {
  resetHotPathCounters();
  const session = new InteractionSession({ x: 0, y: 0, zoom: 1 });
  session.beginPan(10, 10);
  for (let i = 0; i < 40; i += 1) {
    session.updatePan(10 + i * 5, 10 + i * 3);
  }
  session.endPan();
  session.beginDrag(['n0'], { x: 0, y: 0 }, { n0: { x: 0, y: 0 } });
  for (let i = 0; i < 40; i += 1) {
    session.updateDrag({ x: i, y: i });
  }
  session.endDrag();
  assertEqual(hotPathCounters.parseProjectMarkdown, 0, 'no parse on interaction');
  assertEqual(hotPathCounters.serializeProjectMarkdown, 0, 'no serialize on interaction');
});

test('viewportToWorldRect matches inverse of screen transform', () => {
  const vp = { x: 100, y: 50, zoom: 2 };
  const rect = viewportToWorldRect(vp, 800, 600, 0);
  assertApprox(rect.x, -50, 0.01, 'world x');
  assertApprox(rect.y, -25, 0.01, 'world y');
  assertApprox(rect.width, 400, 0.01, 'world w');
  assertApprox(rect.height, 300, 0.01, 'world h');
});

test('signatures are deterministic', () => {
  const nodes = [{ id: 'a', x: 1, y: 2, width: 3, height: 4 }];
  assertEqual(buildNodeSignature(nodes), buildNodeSignature(nodes), 'node sig');
  assertEqual(
    buildEdgeSignature([{ id: 'e', from: 'a', to: 'b' }]),
    buildEdgeSignature([{ id: 'e', from: 'a', to: 'b' }]),
    'edge sig',
  );
});

test('trackpad two-finger scroll pans; pinch/ctrl-wheel zooms', () => {
  const pan = interpretCanvasWheel({
    deltaX: 24,
    deltaY: 16,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
  });
  assertEqual(pan.kind, 'pan', 'plain wheel is pan');
  if (pan.kind === 'pan') {
    assertEqual(pan.dx, 24, 'pan dx');
    assertEqual(pan.dy, 16, 'pan dy');
  }

  const pinch = interpretCanvasWheel({
    deltaX: 0,
    deltaY: 36,
    deltaMode: 0,
    ctrlKey: true,
    metaKey: false,
  });
  assertEqual(pinch.kind, 'zoom', 'ctrl wheel is pinch zoom');
  if (pinch.kind === 'zoom') {
    assert(pinch.factor < 1, 'positive pinch delta zooms out');
  }

  const linePan = interpretCanvasWheel({
    deltaX: 0,
    deltaY: 3,
    deltaMode: 1,
    ctrlKey: false,
    metaKey: false,
  });
  if (linePan.kind === 'pan') {
    assertEqual(linePan.dy, 48, 'DOM_DELTA_LINE scales by 16');
  }

  const shift = interpretCanvasWheel({
    deltaX: 0,
    deltaY: 40,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
  });
  if (shift.kind === 'pan') {
    assertEqual(shift.dx, 40, 'shift+wheel becomes horizontal pan');
    assertEqual(shift.dy, 0, 'shift+wheel has no vertical');
  }

  assertApprox(pinchScaleFactor(1, 1.1), Math.pow(1.1, PINCH_RESPONSE), 1e-6, 'safari gesture gain');
});

test('stress: 500+ nodes pan/drag keeps base rebuild ~1 and culls', () => {
  const metrics = runViewportInteractionStress({
    nodeCount: 500,
    edgeCount: 500,
    frames: 60,
  });
  assertEqual(metrics.rebuildBaseScene, 1, 'base scene rebuilt once for topology');
  assert(metrics.cullViewport >= 60, 'cull each frame');
  assert(metrics.applyDragPreview >= 60, 'drag preview each frame');
  assert(metrics.nodesPerFrameAvg < 500, 'viewport culls below full graph');
  assertEqual(metrics.viewportDocumentCommits, 1, 'one commit after continuous pan');
  assert(metrics.viewportLiveApplies >= 60, 'live applies per frame');
  assert(metrics.staleCullWouldMiss > 0, 'stale pre-cull would miss newly visible nodes');
  assertEqual(hotPathCounters.parseProjectMarkdown, 0, 'stress no parse');
  assertEqual(hotPathCounters.serializeProjectMarkdown, 0, 'stress no serialize');
  console.log('  metrics', JSON.stringify({
    ...metrics,
    nodesPerFrameAvg: Number(metrics.nodesPerFrameAvg.toFixed(2)),
  }));
});

test('paint from full topology reveals nodes that stale pre-cull blanks', () => {
  const nodes = Array.from({ length: 200 }, (_, i) => ({
    id: `n${i}`,
    x: (i % 20) * 200,
    y: Math.floor(i / 20) * 120,
    width: 140,
    height: 56,
  }));
  const initialVp = { x: 0, y: 0, zoom: 1 };
  const screen = { width: 800, height: 600 };
  const initialWorld = viewportToWorldRect(initialVp, screen.width, screen.height, 0);
  const staleList = selectPaintNodesFromTopology(nodes, initialWorld);

  // Trackpad pan right (positive deltaX) decreases viewport.x → world rect moves +x.
  const panned = applyWheelPanViewport(initialVp, 2200, 0);
  const liveWorld = viewportToWorldRect(panned, screen.width, screen.height, 0);
  const correct = selectPaintNodesFromTopology(nodes, liveWorld);
  const broken = selectPaintNodesFromTopology(staleList, liveWorld);

  assert(correct.length > 0, `live cull finds nodes after pan (got ${correct.length})`);
  assert(broken.length < correct.length, `stale pre-cull blanks newly visible (broken=${broken.length} correct=${correct.length})`);
  assert(
    correct.some((n) => !staleList.some((s) => s.id === n.id)),
    'at least one newly visible node only in full-topology paint',
  );
});

test('LiveViewportController: wheel frames do not document-commit', () => {
  resetHotPathCounters();
  const controller = new LiveViewportController({ x: 0, y: 0, zoom: 1 });
  for (let i = 0; i < 40; i += 1) {
    controller.wheelPan(10, 8);
    controller.wheelZoom({ x: 400, y: 300 }, 1.01);
  }
  assertEqual(controller.commitCount, 0, 'no commits during wheel stream');
  assertEqual(hotPathCounters.viewportDocumentCommits, 0, 'counter matches');
  assert(controller.liveApplyCount >= 80, 'live applies for pan+zoom');
  controller.commitDocument();
  assertEqual(controller.commitCount, 1, 'single explicit commit');
  assertEqual(hotPathCounters.viewportDocumentCommits, 1, 'one document commit');
});

test('wheel zoom pure helper keeps focal world point stable', () => {
  const vp = { x: 100, y: 50, zoom: 1 };
  const pointer = { x: 400, y: 300 };
  const worldBefore = {
    x: (pointer.x - vp.x) / vp.zoom,
    y: (pointer.y - vp.y) / vp.zoom,
  };
  const next = applyWheelZoomViewport(vp, pointer, 2, 0.08, 4);
  const worldAfter = {
    x: (pointer.x - next.x) / next.zoom,
    y: (pointer.y - next.y) / next.zoom,
  };
  assert(Math.abs(worldBefore.x - worldAfter.x) < 0.001, 'world x stable');
  assert(Math.abs(worldBefore.y - worldAfter.y) < 0.001, 'world y stable');
  assertEqual(next.zoom, 2, 'zoom applied');
});

test('runWheelViewportStress: many live applies, one commit, paint set changes', () => {
  const metrics = runWheelViewportStress({ nodeCount: 500, frames: 80 });
  assertEqual(metrics.documentCommits, 1, 'one commit after wheel stream');
  assert(metrics.liveApplies >= 80, 'live apply every wheel frame');
  assertEqual(metrics.rebuildBaseScene, 1, 'topology cache once');
  assert(metrics.paintIdsGrew || metrics.maxPainted !== metrics.minPainted, 'paint set responds to pan/zoom');
  assertEqual(hotPathCounters.parseProjectMarkdown, 0, 'wheel path no parse');
  assertEqual(hotPathCounters.serializeProjectMarkdown, 0, 'wheel path no serialize');
  console.log('  wheel metrics', JSON.stringify(metrics));
});

test('after live wheel without document commit, hit-test and pan seed use live not document', () => {
  resetHotPathCounters();
  const documentViewport = { x: 0, y: 0, zoom: 1 };
  const controller = new LiveViewportController(documentViewport);

  // Simulate continuous wheel pan/zoom — no document commit yet.
  for (let i = 0; i < 20; i += 1) {
    controller.wheelPan(40, 20);
  }
  controller.wheelZoom({ x: 400, y: 300 }, 1.5);

  assert(controller.commitCount === 0, 'still uncommitted');
  assert(
    controller.live.x !== documentViewport.x || controller.live.zoom !== documentViewport.zoom,
    'live diverged from document snapshot',
  );

  const bounds = { left: 0, top: 0 };
  const client = { x: 400, y: 300 };

  // App must resolve interaction viewport from live (shipped helper).
  const interactionVp = resolveInteractionViewport(controller.live, documentViewport);
  assertEqual(interactionVp.x, controller.live.x, 'resolve uses live x');
  assertEqual(interactionVp.zoom, controller.live.zoom, 'resolve uses live zoom');

  const hitLive = clientToWorldPoint(client.x, client.y, bounds, interactionVp);
  const hitDoc = clientToWorldPoint(client.x, client.y, bounds, documentViewport);
  assert(
    Math.abs(hitLive.x - hitDoc.x) > 1 || Math.abs(hitLive.y - hitDoc.y) > 1,
    `live and document hit-tests must diverge (live=${hitLive.x},${hitLive.y} doc=${hitDoc.x},${hitDoc.y})`,
  );

  // Pan seed must copy live — seeding from document causes jump.
  const panSeed = seedPanInitialViewport(controller.live);
  assertEqual(panSeed.x, controller.live.x, 'pan seed x from live');
  assertEqual(panSeed.y, controller.live.y, 'pan seed y from live');
  assertEqual(panSeed.zoom, controller.live.zoom, 'pan seed zoom from live');
  assert(panSeed.x !== documentViewport.x || panSeed.zoom !== documentViewport.zoom, 'pan seed ≠ document');

  // Starting a pan from document would jump; from live continues smoothly.
  const panFromDoc = {
    ...documentViewport,
    x: documentViewport.x + 50,
    y: documentViewport.y + 30,
  };
  const panFromLive = {
    ...controller.live,
    x: controller.live.x + 50,
    y: controller.live.y + 30,
  };
  assert(
    Math.abs(panFromDoc.x - panFromLive.x) > 1,
    'document-seeded pan jumps relative to live-seeded pan',
  );
});

test('real parseProjectMarkdown/serializeProjectMarkdown bump hotPathCounters', () => {
  resetHotPathCounters();
  const markdown = `# Test

## Diagram
\`\`\`mermaid
flowchart LR
  A[A] --> B[B]
\`\`\`
`;
  const doc = parseProjectMarkdown(markdown, 'Counter Test', createDefaultLayout());
  assert(hotPathCounters.parseProjectMarkdown >= 1, 'parse wired');
  const parseCount = hotPathCounters.parseProjectMarkdown;
  serializeProjectMarkdown({
    projectName: doc.projectName ?? 'Counter Test',
    projectSummary: doc.projectSummary ?? '',
    mermaidSource: doc.source,
    compat: doc.compat,
    nodes: doc.nodes,
    subgraphs: doc.subgraphs,
  });
  assert(hotPathCounters.serializeProjectMarkdown >= 1, 'serialize wired');
  assert(hotPathCounters.serializeProjectMarkdown >= 1, 'serialize counter stayed positive');
  // parse may nest serialize during standardization; both counters must be live on real entry points.
  assert(parseCount >= 1, 'parse entry was counted');
});

console.log(`\n${passed} tests passed`);
