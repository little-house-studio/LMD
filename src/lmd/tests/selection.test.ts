/**
 * Canvas selection: mixed kinds, box-select collect, select-all collapse.
 * Run: npx --yes tsx src/lmd/tests/selection.test.ts
 */
import {
  collectSelection,
  isCanvasIdSelected,
  partsOf,
  toggleCanvasIds,
} from '../domain/selection';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

assert(collectSelection({ nodes: ['a', 'b'] }).kind === 'node', 'only nodes stay a node selection');
assert(collectSelection({ sequences: ['s1'] }).kind === 'sequence', 'only sequences stay a sequence selection');
assert(collectSelection({ minds: ['m1'] }).kind === 'mind', 'only minds stay a mind selection');
const mixed = collectSelection({ nodes: ['a'], sequences: ['s1'], groups: ['g1'] });
assert(mixed.kind === 'mixed', 'multiple kinds become mixed');
assert(mixed.kind === 'mixed' && mixed.ids.length === 3, 'mixed ids flatten every bucket');
assert(isCanvasIdSelected(mixed, 'sequence', 's1'), 'mixed keeps sequence selected');
const withMind = collectSelection({ nodes: ['a'], minds: ['m1'] });
assert(withMind.kind === 'mixed', 'nodes plus mind is mixed');
assert(isCanvasIdSelected(withMind, 'mind', 'm1'), 'mixed keeps mind selected');
assert(isCanvasIdSelected(mixed, 'node', 'a'), 'mixed keeps node selected');
assert(!isCanvasIdSelected(mixed, 'node', 'missing'), 'unknown id is not selected');

const boxed = collectSelection({
  nodes: ['n1'],
  sequences: ['seq'],
});
assert(boxed.kind === 'mixed', 'box hitting nodes and a sequence is mixed');
assert(isCanvasIdSelected(boxed, 'sequence', 'seq'), 'boxed sequence is selected');

const added = toggleCanvasIds({ kind: 'node', ids: ['n1'] }, 'sequence', ['seq']);
assert(added.kind === 'mixed', 'shift-adding a sequence onto nodes becomes mixed');
assert(partsOf(added).sequences[0] === 'seq', 'toggled sequence is in parts');

const removed = toggleCanvasIds(added, 'sequence', ['seq']);
assert(removed.kind === 'node', 'removing the extra kind collapses back');
assert(collectSelection({}).kind === 'none', 'empty collect is none');

console.log('[selection] ok');
