import type { GraphNode } from '../../..';
import type { StageSelection } from '../../../domain/selection';
import { hitFrameBody, hitFrameResize } from '../../../infrastructure/layout';
import {
  distPointToEdgeSq,
  hitMindFrame,
  hitMindInterior,
  hitSequenceFrame,
  hitSequenceInterior,
} from '../../../placement';
import { edgeLabelWorldChip, groupTitleLabel, groupTitleWorldChip, visibleEdgeLabel } from '../labelChips';
import { pointInRect, type Vec2 } from '../math';
import type { SceneContext } from '../paint/context';
import { collectGroupTitleObstacles } from '../paint/groups';
import { hidesSceneEdge, isGroupHidden, isNodeHidden } from '../visibility';
import type { SceneSpatialIndex } from '../../../infrastructure/hotpath/canvasEngine';

export type HitContext = SceneContext & {
  draggingIds: ReadonlySet<string>;
  nodeIndex: SceneSpatialIndex<GraphNode>;
};

export function hitGroupTitleAt(scene: SceneContext, world: Vec2): string | null {
  const measure = (text: string, font: string) => scene.cache.measureScreenWidth(scene.ctx, text, font);
  for (let i = scene.doc.subgraphs.length - 1; i >= 0; i -= 1) {
    const subgraph = scene.doc.subgraphs[i];
    if (isGroupHidden(subgraph, scene.subgraphMap, scene.camera.scale, scene.nestDepth)) {
      continue;
    }
    const rect = scene.groupRectCache.get(subgraph.id);
    if (!rect) {
      continue;
    }
    const view = scene.camera.worldRectToView(rect);
    if (view.width < 28 || view.height < 18) {
      continue;
    }
    const chip = groupTitleWorldChip(
      scene.camera,
      rect,
      groupTitleLabel(Boolean(subgraph.collapsed), subgraph.title),
      measure,
    );
    if (pointInRect(world, chip)) {
      return subgraph.id;
    }
  }
  return null;
}

export function hitGroupAt(scene: SceneContext, world: Vec2, excludeIds?: ReadonlySet<string>): string | null {
  for (let i = scene.doc.subgraphs.length - 1; i >= 0; i -= 1) {
    const subgraph = scene.doc.subgraphs[i];
    if (excludeIds?.has(subgraph.id)) {
      continue;
    }
    if (isGroupHidden(subgraph, scene.subgraphMap, scene.camera.scale, scene.nestDepth)) {
      continue;
    }
    const rect = scene.groupRectCache.get(subgraph.id);
    if (rect && pointInRect(world, rect)) {
      return subgraph.id;
    }
  }
  return null;
}

export function hitEdgeAt(scene: SceneContext, world: Vec2, ignoreEndpointIds?: ReadonlySet<string>): string | null {
  const threshold = (8 / Math.max(scene.camera.scale, 0.001)) ** 2;
  const measure = (text: string, font: string) => scene.cache.measureScreenWidth(scene.ctx, text, font);
  for (let i = scene.doc.edges.length - 1; i >= 0; i -= 1) {
    const edge = scene.doc.edges[i];
    if (hidesSceneEdge(edge, scene.nodeMap, scene.metrics.showsGroupsOnly)) {
      continue;
    }
    if (ignoreEndpointIds && (ignoreEndpointIds.has(edge.from) || ignoreEndpointIds.has(edge.to))) {
      continue;
    }
    const geometry = scene.edgeRoutes.get(edge.id);
    if (!geometry) {
      continue;
    }
    const label = edge.label.trim();
    const center = label
      ? visibleEdgeLabel(geometry, label, {
          camera: scene.camera,
          cssW: scene.cssW,
          cssH: scene.cssH,
          showsDetails: scene.metrics.showsDetails,
          measure,
          avoid: scene.cache.paintLabelAvoid ?? collectGroupTitleObstacles(scene),
        })
      : null;
    const chip = scene.metrics.showsDetails && center
      ? edgeLabelWorldChip(scene.camera, label, center, measure)
      : null;
    if (chip && pointInRect(world, chip)) {
      return edge.id;
    }
    if (distPointToEdgeSq(world, geometry) <= threshold) {
      return edge.id;
    }
  }
  return null;
}

export function hitTestScene(scene: HitContext, world: Vec2): StageSelection {
  let bestNodeId: string | null = null;
  let bestOrder = -1;
  const considerNode = (node: GraphNode) => {
    if (isNodeHidden(node, scene.subgraphMap, scene.metrics.showsGroupsOnly)) {
      return;
    }
    if (!pointInRect(world, { x: node.x, y: node.y, width: node.width, height: node.height })) {
      return;
    }
    const order = scene.nodeOrder.get(node.id) ?? -1;
    if (order >= bestOrder) {
      bestNodeId = node.id;
      bestOrder = order;
    }
  };

  for (const id of scene.draggingIds) {
    const node = scene.nodeMap.get(id);
    if (node) {
      considerNode(node);
    }
  }
  for (const entry of scene.nodeIndex.queryPoint(world, 2)) {
    if (scene.draggingIds.has(entry.id)) {
      continue;
    }
    considerNode(scene.nodeMap.get(entry.id) ?? entry.item);
  }
  if (bestNodeId) {
    return { kind: 'node', ids: [bestNodeId] };
  }

  if (scene.selection.kind === 'frame') {
    for (const id of scene.selection.ids) {
      const frame = scene.frameById(id);
      if (frame && hitFrameResize(frame, world, scene.camera.scale)) {
        return { kind: 'frame', ids: [id] };
      }
    }
  }

  for (let i = scene.seqFrames.length - 1; i >= 0; i -= 1) {
    const frame = scene.seqFrames[i];
    const model = scene.sequenceModel(frame.id);
    if (!model || !hitSequenceFrame(model.frame, world)) {
      continue;
    }
    const inner = hitSequenceInterior(model, world);
    if (inner?.kind === 'participant') {
      return { kind: 'seq-actor', sceneId: frame.id, ids: [inner.id] };
    }
    if (inner?.kind === 'message') {
      return { kind: 'seq-message', sceneId: frame.id, ids: [inner.id] };
    }
    return { kind: 'sequence', ids: [frame.id] };
  }

  for (let i = scene.mindFrames.length - 1; i >= 0; i -= 1) {
    const frame = scene.mindFrames[i];
    const model = scene.mindModel(frame.id);
    if (!model || !hitMindFrame(model.frame, world)) {
      continue;
    }
    const inner = hitMindInterior(model, world);
    if (inner?.kind === 'topic') {
      return { kind: 'mind-node', mapId: frame.id, ids: [inner.id] };
    }
    return { kind: 'mind', ids: [frame.id] };
  }

  const titleHit = hitGroupTitleAt(scene, world);
  if (titleHit) {
    return { kind: 'group', ids: [titleHit] };
  }

  const edgeHit = hitEdgeAt(scene, world);
  if (edgeHit) {
    return { kind: 'edge', ids: [edgeHit] };
  }
  for (let i = scene.doc.subgraphs.length - 1; i >= 0; i -= 1) {
    const sg = scene.doc.subgraphs[i];
    if (isGroupHidden(sg, scene.subgraphMap, scene.camera.scale, scene.nestDepth)) {
      continue;
    }
    const rect = scene.groupRectCache.get(sg.id);
    if (!rect) {
      continue;
    }
    if (pointInRect(world, rect)) {
      return { kind: 'group', ids: [sg.id] };
    }
  }
  if (!scene.lockPositions) {
    for (let i = scene.frames.length - 1; i >= 0; i -= 1) {
      const frame = scene.frames[i];
      if (hitFrameBody(frame, world) || hitFrameResize(frame, world, scene.camera.scale)) {
        return { kind: 'frame', ids: [frame.id] };
      }
    }
  }
  return { kind: 'none' };
}
