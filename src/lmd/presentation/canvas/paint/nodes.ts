import type { GraphNode } from '../../..';
import { DEFAULT_NODE_STYLE } from '../../../domain/style';
import { isCanvasIdSelected } from '../../../domain/selection';
import { fillCenteredLine } from '../../../infrastructure/hotpath/canvasEngine';
import { createNodePath } from '../shapePath';
import type { Rect } from '../math';
import type { SceneContext } from './context';
import { screenPx } from './context';
import { NAME_MIN_VIEW, NODE_RADIUS, SCREEN_DESC_PX, SCREEN_DESC_LINE, SCREEN_TITLE_FONT, SCREEN_TITLE_LINE, SCREEN_TITLE_PX, SELECT_STROKE } from './theme';

function drawWrappedBlock(
  ctx: CanvasRenderingContext2D,
  scene: SceneContext,
  lines: string[],
  band: Rect,
  font: string,
  color: string,
  linePx: number,
) {
  if (lines.length === 0 || band.width <= 0 || band.height <= 0) {
    return;
  }
  const cx = band.x + band.width / 2;
  const blockH = lines.length * linePx;
  let y = band.y + (band.height - blockH) / 2 + linePx / 2;
  const maxWidth = Math.max(0, band.width - screenPx(scene, 8));
  ctx.save();
  for (const line of lines) {
    fillCenteredLine(ctx, line, cx, y, font, color, maxWidth);
    y += linePx;
  }
  ctx.restore();
}

export function paintNodeBody(ctx: CanvasRenderingContext2D, scene: SceneContext, node: GraphNode) {
  const selected = isCanvasIdSelected(scene.selection, 'node', node.id);
  const fill = node.fill || DEFAULT_NODE_STYLE.fill;
  const stroke = node.stroke || DEFAULT_NODE_STYLE.stroke;
  const path = scene.cache.nodePaths.get(node.id)
    ?? createNodePath(node.shape, node.x, node.y, node.width, node.height, NODE_RADIUS);
  ctx.fillStyle = fill;
  ctx.strokeStyle = selected ? SELECT_STROKE : stroke;
  ctx.lineWidth = screenPx(scene, selected ? 2.25 : 1.5);
  ctx.fill(path);
  ctx.stroke(path);
  if (scene.metrics.showsDetails) {
    const bands = scene.cache.nodeBands(node);
    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = stroke;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(bands.title.x, bands.title.y, bands.title.width, bands.title.height);
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = screenPx(scene, 1);
    ctx.beginPath();
    ctx.moveTo(bands.title.x, bands.title.y + bands.title.height);
    ctx.lineTo(bands.title.x + bands.title.width, bands.title.y + bands.title.height);
    ctx.stroke();
    ctx.restore();
  }
}

export function paintNodeLabel(ctx: CanvasRenderingContext2D, scene: SceneContext, node: GraphNode) {
  const scale = Math.max(scene.camera.scale, 0.001);
  if (Math.min(node.width, node.height) * scale < NAME_MIN_VIEW) {
    return;
  }
  if (scene.inlineSession?.kind === 'node' && scene.inlineSession.id === node.id) {
    return;
  }
  const bands = scene.cache.nodeBands(node);
  const details = scene.metrics.showsDetails;
  const titleBand = details ? bands.title : {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  };
  const titleView = {
    x: 0,
    y: 0,
    width: titleBand.width * scale,
    height: titleBand.height * scale,
  };
  const textColor = node.textColor || DEFAULT_NODE_STYLE.textColor;
  const path = scene.cache.nodePaths.get(node.id)
    ?? createNodePath(node.shape, node.x, node.y, node.width, node.height, NODE_RADIUS);
  ctx.save();
  ctx.clip(path);
  const titleLines = bands.titleLines.length > 0 ? bands.titleLines : [bands.parts.title || node.id];
  const titleFit = scene.cache.fitNodeText(node.id, 't', titleLines, titleView, SCREEN_TITLE_PX, SCREEN_TITLE_LINE, scene.metrics.lod);
  drawWrappedBlock(
    ctx,
    scene,
    titleLines,
    titleBand,
    `800 ${screenPx(scene, titleFit.fontPx)}px ${SCREEN_TITLE_FONT}`,
    textColor,
    screenPx(scene, titleFit.linePx),
  );
  if (details) {
    const descView = {
      x: 0,
      y: 0,
      width: bands.description.width * scale,
      height: bands.description.height * scale,
    };
    const emptyDesc = !bands.parts.description;
    const descLines = emptyDesc ? ['（空）'] : bands.descriptionLines;
    const descFit = scene.cache.fitNodeText(node.id, 'd', descLines, descView, SCREEN_DESC_PX, SCREEN_DESC_LINE, scene.metrics.lod);
    ctx.save();
    if (emptyDesc) {
      ctx.globalAlpha = 0.42;
    }
    drawWrappedBlock(
      ctx,
      scene,
      descLines,
      bands.description,
      `${emptyDesc ? 400 : 500} ${screenPx(scene, descFit.fontPx)}px ${SCREEN_TITLE_FONT}`,
      textColor,
      screenPx(scene, descFit.linePx),
    );
    ctx.restore();
  }
  ctx.restore();
}
