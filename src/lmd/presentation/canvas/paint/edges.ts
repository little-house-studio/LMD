import type { GraphEdge } from '../../..';
import { DEFAULT_EDGE_STYLE } from '../../../domain/style';
import { isCanvasIdSelected } from '../../../domain/selection';
import { screenArrowSize, screenStrokeWidth } from '../../../infrastructure/hotpath/paintOpt';
import { arrowHeading, type EdgeGeometry } from '../../../placement';
import { createEdgePath, createRoundRectPath } from '../shapePath';
import { edgeLabelChipSize, visibleEdgeLabel } from '../labelChips';
import { collectGroupTitleObstacles } from './groups';
import type { SceneContext } from './context';
import { screenPx } from './context';
import { SCREEN_EDGE_FONT, SCREEN_EDGE_PX, SELECT_STROKE } from './theme';

export function paintEdge(
  ctx: CanvasRenderingContext2D,
  scene: SceneContext,
  edge: GraphEdge,
  geometry: EdgeGeometry,
) {
  const selected = isCanvasIdSelected(scene.selection, 'edge', edge.id);
  const stroke = edge.strokeColor || DEFAULT_EDGE_STYLE.strokeColor;
  const width = screenPx(
    scene,
    screenStrokeWidth(edge.strokeWidth || DEFAULT_EDGE_STYLE.strokeWidth, scene.camera.scale),
  );

  const path = scene.cache.edgePaths.get(edge.id) ?? createEdgePath(geometry);
  ctx.save();
  ctx.strokeStyle = selected ? SELECT_STROKE : stroke;
  ctx.lineWidth = selected ? width + screenPx(scene, 1) : width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (edge.type === 'dotted') {
    ctx.setLineDash([screenPx(scene, 6), screenPx(scene, 5)]);
  } else if (edge.type === 'thick') {
    ctx.lineWidth = width + screenPx(scene, 1.5);
  }
  ctx.stroke(path);
  ctx.setLineDash([]);

  if (edge.type !== 'line') {
    const angle = arrowHeading({
      c2: geometry.c2,
      end: geometry.end,
    });
    const ah = screenPx(scene, screenArrowSize(10, scene.camera.scale));
    ctx.fillStyle = selected ? SELECT_STROKE : stroke;
    ctx.beginPath();
    ctx.moveTo(geometry.end.x, geometry.end.y);
    ctx.lineTo(
      geometry.end.x - ah * Math.cos(angle - 0.35),
      geometry.end.y - ah * Math.sin(angle - 0.35),
    );
    ctx.lineTo(
      geometry.end.x - ah * Math.cos(angle + 0.35),
      geometry.end.y - ah * Math.sin(angle + 0.35),
    );
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function paintEdgeLabel(
  ctx: CanvasRenderingContext2D,
  scene: SceneContext,
  edge: GraphEdge,
  geometry: EdgeGeometry,
) {
  if (scene.inlineSession?.kind === 'edge' && scene.inlineSession.id === edge.id) {
    return;
  }
  const text = edge.label.trim();
  if (!text || geometry.labelSize.width <= 0) {
    return;
  }
  const world = visibleEdgeLabel(geometry, text, {
    camera: scene.camera,
    cssW: scene.cssW,
    cssH: scene.cssH,
    showsDetails: scene.metrics.showsDetails,
    measure: (value, font) => scene.cache.measureScreenWidth(scene.ctx, value, font),
    avoid: scene.cache.paintLabelAvoid ?? collectGroupTitleObstacles(scene),
  });
  if (!world) {
    return;
  }
  const selected = isCanvasIdSelected(scene.selection, 'edge', edge.id);
  const chip = edgeLabelChipSize(text, (value, font) => scene.cache.measureScreenWidth(scene.ctx, value, font));
  const width = screenPx(scene, chip.width);
  const height = screenPx(scene, chip.height);
  const x = world.x - width / 2;
  const y = world.y - height / 2;
  const path = createRoundRectPath(x, y, width, height, screenPx(scene, 4));

  ctx.fillStyle = selected ? '#2a2e14' : '#3f3f46';
  ctx.strokeStyle = selected ? SELECT_STROKE : 'rgba(255,255,255,0.22)';
  ctx.lineWidth = screenPx(scene, 1);
  ctx.fill(path);
  ctx.stroke(path);
  ctx.font = `600 ${screenPx(scene, SCREEN_EDGE_PX)}px ${SCREEN_EDGE_FONT}`;
  ctx.fillStyle = selected ? '#eaff8a' : '#f4f4f5';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, world.x, world.y + screenPx(scene, 0.5));
}
