import type { Rect, Vec2 } from './math';

/**
 * Project-Graph style camera: world ↔ view transforms.
 * location = world point under the center of the canvas (PG convention simplified:
 * we store pan offset in view space as `offset` so zoom-to-cursor is easy).
 */
export class Camera {
  /** View-space translation after scale (screen px). */
  offsetX = 0;
  offsetY = 0;
  /** World scale. */
  scale = 1;

  minScale = 0.05;
  maxScale = 8;

  worldToView(p: Vec2): Vec2 {
    return {
      x: p.x * this.scale + this.offsetX,
      y: p.y * this.scale + this.offsetY,
    };
  }

  viewToWorld(p: Vec2): Vec2 {
    return {
      x: (p.x - this.offsetX) / this.scale,
      y: (p.y - this.offsetY) / this.scale,
    };
  }

  worldRectToView(r: Rect): Rect {
    return {
      x: r.x * this.scale + this.offsetX,
      y: r.y * this.scale + this.offsetY,
      width: r.width * this.scale,
      height: r.height * this.scale,
    };
  }

  viewRectToWorld(r: Rect): Rect {
    const scale = this.scale || 1;
    return {
      x: (r.x - this.offsetX) / scale,
      y: (r.y - this.offsetY) / scale,
      width: r.width / scale,
      height: r.height / scale,
    };
  }

  /** Visible world rectangle for a canvas of size (w,h) in CSS pixels. */
  getCoverWorldRectangle(w: number, h: number): Rect {
    const topLeft = this.viewToWorld({ x: 0, y: 0 });
    const bottomRight = this.viewToWorld({ x: w, y: h });
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }

  panByViewDelta(dx: number, dy: number) {
    this.offsetX += dx;
    this.offsetY += dy;
  }

  /** Zoom around a view-space anchor (usually mouse). */
  zoomAt(viewAnchor: Vec2, factor: number) {
    const before = this.viewToWorld(viewAnchor);
    const next = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    if (next === this.scale) {
      return;
    }
    this.scale = next;
    const after = this.viewToWorld(viewAnchor);
    this.offsetX += (after.x - before.x) * this.scale;
    this.offsetY += (after.y - before.y) * this.scale;
  }

  fitWorldRect(world: Rect, viewW: number, viewH: number, padding = 0.12) {
    if (world.width <= 0 || world.height <= 0 || viewW <= 0 || viewH <= 0) {
      return;
    }
    const padX = viewW * padding;
    const padY = viewH * padding;
    const sx = (viewW - padX * 2) / world.width;
    const sy = (viewH - padY * 2) / world.height;
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, Math.min(sx, sy)));
    const cx = world.x + world.width / 2;
    const cy = world.y + world.height / 2;
    this.offsetX = viewW / 2 - cx * this.scale;
    this.offsetY = viewH / 2 - cy * this.scale;
  }

  toViewportState() {
    return { x: this.offsetX, y: this.offsetY, zoom: this.scale };
  }

  fromViewportState(vp: { x: number; y: number; zoom: number }) {
    this.offsetX = vp.x || 0;
    this.offsetY = vp.y || 0;
    this.scale = vp.zoom > 0 ? vp.zoom : 1;
  }

  /** CSS-pixel space (grid, screen-constant text). */
  applyViewTransform(ctx: CanvasRenderingContext2D, dpr: number) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * World space: one matrix for the whole scene.
   * `x_css = x_world * scale + offsetX`
   */
  applyWorldTransform(ctx: CanvasRenderingContext2D, dpr: number) {
    ctx.setTransform(
      dpr * this.scale,
      0,
      0,
      dpr * this.scale,
      dpr * this.offsetX,
      dpr * this.offsetY,
    );
  }

  /** Convert a screen-pixel length to world units at the current zoom. */
  worldUnitsFromScreen(px: number) {
    return px / Math.max(this.scale, 0.001);
  }
}
