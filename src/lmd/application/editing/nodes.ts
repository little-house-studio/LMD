import {
  buildEntityIdFromTitle,
  measureNodeContentSize,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type NodeShape,
} from '@lths/lmd/legacy';
import { DEFAULT_NODE_STYLE } from '../../domain/style';
import { usedNodeIds } from '../../domain/ids';
import { composeEntityText, splitEntityText } from '../../domain/label';
import { refreshSource } from './source';

export function createNodeInDocument(
  document: GraphDocument,
  options?: { label?: string; x?: number; y?: number; subgraphId?: string | null },
): { document: GraphDocument; nodeId: string } {
  const title = options?.label?.trim() || '新建节点';
  const used = usedNodeIds(document);
  const id = buildEntityIdFromTitle(title, used);
  const size = measureNodeContentSize(title, '');
  const node: GraphNode = {
    id,
    label: title,
    shape: 'rect',
    x: options?.x ?? 120,
    y: options?.y ?? 120,
    width: size.width,
    height: size.height,
    fill: DEFAULT_NODE_STYLE.fill,
    stroke: DEFAULT_NODE_STYLE.stroke,
    textColor: DEFAULT_NODE_STYLE.textColor,
    subgraphId: options?.subgraphId ?? null,
  };
  return {
    nodeId: id,
    document: refreshSource({
      ...document,
      nodes: [...document.nodes, node],
    }),
  };
}

export function pasteClonedNodesInDocument(
  document: GraphDocument,
  nodes: GraphNode[],
  edges: GraphEdge[],
  offset = 40,
): { document: GraphDocument; newIds: string[] } {
  if (nodes.length === 0) {
    return { document, newIds: [] };
  }
  const used = usedNodeIds(document);
  const idMap = new Map<string, string>();
  const newNodes = nodes.map((node) => {
    const parts = splitEntityText(node.label);
    const nextId = buildEntityIdFromTitle(parts.title || '未命名内容', used);
    used.add(nextId);
    idMap.set(node.id, nextId);
    return {
      ...node,
      id: nextId,
      x: node.x + offset,
      y: node.y + offset,
    };
  });
  const newEdges = edges
    .filter((edge) => idMap.has(edge.from) && idMap.has(edge.to))
    .map((edge) => ({
      ...edge,
      id: `edge_${idMap.get(edge.from)}_${idMap.get(edge.to)}_${Math.random().toString(36).slice(2, 6)}`,
      from: idMap.get(edge.from)!,
      to: idMap.get(edge.to)!,
    }));
  return {
    newIds: [...idMap.values()],
    document: refreshSource({
      ...document,
      nodes: [...document.nodes, ...newNodes],
      edges: [...document.edges, ...newEdges],
    }),
  };
}

export function duplicateNodesInDocument(
  document: GraphDocument,
  nodeIds: string[],
  offset = 48,
): { document: GraphDocument; newIds: string[] } {
  if (nodeIds.length === 0) {
    return { document, newIds: [] };
  }
  const selected = new Set(nodeIds);
  const used = usedNodeIds(document);
  const idMap = new Map<string, string>();
  const newNodes: GraphNode[] = [];

  document.nodes
    .filter((node) => selected.has(node.id))
    .forEach((node) => {
      const parts = splitEntityText(node.label);
      const nextId = buildEntityIdFromTitle(parts.title || '未命名内容', used);
      used.add(nextId);
      idMap.set(node.id, nextId);
      newNodes.push({
        ...node,
        id: nextId,
        x: node.x + offset,
        y: node.y + offset,
      });
    });

  const newEdges: GraphEdge[] = document.edges
    .filter((edge) => selected.has(edge.from) && selected.has(edge.to))
    .map((edge) => ({
      ...edge,
      id: `edge_${idMap.get(edge.from)}_${idMap.get(edge.to)}_${Math.random().toString(36).slice(2, 6)}`,
      from: idMap.get(edge.from)!,
      to: idMap.get(edge.to)!,
    }));

  return {
    newIds: [...idMap.values()],
    document: refreshSource({
      ...document,
      nodes: [...document.nodes, ...newNodes],
      edges: [...document.edges, ...newEdges],
    }),
  };
}

export function updateNodeInDocument(
  document: GraphDocument,
  nodeId: string,
  patch: {
    title?: string;
    description?: string;
    shape?: NodeShape;
    fill?: string;
    stroke?: string;
    textColor?: string;
  },
): GraphDocument {
  return refreshSource({
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id !== nodeId) {
        return node;
      }
      const parts = splitEntityText(node.label);
      const title = patch.title ?? parts.title;
      const description = patch.description ?? parts.description;
      const label = composeEntityText(title, description);
      const size = measureNodeContentSize(title, description);
      return {
        ...node,
        label,
        shape: patch.shape ?? node.shape,
        fill: patch.fill ?? node.fill,
        stroke: patch.stroke ?? node.stroke,
        textColor: patch.textColor ?? node.textColor,
        width: size.width,
        height: size.height,
      };
    }),
  });
}
