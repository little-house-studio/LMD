import {
  buildEntityIdFromTitle,
  measureNodeContentSize,
  serializeMermaidDocument,
  serializeProjectMarkdown,
  standardizeProjectMarkdown,
  type EdgeType,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type GraphSubgraph,
  type NodeShape,
} from '..';
import { documentToCompat } from './adapter';
import { composeEntityText, splitEntityText } from './label';
import { DEFAULT_EDGE_STYLE, DEFAULT_GROUP_STYLE, DEFAULT_NODE_STYLE } from './types';

function usedNodeIds(document: GraphDocument) {
  return new Set(document.nodes.map((node) => node.id));
}

function usedSubgraphIds(document: GraphDocument) {
  return new Set(document.subgraphs.map((subgraph) => subgraph.id));
}

function refreshSource(document: GraphDocument): GraphDocument {
  return {
    ...document,
    source: serializeMermaidDocument(
      document.direction,
      document.nodes,
      document.edges,
      document.subgraphs,
      document.unsupportedLines,
    ),
  };
}

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
    const created = createNodeInDocument(next, {
      label: '新建节点',
      x: point.x,
      y: point.y,
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

export function deleteIdsFromDocument(
  document: GraphDocument,
  selection: { kind: string; ids: string[] },
): GraphDocument {
  if (selection.kind === 'none' || selection.ids.length === 0) {
    return document;
  }
  const ids = new Set(selection.ids);

  if (selection.kind === 'edge') {
    return refreshSource({
      ...document,
      edges: document.edges.filter((edge) => !ids.has(edge.id)),
    });
  }

  if (selection.kind === 'group' || selection.kind === 'subgraph') {
    return refreshSource({
      ...document,
      subgraphs: document.subgraphs.filter((subgraph) => !ids.has(subgraph.id)),
      nodes: document.nodes.map((node) =>
        node.subgraphId && ids.has(node.subgraphId)
          ? { ...node, subgraphId: null }
          : node,
      ),
    });
  }

  // nodes
  return refreshSource({
    ...document,
    nodes: document.nodes.filter((node) => !ids.has(node.id)),
    edges: document.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)),
  });
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

export function groupNodesInDocument(
  document: GraphDocument,
  nodeIds: string[],
  title = '新建分组',
): { document: GraphDocument; subgraphId: string } {
  if (nodeIds.length === 0) {
    return { document, subgraphId: '' };
  }
  const used = usedSubgraphIds(document);
  const subgraphId = buildEntityIdFromTitle(title, used);
  const selected = new Set(nodeIds);
  const subgraph: GraphSubgraph = {
    id: subgraphId,
    title,
    parentId: null,
    collapsed: false,
    fill: DEFAULT_GROUP_STYLE.fill,
    stroke: DEFAULT_GROUP_STYLE.stroke,
    textColor: DEFAULT_GROUP_STYLE.textColor,
  };

  return {
    subgraphId,
    document: refreshSource({
      ...document,
      subgraphs: [...document.subgraphs, subgraph],
      nodes: document.nodes.map((node) =>
        selected.has(node.id) ? { ...node, subgraphId } : node,
      ),
    }),
  };
}

export function ungroupNodesInDocument(
  document: GraphDocument,
  subgraphIds: string[],
): GraphDocument {
  if (subgraphIds.length === 0) {
    return document;
  }
  const ids = new Set(subgraphIds);
  return refreshSource({
    ...document,
    subgraphs: document.subgraphs.filter((subgraph) => !ids.has(subgraph.id)),
    nodes: document.nodes.map((node) =>
      node.subgraphId && ids.has(node.subgraphId)
        ? { ...node, subgraphId: null }
        : node,
    ),
  });
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

export function updateEdgeInDocument(
  document: GraphDocument,
  edgeId: string,
  patch: {
    label?: string;
    type?: EdgeType;
    strokeColor?: string;
    strokeWidth?: number;
  },
): GraphDocument {
  return refreshSource({
    ...document,
    edges: document.edges.map((edge) =>
      edge.id === edgeId
        ? {
            ...edge,
            label: patch.label ?? edge.label,
            type: patch.type ?? edge.type,
            strokeColor: patch.strokeColor ?? edge.strokeColor,
            strokeWidth: patch.strokeWidth ?? edge.strokeWidth,
          }
        : edge,
    ),
  });
}

export function updateSubgraphInDocument(
  document: GraphDocument,
  subgraphId: string,
  patch: {
    title?: string;
    fill?: string;
    stroke?: string;
    textColor?: string;
  },
): GraphDocument {
  return refreshSource({
    ...document,
    subgraphs: document.subgraphs.map((subgraph) =>
      subgraph.id === subgraphId
        ? {
            ...subgraph,
            title: patch.title ?? subgraph.title,
            fill: patch.fill ?? subgraph.fill,
            stroke: patch.stroke ?? subgraph.stroke,
            textColor: patch.textColor ?? subgraph.textColor,
          }
        : subgraph,
    ),
  });
}

export function updateProjectMeta(
  document: GraphDocument,
  patch: { projectName?: string; projectSummary?: string; contentMarkdown?: string },
): GraphDocument {
  return {
    ...document,
    projectName: patch.projectName ?? document.projectName,
    projectSummary: patch.projectSummary ?? document.projectSummary,
    contentMarkdown:
      patch.contentMarkdown !== undefined
        ? patch.contentMarkdown
        : document.contentMarkdown,
  };
}

/** Simple layered LR layout (barycenter-lite) — keeps RF happy with absolute coords. */
export function autoLayoutDocument(document: GraphDocument): GraphDocument {
  const ids = document.nodes.map((node) => node.id);
  if (ids.length === 0) {
    return document;
  }

  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  ids.forEach((id) => {
    outgoing.set(id, []);
    indegree.set(id, 0);
  });
  document.edges.forEach((edge) => {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) {
      return;
    }
    outgoing.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  });

  const rank = new Map<string, number>();
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  queue.forEach((id) => rank.set(id, 0));
  const seen = new Set(queue);

  while (queue.length > 0) {
    const id = queue.shift()!;
    const base = rank.get(id) ?? 0;
    (outgoing.get(id) ?? []).forEach((nextId) => {
      rank.set(nextId, Math.max(rank.get(nextId) ?? 0, base + 1));
      if (!seen.has(nextId)) {
        seen.add(nextId);
        queue.push(nextId);
      }
    });
  }

  ids.forEach((id) => {
    if (!rank.has(id)) {
      rank.set(id, 0);
    }
  });

  const layers = new Map<number, GraphNode[]>();
  document.nodes.forEach((node) => {
    const r = rank.get(node.id) ?? 0;
    layers.set(r, [...(layers.get(r) ?? []), node]);
  });

  const colGap = 180;
  const rowGap = 36;
  const positions = new Map<string, { x: number; y: number }>();
  const sortedRanks = [...layers.keys()].sort((a, b) => a - b);

  sortedRanks.forEach((r) => {
    const layer = (layers.get(r) ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));
    const totalHeight = layer.reduce(
      (sum, node, index) => sum + node.height + (index === layer.length - 1 ? 0 : rowGap),
      0,
    );
    let y = -totalHeight / 2;
    layer.forEach((node) => {
      positions.set(node.id, {
        x: r * (220 + colGap),
        y,
      });
      y += node.height + rowGap;
    });
  });

  // Keep current center.
  const oldCx =
    document.nodes.reduce((sum, node) => sum + node.x + node.width / 2, 0) /
    document.nodes.length;
  const oldCy =
    document.nodes.reduce((sum, node) => sum + node.y + node.height / 2, 0) /
    document.nodes.length;
  const laid = document.nodes.map((node) => {
    const p = positions.get(node.id);
    return p ? { ...node, x: p.x, y: p.y } : node;
  });
  const newCx =
    laid.reduce((sum, node) => sum + node.x + node.width / 2, 0) / laid.length;
  const newCy =
    laid.reduce((sum, node) => sum + node.y + node.height / 2, 0) / laid.length;
  const dx = oldCx - newCx;
  const dy = oldCy - newCy;

  return refreshSource({
    ...document,
    nodes: laid.map((node) => ({
      ...node,
      x: Math.round(node.x + dx),
      y: Math.round(node.y + dy),
      // clear groups for clean global layout
      subgraphId: node.subgraphId,
    })),
  });
}

/** Compact: pull nodes toward centroid with less spacing. */
export function tidyLayoutDocument(document: GraphDocument): GraphDocument {
  if (document.nodes.length === 0) {
    return document;
  }
  const cx =
    document.nodes.reduce((sum, node) => sum + node.x + node.width / 2, 0) /
    document.nodes.length;
  const cy =
    document.nodes.reduce((sum, node) => sum + node.y + node.height / 2, 0) /
    document.nodes.length;

  return refreshSource({
    ...document,
    nodes: document.nodes.map((node) => {
      const midX = node.x + node.width / 2;
      const midY = node.y + node.height / 2;
      const nx = cx + (midX - cx) * 0.86;
      const ny = cy + (midY - cy) * 0.86;
      return {
        ...node,
        x: Math.round(nx - node.width / 2),
        y: Math.round(ny - node.height / 2),
      };
    }),
  });
}

export function standardizeDocument(document: GraphDocument): GraphDocument {
  const markdown = serializeProjectMarkdown({
    projectName: document.projectName || 'LMD Project',
    projectSummary: document.projectSummary || '',
    prefixMarkdown: document.prefixMarkdown,
    contentMarkdown: document.contentMarkdown ?? '',
    mermaidSource: document.source,
    compat: documentToCompat(document),
    nodes: document.nodes,
    subgraphs: document.subgraphs,
  });
  return standardizeProjectMarkdown(
    markdown,
    document.projectName || 'LMD Project',
    document.layout,
  );
}
