/**
 * Optimal layout solver + editable shape frames.
 * Run: npx --yes tsx src/lmd/tests/layout.test.ts
 */
import { createDefaultLayout } from '..';
import type { GraphDocument, GraphNode } from '../infrastructure/compat/types';
import {
  createFrameFromRect,
  nodesOverlap,
  readLayoutFrames,
  reflowFrame,
  resizeFrame,
  solveOptimalLayout,
  writeLayoutFrames,
} from '../infrastructure/layout';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
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

function node(id: string, x: number, y: number): GraphNode {
  return {
    id,
    label: id,
    shape: 'rect',
    x,
    y,
    width: 120,
    height: 48,
    fill: '#111',
    stroke: '#fff',
    textColor: '#fff',
    subgraphId: null,
  };
}

function doc(partial: Partial<GraphDocument>): GraphDocument {
  return {
    diagramType: 'flowchart',
    direction: 'LR',
    nodes: [],
    edges: [],
    subgraphs: [],
    warnings: [],
    unsupportedLines: [],
    source: '',
    layout: createDefaultLayout(),
    ...partial,
  };
}

const chain = doc({
  nodes: [node('a', 0, 0), node('b', 10, 10), node('c', 20, 20)],
  edges: [
    { id: 'ab', from: 'a', to: 'b', label: '', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
    { id: 'bc', from: 'b', to: 'c', label: '', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
  ],
});

console.log('layout module tests');

test('optimal LR layout is left-to-right and collision-free', () => {
  const { nodes } = solveOptimalLayout(chain);
  const a = nodes.find((entry) => entry.id === 'a')!;
  const b = nodes.find((entry) => entry.id === 'b')!;
  const c = nodes.find((entry) => entry.id === 'c')!;
  assert(b.x > a.x, 'b right of a');
  assert(c.x > b.x, 'c right of b');
  assert(!nodesOverlap(nodes, 4), 'no overlaps');
});

test('optimal TD layout is top-to-bottom', () => {
  const { nodes } = solveOptimalLayout({ ...chain, direction: 'TD' });
  const a = nodes.find((entry) => entry.id === 'a')!;
  const c = nodes.find((entry) => entry.id === 'c')!;
  assert(c.y > a.y, 'c below a');
  assert(!nodesOverlap(nodes, 4), 'no overlaps');
});

test('bounded solve keeps every node inside the shape', () => {
  const bounds = { x: 400, y: 200, width: 520, height: 280 };
  const { nodes } = solveOptimalLayout(chain, { bounds });
  nodes.forEach((entry) => {
    assert(entry.x >= bounds.x - 1, `${entry.id} left`);
    assert(entry.y >= bounds.y - 1, `${entry.id} top`);
    assert(entry.x + entry.width <= bounds.x + bounds.width + 1, `${entry.id} right`);
    assert(entry.y + entry.height <= bounds.y + bounds.height + 1, `${entry.id} bottom`);
  });
  assert(!nodesOverlap(nodes, 2), 'packed without overlap');
});

test('cycles stay finite and still unpack', () => {
  const cyclic = doc({
    nodes: [node('a', 0, 0), node('b', 0, 0), node('c', 0, 0)],
    edges: [
      { id: 'ab', from: 'a', to: 'b', label: '', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
      { id: 'bc', from: 'b', to: 'c', label: '', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
      { id: 'ca', from: 'c', to: 'a', label: '', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
    ],
  });
  const { nodes } = solveOptimalLayout(cyclic);
  const a = nodes.find((entry) => entry.id === 'a')!;
  const c = nodes.find((entry) => entry.id === 'c')!;
  assert(nodes.every((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y)), 'finite');
  assert(!nodesOverlap(nodes, 2), 'unpacked cycle');
  assert(c.x > a.x, 'feedback edge does not collapse the chain into one column');
});

test('nested groups pack as compact blocks, not a flat rank chain', () => {
  const nested = doc({
    nodes: [
      { ...node('api', 0, 0), subgraphId: '控制面', width: 176, height: 106 },
      { ...node('sched', 0, 0), subgraphId: '控制面', width: 160, height: 106 },
      { ...node('gw', 0, 0), subgraphId: '数据面', width: 156, height: 106 },
      { ...node('work', 0, 0), subgraphId: '数据面', width: 160, height: 106 },
    ],
    edges: [
      { id: 'a', from: 'api', to: 'sched', label: '更新期望', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
      { id: 'b', from: 'sched', to: 'gw', label: '下发规则', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
      { id: 'c', from: 'gw', to: 'work', label: '转发流量', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
      { id: 'd', from: 'work', to: 'api', label: '心跳', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
    ],
    subgraphs: [
      { id: '平台域', title: '平台域', parentId: null, collapsed: false, fill: '', stroke: '', textColor: '' },
      { id: '控制面', title: '控制面', parentId: '平台域', collapsed: false, fill: '', stroke: '', textColor: '' },
      { id: '数据面', title: '数据面', parentId: '平台域', collapsed: false, fill: '', stroke: '', textColor: '' },
    ],
  });
  const { nodes } = solveOptimalLayout(nested, { anchor: 'origin' });
  const api = nodes.find((entry) => entry.id === 'api')!;
  const sched = nodes.find((entry) => entry.id === 'sched')!;
  const gw = nodes.find((entry) => entry.id === 'gw')!;
  const spanX = Math.max(...nodes.map((entry) => entry.x + entry.width)) - Math.min(...nodes.map((entry) => entry.x));
  assert(Math.abs(api.x - sched.x) < 40, 'control-plane nodes stack on X');
  assert(Math.abs(api.y - sched.y) > 40, 'control-plane nodes separate on Y');
  assert(Math.abs(api.x - gw.x) > 80, 'sibling groups sit side by side');
  assert(spanX < 720, `nested cluster should stay compact, got ${spanX}`);
  assert(!nodesOverlap(nodes, 8), 'compound groups do not overlap');
});

test('isolated nodes pack into a compact grid', () => {
  const lonely = doc({
    nodes: [node('p', 0, 0), node('q', 0, 0), node('r', 0, 0), node('s', 0, 0)],
  });
  const { nodes } = solveOptimalLayout(lonely, { anchor: 'origin' });
  const xs = new Set(nodes.map((entry) => entry.x));
  const ys = new Set(nodes.map((entry) => entry.y));
  assert(xs.size <= 2, 'at most two columns');
  assert(ys.size <= 2, 'at most two rows');
  assert(!nodesOverlap(nodes, 2), 'notes do not overlap');
});

test('reflow after resize stays inside the new shape', () => {
  const frame = createFrameFromRect([], { x: 0, y: 0, width: 640, height: 320 }, ['a', 'b', 'c']);
  const first = reflowFrame(chain, frame);
  const resized = resizeFrame(frame, 'se', { x: 420, y: 260 });
  const second = reflowFrame(first, resized);
  second.nodes.filter((entry) => ['a', 'b', 'c'].includes(entry.id)).forEach((entry) => {
    assert(entry.x + entry.width <= resized.x + resized.width + 1, 'still inside width');
    assert(entry.y + entry.height <= resized.y + resized.height + 1, 'still inside height');
  });
});

test('layoutFrames persist through extras write/read', () => {
  const frame = createFrameFromRect([], { x: 10, y: 20, width: 300, height: 200 }, ['a']);
  const written = writeLayoutFrames(chain, [frame]);
  const read = readLayoutFrames(written.compat?.extras as Record<string, unknown>);
  assert(read.length === 1, 'one frame');
  assert(read[0].nodeIds[0] === 'a', 'membership kept');
  assert(read[0].x === 10 && read[0].y === 20, 'rect kept');
});

console.log(`\n${passed} tests passed`);
