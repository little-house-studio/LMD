import type { GraphEdge } from '@lths/lmd/legacy';
import { estimateEdgeLabelSize } from '../domain/label';
import {
  cubicBezierPoint,
  cubicBezierTangent,
  distPointToCubicBezierSq,
} from '../shared/curve';
import {
  pointInRect,
  rectIntersects,
  type Rect,
  type Vec2,
} from '../shared/geom';
import { LOD_DETAILS_MIN } from './lod';

export const estimateLabelSize = estimateEdgeLabelSize;

export type EndpointBox = Pick<Rect, 'x' | 'y' | 'width' | 'height'> & { id?: string };

export type Face = 'n' | 'e' | 's' | 'w';

export type EdgeGeometry = {
  start: Vec2;
  end: Vec2;
  c1: Vec2;
  c2: Vec2;
  /** Sampled polyline of the same cubic the canvas strokes (hit / bounds). */
  points: Vec2[];
  label: Vec2;
  labelSize: { width: number; height: number };
  fromFace: Face;
  toFace: Face;
};

export type RouteLabelMode = 'full' | 'fast';

/** Below this zoom, hide descriptions / edge labels; node titles stay at screen-absolute size. */
export const EDGE_LABEL_MIN_SCALE = LOD_DETAILS_MIN;

const SAMPLE_COUNT = 16;
const MIN_STUB = 28;
const MAX_STUB = 172;
const FACE_INSET = 2;

export function nodeCenter(box: EndpointBox): Vec2 {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

export function faceNormal(face: Face): Vec2 {
  if (face === 'n') return { x: 0, y: -1 };
  if (face === 's') return { x: 0, y: 1 };
  if (face === 'w') return { x: -1, y: 0 };
  return { x: 1, y: 0 };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hypot(dx: number, dy: number) {
  return Math.hypot(dx, dy);
}

function normalize(vector: Vec2): Vec2 {
  const length = hypot(vector.x, vector.y);
  if (length < 1e-6) {
    return { x: 1, y: 0 };
  }
  return { x: vector.x / length, y: vector.y / length };
}

export function preferredExitFace(from: EndpointBox, to: EndpointBox): Face {
  const a = nodeCenter(from);
  const b = nodeCenter(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy) * 0.88) {
    return dx >= 0 ? 'e' : 'w';
  }
  return dy >= 0 ? 's' : 'n';
}

export function preferredEnterFace(from: EndpointBox, to: EndpointBox): Face {
  return preferredExitFace(to, from);
}

export function facePoint(box: EndpointBox, face: Face, t: number): Vec2 {
  const u = clamp(t, 0.08, 0.92);
  if (face === 'n') {
    return { x: box.x + box.width * u, y: box.y };
  }
  if (face === 's') {
    return { x: box.x + box.width * u, y: box.y + box.height };
  }
  if (face === 'w') {
    return { x: box.x, y: box.y + box.height * u };
  }
  return { x: box.x + box.width, y: box.y + box.height * u };
}

export function adaptiveStubLength(
  face: Face,
  start: Vec2,
  end: Vec2,
  loopLike: boolean,
): number {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const along = face === 'e' || face === 'w' ? dx : dy;
  const across = face === 'e' || face === 'w' ? dy : dx;
  const span = hypot(dx, dy);
  let stub = along * 0.38 + across * 0.12 + span * 0.06;
  stub = clamp(stub, MIN_STUB, MAX_STUB);
  if (loopLike) {
    stub = Math.max(stub, clamp(56 + across * 0.22, 56, 150));
  }
  if (span < 64) {
    stub = Math.min(stub, 36);
  }
  return stub;
}

function isLoopLike(fromFace: Face, toFace: Face): boolean {
  return fromFace === toFace;
}

function sampleCubic(start: Vec2, c1: Vec2, c2: Vec2, end: Vec2, count = SAMPLE_COUNT): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i <= count; i += 1) {
    points.push(cubicBezierPoint(start, c1, c2, end, i / count));
  }
  return points;
}

function labelRect(center: Vec2, size: { width: number; height: number }, pad = 0): Rect {
  return {
    x: center.x - size.width / 2 - pad,
    y: center.y - size.height / 2 - pad,
    width: size.width + pad * 2,
    height: size.height + pad * 2,
  };
}

function rectsOverlap(left: Rect, right: Rect) {
  return rectIntersects(left, right);
}

function sameBox(left: EndpointBox, right: EndpointBox) {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function pathHitsForeign(
  points: Vec2[],
  obstacles: Rect[],
  fromBox: EndpointBox,
  toBox: EndpointBox,
) {
  for (const point of points) {
    const probe = { x: point.x - 4, y: point.y - 4, width: 8, height: 8 };
    for (const obstacle of obstacles) {
      if (sameBox(obstacle, fromBox) || sameBox(obstacle, toBox)) {
        continue;
      }
      if (rectsOverlap(probe, obstacle)) {
        return true;
      }
    }
  }
  return false;
}

function uniqueFacePairs(fromFace: Face, toFace: Face, preferNorth: boolean): Array<[Face, Face]> {
  const over: Array<[Face, Face]> = preferNorth
    ? [['n', 'n'], ['s', 's']]
    : [['s', 's'], ['n', 'n']];
  const pairs: Array<[Face, Face]> = [
    [fromFace, toFace],
    ...over,
    [over[0][0], toFace],
    [fromFace, over[0][0]],
  ];
  const seen = new Set<string>();
  return pairs.filter(([from, to]) => {
    const key = `${from}:${to}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

type CubicOptions = {
  maxStub?: number;
};

function clearRoute(
  fromBox: EndpointBox,
  toBox: EndpointBox,
  fromFace: Face,
  toFace: Face,
  startT: number,
  endT: number,
  bow: number,
  obstacles: Rect[],
  preferNorth: boolean,
  options?: CubicOptions & { lockFaces?: boolean },
): ReturnType<typeof buildCubic> {
  const first = buildCubic(fromBox, toBox, fromFace, toFace, startT, endT, bow, options);
  if (obstacles.length === 0 || !pathHitsForeign(first.points, obstacles, fromBox, toBox)) {
    return first;
  }
  const extras = options?.lockFaces
    ? [bow, bow - 12, bow + 12, bow - 22, bow + 22]
    : preferNorth
      ? [bow, bow - 40, bow + 40, bow - 64, bow + 64, bow - 88, bow + 88, bow - 120, bow + 120]
      : [bow, bow + 40, bow - 40, bow + 64, bow - 64, bow + 88, bow - 88, bow + 120, bow - 120];
  const faces = options?.lockFaces
    ? [[fromFace, toFace] as [Face, Face]]
    : uniqueFacePairs(fromFace, toFace, preferNorth);
  for (const [nextFrom, nextTo] of faces) {
    for (const extra of extras) {
      const trial = buildCubic(fromBox, toBox, nextFrom, nextTo, startT, endT, extra, options);
      if (!pathHitsForeign(trial.points, obstacles, fromBox, toBox)) {
        return trial;
      }
    }
  }
  return first;
}

type RoutedDraft = {
  edge: Pick<GraphEdge, 'id' | 'from' | 'to' | 'label'>;
  fromFace: Face;
  toFace: Face;
  startT: number;
  endT: number;
  bow: number;
  maxStub?: number;
  lockFaces?: boolean;
};

function pairKey(fromId: string, toId: string) {
  return fromId < toId ? `${fromId}::${toId}` : `${toId}::${fromId}`;
}

type PairStyle = {
  bow: number;
  startT?: number;
  endT?: number;
  maxStub?: number;
  lockFaces?: boolean;
};

function reciprocalLaneTs(size: number): [number, number] {
  if (size < 40) {
    return [0.34, 0.66];
  }
  return [0.28, 0.72];
}

function assignPairStyles(
  edges: Array<Pick<GraphEdge, 'id' | 'from' | 'to' | 'label'>>,
  boxes: Map<string, EndpointBox>,
): Map<string, PairStyle> {
  const groups = new Map<string, Array<Pick<GraphEdge, 'id' | 'from' | 'to' | 'label'>>>();
  for (const edge of edges) {
    const key = pairKey(edge.from, edge.to);
    const bucket = groups.get(key) ?? [];
    bucket.push(edge);
    groups.set(key, bucket);
  }
  const styles = new Map<string, PairStyle>();
  for (const group of groups.values()) {
    const sorted = [...group].sort((left, right) => left.id.localeCompare(right.id));
    const forward = sorted.filter((edge) => edge.from <= edge.to);
    const reverse = sorted.filter((edge) => edge.from > edge.to);
    const labeled = group.some((edge) => edge.label?.trim());
    const step = labeled ? 32 : 22;
    if (forward.length > 0 && reverse.length > 0) {
      const sample = boxes.get(forward[0].from);
      const other = boxes.get(forward[0].to);
      const dx = sample && other
        ? (other.x + other.width / 2) - (sample.x + sample.width / 2)
        : 1;
      const dy = sample && other
        ? (other.y + other.height / 2) - (sample.y + sample.height / 2)
        : 0;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const faceSize = Math.min(
        sample ? (horizontal ? sample.height : sample.width) : 80,
        other ? (horizontal ? other.height : other.width) : 80,
      );
      const gap = sample && other
        ? (horizontal
          ? Math.abs(dx) - (sample.width + other.width) / 2
          : Math.abs(dy) - (sample.height + other.height) / 2)
        : 80;
      const [highT, lowT] = reciprocalLaneTs(faceSize);
      const maxStub = clamp(gap * 0.22, 16, 32);
      const placeLane = (
        list: Array<Pick<GraphEdge, 'id' | 'from' | 'to' | 'label'>>,
        t: number,
        sign: 1 | -1,
      ) => {
        const center = (list.length - 1) / 2;
        list.forEach((edge, index) => {
          styles.set(edge.id, {
            bow: sign * (6 + (index - center) * 10),
            startT: t,
            endT: t,
            maxStub,
            lockFaces: true,
          });
        });
      };
      placeLane(forward, highT, -1);
      placeLane(reverse, lowT, 1);
      continue;
    }
    if (sorted.length === 1) {
      styles.set(sorted[0].id, { bow: 0 });
      continue;
    }
    const center = (sorted.length - 1) / 2;
    sorted.forEach((edge, index) => {
      styles.set(edge.id, { bow: (index - center) * step });
    });
  }
  return styles;
}

function assignBows(edges: Array<Pick<GraphEdge, 'id' | 'from' | 'to' | 'label'>>): Map<string, number> {
  const styles = assignPairStyles(edges, new Map());
  const bows = new Map<string, number>();
  for (const [id, style] of styles) {
    bows.set(id, style.bow);
  }
  return bows;
}

function assignFaceSlots(
  attachments: Array<{ key: string; sort: number; edgeId: string; end: 'start' | 'end' }>,
): Map<string, number> {
  const groups = new Map<string, typeof attachments>();
  for (const item of attachments) {
    const bucket = groups.get(item.key) ?? [];
    bucket.push(item);
    groups.set(item.key, bucket);
  }
  const slots = new Map<string, number>();
  for (const bucket of groups.values()) {
    bucket.sort((left, right) => left.sort - right.sort || left.edgeId.localeCompare(right.edgeId));
    const count = bucket.length;
    bucket.forEach((item, index) => {
      const t = count === 1 ? 0.5 : 0.18 + ((index + 0.5) / count) * 0.64;
      slots.set(`${item.edgeId}:${item.end}`, t);
    });
  }
  return slots;
}

function buildCubic(
  fromBox: EndpointBox,
  toBox: EndpointBox,
  fromFace: Face,
  toFace: Face,
  startT: number,
  endT: number,
  bow: number,
  options?: CubicOptions,
): Pick<EdgeGeometry, 'start' | 'end' | 'c1' | 'c2' | 'points' | 'fromFace' | 'toFace'> {
  const fromN = faceNormal(fromFace);
  const toN = faceNormal(toFace);
  const start0 = facePoint(fromBox, fromFace, startT);
  const end0 = facePoint(toBox, toFace, endT);
  const start = {
    x: start0.x + fromN.x * FACE_INSET,
    y: start0.y + fromN.y * FACE_INSET,
  };
  const end = {
    x: end0.x + toN.x * FACE_INSET,
    y: end0.y + toN.y * FACE_INSET,
  };
  const loopLike = isLoopLike(fromFace, toFace);
  const cap = options?.maxStub;
  const stubFrom = cap == null
    ? adaptiveStubLength(fromFace, start, end, loopLike)
    : Math.min(adaptiveStubLength(fromFace, start, end, loopLike), cap);
  const stubTo = cap == null
    ? adaptiveStubLength(toFace, end, start, loopLike)
    : Math.min(adaptiveStubLength(toFace, end, start, loopLike), cap);
  const chord = normalize({ x: end.x - start.x, y: end.y - start.y });
  const perp = { x: -chord.y, y: chord.x };
  const c1 = {
    x: start.x + fromN.x * stubFrom + perp.x * bow,
    y: start.y + fromN.y * stubFrom + perp.y * bow,
  };
  const c2 = {
    x: end.x + toN.x * stubTo + perp.x * bow,
    y: end.y + toN.y * stubTo + perp.y * bow,
  };
  return {
    start,
    end,
    c1,
    c2,
    points: sampleCubic(start, c1, c2, end),
    fromFace,
    toFace,
  };
}

function placeLabel(
  cubic: Pick<EdgeGeometry, 'start' | 'c1' | 'c2' | 'end'>,
  size: { width: number; height: number },
  obstacles: Rect[],
  mode: RouteLabelMode,
): Vec2 {
  const mid = cubicBezierPoint(cubic.start, cubic.c1, cubic.c2, cubic.end, 0.5);
  if (size.width <= 0 || mode === 'fast') {
    return mid;
  }

  const ts = [0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68];
  const offsets = [0, 6, -6, 12, -12];
  let best = mid;
  let bestScore = Number.NEGATIVE_INFINITY;
  let foundClear = false;

  for (const t of ts) {
    const point = cubicBezierPoint(cubic.start, cubic.c1, cubic.c2, cubic.end, t);
    const tangent = cubicBezierTangent(cubic.start, cubic.c1, cubic.c2, cubic.end, t);
    const normal = normalize({ x: -tangent.y, y: tangent.x });
    for (const offset of offsets) {
      const candidate = {
        x: point.x + normal.x * offset,
        y: point.y + normal.y * offset,
      };
      const box = labelRect(candidate, size, 2);
      const score = 100 - Math.abs(t - 0.5) * 80 - Math.abs(offset) * 4;
      let blocked = false;
      for (const obstacle of obstacles) {
        if (rectsOverlap(box, obstacle)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        if (!foundClear || score > bestScore) {
          foundClear = true;
          bestScore = score;
          best = candidate;
        }
      } else if (!foundClear && score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }

  return best;
}

export function routeSceneEdges(
  edges: Array<Pick<GraphEdge, 'id' | 'from' | 'to' | 'label'>>,
  boxes: Map<string, EndpointBox>,
  options?: { resolveLabels?: RouteLabelMode; obstacles?: Rect[] },
): Map<string, EdgeGeometry> {
  const mode = options?.resolveLabels ?? 'full';
  const styles = assignPairStyles(edges, boxes);
  const attachments: Array<{ key: string; sort: number; edgeId: string; end: 'start' | 'end' }> = [];
  const drafts: RoutedDraft[] = [];

  for (const edge of edges) {
    const fromBox = boxes.get(edge.from);
    const toBox = boxes.get(edge.to);
    if (!fromBox || !toBox) {
      continue;
    }
    if (
      fromBox.x === toBox.x &&
      fromBox.y === toBox.y &&
      fromBox.width === toBox.width &&
      fromBox.height === toBox.height
    ) {
      continue;
    }
    const fromFace = preferredExitFace(fromBox, toBox);
    const toFace = preferredEnterFace(fromBox, toBox);
    const fromC = nodeCenter(fromBox);
    const toC = nodeCenter(toBox);
    const style = styles.get(edge.id);
    drafts.push({
      edge,
      fromFace,
      toFace,
      startT: style?.startT ?? 0.5,
      endT: style?.endT ?? 0.5,
      bow: style?.bow ?? 0,
      maxStub: style?.maxStub,
      lockFaces: style?.lockFaces,
    });
    attachments.push({
      key: `${edge.from}:${fromFace}`,
      sort: fromFace === 'e' || fromFace === 'w' ? toC.y : toC.x,
      edgeId: edge.id,
      end: 'start',
    });
    attachments.push({
      key: `${edge.to}:${toFace}`,
      sort: toFace === 'e' || toFace === 'w' ? fromC.y : fromC.x,
      edgeId: edge.id,
      end: 'end',
    });
  }

  const slots = assignFaceSlots(attachments);
  const routes = new Map<string, EdgeGeometry>();
  const labeled: Array<{ id: string; cubic: EdgeGeometry; size: { width: number; height: number } }> = [];
  const obstacles = [...(options?.obstacles ?? [])];

  for (const draft of drafts) {
    const fromBox = boxes.get(draft.edge.from);
    const toBox = boxes.get(draft.edge.to);
    if (!fromBox || !toBox) {
      continue;
    }
    const startT = draft.lockFaces
      ? draft.startT
      : slots.get(`${draft.edge.id}:start`) ?? draft.startT;
    const endT = draft.lockFaces
      ? draft.endT
      : slots.get(`${draft.edge.id}:end`) ?? draft.endT;
    const cubicOpts = { maxStub: draft.maxStub, lockFaces: draft.lockFaces };
    const cubic = mode === 'full'
      ? clearRoute(
        fromBox,
        toBox,
        draft.fromFace,
        draft.toFace,
        startT,
        endT,
        draft.bow,
        obstacles,
        draft.edge.id.length % 2 === 0,
        cubicOpts,
      )
      : buildCubic(
        fromBox,
        toBox,
        draft.fromFace,
        draft.toFace,
        startT,
        endT,
        draft.bow,
        cubicOpts,
      );
    const size = estimateLabelSize(draft.edge.label ?? '');
    const geometry: EdgeGeometry = {
      ...cubic,
      label: cubicBezierPoint(cubic.start, cubic.c1, cubic.c2, cubic.end, 0.5),
      labelSize: size,
    };
    routes.set(draft.edge.id, geometry);
    if (size.width > 0) {
      labeled.push({ id: draft.edge.id, cubic: geometry, size });
    }
  }

  labeled.sort((left, right) => right.size.width - left.size.width);
  for (const item of labeled) {
    const label = placeLabel(item.cubic, item.size, obstacles, mode);
    const next = routes.get(item.id);
    if (!next) {
      continue;
    }
    next.label = label;
    if (mode === 'full') {
      obstacles.push(labelRect(label, item.size, 3));
    }
  }

  return routes;
}

/** Single-edge helper for tests and previews. */
export function buildEdgeGeometry(
  fromBox: EndpointBox,
  toBox: EndpointBox,
  laneOffset = 0,
): EdgeGeometry {
  const fromFace = preferredExitFace(fromBox, toBox);
  const toFace = preferredEnterFace(fromBox, toBox);
  const cubic = buildCubic(fromBox, toBox, fromFace, toFace, 0.5, 0.5, laneOffset);
  return {
    ...cubic,
    label: cubicBezierPoint(cubic.start, cubic.c1, cubic.c2, cubic.end, 0.5),
    labelSize: { width: 0, height: 0 },
  };
}

export function buildConnectPreview(fromBox: EndpointBox, cursor: Vec2): EdgeGeometry {
  const phantom: EndpointBox = {
    id: 'cursor',
    x: cursor.x - 4,
    y: cursor.y - 4,
    width: 8,
    height: 8,
  };
  const fromFace = preferredExitFace(fromBox, phantom);
  const toFace = preferredEnterFace(fromBox, phantom);
  const cubic = buildCubic(fromBox, phantom, fromFace, toFace, 0.5, 0.5, 0);
  return {
    ...cubic,
    label: cursor,
    labelSize: { width: 0, height: 0 },
  };
}

export type ConnectSnapTarget = {
  id: string;
  box: EndpointBox;
  point: Vec2;
};

export function distanceToBox(point: Vec2, box: EndpointBox): number {
  const nearestX = clamp(point.x, box.x, box.x + box.width);
  const nearestY = clamp(point.y, box.y, box.y + box.height);
  return hypot(point.x - nearestX, point.y - nearestY);
}

/** Magnet a live connection onto the nearest node face, matching the routed edge. */
export function snapConnectTarget(
  cursor: Vec2,
  from: EndpointBox,
  boxes: EndpointBox[],
  radius: number,
): ConnectSnapTarget | null {
  const fromId = from.id;
  let best: ConnectSnapTarget | null = null;
  let bestDist = radius;
  for (const box of boxes) {
    if (!box.id || box.id === fromId) {
      continue;
    }
    const dist = distanceToBox(cursor, box);
    if (dist > bestDist) {
      continue;
    }
    const face = preferredEnterFace(from, box);
    best = {
      id: box.id,
      box,
      point: facePoint(box, face, 0.5),
    };
    bestDist = dist;
  }
  return best;
}

export function distPointToEdgeSq(point: Vec2, geometry: EdgeGeometry): number {
  return distPointToCubicBezierSq(point, geometry.start, geometry.c1, geometry.c2, geometry.end, 18);
}

export function edgeBounds(geometry: EdgeGeometry): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const consider = (point: Vec2) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };
  consider(geometry.start);
  consider(geometry.end);
  consider(geometry.c1);
  consider(geometry.c2);
  if (geometry.labelSize.width > 0) {
    const box = labelRect(geometry.label, geometry.labelSize);
    consider({ x: box.x, y: box.y });
    consider({ x: box.x + box.width, y: box.y + box.height });
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function cubicToSvgPath(geometry: Pick<EdgeGeometry, 'start' | 'c1' | 'c2' | 'end'>): string {
  const p = (point: Vec2) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  return `M ${p(geometry.start)} C ${p(geometry.c1)} ${p(geometry.c2)} ${p(geometry.end)}`;
}

export function arrowHeading(geometry: Pick<EdgeGeometry, 'c2' | 'end'>): number {
  return Math.atan2(geometry.end.y - geometry.c2.y, geometry.end.x - geometry.c2.x);
}

export function labelHitRect(geometry: EdgeGeometry, pad = 2): Rect | null {
  if (geometry.labelSize.width <= 0) {
    return null;
  }
  return labelRect(geometry.label, geometry.labelSize, pad);
}

/** Liang–Barsky: keep the part of AB that lies inside `rect`. */
function clipSegmentToRect(a: Vec2, b: Vec2, rect: Rect): { a: Vec2; b: Vec2 } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) {
      return q >= 0;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) {
        return false;
      }
      if (t > t0) {
        t0 = t;
      }
    } else {
      if (t < t0) {
        return false;
      }
      if (t < t1) {
        t1 = t;
      }
    }
    return true;
  };
  if (
    !clip(-dx, a.x - rect.x)
    || !clip(dx, rect.x + rect.width - a.x)
    || !clip(-dy, a.y - rect.y)
    || !clip(dy, rect.y + rect.height - a.y)
  ) {
    return null;
  }
  return {
    a: { x: a.x + dx * t0, y: a.y + dy * t0 },
    b: { x: a.x + dx * t1, y: a.y + dy * t1 },
  };
}

export type ClampLabelOptions = {
  /** World-space rects the chip must not cover (group title chips, etc.). */
  avoid?: readonly Rect[];
  /** World-space chip size used for overlap tests. */
  chip?: { width: number; height: number };
  pad?: number;
};

function labelChipBlocked(center: Vec2, options?: ClampLabelOptions): boolean {
  const avoid = options?.avoid;
  if (!avoid?.length) {
    return false;
  }
  const pad = options?.pad ?? 2;
  const chip = options?.chip ?? { width: 8, height: 8 };
  const box = {
    x: center.x - chip.width / 2 - pad,
    y: center.y - chip.height / 2 - pad,
    width: chip.width + pad * 2,
    height: chip.height + pad * 2,
  };
  for (const rect of avoid) {
    if (rectIntersects(box, rect)) {
      return true;
    }
  }
  return false;
}

/**
 * Keep an edge label on the path and inside `viewport` (already inset for chip size).
 * If the preferred midpoint is out of view, slide to the closest visible point on the cubic.
 * `avoid` keeps the chip off group names and other chrome.
 */
export function clampLabelToViewport(
  geometry: Pick<EdgeGeometry, 'label' | 'points' | 'start' | 'c1' | 'c2' | 'end'>,
  viewport: Rect,
  options?: ClampLabelOptions,
): Vec2 | null {
  if (pointInRect(geometry.label, viewport) && !labelChipBlocked(geometry.label, options)) {
    return geometry.label;
  }
  const raw = geometry.points.length >= 4
    ? geometry.points
    : sampleCubic(geometry.start, geometry.c1, geometry.c2, geometry.end);
  const points = raw.length > 4 ? raw.slice(1, -1) : raw;
  let clear: Vec2 | null = null;
  let clearDist = Number.POSITIVE_INFINITY;
  let fallback: Vec2 | null = null;
  let fallbackDist = Number.POSITIVE_INFINITY;
  const consider = (point: Vec2) => {
    if (!pointInRect(point, viewport)) {
      return;
    }
    const dx = point.x - geometry.label.x;
    const dy = point.y - geometry.label.y;
    const dist = dx * dx + dy * dy;
    if (dist < fallbackDist) {
      fallbackDist = dist;
      fallback = point;
    }
    if (!labelChipBlocked(point, options) && dist < clearDist) {
      clearDist = dist;
      clear = point;
    }
  };
  for (let i = 1; i < points.length; i += 1) {
    const clipped = clipSegmentToRect(points[i - 1], points[i], viewport);
    if (!clipped) {
      continue;
    }
    consider(clipped.a);
    consider(clipped.b);
  }
  return clear ?? fallback;
}

/** @deprecated pair lanes are assigned inside routeSceneEdges */
export function buildEdgeLaneMap(edges: GraphEdge[]): Map<string, number> {
  return assignBows(edges);
}
