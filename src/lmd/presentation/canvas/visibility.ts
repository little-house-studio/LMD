import {
  isInsideCollapsedSubgraph,
  isSubgraphHiddenByCollapsedAncestor,
} from '../../application/layout/graphLayout';
import type { GraphEdge, GraphNode, GraphSubgraph } from '../..';
import {
  canvasLod,
  groupVisibleAtScale,
  hidesGroupedEdge,
  nodeBelongsToGroup,
  subgraphDepth,
  type CanvasLod,
} from '../../placement';

export type SceneMetrics = {
  scale: number;
  lod: CanvasLod;
  showsDetails: boolean;
  showsNames: boolean;
  showsGroupsOnly: boolean;
};

export function sceneMetrics(scale: number, hasGroups: boolean): SceneMetrics {
  const lod = canvasLod(scale, hasGroups);
  return {
    scale,
    lod,
    showsDetails: lod === 'details',
    showsNames: lod !== 'groups',
    showsGroupsOnly: lod === 'groups',
  };
}

export function isNodeHidden(
  node: GraphNode,
  subgraphMap: Map<string, GraphSubgraph>,
  showsGroupsOnly: boolean,
) {
  return isInsideCollapsedSubgraph(node, subgraphMap) || (showsGroupsOnly && nodeBelongsToGroup(node));
}

export function isGroupHidden(
  subgraph: GraphSubgraph,
  subgraphMap: Map<string, GraphSubgraph>,
  scale: number,
  nestDepth: number,
) {
  if (isSubgraphHiddenByCollapsedAncestor(subgraph, subgraphMap)) {
    return true;
  }
  return !groupVisibleAtScale(subgraphDepth(subgraph.id, subgraphMap), scale, nestDepth);
}

export function hidesSceneEdge(
  edge: GraphEdge,
  nodeMap: Map<string, GraphNode>,
  showsGroupsOnly: boolean,
) {
  if (!showsGroupsOnly) {
    return false;
  }
  return hidesGroupedEdge(nodeMap.get(edge.from), nodeMap.get(edge.to));
}

export type { CanvasLod };
