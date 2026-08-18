import { expandCoverForCull } from '../../../infrastructure/hotpath/paintOpt';
import { hotPathCounters } from '../../../infrastructure/hotpath/sceneHotPath';
import { subgraphDepth, edgeBounds } from '../../../placement';
import { expandRect, rectIntersects, type Rect } from '../math';
import { hidesSceneEdge, isGroupHidden } from '../visibility';
import { paintMindBlocks, paintSequenceBlocks, paintSequenceConnect } from './blocks';
import type { SceneContext } from './context';
import { paintInteractiveOverlay } from './connect';
import { paintEdge, paintEdgeLabel } from './edges';
import { paintFrameBodies, paintFrameOverlays } from './frames';
import { collectGroupTitleObstacles, paintGroup, paintGroupTitle } from './groups';
import { paintGrid } from './grid';
import { paintNodeBody, paintNodeLabel } from './nodes';
import { SCENE_BG } from './theme';

function isOverView(view: Rect, r: Rect) {
  return !rectIntersects(view, r);
}

export type ScenePaintStats = {
  nodes: number;
  edges: number;
  groups: number;
  culled: number;
};

export function paintScene(ctx: CanvasRenderingContext2D, scene: SceneContext, interactive: boolean): ScenePaintStats {
  const view = scene.camera.getCoverWorldRectangle(scene.cssW, scene.cssH);
  const cullView = expandCoverForCull(view, scene.camera.scale);

  scene.camera.applyViewTransform(ctx, scene.dpr);
  ctx.fillStyle = SCENE_BG;
  ctx.fillRect(0, 0, scene.cssW, scene.cssH);
  if (interactive) {
    paintGrid(ctx, scene);
  }

  const visibleNodes = [];
  for (const id of scene.queryVisibleNodeIds(cullView)) {
    const node = scene.nodeMap.get(id);
    if (node) {
      visibleNodes.push(node);
    }
  }

  const groupsByDepth = scene.groupsPaintOrder.length > 0
    ? scene.groupsPaintOrder
    : [...scene.doc.subgraphs].sort(
      (left, right) => subgraphDepth(left.id, scene.subgraphMap) - subgraphDepth(right.id, scene.subgraphMap),
    );
  const visibleGroups: Array<{ sg: (typeof scene.doc.subgraphs)[number]; rect: Rect }> = [];
  let culled = 0;
  for (const sg of groupsByDepth) {
    if (isGroupHidden(sg, scene.subgraphMap, scene.camera.scale, scene.nestDepth)) {
      continue;
    }
    const rect = scene.groupRectCache.get(sg.id);
    if (!rect) {
      continue;
    }
    if (isOverView(cullView, rect)) {
      culled += 1;
      continue;
    }
    visibleGroups.push({ sg, rect });
  }

  const visibleEdges = [];
  const selectedIds = scene.selection.kind === 'edge' ? new Set(scene.selection.ids) : null;
  for (const edge of scene.doc.edges) {
    if (hidesSceneEdge(edge, scene.nodeMap, scene.metrics.showsGroupsOnly)) {
      continue;
    }
    const geometry = scene.edgeRoutes.get(edge.id) ?? null;
    if (!geometry) {
      continue;
    }
    const bound = edgeBounds(geometry);
    if (isOverView(cullView, expandRect(bound, 28))) {
      culled += 1;
      continue;
    }
    visibleEdges.push({ edge, geometry });
  }
  const ordered = selectedIds
    ? [
        ...visibleEdges.filter((item) => !selectedIds.has(item.edge.id)),
        ...visibleEdges.filter((item) => selectedIds.has(item.edge.id)),
      ]
    : visibleEdges;

  scene.camera.applyWorldTransform(ctx, scene.dpr);
  paintFrameBodies(ctx, scene, interactive);
  for (const item of visibleGroups) {
    paintGroup(ctx, scene, item.sg, item.rect);
  }
  for (const item of ordered) {
    paintEdge(ctx, scene, item.edge, item.geometry);
  }
  for (const node of visibleNodes) {
    paintNodeBody(ctx, scene, node);
    paintNodeLabel(ctx, scene, node);
  }
  scene.cache.paintLabelAvoid = scene.metrics.showsDetails ? collectGroupTitleObstacles(scene) : null;
  if (scene.metrics.showsDetails) {
    for (const item of ordered) {
      paintEdgeLabel(ctx, scene, item.edge, item.geometry);
    }
  }
  for (const item of visibleGroups) {
    paintGroupTitle(ctx, scene, item.sg, item.rect);
  }
  paintSequenceBlocks(ctx, scene, cullView, interactive);
  paintMindBlocks(ctx, scene, cullView, interactive);
  paintSequenceConnect(ctx, scene);
  paintFrameOverlays(ctx, scene, interactive);
  scene.cache.paintLabelAvoid = null;

  return {
    nodes: visibleNodes.length,
    edges: ordered.length,
    groups: visibleGroups.length,
    culled,
  };
}

export function paintCanvasFrame(ctx: CanvasRenderingContext2D, scene: SceneContext, canvas: HTMLCanvasElement) {
  const paintStart = performance.now();
  if (scene.cssW < 1 || scene.cssH < 1) {
    return { nodes: 0, edges: 0, groups: 0, culled: 0, paintMs: 0 };
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = SCENE_BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const drawn = paintScene(ctx, scene, true);
  paintInteractiveOverlay(ctx, scene);
  ctx.restore();
  hotPathCounters.incrementalPaint += 1;
  return { ...drawn, paintMs: performance.now() - paintStart };
}
