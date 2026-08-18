import { siblingMetaPath } from '../../../shared-kernel/protocol';
import { DEFAULT_EDGE_THEME, DEFAULT_GROUP_THEME, DEFAULT_NODE_THEME } from '../../../shared-kernel/theme';
import type { GraphDocument, GraphEdge, GraphNode, GraphSubgraph } from '../working-model/types';

export type LmdMetaNode = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  textColor?: string;
};

export type LmdMetaEdge = {
  strokeColor?: string;
  strokeWidth?: number;
};

export type LmdMetaGroup = {
  collapsed?: boolean;
  fill?: string;
  stroke?: string;
  textColor?: string;
};

export type LmdMetaFile = {
  v: 1;
  viewport?: { x: number; y: number; zoom: number };
  nodes?: Record<string, LmdMetaNode>;
  edges?: Record<string, LmdMetaEdge>;
  groups?: Record<string, LmdMetaGroup>;
  extras?: Record<string, unknown>;
};

export { siblingMetaPath };

export function emptyLmdMeta(): LmdMetaFile {
  return { v: 1 };
}

export function parseLmdMeta(text: string): LmdMetaFile {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    return emptyLmdMeta();
  }
  try {
    const raw = JSON.parse(trimmed) as Partial<LmdMetaFile>;
    if (!raw || typeof raw !== 'object') {
      return emptyLmdMeta();
    }
    return {
      v: 1,
      viewport: isViewport(raw.viewport) ? raw.viewport : undefined,
      nodes: asRecord(raw.nodes),
      edges: asRecord(raw.edges),
      groups: asRecord(raw.groups),
      extras: asRecord(raw.extras),
    };
  } catch {
    return emptyLmdMeta();
  }
}

export function printLmdMeta(meta: LmdMetaFile) {
  return `${JSON.stringify({ ...meta, v: 1 }, null, 2)}\n`;
}

export function metaHasNodeLayout(meta: LmdMetaFile) {
  return Object.values(meta.nodes ?? {}).some((node) => (
    node && (Number.isFinite(node.x) || Number.isFinite(node.y))
  ));
}

export function extractMetaFromGraph(document: GraphDocument): LmdMetaFile {
  const nodes: Record<string, LmdMetaNode> = {};
  for (const node of document.nodes) {
    const entry: LmdMetaNode = { x: node.x, y: node.y, width: node.width, height: node.height };
    if (node.fill !== DEFAULT_NODE_THEME.fill) entry.fill = node.fill;
    if (node.stroke !== DEFAULT_NODE_THEME.stroke) entry.stroke = node.stroke;
    if (node.textColor !== DEFAULT_NODE_THEME.textColor) entry.textColor = node.textColor;
    nodes[node.id] = entry;
  }
  const edges: Record<string, LmdMetaEdge> = {};
  for (const edge of document.edges) {
    const entry: LmdMetaEdge = {};
    if (edge.strokeColor !== DEFAULT_EDGE_THEME.strokeColor) entry.strokeColor = edge.strokeColor;
    if (edge.strokeWidth !== DEFAULT_EDGE_THEME.strokeWidth) entry.strokeWidth = edge.strokeWidth;
    if (Object.keys(entry).length > 0) {
      edges[edge.id] = entry;
    }
  }
  const groups: Record<string, LmdMetaGroup> = {};
  for (const group of document.subgraphs) {
    const entry: LmdMetaGroup = {};
    if (group.collapsed) entry.collapsed = true;
    if (group.fill !== DEFAULT_GROUP_THEME.fill) entry.fill = group.fill;
    if (group.stroke !== DEFAULT_GROUP_THEME.stroke) entry.stroke = group.stroke;
    if (group.textColor !== DEFAULT_GROUP_THEME.textColor) entry.textColor = group.textColor;
    if (Object.keys(entry).length > 0) {
      groups[group.id] = entry;
    }
  }
  return {
    v: 1,
    viewport: { ...document.layout.viewport },
    nodes,
    edges: Object.keys(edges).length > 0 ? edges : undefined,
    groups: Object.keys(groups).length > 0 ? groups : undefined,
    extras: document.compat?.extras,
  };
}

export function applyMetaToGraph(document: GraphDocument, meta: LmdMetaFile): GraphDocument {
  const nodeMeta = meta.nodes ?? {};
  const edgeMeta = meta.edges ?? {};
  const groupMeta = meta.groups ?? {};
  const nodes = document.nodes.map((node) => applyNodeMeta(node, nodeMeta[node.id]));
  const edges = document.edges.map((edge) => applyEdgeMeta(edge, edgeMeta[edge.id]));
  const subgraphs = document.subgraphs.map((group) => applyGroupMeta(group, groupMeta[group.id]));
  const layout = {
    ...document.layout,
    viewport: meta.viewport ?? document.layout.viewport,
    nodes: Object.fromEntries(nodes.map((node) => [node.id, {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    }])),
    subgraphs: Object.fromEntries(subgraphs.map((group) => [group.id, { collapsed: group.collapsed }])),
  };
  return {
    ...document,
    nodes,
    edges,
    subgraphs,
    layout,
    compat: {
      version: document.compat?.version ?? 1,
      layout,
      editor: document.compat?.editor,
      extras: meta.extras ?? document.compat?.extras,
    },
  };
}

function applyNodeMeta(node: GraphNode, meta?: LmdMetaNode): GraphNode {
  if (!meta) {
    return node;
  }
  return {
    ...node,
    x: Number.isFinite(meta.x) ? meta.x as number : node.x,
    y: Number.isFinite(meta.y) ? meta.y as number : node.y,
    width: Number.isFinite(meta.width) && (meta.width as number) > 0 ? meta.width as number : node.width,
    height: Number.isFinite(meta.height) && (meta.height as number) > 0 ? meta.height as number : node.height,
    fill: meta.fill ?? node.fill,
    stroke: meta.stroke ?? node.stroke,
    textColor: meta.textColor ?? node.textColor,
  };
}

function applyEdgeMeta(edge: GraphEdge, meta?: LmdMetaEdge): GraphEdge {
  if (!meta) {
    return edge;
  }
  return {
    ...edge,
    strokeColor: meta.strokeColor ?? edge.strokeColor,
    strokeWidth: Number.isFinite(meta.strokeWidth) ? meta.strokeWidth as number : edge.strokeWidth,
  };
}

function applyGroupMeta(group: GraphSubgraph, meta?: LmdMetaGroup): GraphSubgraph {
  if (!meta) {
    return group;
  }
  return {
    ...group,
    collapsed: meta.collapsed ?? group.collapsed,
    fill: meta.fill ?? group.fill,
    stroke: meta.stroke ?? group.stroke,
    textColor: meta.textColor ?? group.textColor,
  };
}

function isViewport(value: unknown): value is { x: number; y: number; zoom: number } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const viewport = value as { x?: unknown; y?: unknown; zoom?: unknown };
  return Number.isFinite(viewport.x) && Number.isFinite(viewport.y) && Number.isFinite(viewport.zoom);
}

function asRecord<T>(value: unknown): Record<string, T> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, T>;
}
