/**
 * Paint-path helpers must not encode LOD / fold rules.
 * Run: npx --yes tsx src/lmd/tests/paintOpt.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  derivedSceneRevision,
  expandCoverForCull,
  sameViewport,
  screenArrowSize,
  screenStrokeWidth,
  shouldRebuildDerivedScene,
  worldStrokeWidth,
} from '../infrastructure/hotpath/paintOpt';

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

const cover = { x: 0, y: 0, width: 1000, height: 800 };
const culled = expandCoverForCull(cover, 0.2, 260);
assert(culled.width > cover.width, 'cull overscan grows the world rect');
assertEqual(Math.round((culled.width - cover.width) / 2), 1300, '260px screen margin at 0.2 zoom');

assert(screenStrokeWidth(1.75, 0.2) >= 1.25, 'zoomed-out stroke stays visible');
assertEqual(screenStrokeWidth(1.75, 1), 1.75, 'scale 1 keeps the design width');
assert(screenArrowSize(10, 0.2) >= 6, 'zoomed-out arrow stays visible');
assertEqual(Number(worldStrokeWidth(1.25, 0.25).toFixed(2)), 5, 'screen 1.25px at 0.25 zoom is 5 world units');
assert(sameViewport({ x: 10, y: 10, zoom: 1 }, { x: 10.01, y: 10.02, zoom: 1 }), 'tiny camera jitter is the same viewport');
assert(!sameViewport({ x: 10, y: 10, zoom: 1 }, { x: 10, y: 10, zoom: 1.2 }), 'zoom change is a new viewport');

const graph = {
  nodes: [{ id: 'a', x: 10, y: 20, width: 100, height: 40 }],
  edges: [{ id: 'e', from: 'a', to: 'a', label: 'go' }],
  subgraphs: [{ id: 'g', collapsed: false, title: '域' }],
};
const rev = derivedSceneRevision(graph);
assertEqual(derivedSceneRevision({ ...graph, edges: [{ ...graph.edges[0], label: 'go' }] }), rev, 'same geometry is stable');
assert(derivedSceneRevision({ ...graph, nodes: [{ ...graph.nodes[0], x: 80 }] }) !== rev, 'move invalidates');
assert(derivedSceneRevision({ ...graph, edges: [{ ...graph.edges[0], label: 'stop' }] }) !== rev, 'edge label invalidates routes');
assert(!shouldRebuildDerivedScene(rev, rev), 'identical revision skips rebuild');
assert(shouldRebuildDerivedScene(rev, rev, true), 'drag forces rebuild');

const source = readFileSync(fileURLToPath(new URL('../infrastructure/hotpath/paintOpt.ts', import.meta.url)), 'utf8');
assert(!source.includes('canvasLod'), 'paintOpt must not own LOD');
assert(!source.includes('nodeBelongsToGroup'), 'paintOpt must not fold groups');

console.log('[paintOpt] ok');
