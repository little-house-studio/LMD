import { partsOf } from '../../../domain/selection';
import { arrowHeading, buildConnectPreview, buildEdgeGeometry, type EndpointBox } from '../../../placement';
import { connectBoxes, endpointPorts, snapSceneConnect } from '../endpoints';
import { createNodePath } from '../shapePath';
import type { Vec2 } from '../math';
import { isNodeHidden } from '../visibility';
import type { SceneContext } from './context';
import { screenPx } from './context';
import { paintBoxSelect } from './overlay';
import { NODE_RADIUS, SELECT_STROKE } from './theme';

export function paintEndpointHandles(ctx: CanvasRenderingContext2D, scene: SceneContext, box: EndpointBox) {
  if (scene.camera.scale < 0.35) {
    return;
  }
  const ports = endpointPorts(box);
  const radius = screenPx(scene, 5);
  ctx.save();
  ctx.fillStyle = '#0a0a0c';
  ctx.strokeStyle = SELECT_STROKE;
  ctx.lineWidth = screenPx(scene, 1.5);
  for (const port of ports) {
    ctx.beginPath();
    ctx.arc(port.x, port.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export function paintConnectPreview(
  ctx: CanvasRenderingContext2D,
  scene: SceneContext,
  from: EndpointBox,
  cursor: Vec2,
) {
  const boxes = connectBoxes({
    nodes: scene.doc.nodes,
    seqFrames: scene.seqFrames,
    mindFrames: scene.mindFrames,
    isNodeHidden: (node) => isNodeHidden(node, scene.subgraphMap, scene.metrics.showsGroupsOnly),
  });
  const snap = snapSceneConnect(from, cursor, boxes, scene.camera.scale);
  const preview = snap ? buildEdgeGeometry(from, snap.box) : buildConnectPreview(from, cursor);
  ctx.save();
  ctx.strokeStyle = SELECT_STROKE;
  ctx.lineWidth = screenPx(scene, snap ? 2 : 1.5);
  ctx.setLineDash(snap ? [] : [screenPx(scene, 6), screenPx(scene, 4)]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(preview.start.x, preview.start.y);
  ctx.bezierCurveTo(
    preview.c1.x,
    preview.c1.y,
    preview.c2.x,
    preview.c2.y,
    preview.end.x,
    preview.end.y,
  );
  ctx.stroke();
  ctx.setLineDash([]);
  if (snap) {
    const angle = arrowHeading({ c2: preview.c2, end: preview.end });
    const ah = screenPx(scene, 10);
    ctx.fillStyle = SELECT_STROKE;
    ctx.beginPath();
    ctx.moveTo(preview.end.x, preview.end.y);
    ctx.lineTo(
      preview.end.x - ah * Math.cos(angle - 0.35),
      preview.end.y - ah * Math.sin(angle - 0.35),
    );
    ctx.lineTo(
      preview.end.x - ah * Math.cos(angle + 0.35),
      preview.end.y - ah * Math.sin(angle + 0.35),
    );
    ctx.closePath();
    ctx.fill();
    const target = scene.nodeMap.get(snap.id);
    const box = target ?? snap.box;
    ctx.lineWidth = screenPx(scene, 2.25);
    if (target) {
      ctx.stroke(createNodePath(target.shape, target.x, target.y, target.width, target.height, NODE_RADIUS));
    } else {
      ctx.strokeRect(box.x, box.y, box.width, box.height);
    }
    for (const port of endpointPorts(box)) {
      const hot = Math.hypot(port.x - snap.point.x, port.y - snap.point.y) < 2;
      ctx.fillStyle = '#0a0a0c';
      ctx.beginPath();
      ctx.arc(port.x, port.y, screenPx(scene, hot ? 6 : 4), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function paintInteractiveOverlay(ctx: CanvasRenderingContext2D, scene: SceneContext) {
  if (scene.drag.type === 'connect') {
    const from = scene.endpointBox(scene.drag.fromId);
    if (from) {
      scene.camera.applyWorldTransform(ctx, scene.dpr);
      paintConnectPreview(ctx, scene, from, scene.drag.currentWorld);
      scene.camera.applyViewTransform(ctx, scene.dpr);
    }
  }
  if (scene.drag.type === 'box' || scene.drag.type === 'seq-box' || scene.drag.type === 'frame-draw') {
    scene.camera.applyWorldTransform(ctx, scene.dpr);
    paintBoxSelect(ctx, scene, scene.drag.startWorld, scene.drag.currentWorld);
    scene.camera.applyViewTransform(ctx, scene.dpr);
  }
  if (scene.camera.scale >= 0.35) {
    const handleIds = [
      ...partsOf(scene.selection).nodes,
      ...partsOf(scene.selection).sequences,
      ...partsOf(scene.selection).minds,
    ];
    if (handleIds.length > 0) {
      scene.camera.applyWorldTransform(ctx, scene.dpr);
      for (const id of handleIds) {
        const node = scene.nodeMap.get(id);
        if (node && isNodeHidden(node, scene.subgraphMap, scene.metrics.showsGroupsOnly)) {
          continue;
        }
        const box = scene.endpointBox(id);
        if (box) {
          paintEndpointHandles(ctx, scene, box);
        }
      }
      scene.camera.applyViewTransform(ctx, scene.dpr);
    }
  }
}
