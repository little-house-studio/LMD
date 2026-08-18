import type { Direction, GraphDocument, GraphEdge, GraphNode, GraphSubgraph } from '../compat/types';
import { GROUP_HEADER, GROUP_PAD } from '../../placement/groups';

export type PlaceFlowFn = (
  nodes: GraphNode[],
  keepCentroid: { x: number; y: number } | null,
  style?: {
    compact?: boolean;
    direction?: Direction;
    graph?: GraphDocument;
  },
) => GraphNode[];

/** Leaf groups pack on the cross axis so a parent in LR is not a long sausage. */
export function nestedLayoutDirection(direction: Direction): Direction {
  if (direction === 'LR') return 'TD';
  if (direction === 'RL') return 'BT';
  if (direction === 'TD') return 'LR';
  return 'RL';
}

function subgraphLookup(subgraphs: GraphSubgraph[]) {
  return new Map(subgraphs.map((subgraph) => [subgraph.id, subgraph]));
}

function belongsToSubgraph(
  node: GraphNode,
  subgraphId: string,
  lookup: Map<string, GraphSubgraph>,
) {
  let current = node.subgraphId;
  while (current) {
    if (current === subgraphId) {
      return true;
    }
    current = lookup.get(current)?.parentId ?? null;
  }
  return false;
}

function membersOf(
  nodes: GraphNode[],
  subgraphId: string,
  lookup: Map<string, GraphSubgraph>,
) {
  return nodes.filter((node) => belongsToSubgraph(node, subgraphId, lookup));
}

function nodeBounds(nodes: GraphNode[]) {
  return {
    minX: Math.min(...nodes.map((node) => node.x)),
    minY: Math.min(...nodes.map((node) => node.y)),
    maxX: Math.max(...nodes.map((node) => node.x + node.width)),
    maxY: Math.max(...nodes.map((node) => node.y + node.height)),
  };
}

function chromeSize(nodes: GraphNode[]) {
  const box = nodeBounds(nodes);
  return {
    width: Math.max(80, box.maxX - box.minX + GROUP_PAD * 2),
    height: Math.max(80, box.maxY - box.minY + GROUP_PAD * 2 + GROUP_HEADER),
  };
}

function translateIntoChrome(nodes: GraphNode[], host: GraphNode): GraphNode[] {
  const box = nodeBounds(nodes);
  const dx = host.x + GROUP_PAD - box.minX;
  const dy = host.y + GROUP_PAD + GROUP_HEADER - box.minY;
  return nodes.map((node) => ({
    ...node,
    x: Math.round(node.x + dx),
    y: Math.round(node.y + dy),
  }));
}

function superNode(id: string, width: number, height: number): GraphNode {
  return {
    id,
    label: id,
    shape: 'rect',
    x: 0,
    y: 0,
    width,
    height,
    fill: '',
    stroke: '',
    textColor: '',
    subgraphId: null,
  };
}

function immediateGroups(
  document: GraphDocument,
  nodes: GraphNode[],
  parentId: string | null,
) {
  const lookup = subgraphLookup(document.subgraphs);
  const ids = new Set(nodes.map((node) => node.id));
  return document.subgraphs.filter((subgraph) => {
    if (subgraph.parentId !== parentId) {
      return false;
    }
    return membersOf(nodes, subgraph.id, lookup).some((node) => ids.has(node.id));
  });
}

function coveringGroup(
  groups: GraphSubgraph[],
  nodes: GraphNode[],
  lookup: Map<string, GraphSubgraph>,
) {
  if (groups.length === 0) {
    return null;
  }
  const cover = groups.filter((group) => nodes.every((node) => belongsToSubgraph(node, group.id, lookup)));
  return cover.length === 1 ? cover[0] : null;
}

function superIdOf(
  nodeId: string,
  nodes: GraphNode[],
  groups: GraphSubgraph[],
  lookup: Map<string, GraphSubgraph>,
) {
  const node = nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return null;
  }
  const owner = groups.find((group) => belongsToSubgraph(node, group.id, lookup));
  return owner?.id ?? node.id;
}

function collapseEdges(
  document: GraphDocument,
  nodes: GraphNode[],
  groups: GraphSubgraph[],
): GraphEdge[] {
  const lookup = subgraphLookup(document.subgraphs);
  const allow = new Set(nodes.map((node) => node.id));
  const unique = new Map<string, GraphEdge>();
  document.edges.forEach((edge, index) => {
    if (!allow.has(edge.from) || !allow.has(edge.to)) {
      return;
    }
    const from = superIdOf(edge.from, nodes, groups, lookup);
    const to = superIdOf(edge.to, nodes, groups, lookup);
    if (!from || !to || from === to) {
      return;
    }
    const key = `${from}->${to}`;
    if (!unique.has(key)) {
      unique.set(key, {
        ...edge,
        id: `super-${index}-${from}-${to}`,
        from,
        to,
      });
    }
  });
  return [...unique.values()];
}

function mergeById(original: GraphNode[], placed: GraphNode[]) {
  const map = new Map(placed.map((node) => [node.id, node]));
  return original.map((node) => map.get(node.id) ?? node);
}

/**
 * Layout each subgraph as a compact block, then place those blocks
 * (plus leftover nodes) with the document direction.
 */
export function placeCompoundComponent(
  document: GraphDocument,
  nodes: GraphNode[],
  placeFlow: PlaceFlowFn,
  parentId: string | null = null,
): GraphNode[] {
  if (nodes.length === 0) {
    return nodes;
  }
  const lookup = subgraphLookup(document.subgraphs);
  const groups = immediateGroups(document, nodes, parentId);
  const cover = coveringGroup(groups, nodes, lookup);
  if (cover) {
    return placeCompoundComponent(document, nodes, placeFlow, cover.id);
  }
  if (groups.length === 0) {
    return placeFlow(nodes, null, {
      compact: parentId !== null,
      direction: parentId !== null ? nestedLayoutDirection(document.direction) : document.direction,
    });
  }

  const laidGroups = new Map<string, GraphNode[]>();
  const superNodes: GraphNode[] = [];
  const groupedIds = new Set<string>();

  groups.forEach((group) => {
    const members = membersOf(nodes, group.id, lookup);
    if (members.length === 0) {
      return;
    }
    const inner = placeCompoundComponent(document, members, placeFlow, group.id);
    laidGroups.set(group.id, inner);
    inner.forEach((node) => groupedIds.add(node.id));
    const size = chromeSize(inner);
    superNodes.push(superNode(group.id, size.width, size.height));
  });

  const leftovers = nodes.filter((node) => !groupedIds.has(node.id));
  superNodes.push(...leftovers.map((node) => ({ ...node })));

  const superDoc: GraphDocument = {
    ...document,
    nodes: superNodes,
    edges: collapseEdges(document, nodes, groups),
    subgraphs: [],
  };
  const placedSuper = placeFlow(superNodes, null, {
    graph: superDoc,
    direction: document.direction,
  });
  const bySuper = new Map(placedSuper.map((node) => [node.id, node]));

  const placed: GraphNode[] = [];
  laidGroups.forEach((members, groupId) => {
    const host = bySuper.get(groupId);
    if (!host) {
      placed.push(...members);
      return;
    }
    placed.push(...translateIntoChrome(members, host));
  });
  leftovers.forEach((node) => {
    const next = bySuper.get(node.id);
    placed.push(next ?? node);
  });
  return mergeById(nodes, placed);
}
