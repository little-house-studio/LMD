import { handleRects } from '../../../infrastructure/layout';
import { isCanvasIdSelected } from '../../../domain/selection';
import { SCREEN_EDGE_FONT, SCREEN_GROUP_PX } from './theme';
import { strokeRoundRect } from './shapes';
import type { SceneContext } from './context';
import { screenPx } from './context';
import { paintBoxSelect } from './overlay';

export function paintFrameBodies(ctx: CanvasRenderingContext2D, scene: SceneContext, interactive: boolean) {
  if (scene.lockPositions) {
    return;
  }
  if (interactive && scene.drag.type === 'frame-draw') {
    paintBoxSelect(ctx, scene, scene.drag.startWorld, scene.drag.currentWorld);
  }
  for (const frame of scene.frames) {
    const selected = isCanvasIdSelected(scene.selection, 'frame', frame.id);
    ctx.save();
    ctx.beginPath();
    strokeRoundRect(ctx, frame.x, frame.y, frame.width, frame.height, 2);
    ctx.fillStyle = selected ? 'rgba(80, 210, 220, 0.1)' : 'rgba(80, 180, 200, 0.06)';
    ctx.fill();
    ctx.setLineDash([screenPx(scene, 6), screenPx(scene, 4)]);
    ctx.strokeStyle = selected ? '#7cf0f6' : 'rgba(120, 210, 220, 0.55)';
    ctx.lineWidth = screenPx(scene, selected ? 1.75 : 1.25);
    ctx.stroke();
    ctx.restore();
  }
}

export function paintFrameOverlays(ctx: CanvasRenderingContext2D, scene: SceneContext, interactive: boolean) {
  if (scene.lockPositions) {
    return;
  }
  const scale = Math.max(scene.camera.scale, 0.001);
  for (const frame of scene.frames) {
    const selected = isCanvasIdSelected(scene.selection, 'frame', frame.id);
    const viewW = frame.width * scale;
    ctx.save();
    const headerH = Math.min(frame.height, 20 / scale);
    ctx.fillStyle = selected ? 'rgba(40, 90, 96, 0.55)' : 'rgba(20, 40, 46, 0.45)';
    ctx.fillRect(frame.x, frame.y, frame.width, headerH);
    if (scene.metrics.showsNames && viewW >= 40) {
      ctx.fillStyle = selected ? '#d9fbff' : '#9ad4dc';
      ctx.font = `700 ${screenPx(scene, SCREEN_GROUP_PX)}px ${SCREEN_EDGE_FONT}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(
        scene.inlineSession?.kind === 'frame' && scene.inlineSession.id === frame.id
          ? `${frame.nodeIds.length}`
          : `${frame.title} · ${frame.nodeIds.length}`,
        frame.x + screenPx(scene, 8),
        frame.y + headerH / 2,
        Math.max(0, frame.width - screenPx(scene, 16)),
      );
    }
    if (interactive && selected) {
      for (const handle of handleRects(frame, scene.camera.scale)) {
        ctx.fillStyle = '#081014';
        ctx.strokeStyle = '#7cf0f6';
        ctx.lineWidth = screenPx(scene, 1.25);
        ctx.fillRect(handle.rect.x, handle.rect.y, handle.rect.width, handle.rect.height);
        ctx.strokeRect(handle.rect.x, handle.rect.y, handle.rect.width, handle.rect.height);
      }
    }
    ctx.restore();
  }
}
