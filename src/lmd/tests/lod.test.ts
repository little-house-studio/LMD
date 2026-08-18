/**
 * Canvas LOD: ungrouped nodes stay; nested groups peel inward.
 * Run: npx --yes tsx src/lmd/tests/lod.test.ts
 */
import {
  canvasLod,
  groupVisibleAtScale,
  hidesGroupedEdge,
  LOD_DETAILS_MIN,
  LOD_NAMES_MIN,
  LOD_NEST_MIN,
  maxVisibleGroupDepth,
  nodeBelongsToGroup,
} from '../placement/lod';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

assert(canvasLod(1) === 'details', 'zoom 1 is details');
assert(canvasLod(LOD_DETAILS_MIN) === 'details', '0.5 is details');
assert(canvasLod(LOD_DETAILS_MIN - 0.01) === 'names', 'just below 0.5 is names');
assert(canvasLod(LOD_NAMES_MIN) === 'names', '0.28 is names');
assert(canvasLod(LOD_NAMES_MIN - 0.01) === 'groups', 'just below 0.28 is groups');
assert(canvasLod(0.20) === 'groups', 'fit-all kitchen sink is groups');
assert(canvasLod(0.12, false) === 'names', 'no subgraphs stays names');

assert(nodeBelongsToGroup({ subgraphId: '平台域' }), 'member folds');
assert(!nodeBelongsToGroup({ subgraphId: null }), 'ungrouped stays');
assert(!nodeBelongsToGroup({}), 'missing subgraph stays');

assert(hidesGroupedEdge({ subgraphId: 'a' }, { subgraphId: null }), 'group-to-free folds');
assert(!hidesGroupedEdge({ subgraphId: null }, { subgraphId: null }), 'free-to-free stays');

const kitchenMax = 1;
assert(maxVisibleGroupDepth(LOD_NEST_MIN, kitchenMax) === Number.POSITIVE_INFINITY, 'at nest min every group stays');
assert(groupVisibleAtScale(1, 0.24, kitchenMax), 'nested groups stay just after nodes fold');
assert(!groupVisibleAtScale(1, 0.16, kitchenMax), 'nested groups fold into the parent');
assert(groupVisibleAtScale(0, 0.16, kitchenMax), 'top-level group stays');

const tripleMax = 2;
assert(!groupVisibleAtScale(2, 0.16, tripleMax), 'innermost peels first');
assert(groupVisibleAtScale(1, 0.16, tripleMax), 'middle nest stays one step longer');
assert(!groupVisibleAtScale(1, 0.08, tripleMax), 'next step folds the middle nest');
assert(groupVisibleAtScale(0, 0.08, tripleMax), 'outermost group never folds away');

console.log('[lod] ok');
