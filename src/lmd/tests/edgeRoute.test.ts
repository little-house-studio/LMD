/**
 * Cubic edge routing: adaptive stubs, de-overlap, label clearance.
 * Run: npx --yes tsx src/lmd/tests/edgeRoute.test.ts
 */
import { distPointToCubicBezierSq } from '../shared/curve';
import {
  adaptiveStubLength,
  buildEdgeGeometry,
  clampLabelToViewport,
  cubicToSvgPath,
  estimateLabelSize,
  preferredExitFace,
  routeSceneEdges,
  snapConnectTarget,
} from '../placement';

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

console.log('edgeRoute tests');

const left = { id: 'a', x: 0, y: 40, width: 80, height: 48 };
const right = { id: 'b', x: 280, y: 40, width: 80, height: 48 };
const farRight = { id: 'c', x: 720, y: 40, width: 80, height: 48 };
const below = { id: 'd', x: 280, y: 260, width: 80, height: 48 };

test('horizontal neighbors leave from the east face', () => {
  assert(preferredExitFace(left, right) === 'e', 'A→B exits east');
  assert(preferredExitFace(right, left) === 'w', 'B→A exits west');
});

test('adaptive stub grows with distance and stays bounded', () => {
  const near = adaptiveStubLength('e', { x: 80, y: 64 }, { x: 140, y: 64 }, false);
  const far = adaptiveStubLength('e', { x: 80, y: 64 }, { x: 640, y: 64 }, false);
  const loop = adaptiveStubLength('e', { x: 80, y: 64 }, { x: 200, y: 80 }, true);
  assert(far > near, `far stub ${far} > near stub ${near}`);
  assert(far <= 172, 'stub cap');
  assert(loop > near, 'loop-like exits get a longer handle');
});

test('geometry is a cubic whose samples stay on the curve', () => {
  const geometry = buildEdgeGeometry(left, right, 0);
  assert(geometry.points.length > 4, 'sampled cubic');
  const mid = geometry.points[Math.floor(geometry.points.length / 2)];
  const dist = distPointToCubicBezierSq(mid, geometry.start, geometry.c1, geometry.c2, geometry.end);
  assert(dist < 1, 'sample lies on the cubic');
  const svg = cubicToSvgPath(geometry);
  assert(svg.includes('C '), `svg uses cubic command: ${svg}`);
});

test('reciprocal edges run as parallel lanes instead of a pinched V', () => {
  const routes = routeSceneEdges(
    [
      { id: 'ab', from: 'a', to: 'b', label: 'offer' },
      { id: 'ba', from: 'b', to: 'a', label: 'answer' },
    ],
    new Map([
      ['a', left],
      ['b', right],
    ]),
    { resolveLabels: 'full', obstacles: [left, right] },
  );
  const ab = routes.get('ab');
  const ba = routes.get('ba');
  assert(ab && ba, 'both routed');
  const sameControls =
    Math.abs(ab.c1.x - ba.c1.x) < 0.5 &&
    Math.abs(ab.c1.y - ba.c1.y) < 0.5 &&
    Math.abs(ab.c2.x - ba.c2.x) < 0.5 &&
    Math.abs(ab.c2.y - ba.c2.y) < 0.5;
  assert(!sameControls, 'reciprocal cubics must not coincide');
  assert(Math.abs(ab.start.y - ba.start.y) > 16, 'exits sit on separate face slots');
  assert(Math.abs(ab.end.y - ba.end.y) > 16, 'entries sit on separate face slots');
  const pinch = (route: NonNullable<typeof ab>) => {
    const chordY = (route.start.y + route.end.y) / 2;
    return Math.abs(route.label.y - chordY);
  };
  assert(pinch(ab) < 18, `offer stays on its lane, pinch=${pinch(ab)}`);
  assert(pinch(ba) < 18, `answer stays on its lane, pinch=${pinch(ba)}`);
  assert(Math.abs(ab.label.y - ba.label.y) > 16, 'labels stay on their own lanes');
});

test('fan-out from one node uses distinct exit points', () => {
  const routes = routeSceneEdges(
    [
      { id: 'ab', from: 'a', to: 'b', label: '' },
      { id: 'ad', from: 'a', to: 'd', label: '' },
    ],
    new Map([
      ['a', left],
      ['b', right],
      ['d', below],
    ]),
    { resolveLabels: 'fast' },
  );
  const ab = routes.get('ab');
  const ad = routes.get('ad');
  assert(ab && ad, 'both routed');
  const sameStart = Math.abs(ab.start.x - ad.start.x) < 0.5 && Math.abs(ab.start.y - ad.start.y) < 0.5;
  assert(!sameStart || ab.fromFace !== ad.fromFace, 'shared-face exits must slot apart');
});

test('labels sit on the cubic instead of beside it', () => {
  const routes = routeSceneEdges(
    [{ id: 'ab', from: 'a', to: 'b', label: '已认证' }],
    new Map([
      ['a', left],
      ['b', right],
    ]),
    {
      resolveLabels: 'full',
      obstacles: [left, right],
    },
  );
  const route = routes.get('ab');
  assert(route, 'routed');
  const dist = distPointToCubicBezierSq(route.label, route.start, route.c1, route.c2, route.end);
  assert(dist < 40, `label should sit on the path, distSq=${dist}`);
});

test('labels leave node boxes when there is room', () => {
  const routes = routeSceneEdges(
    [{ id: 'ab', from: 'a', to: 'c', label: '通过审核' }],
    new Map([
      ['a', left],
      ['c', farRight],
    ]),
    {
      resolveLabels: 'full',
      obstacles: [left, farRight],
    },
  );
  const route = routes.get('ab');
  assert(route, 'routed');
  const size = estimateLabelSize('通过审核');
  const box = {
    x: route.label.x - size.width / 2,
    y: route.label.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
  const hitsLeft =
    box.x < left.x + left.width &&
    box.x + box.width > left.x &&
    box.y < left.y + left.height &&
    box.y + box.height > left.y;
  const hitsRight =
    box.x < farRight.x + farRight.width &&
    box.x + box.width > farRight.x &&
    box.y < farRight.y + farRight.height &&
    box.y + box.height > farRight.y;
  assert(!hitsLeft && !hitsRight, 'label chip stays off both nodes');
});

test('skip edges bow around a node sitting on the chord', () => {
  const mid = { id: 'm', x: 280, y: 40, width: 80, height: 48 };
  const routes = routeSceneEdges(
    [{ id: 'ac', from: 'a', to: 'c', label: '跳过' }],
    new Map([
      ['a', left],
      ['m', mid],
      ['c', farRight],
    ]),
    {
      resolveLabels: 'full',
      obstacles: [left, mid, farRight],
    },
  );
  const route = routes.get('ac');
  assert(route, 'routed');
  const hitsMid = route.points.some((point) => (
    point.x > mid.x &&
    point.x < mid.x + mid.width &&
    point.y > mid.y &&
    point.y < mid.y + mid.height
  ));
  assert(!hitsMid, 'skip cubic stays off the middle node');
  const size = estimateLabelSize('跳过');
  const box = {
    x: route.label.x - size.width / 2,
    y: route.label.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
  const hitsLabel =
    box.x < mid.x + mid.width &&
    box.x + box.width > mid.x &&
    box.y < mid.y + mid.height &&
    box.y + box.height > mid.y;
  assert(!hitsLabel, 'skip label stays off the middle node');
});

test('viewport clamp keeps a mid-edge label when the midpoint is still inside', () => {
  const geometry = buildEdgeGeometry(left, farRight, 0);
  geometry.label = { x: 400, y: 64 };
  const kept = clampLabelToViewport(geometry, { x: 200, y: 0, width: 400, height: 160 });
  assert(kept !== null, 'visible midpoint stays');
  assert(Math.abs(kept.x - 400) < 1 && Math.abs(kept.y - 64) < 1, 'no slide while inside');
});

test('viewport clamp slides the label onto the visible leftover of a long edge', () => {
  const geometry = buildEdgeGeometry(left, farRight, 0);
  geometry.label = { x: 400, y: 64 };
  const rightHalf = clampLabelToViewport(geometry, { x: 520, y: 0, width: 280, height: 160 });
  assert(rightHalf !== null, 'right leftover has a label');
  assert(rightHalf.x >= 520 && rightHalf.x < 800, `slides right into view, got ${rightHalf.x}`);
  assert(rightHalf.x > geometry.label.x, 'moves toward the visible segment');

  const leftHalf = clampLabelToViewport(geometry, { x: 0, y: 0, width: 260, height: 160 });
  assert(leftHalf !== null, 'left leftover has a label');
  assert(leftHalf.x >= 0 && leftHalf.x <= 260, `slides left into view, got ${leftHalf.x}`);
  assert(leftHalf.x < geometry.label.x, 'moves toward the visible segment');
});

test('viewport clamp slides off a group title chip', () => {
  const geometry = buildEdgeGeometry(left, farRight, 0);
  geometry.label = { x: 400, y: 64 };
  const title = { x: 360, y: 48, width: 90, height: 28 };
  const viewport = { x: 0, y: 0, width: 900, height: 200 };
  const chip = { width: 48, height: 18 };
  const kept = clampLabelToViewport(geometry, viewport, { avoid: [title], chip, pad: 2 });
  assert(kept !== null, 'still on the visible path');
  const box = {
    x: kept.x - chip.width / 2 - 2,
    y: kept.y - chip.height / 2 - 2,
    width: chip.width + 4,
    height: chip.height + 4,
  };
  const overlaps =
    box.x < title.x + title.width
    && box.x + box.width > title.x
    && box.y < title.y + title.height
    && box.y + box.height > title.y;
  assert(!overlaps, `label chip must miss the group title, center=${kept.x},${kept.y}`);
});

test('viewport clamp hides the label when the whole edge is off-screen', () => {
  const geometry = buildEdgeGeometry(left, farRight, 0);
  const hidden = clampLabelToViewport(geometry, { x: 1200, y: 0, width: 200, height: 160 });
  assert(hidden === null, 'no visible segment, no label');
});

test('connect magnet snaps to the nearest node face', () => {
  const boxes = [left, right, below];
  const inside = snapConnectTarget({ x: 300, y: 60 }, left, boxes, 40);
  assert(inside?.id === 'b', 'cursor on the target snaps to it');
  const near = snapConnectTarget({ x: 250, y: 64 }, left, boxes, 40);
  assert(near?.id === 'b', 'cursor beside the target still snaps');
  const far = snapConnectTarget({ x: 140, y: 64 }, left, boxes, 40);
  assert(far === null, 'cursor in empty space stays free');
  const self = snapConnectTarget({ x: 20, y: 60 }, left, boxes, 80);
  assert(self === null, 'source node is not a snap target');
  assert(inside && Math.abs(inside.point.x - right.x) < 0.01, 'snap point is the inbound face');
  const preview = buildEdgeGeometry(left, right);
  assert(Math.abs(preview.end.x - right.x) <= 3, 'preview lands on the target face');
});

test('two labels on a pair do not occupy the same chip', () => {
  const routes = routeSceneEdges(
    [
      { id: 'ab', from: 'a', to: 'b', label: '正向' },
      { id: 'ba', from: 'b', to: 'a', label: '反向' },
    ],
    new Map([
      ['a', left],
      ['b', right],
    ]),
    {
      resolveLabels: 'full',
      obstacles: [left, right],
    },
  );
  const ab = routes.get('ab');
  const ba = routes.get('ba');
  assert(ab && ba, 'both labeled');
  const dx = ab.label.x - ba.label.x;
  const dy = ab.label.y - ba.label.y;
  assert(Math.hypot(dx, dy) > 12, 'label centers stay apart');
});

console.log(`\n${passed} tests passed`);
