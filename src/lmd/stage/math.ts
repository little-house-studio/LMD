export type Vec2 = { x: number; y: number };

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function rectIntersects(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

export function pointInRect(p: Vec2, r: Rect, pad = 0): boolean {
  return (
    p.x >= r.x - pad &&
    p.x <= r.x + r.width + pad &&
    p.y >= r.y - pad &&
    p.y <= r.y + r.height + pad
  );
}

export function expandRect(r: Rect, pad: number): Rect {
  return {
    x: r.x - pad,
    y: r.y - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function cubicBezierPoint(a: Vec2, c1: Vec2, c2: Vec2, b: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * a.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + tt * t * b.x,
    y: uu * u * a.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + tt * t * b.y,
  };
}

/** Sampled squared distance from a point to a cubic Bézier (same curve the stage paints). */
export function distPointToCubicBezierSq(
  p: Vec2,
  a: Vec2,
  c1: Vec2,
  c2: Vec2,
  b: Vec2,
  samples = 12,
): number {
  let min = Infinity;
  let prev = a;
  for (let i = 1; i <= samples; i += 1) {
    const next = cubicBezierPoint(a, c1, c2, b, i / samples);
    min = Math.min(min, distPointToSegmentSq(p, prev, next));
    prev = next;
  }
  return min;
}

/** Squared distance from point to segment AB. */
export function distPointToSegmentSq(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) {
    const ox = p.x - a.x;
    const oy = p.y - a.y;
    return ox * ox + oy * oy;
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx - p.x;
  const py = a.y + t * dy - p.y;
  return px * px + py * py;
}

/** Anchor on rectangle border in direction of target. */
export function rectBorderPoint(rect: Rect, toward: Vec2): Vec2 {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return { x: cx, y: rect.y };
  }
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}
