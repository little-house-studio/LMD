/**
 * Nested group frames: parent wraps children with a visible margin.
 * Run: npx --yes tsx src/lmd/tests/groupLayout.test.ts
 */
import { subgraphLookup } from '../application/layout/graphLayout';
import type { GraphNode, GraphSubgraph } from '../infrastructure/compat/types';
import { computeGroupRects, subgraphDepth } from '../placement';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function node(id: string, x: number, y: number, subgraphId: string): GraphNode {
  return {
    id,
    label: id,
    shape: 'rect',
    x,
    y,
    width: 120,
    height: 64,
    subgraphId,
    fill: '',
    stroke: '',
    textColor: '',
  };
}

function group(id: string, parentId: string | null): GraphSubgraph {
  return {
    id,
    title: id,
    parentId,
    collapsed: false,
    fill: '',
    stroke: '',
    textColor: '',
  };
}

const subgraphs = [
  group('平台域', null),
  group('控制面', '平台域'),
  group('数据面', '平台域'),
];
const lookup = subgraphLookup(subgraphs);
const nodes = [
  node('api', 0, 0, '控制面'),
  node('sched', 200, 0, '控制面'),
  node('gw', 480, 0, '数据面'),
  node('work', 680, 0, '数据面'),
];
const rects = computeGroupRects(subgraphs, nodes, lookup);
const outer = rects.get('平台域');
const control = rects.get('控制面');
const data = rects.get('数据面');

assert(outer && control && data, 'all group rects exist');
assert(subgraphDepth('平台域', lookup) === 0, 'root depth');
assert(subgraphDepth('控制面', lookup) === 1, 'child depth');
assert(
  control.x > outer.x &&
    control.y > outer.y &&
    control.x + control.width < outer.x + outer.width &&
    control.y + control.height < outer.y + outer.height,
  'control plane sits inside platform',
);
assert(
  data.x > outer.x &&
    data.y > outer.y &&
    data.x + data.width < outer.x + outer.width &&
    data.y + data.height < outer.y + outer.height,
  'data plane sits inside platform',
);
assert(control.x + control.width < data.x, 'sibling groups stay side by side');
assert(outer.width - (data.x + data.width - control.x) > 16, 'parent keeps a visible nest margin');

console.log(
  `[groupLayout] ok · outer=${Math.round(outer.width)}x${Math.round(outer.height)} nestMargin=${Math.round(control.x - outer.x)}`,
);
