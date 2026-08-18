import { measureNodeContentSize, type GraphDocument, type GraphEdge, type GraphNode } from '@lths/lmd/legacy';
import { nodeCollisionObstacles, searchFreeRect } from '../layout/graphLayout';
import { DEFAULT_EDGE_STYLE } from '../../domain/style';
import { createNodeInDocument } from './nodes';
import { refreshSource } from './source';

export type RelatedNodeRelation = 'linked' | 'sibling' | 'mirrored';

export function placementForRelatedNode(
  node: GraphNode,
  direction: GraphDocument['direction'],
  relation: RelatedNodeRelation,
) {
  const gapX = 96;
  const gapY = 84;
  if (relation === 'linked') {
    if (direction === 'LR') {
      return { x: node.x + node.width + gapX, y: node.y };
    }
    if (direction === 'RL') {
      return { x: node.x - node.width - gapX, y: node.y };
    }
    if (direction === 'BT') {
      return { x: node.x, y: node.y - node.height - gapY };
    }
    return { x: node.x, y: node.y + node.height + gapY };
  }
  if (direction === 'LR' || direction === 'RL') {
    return { x: node.x, y: node.y + node.height + gapY };
  }
  return { x: node.x + node.width + gapX, y: node.y };
}

export function createRelatedNodesInDocument(
  document: GraphDocument,
  sourceIds: string[],
  relation: RelatedNodeRelation,
): { document: GraphDocument; newIds: string[] } {
  if (sourceIds.length === 0) {
    return { document, newIds: [] };
  }
  const sources = document.nodes.filter((node) => sourceIds.includes(node.id));
  if (sources.length === 0) {
    return { document, newIds: [] };
  }

  let next = document;
  const newIds: string[] = [];
  const newEdges: GraphEdge[] = [];

  for (const source of sources) {
    const point = placementForRelatedNode(source, next.direction, relation);
    const size = measureNodeContentSize('新建节点', '');
    const hint =
      relation === 'linked'
        ? { x: point.x - source.x, y: point.y - source.y }
        : { x: 1, y: 0 };
    const free = searchFreeRect(
      { x: point.x, y: point.y, width: size.width, height: size.height },
      nodeCollisionObstacles(next.nodes),
      hint,
    );
    const created = createNodeInDocument(next, {
      label: '新建节点',
      x: free.x,
      y: free.y,
      subgraphId: source.subgraphId,
    });
    next = created.document;
    newIds.push(created.nodeId);
    if (relation === 'linked') {
      newEdges.push({
        id: `edge_${source.id}_${created.nodeId}_${Math.random().toString(36).slice(2, 6)}`,
        from: source.id,
        to: created.nodeId,
        label: '',
        type: 'solid',
        strokeColor: DEFAULT_EDGE_STYLE.strokeColor,
        strokeWidth: DEFAULT_EDGE_STYLE.strokeWidth,
      });
    } else if (relation === 'mirrored') {
      next.edges
        .filter((edge) => edge.to === source.id)
        .forEach((edge) => {
          newEdges.push({
            ...edge,
            id: `edge_${edge.from}_${created.nodeId}_${Math.random().toString(36).slice(2, 6)}`,
            to: created.nodeId,
          });
        });
    }
  }

  if (newEdges.length === 0) {
    return { document: next, newIds };
  }
  return {
    newIds,
    document: refreshSource({
      ...next,
      edges: [...next.edges, ...newEdges],
    }),
  };
}
