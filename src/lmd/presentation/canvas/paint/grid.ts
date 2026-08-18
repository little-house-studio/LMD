import type { SceneContext } from './context';

export function paintGrid(ctx: CanvasRenderingContext2D, scene: SceneContext) {
  if (!scene.policy.snap.enabled) {
    return;
  }
  const minor = scene.policy.snap.size * scene.camera.scale;
  const major = scene.policy.snap.major * scene.camera.scale;
  ctx.save();
  if (minor >= 10) {
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    const ox = scene.camera.offsetX % minor;
    const oy = scene.camera.offsetY % minor;
    ctx.beginPath();
    for (let x = ox; x < scene.cssW; x += minor) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, scene.cssH);
    }
    for (let y = oy; y < scene.cssH; y += minor) {
      ctx.moveTo(0, y);
      ctx.lineTo(scene.cssW, y);
    }
    ctx.stroke();
  }
  if (major >= 12) {
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    const ox = scene.camera.offsetX % major;
    const oy = scene.camera.offsetY % major;
    for (let x = ox; x < scene.cssW; x += major) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, scene.cssH);
    }
    for (let y = oy; y < scene.cssH; y += major) {
      ctx.moveTo(0, y);
      ctx.lineTo(scene.cssW, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
