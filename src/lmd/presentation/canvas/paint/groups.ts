import type { GraphSubgraph } from '../../..';
import { isCanvasIdSelected } from '../../../domain/selection';
import { subgraphDepth } from '../../../placement';
import { groupChrome } from '../groupChrome';
import { groupTitleLabel, groupTitleWorldChip } from '../labelChips';
import { createRoundRectPath } from '../shapePath';
import type { Rect } from '../math';
import { isGroupHidden } from '../visibility';
import type { SceneContext } from './context';
import { screenPx } from './context';
import { SCREEN_EDGE_FONT, SCREEN_GROUP_PX } from './theme';

export function collectGroupTitleObstacles(scene: SceneContext): Rect[] {
  if (!scene.metrics.showsNames) {
    return [];
  }
  const measure = (text: string, font: string) => scene.cache.measureScreenWidth(scene.ctx, text, font);
  const avoid: Rect[] = [];
  for (const subgraph of scene.doc.subgraphs) {
    if (isGroupHidden(subgraph, scene.subgraphMap, scene.camera.scale, scene.nestDepth)) {
      continue;
    }
    const rect = scene.groupRectCache.get(subgraph.id);
    if (!rect) {
      continue;
    }
    const view = scene.camera.worldRectToView(rect);
    if (view.width < 36 || view.height < 22) {
      continue;
    }
    avoid.push(groupTitleWorldChip(
      scene.camera,
      rect,
      groupTitleLabel(Boolean(subgraph.collapsed), subgraph.title),
      measure,
    ));
  }
  return avoid;
}

export function paintGroup(ctx: CanvasRenderingContext2D, scene: SceneContext, sg: GraphSubgraph, rect: Rect) {
  const selected = isCanvasIdSelected(scene.selection, 'group', sg.id);
  const chrome = groupChrome(subgraphDepth(sg.id, scene.subgraphMap), selected, sg);
  const path = createRoundRectPath(
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    Math.max(screenPx(scene, 4), chrome.radius),
  );
  ctx.fillStyle = chrome.fill;
  ctx.fill(path);
  if (scene.metrics.showsGroupsOnly) {
    ctx.fillStyle = 'rgba(6, 12, 14, 0.28)';
    ctx.fill(path);
  }
  ctx.strokeStyle = chrome.stroke;
  ctx.lineWidth = screenPx(
    scene,
    selected ? 2 : scene.metrics.showsGroupsOnly ? chrome.lineWidth + 0.6 : chrome.lineWidth,
  );
  ctx.stroke(path);
}

export function paintGroupTitle(ctx: CanvasRenderingContext2D, scene: SceneContext, sg: GraphSubgraph, rect: Rect) {
  const scale = Math.max(scene.camera.scale, 0.001);
  if (rect.width * scale < 28 || rect.height * scale < 18) {
    return;
  }
  const selected = isCanvasIdSelected(scene.selection, 'group', sg.id);
  const chrome = groupChrome(subgraphDepth(sg.id, scene.subgraphMap), selected, sg);
  const title = scene.inlineSession?.kind === 'group' && scene.inlineSession.id === sg.id
    ? `${sg.collapsed ? '▸' : '▾'}`
    : groupTitleLabel(Boolean(sg.collapsed), sg.title);
  const chip = groupTitleWorldChip(
    scene.camera,
    rect,
    title,
    (text, font) => scene.cache.measureScreenWidth(scene.ctx, text, font),
  );
  const path = createRoundRectPath(chip.x, chip.y, chip.width, chip.height, Math.min(screenPx(scene, 6), chip.height / 2));
  ctx.fillStyle = 'rgba(6, 10, 12, 0.72)';
  ctx.fill(path);
  ctx.font = `700 ${screenPx(scene, SCREEN_GROUP_PX)}px ${SCREEN_EDGE_FONT}`;
  ctx.fillStyle = chrome.text;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(title, chip.x + screenPx(scene, 7), chip.y + chip.height / 2, Math.max(0, chip.width - screenPx(scene, 10)));
}
