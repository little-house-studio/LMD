import {
  getTopVisibleCollapsedAncestorId,
  isSubgraphHiddenByCollapsedAncestor,
} from '../../application/layout/graphLayout';
import type { GraphNode, GraphSubgraph } from '../..';
import {
  mindFrameAsRect,
  sequenceFrameAsRect,
  snapConnectTarget,
  type EndpointBox,
  type MindFrame,
  type SequenceFrame,
} from '../../placement';
import type { Rect, Vec2 } from './math';

export function endpointPorts(box: EndpointBox): Vec2[] {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return [
    { x: cx, y: box.y },
    { x: box.x + box.width, y: cy },
    { x: cx, y: box.y + box.height },
    { x: box.x, y: cy },
  ];
}

export function resolveEndpointBox(
  id: string,
  input: {
    nodeMap: Map<string, GraphNode>;
    subgraphMap: Map<string, GraphSubgraph>;
    groupRectCache: Map<string, Rect>;
    seqFrames: readonly SequenceFrame[];
    mindFrames: readonly MindFrame[];
  },
): EndpointBox | null {
  const node = input.nodeMap.get(id);
  if (node) {
    const collapsed = getTopVisibleCollapsedAncestorId(node.subgraphId, input.subgraphMap);
    if (collapsed) {
      return input.groupRectCache.get(collapsed) ?? null;
    }
    return { ...node, id: node.id };
  }
  const seq = input.seqFrames.find((frame) => frame.id === id);
  if (seq) {
    return { ...sequenceFrameAsRect(seq), id: seq.id };
  }
  const mind = input.mindFrames.find((frame) => frame.id === id);
  if (mind) {
    return { ...mindFrameAsRect(mind), id: mind.id };
  }
  const subgraph = input.subgraphMap.get(id);
  if (!subgraph) {
    return null;
  }
  const collapsed = getTopVisibleCollapsedAncestorId(subgraph.id, input.subgraphMap);
  const rect = input.groupRectCache.get(collapsed ?? subgraph.id);
  return rect ? { ...rect, id: collapsed ?? subgraph.id } : null;
}

export function hasEndpoint(
  id: string,
  input: {
    nodeMap: Map<string, GraphNode>;
    subgraphMap: Map<string, GraphSubgraph>;
    seqFrames: readonly SequenceFrame[];
    mindFrames: readonly MindFrame[];
  },
) {
  return input.nodeMap.has(id)
    || input.subgraphMap.has(id)
    || input.seqFrames.some((frame) => frame.id === id)
    || input.mindFrames.some((frame) => frame.id === id);
}

export function connectBoxes(input: {
  nodes: readonly GraphNode[];
  seqFrames: readonly SequenceFrame[];
  mindFrames: readonly MindFrame[];
  isNodeHidden: (node: GraphNode) => boolean;
}): EndpointBox[] {
  const boxes: EndpointBox[] = [];
  for (const node of input.nodes) {
    if (!input.isNodeHidden(node)) {
      boxes.push({ ...node, id: node.id });
    }
  }
  for (const frame of input.seqFrames) {
    boxes.push({ ...sequenceFrameAsRect(frame), id: frame.id });
  }
  for (const frame of input.mindFrames) {
    boxes.push({ ...mindFrameAsRect(frame), id: frame.id });
  }
  return boxes;
}

export function collectEndpointBoxes(input: {
  nodes: readonly GraphNode[];
  subgraphs: readonly GraphSubgraph[];
  subgraphMap: Map<string, GraphSubgraph>;
  groupRectCache: Map<string, Rect>;
  seqFrames: readonly SequenceFrame[];
  mindFrames: readonly MindFrame[];
  boxOf: (id: string) => EndpointBox | null;
}): Map<string, EndpointBox> {
  const boxes = new Map<string, EndpointBox>();
  for (const node of input.nodes) {
    const box = input.boxOf(node.id);
    if (box) {
      boxes.set(node.id, { ...box, id: node.id });
    }
  }
  for (const subgraph of input.subgraphs) {
    if (isSubgraphHiddenByCollapsedAncestor(subgraph, input.subgraphMap)) {
      continue;
    }
    const box = input.boxOf(subgraph.id);
    if (box) {
      boxes.set(subgraph.id, { ...box, id: subgraph.id });
    }
  }
  for (const frame of input.seqFrames) {
    boxes.set(frame.id, { ...sequenceFrameAsRect(frame), id: frame.id });
  }
  for (const frame of input.mindFrames) {
    boxes.set(frame.id, { ...mindFrameAsRect(frame), id: frame.id });
  }
  return boxes;
}

export function snapSceneConnect(
  from: EndpointBox,
  cursor: Vec2,
  boxes: EndpointBox[],
  scale: number,
) {
  return snapConnectTarget(cursor, from, boxes, 40 / Math.max(scale, 0.05));
}

export function hitEndpointPort(
  world: Vec2,
  ids: readonly string[],
  scale: number,
  boxOf: (id: string) => EndpointBox | null,
): { nodeId: string } | null {
  if (ids.length === 0) {
    return null;
  }
  const threshold = 10 / scale;
  for (const id of ids) {
    const box = boxOf(id);
    if (!box) {
      continue;
    }
    for (const port of endpointPorts(box)) {
      const dx = world.x - port.x;
      const dy = world.y - port.y;
      if (dx * dx + dy * dy <= threshold * threshold) {
        return { nodeId: id };
      }
    }
  }
  return null;
}
