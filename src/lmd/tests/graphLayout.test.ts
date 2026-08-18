/**
 * Layout / collision helpers ported from the legacy App workbench.
 * Run: npx --yes tsx src/lmd/tests/graphLayout.test.ts
 */
import { createDefaultLayout } from '..';
import type { GraphDocument, GraphNode } from '../infrastructure/compat/types';
import {
  getTopVisibleCollapsedAncestorId,
  isInsideCollapsedSubgraph,
  layoutDocumentNodes,
  searchFreeRect,
  subgraphLookup,
  tidyDocumentNodes,
} from '../application/layout/graphLayout';

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

function node(id: string, x: number, y: number, extra?: Partial<GraphNode>): GraphNode {
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
    ...extra,
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

console.log('graphLayout tests');

test('searchFreeRect slides off an overlapping obstacle', () => {
  const desired = { x: 0, y: 0, width: 80, height: 40 };
  const obstacle = { x: -10, y: -10, width: 100, height: 60 };
  const free = searchFreeRect(desired, [obstacle], { x: 1, y: 0 });
  assert(free.x !== 0 || free.y !== 0, 'must move away from the obstacle');
  assert(
    free.x >= obstacle.x + obstacle.width ||
    free.x + free.width <= obstacle.x ||
    free.y >= obstacle.y + obstacle.height ||
    free.y + free.height <= obstacle.y,
    'resolved rect does not intersect',
  );
});

test('layoutDocumentNodes ranks LR left-to-right and keeps a cycle finite', () => {
  const graph = doc({
    direction: 'LR',
    nodes: [node('a', 0, 0), node('b', 0, 80), node('c', 0, 160)],
    edges: [
      { id: 'ab', from: 'a', to: 'b', label: '', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
      { id: 'bc', from: 'b', to: 'c', label: '', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
      { id: 'ca', from: 'c', to: 'a', label: '', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
    ],
  });
  const laid = layoutDocumentNodes(graph);
  assert(laid.length === 3, 'all nodes placed');
  const xs = laid.map((entry) => entry.x);
  assert(xs.every((value) => Number.isFinite(value)), 'finite positions');
});

test('layoutDocumentNodes respects TD vs LR primary axis', () => {
  const chain = {
    nodes: [node('a', 40, 40), node('b', 40, 40)],
    edges: [
      { id: 'ab', from: 'a', to: 'b', label: '', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
    ],
  };
  const lr = layoutDocumentNodes(doc({ direction: 'LR', ...chain }));
  const td = layoutDocumentNodes(doc({ direction: 'TD', ...chain }));
  const lrA = lr.find((entry) => entry.id === 'a')!;
  const lrB = lr.find((entry) => entry.id === 'b')!;
  const tdA = td.find((entry) => entry.id === 'a')!;
  const tdB = td.find((entry) => entry.id === 'b')!;
  assert(lrB.x > lrA.x, 'LR child sits to the right');
  assert(tdB.y > tdA.y, 'TD child sits below');
});

test('tidyDocumentNodes keeps node count and finite coords', () => {
  const graph = doc({
    nodes: [node('a', 0, 0), node('b', 400, 0), node('c', 800, 0)],
    edges: [
      { id: 'ab', from: 'a', to: 'b', label: '', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
      { id: 'bc', from: 'b', to: 'c', label: '', type: 'solid', strokeColor: '#fff', strokeWidth: 1 },
    ],
  });
  const tidied = tidyDocumentNodes(graph);
  assert(tidied.length === 3, 'same count');
  assert(tidied.every((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y)), 'finite');
});

test('nested collapse hides descendants and remaps to the outer group', () => {
  const lookup = subgraphLookup([
    {
      id: 'outer',
      title: 'outer',
      parentId: null,
      collapsed: true,
      fill: '',
      stroke: '',
      textColor: '',
    },
    {
      id: 'inner',
      title: 'inner',
      parentId: 'outer',
      collapsed: false,
      fill: '',
      stroke: '',
      textColor: '',
    },
  ]);
  const child = node('n1', 0, 0, { subgraphId: 'inner' });
  assert(isInsideCollapsedSubgraph(child, lookup), 'inner member hidden when outer is collapsed');
  assert(getTopVisibleCollapsedAncestorId('inner', lookup) === 'outer', 'outermost collapsed ancestor');
});

console.log(`\n${passed} tests passed`);
