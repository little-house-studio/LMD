/**
 * Cached Path2D builders (Project Graph Hybrid style).
 * Geometry is world-space; the engine strokes them under the camera matrix.
 */
import type { GraphNode } from '../..';
import type { EdgeGeometry } from '../../placement';

export function createRoundRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): Path2D {
  const path = new Path2D();
  const rr = Math.min(r, w / 2, h / 2);
  path.moveTo(x + rr, y);
  path.arcTo(x + w, y, x + w, y + h, rr);
  path.arcTo(x + w, y + h, x, y + h, rr);
  path.arcTo(x, y + h, x, y, rr);
  path.arcTo(x, y, x + w, y, rr);
  path.closePath();
  return path;
}

export function createNodePath(
  shape: GraphNode['shape'],
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): Path2D {
  const path = new Path2D();
  switch (shape) {
    case 'diamond': {
      path.moveTo(x + w / 2, y);
      path.lineTo(x + w, y + h / 2);
      path.lineTo(x + w / 2, y + h);
      path.lineTo(x, y + h / 2);
      path.closePath();
      return path;
    }
    case 'circle': {
      path.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      return path;
    }
    case 'hexagon': {
      const inset = w * 0.15;
      path.moveTo(x + inset, y);
      path.lineTo(x + w - inset, y);
      path.lineTo(x + w, y + h / 2);
      path.lineTo(x + w - inset, y + h);
      path.lineTo(x + inset, y + h);
      path.lineTo(x, y + h / 2);
      path.closePath();
      return path;
    }
    case 'database': {
      const ry = Math.min(h * 0.18, r * 1.75);
      path.moveTo(x, y + ry);
      path.ellipse(x + w / 2, y + ry, w / 2, ry, 0, Math.PI, 0, false);
      path.lineTo(x + w, y + h - ry);
      path.ellipse(x + w / 2, y + h - ry, w / 2, ry, 0, 0, Math.PI, false);
      path.closePath();
      return path;
    }
    default:
      return createRoundRectPath(x, y, w, h, r);
  }
}

export function createEdgePath(geometry: Pick<EdgeGeometry, 'start' | 'c1' | 'c2' | 'end'>): Path2D {
  const path = new Path2D();
  path.moveTo(geometry.start.x, geometry.start.y);
  path.bezierCurveTo(
    geometry.c1.x,
    geometry.c1.y,
    geometry.c2.x,
    geometry.c2.y,
    geometry.end.x,
    geometry.end.y,
  );
  return path;
}
