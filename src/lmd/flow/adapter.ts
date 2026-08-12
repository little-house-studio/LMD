import type { Viewport } from '@xyflow/react';
import {
  defaultEdgeStyle,
  defaultSubgraphStyle,
  measureNodeContentSize,
  serializeMermaidDocument,
  toSidecar,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type GraphSubgraph,
  type LayoutSidecar,
  type ProjectCompatLayer,
} from '..';
import { composeEntityText, splitEntityText } from './label';
import {
  DEFAULT_EDGE_STYLE,
  DEFAULT_GROUP_STYLE,
  DEFAULT_NODE_STYLE,
  type LmdFlowEdge,
  type LmdFlowNode,
  type LmdGroupData,
  type LmdNodeData,
} from './types';

const GROUP_PAD = 28;
const GROUP_HEADER = 44;

function isGroupData(data: LmdFlowNode['data']): data is LmdGroupData {
  return data.kind === 'group';
}

function isNodeData(data: LmdFlowNode['data']): data is LmdNodeData {
  return data.kind === 'node';
}

function groupBounds(nodes: GraphNode[]) {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 240, height: 160 };
  }
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(...nodes.map((n) => n.y + n.height));
  return {
    x: minX - GROUP_PAD,
    y: minY - GROUP_PAD - GROUP_HEADER,
    width: Math.max(200, maxX - minX + GROUP_PAD * 2),
    height: Math.max(120, maxY - minY + GROUP_PAD * 2 + GROUP_HEADER),
  };
}

/** Convert domain GraphDocument → React Flow elements. */
export function documentToFlow(document: GraphDocument): {
  nodes: LmdFlowNode[];
  edges: LmdFlowEdge[];
  viewport: Viewport;
} {
  const nodesBySubgraph = new Map<string, GraphNode[]>();
  document.nodes.forEach((node) => {
    if (!node.subgraphId) {
      return;
    }
    const list = nodesBySubgraph.get(node.subgraphId) ?? [];
    list.push(node);
    nodesBySubgraph.set(node.subgraphId, list);
  });

  const groupMeta = new Map<string, { x: number; y: number; width: number; height: number }>();
  document.subgraphs.forEach((subgraph) => {
    const members = nodesBySubgraph.get(subgraph.id) ?? [];
    groupMeta.set(subgraph.id, groupBounds(members));
  });

  const flowNodes: LmdFlowNode[] = [];

  // Parent groups first (RF expects parents before children when hydrating).
  document.subgraphs.forEach((subgraph) => {
    const bounds = groupMeta.get(subgraph.id) ?? { x: 0, y: 0, width: 240, height: 160 };
    const style = {
      fill: subgraph.fill || DEFAULT_GROUP_STYLE.fill,
      stroke: subgraph.stroke || DEFAULT_GROUP_STYLE.stroke,
      textColor: subgraph.textColor || DEFAULT_GROUP_STYLE.textColor,
    };
    flowNodes.push({
      id: subgraph.id,
      type: 'lmdGroup',
      position: { x: bounds.x, y: bounds.y },
      draggable: true,
      selectable: true,
      connectable: false,
      // RF parent sizing: style width/height is the supported surface for expandParent.
      style: {
        width: bounds.width,
        height: bounds.height,
      },
      data: {
        kind: 'group',
        title: subgraph.title,
        fill: style.fill,
        stroke: style.stroke,
        textColor: style.textColor,
        collapsed: subgraph.collapsed,
        width: bounds.width,
        height: bounds.height,
      },
    });
  });

  document.nodes.forEach((node) => {
    const parts = splitEntityText(node.label);
    const parentId = node.subgraphId ?? undefined;
    const parentBounds = parentId ? groupMeta.get(parentId) : null;
    const position = parentBounds
      ? { x: node.x - parentBounds.x, y: node.y - parentBounds.y }
      : { x: node.x, y: node.y };

    flowNodes.push({
      id: node.id,
      type: 'lmdNode',
      position,
      parentId,
      // Library-native parent growth while dragging children to the edge.
      expandParent: Boolean(parentId),
      draggable: true,
      selectable: true,
      connectable: true,
      style: {
        width: node.width,
        height: node.height,
      },
      data: {
        kind: 'node',
        title: parts.title || '未命名内容',
        description: parts.description,
        shape: node.shape,
        fill: node.fill || DEFAULT_NODE_STYLE.fill,
        stroke: node.stroke || DEFAULT_NODE_STYLE.stroke,
        textColor: node.textColor || DEFAULT_NODE_STYLE.textColor,
        width: node.width,
        height: node.height,
      },
    });
  });

  const flowEdges: LmdFlowEdge[] = document.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: 'lmdEdge',
    label: edge.label || undefined,
    data: {
      edgeType: edge.type,
      labelText: edge.label,
    },
    style: {
      stroke: edge.strokeColor || DEFAULT_EDGE_STYLE.strokeColor,
      strokeWidth: edge.strokeWidth || DEFAULT_EDGE_STYLE.strokeWidth,
    },
  }));

  const viewport: Viewport = {
    x: document.layout.viewport.x,
    y: document.layout.viewport.y,
    zoom: document.layout.viewport.zoom || 1,
  };

  return { nodes: flowNodes, edges: flowEdges, viewport };
}

function absolutePosition(
  node: LmdFlowNode,
  nodeMap: Map<string, LmdFlowNode>,
): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  while (parentId) {
    const parent = nodeMap.get(parentId);
    if (!parent) {
      break;
    }
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

/** Convert React Flow elements → domain GraphDocument (keeps project meta). */
export function flowToDocument(
  flowNodes: LmdFlowNode[],
  flowEdges: LmdFlowEdge[],
  base: GraphDocument,
  viewport?: Viewport,
): GraphDocument {
  const nodeMap = new Map(flowNodes.map((node) => [node.id, node]));

  const subgraphs: GraphSubgraph[] = flowNodes
    .filter((node) => node.type === 'lmdGroup' && isGroupData(node.data))
    .map((node) => {
      const data = node.data as LmdGroupData;
      return {
        id: node.id,
        title: data.title,
        parentId: node.parentId ?? null,
        collapsed: data.collapsed,
        fill: data.fill || defaultSubgraphStyle.fill,
        stroke: data.stroke || defaultSubgraphStyle.stroke,
        textColor: data.textColor || defaultSubgraphStyle.textColor,
      };
    });

  const nodes: GraphNode[] = flowNodes
    .filter((node) => node.type === 'lmdNode' && isNodeData(node.data))
    .map((node) => {
      const data = node.data as LmdNodeData;
      const abs = absolutePosition(node, nodeMap);
      const fallback = measureNodeContentSize(data.title, data.description);
      // Prefer RF measured / style dimensions when present.
      const width =
        node.measured?.width ||
        (typeof node.style?.width === 'number' ? node.style.width : undefined) ||
        node.width ||
        data.width ||
        fallback.width;
      const height =
        node.measured?.height ||
        (typeof node.style?.height === 'number' ? node.style.height : undefined) ||
        node.height ||
        data.height ||
        fallback.height;
      return {
        id: node.id,
        label: composeEntityText(data.title, data.description),
        shape: data.shape,
        x: Math.round(abs.x),
        y: Math.round(abs.y),
        width: Math.round(width),
        height: Math.round(height),
        fill: data.fill || DEFAULT_NODE_STYLE.fill,
        stroke: data.stroke || DEFAULT_NODE_STYLE.stroke,
        textColor: data.textColor || DEFAULT_NODE_STYLE.textColor,
        subgraphId: node.parentId ?? null,
      };
    });

  const edges: GraphEdge[] = flowEdges.map((edge) => ({
    id: edge.id,
    from: edge.source,
    to: edge.target,
    label: edge.data?.labelText ?? (typeof edge.label === 'string' ? edge.label : '') ?? '',
    type: edge.data?.edgeType ?? 'solid',
    strokeColor:
      (typeof edge.style?.stroke === 'string' ? edge.style.stroke : null) ||
      defaultEdgeStyle.strokeColor,
    strokeWidth:
      typeof edge.style?.strokeWidth === 'number'
        ? edge.style.strokeWidth
        : defaultEdgeStyle.strokeWidth,
  }));

  const layout: LayoutSidecar = {
    version: base.layout.version || 1,
    viewport: viewport
      ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
      : { ...base.layout.viewport },
    nodes: Object.fromEntries(
      nodes.map((node) => [
        node.id,
        { x: node.x, y: node.y, width: node.width, height: node.height },
      ]),
    ),
    subgraphs: Object.fromEntries(
      subgraphs.map((subgraph) => [subgraph.id, { collapsed: subgraph.collapsed }]),
    ),
  };

  const mermaidSource = serializeMermaidDocument(
    base.direction,
    nodes,
    edges,
    subgraphs,
    base.unsupportedLines,
  );

  const next: GraphDocument = {
    ...base,
    nodes,
    edges,
    subgraphs,
    source: mermaidSource,
    layout,
  };

  // Keep sidecar in sync for compact compat writers.
  next.layout = toSidecar(next);
  if (viewport) {
    next.layout.viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
  }

  return next;
}

export function documentToCompat(document: GraphDocument): ProjectCompatLayer {
  return {
    version: document.compat?.version ?? 1,
    layout: toSidecar(document),
    editor: document.compat?.editor ?? { localFileActions: { enabled: true } },
    extras: document.compat?.extras,
  };
}
