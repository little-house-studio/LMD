interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface BlobPrimitive {
  kind: 'rounded-rect';
  rect: Rect;
  radius: number;
  softness: number;
  weight: number;
}

interface ContourSegment {
  start: Point;
  end: Point;
}

interface BlobContourDetail {
  kind: 'interactive' | 'full';
}

interface BlobComputationRequest {
  type: 'compute-blob';
  id: string;
  primitives: BlobPrimitive[];
  fieldThreshold: number;
  detail: BlobContourDetail;
}

interface BlobComputationResponse {
  type: 'blob-result';
  id: string;
  loops: Point[][];
  bounds: Rect | null;
}

function distanceToRoundedRectSurface(point: Point, rect: Rect, radius: number): number {
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  const centerX = rect.x + halfWidth;
  const centerY = rect.y + halfHeight;
  const qx = Math.abs(point.x - centerX) - Math.max(halfWidth - radius, 0);
  const qy = Math.abs(point.y - centerY) - Math.max(halfHeight - radius, 0);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

function measureBlobField(point: Point, primitives: BlobPrimitive[]): number {
  return primitives.reduce((field, primitive) => {
    const signedDistance = distanceToRoundedRectSurface(point, primitive.rect, primitive.radius);
    const softness = Math.max(primitive.softness, 1);

    if (signedDistance <= 0) {
      return field + primitive.weight * (1 + Math.max(0, Math.min(-signedDistance / softness, 0.28)));
    }

    const normalized = 1 - signedDistance / softness;
    if (normalized <= 0) {
      return field;
    }

    return field + primitive.weight * normalized * normalized;
  }, 0);
}

function buildBlobPrimitiveBounds(primitives: BlobPrimitive[]): Rect | null {
  if (primitives.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const primitive of primitives) {
    minX = Math.min(minX, primitive.rect.x);
    minY = Math.min(minY, primitive.rect.y);
    maxX = Math.max(maxX, primitive.rect.x + primitive.rect.width);
    maxY = Math.max(maxY, primitive.rect.y + primitive.rect.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function interpolateContourPoint(
  start: Point,
  end: Point,
  startValue: number,
  endValue: number,
  threshold: number,
): Point {
  const denominator = endValue - startValue;
  if (Math.abs(denominator) < 0.0001) {
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }

  const t = clamp((threshold - startValue) / denominator, 0, 1);
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

function buildContourLoops(segments: ContourSegment[]): Point[][] {
  const pointLookup = new Map<string, Point>();
  const adjacency = new Map<string, string[]>();
  const unusedEdges = new Set<string>();

  const pointKey = (p: Point) => `${Math.round(p.x * 100) / 100}:${Math.round(p.y * 100) / 100}`;
  const edgeKey = (a: string, b: string) => (a < b ? `${a}::${b}` : `${b}::${a}`);

  segments.forEach((segment) => {
    const startKey = pointKey(segment.start);
    const endKey = pointKey(segment.end);
    if (startKey === endKey) return;

    pointLookup.set(startKey, segment.start);
    pointLookup.set(endKey, segment.end);
    adjacency.set(startKey, [...(adjacency.get(startKey) ?? []), endKey]);
    adjacency.set(endKey, [...(adjacency.get(endKey) ?? []), startKey]);
    unusedEdges.add(edgeKey(startKey, endKey));
  });

  const loops: Point[][] = [];
  while (unusedEdges.size > 0) {
    const firstEdge = unusedEdges.values().next().value as string | undefined;
    if (!firstEdge) break;

    const [startKey, nextKey] = firstEdge.split('::');
    let previousKey: string | null = null;
    let currentKey = startKey;
    let candidateKey = nextKey;
    const loop: Point[] = [];

    while (candidateKey) {
      loop.push(pointLookup.get(currentKey) ?? { x: 0, y: 0 });
      unusedEdges.delete(edgeKey(currentKey, candidateKey));

      previousKey = currentKey;
      currentKey = candidateKey;
      if (currentKey === startKey) break;

      const neighbors = adjacency.get(currentKey) ?? [];
      const nextCandidate = neighbors.find((neighbor) =>
        neighbor !== previousKey && unusedEdges.has(edgeKey(currentKey, neighbor)),
      ) ?? neighbors.find((neighbor) => unusedEdges.has(edgeKey(currentKey, neighbor)));

      if (!nextCandidate) break;
      candidateKey = nextCandidate;
    }

    if (loop.length >= 3) {
      loops.push(loop);
    }
  }

  return loops;
}

function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }

  return area / 2;
}

function simplifyClosedPolygon(points: Point[]): Point[] {
  if (points.length <= 3) return points;

  const distanceBetweenPoints = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  return points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    if (
      distanceBetweenPoints(previous, point) < 0.8 ||
      distanceBetweenPoints(point, next) < 0.8
    ) {
      return false;
    }

    const cross = (point.x - previous.x) * (next.y - point.y) - (point.y - previous.y) * (next.x - point.x);
    return Math.abs(cross) > 0.6;
  });
}

function buildBlobContourLoopsForPrimitives(
  primitives: BlobPrimitive[],
  fieldThreshold: number,
  detail: BlobContourDetail,
): Point[][] {
  const primitiveBounds = buildBlobPrimitiveBounds(primitives);
  const maxSoftness = Math.max(0, ...primitives.map((p) => p.softness));
  const fieldBounds = primitiveBounds
    ? {
        x: primitiveBounds.x - (detail === 'interactive' ? Math.max(20, maxSoftness * 0.38) : Math.max(30, maxSoftness * 0.54)),
        y: primitiveBounds.y - (detail === 'interactive' ? Math.max(20, maxSoftness * 0.38) : Math.max(30, maxSoftness * 0.54)),
        width: primitiveBounds.width + (detail === 'interactive' ? Math.max(20, maxSoftness * 0.38) * 2 : Math.max(30, maxSoftness * 0.54) * 2),
        height: primitiveBounds.height + (detail === 'interactive' ? Math.max(20, maxSoftness * 0.38) * 2 : Math.max(30, maxSoftness * 0.54) * 2),
      }
    : null;

  if (!fieldBounds) return [];

  const maxDimension = Math.max(fieldBounds.width, fieldBounds.height);
  const cellSize = detail === 'interactive'
    ? clamp(maxDimension / 16, 18, 30)
    : clamp(maxDimension / 30, 10, 16);
  const threshold = fieldThreshold;
  const cols = Math.max(4, Math.ceil(fieldBounds.width / cellSize) + 3);
  const rows = Math.max(4, Math.ceil(fieldBounds.height / cellSize) + 3);
  const origin = {
    x: fieldBounds.x - cellSize * 1.5,
    y: fieldBounds.y - cellSize * 1.5,
  };

  const values: number[][] = Array.from({ length: rows + 1 }, (_, rowIndex) =>
    Array.from({ length: cols + 1 }, (_, columnIndex) =>
      measureBlobField(
        {
          x: origin.x + columnIndex * cellSize,
          y: origin.y + rowIndex * cellSize,
        },
        primitives,
      ),
    ),
  );

  const segments: ContourSegment[] = [];

  for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
    for (let columnIndex = 0; columnIndex < cols; columnIndex++) {
      const topLeftValue = values[rowIndex][columnIndex];
      const topRightValue = values[rowIndex][columnIndex + 1];
      const bottomRightValue = values[rowIndex + 1][columnIndex + 1];
      const bottomLeftValue = values[rowIndex + 1][columnIndex];
      const state =
        (topLeftValue >= threshold ? 8 : 0) |
        (topRightValue >= threshold ? 4 : 0) |
        (bottomRightValue >= threshold ? 2 : 0) |
        (bottomLeftValue >= threshold ? 1 : 0);

      if (state === 0 || state === 15) continue;

      const topLeft = { x: origin.x + columnIndex * cellSize, y: origin.y + rowIndex * cellSize };
      const topRight = { x: topLeft.x + cellSize, y: topLeft.y };
      const bottomLeft = { x: topLeft.x, y: topLeft.y + cellSize };
      const bottomRight = { x: topLeft.x + cellSize, y: topLeft.y + cellSize };

      const top = interpolateContourPoint(topLeft, topRight, topLeftValue, topRightValue, threshold);
      const right = interpolateContourPoint(topRight, bottomRight, topRightValue, bottomRightValue, threshold);
      const bottom = interpolateContourPoint(bottomLeft, bottomRight, bottomLeftValue, bottomRightValue, threshold);
      const left = interpolateContourPoint(topLeft, bottomLeft, topLeftValue, bottomLeftValue, threshold);

      const centerValue = state === 5 || state === 10
        ? measureBlobField({ x: topLeft.x + cellSize / 2, y: topLeft.y + cellSize / 2 }, primitives)
        : 0;

      const addSegment = (start: Point, end: Point) => segments.push({ start, end });

      switch (state) {
        case 1: addSegment(left, bottom); break;
        case 2: addSegment(bottom, right); break;
        case 3: addSegment(left, right); break;
        case 4: addSegment(top, right); break;
        case 5:
          if (centerValue >= threshold) {
            addSegment(top, left);
            addSegment(right, bottom);
          } else {
            addSegment(top, right);
            addSegment(left, bottom);
          }
          break;
        case 6: addSegment(top, bottom); break;
        case 7: addSegment(top, left); break;
        case 8: addSegment(top, left); break;
        case 9: addSegment(top, bottom); break;
        case 10:
          if (centerValue >= threshold) {
            addSegment(top, right);
            addSegment(left, bottom);
          } else {
            addSegment(top, left);
            addSegment(right, bottom);
          }
          break;
        case 11: addSegment(top, right); break;
        case 12: addSegment(left, right); break;
        case 13: addSegment(bottom, right); break;
        case 14: addSegment(left, bottom); break;
        default: break;
      }
    }
  }

  return buildContourLoops(segments)
    .map((loop) => simplifyClosedPolygon(loop))
    .filter((loop) => Math.abs(polygonArea(loop)) >= (detail === 'interactive' ? 220 : 140))
    .sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
}

function buildBlobPrimitiveClusters(
  primitives: BlobPrimitive[],
  fieldThreshold: number,
): BlobPrimitive[][] {
  if (primitives.length <= 1) {
    return primitives.length === 0 ? [] : [primitives];
  }

  const bounds = primitives.map((p) => ({
    x: p.rect.x,
    y: p.rect.y,
    width: p.rect.width,
    height: p.rect.height,
  }));
  const centers = primitives.map((p) => ({
    x: p.rect.x + p.rect.width / 2,
    y: p.rect.y + p.rect.height / 2,
  }));
  const influenceBounds = primitives.map((p, i) => ({
    x: bounds[i].x - Math.max(20, p.softness * (1 - fieldThreshold * 0.42)),
    y: bounds[i].y - Math.max(20, p.softness * (1 - fieldThreshold * 0.42)),
    width: bounds[i].width + Math.max(20, p.softness * (1 - fieldThreshold * 0.42)) * 2,
    height: bounds[i].height + Math.max(20, p.softness * (1 - fieldThreshold * 0.42)) * 2,
  }));

  const visited = new Set<number>();
  const clusters: BlobPrimitive[][] = [];

  const rectsIntersect = (a: Rect, b: Rect) => !(
    a.x + a.width <= b.x || a.x >= b.x + b.width ||
    a.y + a.height <= b.y || a.y >= b.y + b.height
  );

  const shouldConnect = (leftIndex: number, rightIndex: number) => {
    if (rectsIntersect(bounds[leftIndex], bounds[rightIndex])) return true;
    if (!rectsIntersect(influenceBounds[leftIndex], influenceBounds[rightIndex])) return false;

    const midpoint = {
      x: (centers[leftIndex].x + centers[rightIndex].x) / 2,
      y: (centers[leftIndex].y + centers[rightIndex].y) / 2,
    };
    return measureBlobField(midpoint, [primitives[leftIndex], primitives[rightIndex]]) >= fieldThreshold * 0.94;
  };

  for (let i = 0; i < primitives.length; i++) {
    if (visited.has(i)) continue;

    const stack = [i];
    const clusterIndices: number[] = [];
    visited.add(i);

    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;

      clusterIndices.push(current);
      for (let j = 0; j < primitives.length; j++) {
        if (visited.has(j) || j === current) continue;
        if (!shouldConnect(current, j)) continue;

        visited.add(j);
        stack.push(j);
      }
    }

    clusters.push(clusterIndices.map((idx) => primitives[idx]));
  }

  return clusters;
}

self.addEventListener('message', (event) => {
  const data = event.data as BlobComputationRequest;

  if (data.type !== 'compute-blob') return;

  const clusters = buildBlobPrimitiveClusters(data.primitives, data.fieldThreshold);
  const loops = clusters.flatMap((cluster) =>
    buildBlobContourLoopsForPrimitives(cluster, data.fieldThreshold, data.detail),
  );

  const response: BlobComputationResponse = {
    type: 'blob-result',
    id: data.id,
    loops,
    bounds: buildBlobPrimitiveBounds(data.primitives),
  };

  self.postMessage(response);
});