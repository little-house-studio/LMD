/** Shared geometry — used by layout and canvas. Not canvas-specific. */

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

export function insetRect(r: Rect, dx: number, dy = dx): Rect | null {
  const width = r.width - dx * 2;
  const height = r.height - dy * 2;
  if (width <= 1 || height <= 1) {
    return null;
  }
  return { x: r.x + dx, y: r.y + dy, width, height };
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
