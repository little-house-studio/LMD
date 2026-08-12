/**
 * Unit tests for shipped LMP layout/serialize caches.
 * Run: npx --yes tsx lmp/src/lib/layoutCache.test.ts
 */
import {
  MindMapLayoutCache,
  OutlineSerializeCache,
  buildOutlineLayoutSignature,
  lmpHotPathCounters,
  resetLmpHotPathCounters,
  runLmpInteractionStress,
} from './layoutCache.ts';
import type { OutlineNode } from './outline.ts';

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

const sampleRoots: OutlineNode[] = [
  {
    id: 'root',
    text: 'Root',
    color: null,
    children: [
      {
        id: 'child-a',
        text: 'A',
        color: 'amber',
        children: [],
      },
      {
        id: 'child-b',
        text: 'B',
        color: null,
        children: [
          { id: 'grand', text: 'G', color: null, children: [] },
        ],
      },
    ],
  },
];

console.log('layoutCache tests');

test('layout signature stable for same outline', () => {
  const a = buildOutlineLayoutSignature(sampleRoots, 'balanced');
  const b = buildOutlineLayoutSignature(sampleRoots, 'balanced');
  assertEqual(a, b, 'stable');
  const c = buildOutlineLayoutSignature(sampleRoots, 'right');
  assert(a !== c, 'mode changes signature');
});

test('MindMapLayoutCache hits on pan-equivalent repeated get', () => {
  resetLmpHotPathCounters();
  const cache = new MindMapLayoutCache();
  const layout1 = cache.get(sampleRoots, 'balanced');
  const layout2 = cache.get(sampleRoots, 'balanced');
  const layout3 = cache.get(sampleRoots, 'balanced');
  assert(layout1 === layout2 && layout2 === layout3, 'same array reference on hit');
  assertEqual(lmpHotPathCounters.layoutCacheMisses, 1, 'one miss');
  assertEqual(lmpHotPathCounters.layoutCacheHits, 2, 'two hits');
  assertEqual(lmpHotPathCounters.computeMindMapLayout, 1, 'layout computed once');
  assert(layout1.length >= 3, 'placed boxes exist');
});

test('MindMapLayoutCache invalidates on text change', () => {
  resetLmpHotPathCounters();
  const cache = new MindMapLayoutCache();
  cache.get(sampleRoots, 'balanced');
  const edited: OutlineNode[] = [
    {
      ...sampleRoots[0],
      text: 'Root changed',
      children: sampleRoots[0].children,
    },
  ];
  cache.get(edited, 'balanced');
  assertEqual(lmpHotPathCounters.layoutCacheMisses, 2, 'second miss after text change');
  assertEqual(lmpHotPathCounters.computeMindMapLayout, 2, 'recomputed');
});

test('OutlineSerializeCache hits when outline unchanged', () => {
  resetLmpHotPathCounters();
  const cache = new OutlineSerializeCache();
  const t1 = cache.get(sampleRoots, 'balanced');
  const t2 = cache.get(sampleRoots, 'balanced');
  assertEqual(t1, t2, 'same text');
  assert(t1.includes('Root'), 'contains root text');
  assertEqual(lmpHotPathCounters.serializeCacheMisses, 1, 'one serialize');
  assertEqual(lmpHotPathCounters.serializeCacheHits, 1, 'one hit');
  assertEqual(lmpHotPathCounters.serializeOutline, 1, 'one real call');
});

test('stress: pan/selection zero layout misses; topology edit once', () => {
  const metrics = runLmpInteractionStress({
    rootCount: 20,
    childrenPerRoot: 15,
    panFrames: 80,
    selectionFrames: 40,
  });
  assertEqual(metrics.layoutMissesDuringPan, 0, 'no layout on pan frames');
  assertEqual(metrics.layoutMissesDuringSelection, 0, 'no layout on selection');
  assertEqual(metrics.serializeMissesDuringPan, 0, 'no serialize on pan');
  assertEqual(metrics.layoutMissesOnTopologyEdit, 1, 'one layout on topology edit');
  console.log('  metrics', JSON.stringify(metrics));
});

console.log(`\n${passed} tests passed`);
