import type { Vec2 } from '../math';
import type { SceneContext } from './context';
import { screenPx } from './context';
import { SELECT_STROKE } from './theme';

export function paintBoxSelect(ctx: CanvasRenderingContext2D, scene: SceneContext, a: Vec2, b: Vec2) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  ctx.save();
  ctx.fillStyle = 'rgba(214,255,58,0.08)';
  ctx.strokeStyle = SELECT_STROKE;
  ctx.lineWidth = screenPx(scene, 1);
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}
