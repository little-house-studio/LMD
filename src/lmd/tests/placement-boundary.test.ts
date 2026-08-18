/**
 * Placement stays a pure geometry kernel: no canvas/engine imports,
 * and canvas shims must not grow a second copy of the algorithms.
 * Run: npx --yes tsx src/lmd/tests/placement-boundary.test.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const srcRoot = fileURLToPath(new URL('..', import.meta.url));
const placementDir = join(srcRoot, 'placement');
const canvasDir = join(srcRoot, 'presentation', 'canvas');
const paintDir = join(canvasDir, 'paint');

function walk(dir: string, acc: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

const forbidden = /from\s+['"][^'"]*presentation[^'"]*['"]/;
for (const file of walk(placementDir)) {
  const source = readFileSync(file, 'utf8');
  assert(!forbidden.test(source), `${file} must not import presentation`);
  assert(!source.includes('CanvasRenderingContext2D'), `${file} must stay canvas-free`);
}

const shims = ['edgeRoute.ts', 'groupLayout.ts', 'nodeContent.ts'];
for (const name of shims) {
  const source = readFileSync(join(canvasDir, name), 'utf8');
  assert(
    source.includes('@deprecated') && source.includes('from \'../../placement\''),
    `${name} must stay a placement re-export`,
  );
  assert(!/function\s+(routeSceneEdges|clampLabelToViewport|computeGroupRects|nodeContentBands)\b/.test(source), `${name} must not redefine placement`);
}

const engine = readFileSync(join(canvasDir, 'engine.ts'), 'utf8');
assert(engine.includes('from \'../../placement\''), 'engine must consume placement');
assert(engine.includes('from \'./paint\''), 'engine must delegate paint');
assert(engine.includes('paintCanvasFrame'), 'engine must paint via paintCanvasFrame');
assert(engine.includes('hitTestScene'), 'engine must hit-test via interact/hitTest');
assert(engine.includes('buildInlineEdit'), 'engine must build inline edit via interact/inlineEdit');
assert(engine.includes('cloneWorkingDocument'), 'engine must clone via workingDoc');
assert(engine.includes('snapScalar'), 'engine must consume placement grid snap');
assert(engine.includes('snapSceneConnect'), 'engine must consume connect snap');
assert(engine.includes('layoutSequenceScene'), 'engine must consume sequence layout');
assert(engine.includes('searchFreeSequenceOrigin'), 'engine must consume sequence placement');
assert(engine.includes('layoutMindMap'), 'engine must consume mind layout');
assert(!engine.includes('applySnapshotBlit'), 'engine must not blit scene snapshots');
assert(!/function\s+snapToGrid\b/.test(engine), 'engine must not redefine grid snap');
assert(!/function\s+(routeSceneEdges|clampLabelToViewport|computeGroupRects|nodeContentBands|canvasLod|fitWrappedText|groupVisibleAtScale|expandCoverForCull|screenStrokeWidth|snapScalar)\b/.test(engine), 'engine must not reimplement placement');
assert(!/function\s+(paintSequenceBlock|paintMindBlock|paintNodeBody|paintEdge)\b/.test(engine), 'engine must not own scene paint primitives');

const paint = walk(paintDir).map((file) => readFileSync(file, 'utf8')).join('\n');
assert(paint.includes('from \'../../../placement\'') || paint.includes('from \'../../placement\''), 'paint must consume placement');
assert(paint.includes('paintSequenceBlock'), 'paint must draw sequence via sequencePaint');
assert(paint.includes('paintMindBlock'), 'paint must draw mind via mindPaint');
assert(paint.includes('createNodePath'), 'paint must reuse Path2D node shapes');
assert(paint.includes('applyWorldTransform'), 'paint must draw geometry in world space');
assert(paint.includes('worldStrokeWidth'), 'paint must convert screen strokes for the world matrix');
assert(!paint.includes('from \'../engine\''), 'paint must not import the engine class');

console.log('[placement-boundary] ok');
