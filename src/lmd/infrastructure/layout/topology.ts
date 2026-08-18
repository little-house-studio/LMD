import type { Direction, GraphDocument, GraphNode, GraphSubgraph } from '../compat/types';
import type { LayoutPlan, LayoutPlanSlot } from './types';

function isVertical(direction: Direction) {
  return direction === 'TD' || direction === 'BT';
}

function minorStart(node: GraphNode, direction: Direction) {
  return isVertical(direction) ? node.x : node.y;
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

function subgraphPath(subgraphId: string | null, lookup: Map<string, GraphSubgraph>) {
  const path: string[] = [];
  let current = subgraphId;
  while (current) {
    const subgraph = lookup.get(current);
    if (!subgraph) {
      break;
    }
    path.unshift(subgraph.title || subgraph.id);
    current = subgraph.parentId;
  }
  return path.join('/');
}

function semanticEdges(document: GraphDocument, scoped: GraphNode[]) {
  const nodeIds = new Set(scoped.map((node) => node.id));
  const lookup = subgraphLookup(document.subgraphs);
  const degree = new Map(scoped.map((node) => [node.id, 0]));
  document.edges.forEach((edge) => {
    if (nodeIds.has(edge.from)) {
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    }
    if (nodeIds.has(edge.to)) {
      degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    }
  });

  const resolve = (endpoint: string) => {
    if (nodeIds.has(endpoint)) {
      return endpoint;
    }
    const members = scoped
      .filter((node) => belongsToSubgraph(node, endpoint, lookup))
      .sort((left, right) => (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0));
    return members[0]?.id ?? null;
  };

  const unique = new Map<string, { from: string; to: string }>();
  document.edges.forEach((edge) => {
    const from = resolve(edge.from);
    const to = resolve(edge.to);
    if (!from || !to || from === to) {
      return;
    }
    unique.set(`${from}->${to}`, { from, to });
  });
  return [...unique.values()];
}

function barycenter(id: string, neighbors: Map<string, string[]>, order: Map<string, number>) {
  const values = (neighbors.get(id) ?? [])
    .map((next) => order.get(next))
    .filter((value): value is number => typeof value === 'number');
  if (values.length === 0) {
    return Number.NaN;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

type TopologyEdge = { from: string; to: string };

export type LayoutComponent = {
  kind: 'flow' | 'notes';
  nodes: GraphNode[];
};

function edgeKey(edge: TopologyEdge) {
  return `${edge.from}->${edge.to}`;
}

/** DFS back-edges become a feedback arc set so cycles do not collapse into one rank. */
function feedbackKeys(ids: string[], edges: TopologyEdge[]) {
  const adjacency = new Map(ids.map((id) => [id, [] as TopologyEdge[]]));
  edges.forEach((edge) => adjacency.get(edge.from)?.push(edge));
  const color = new Map(ids.map((id) => [id, 0]));
  const feedback = new Set<string>();
  const visit = (id: string) => {
    color.set(id, 1);
    for (const edge of adjacency.get(id) ?? []) {
      const next = color.get(edge.to) ?? 0;
      if (next === 1) {
        feedback.add(edgeKey(edge));
      } else if (next === 0) {
        visit(edge.to);
      }
    }
    color.set(id, 2);
  };
  ids.forEach((id) => {
    if (color.get(id) === 0) {
      visit(id);
    }
  });
  return feedback;
}

function longestPathRanks(ids: string[], edges: TopologyEdge[]) {
  const dag = edges.filter((edge) => !feedbackKeys(ids, edges).has(edgeKey(edge)));
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  const incoming = new Map(ids.map((id) => [id, 0]));
  dag.forEach((edge) => {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  });
  const rankOf = new Map(ids.map((id) => [id, 0]));
  const ready = ids.filter((id) => (incoming.get(id) ?? 0) === 0);
  while (ready.length > 0) {
    const id = ready.shift();
    if (!id) {
      break;
    }
    const rank = rankOf.get(id) ?? 0;
    (outgoing.get(id) ?? []).forEach((next) => {
      rankOf.set(next, Math.max(rankOf.get(next) ?? 0, rank + 1));
      incoming.set(next, (incoming.get(next) ?? 1) - 1);
      if ((incoming.get(next) ?? 0) === 0) {
        ready.push(next);
      }
    });
  }
  return rankOf;
}

export function partitionLayoutComponents(
  document: GraphDocument,
  scopedNodes: GraphNode[],
): LayoutComponent[] {
  const edges = semanticEdges(document, scopedNodes);
  const incident = new Set<string>();
  edges.forEach((edge) => {
    incident.add(edge.from);
    incident.add(edge.to);
  });
  const notes = scopedNodes.filter((node) => !incident.has(node.id));
  const flowNodes = scopedNodes.filter((node) => incident.has(node.id));
  const parent = new Map(flowNodes.map((node) => [node.id, node.id]));
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current !== id) {
      const root = find(current);
      parent.set(id, root);
      return root;
    }
    return id;
  };
  edges.forEach((edge) => {
    if (!parent.has(edge.from) || !parent.has(edge.to)) {
      return;
    }
    const left = find(edge.from);
    const right = find(edge.to);
    if (left !== right) {
      parent.set(right, left);
    }
  });
  const grouped = new Map<string, GraphNode[]>();
  flowNodes.forEach((node) => {
    const root = find(node.id);
    grouped.set(root, [...(grouped.get(root) ?? []), node]);
  });
  const flows = [...grouped.values()].sort((left, right) => {
    const indexOf = (nodes: GraphNode[]) =>
      scopedNodes.findIndex((node) => node.id === nodes[0]?.id);
    return indexOf(left) - indexOf(right);
  });
  const parts: LayoutComponent[] = flows.map((nodes) => ({ kind: 'flow', nodes }));
  if (notes.length > 0) {
    parts.push({ kind: 'notes', nodes: notes });
  }
  return parts;
}

/**
 * Layered topology: break cycles, longest-path ranks, barycenter sweeps.
 * Isolated nodes share one trailing rank (packed later as a notes grid).
 */
export function buildLayoutPlan(document: GraphDocument, scopedNodes: GraphNode[]): LayoutPlan {
  const direction = document.direction;
  const ids = scopedNodes.map((node) => node.id);
  const edges = semanticEdges(document, scopedNodes);
  const lookup = subgraphLookup(document.subgraphs);

  if (ids.length === 0) {
    return { direction, slots: [] };
  }

  const rankOf = longestPathRanks(ids, edges);
  const incident = new Set<string>();
  edges.forEach((edge) => {
    incident.add(edge.from);
    incident.add(edge.to);
  });
  const isolatedRank = Math.max(0, ...rankOf.values()) + (incident.size > 0 ? 1 : 0);
  scopedNodes
    .filter((node) => !incident.has(node.id))
    .forEach((node) => {
      rankOf.set(node.id, isolatedRank);
    });

  const grouped = new Map<number, GraphNode[]>();
  scopedNodes.forEach((node) => {
    const rank = rankOf.get(node.id) ?? 0;
    grouped.set(rank, [...(grouped.get(rank) ?? []), node]);
  });
  const ranks = [...grouped.keys()].sort((left, right) => left - right);

  const incomingN = new Map<string, string[]>();
  const outgoingN = new Map<string, string[]>();
  scopedNodes.forEach((node) => {
    incomingN.set(node.id, []);
    outgoingN.set(node.id, []);
  });
  edges.forEach((edge) => {
    incomingN.get(edge.to)?.push(edge.from);
    outgoingN.get(edge.from)?.push(edge.to);
  });

  const order = new Map<string, number>();
  const sortSlot = (nodes: GraphNode[]) =>
    [...nodes].sort((left, right) => {
      const path = subgraphPath(left.subgraphId, lookup).localeCompare(subgraphPath(right.subgraphId, lookup));
      if (path !== 0) {
        return path;
      }
      const minor = minorStart(left, direction) - minorStart(right, direction);
      if (minor !== 0) {
        return minor;
      }
      return left.id.localeCompare(right.id);
    });

  ranks.forEach((rank) => {
    const sorted = sortSlot(grouped.get(rank) ?? []);
    grouped.set(rank, sorted);
    sorted.forEach((node, index) => order.set(node.id, index));
  });

  for (let sweep = 0; sweep < 4; sweep += 1) {
    const ascending = sweep % 2 === 0;
    const walk = ascending ? ranks : [...ranks].reverse();
    walk.forEach((rank) => {
      const nodes = [...(grouped.get(rank) ?? [])];
      const neighbors = ascending ? incomingN : outgoingN;
      nodes.sort((left, right) => {
        const path = subgraphPath(left.subgraphId, lookup).localeCompare(subgraphPath(right.subgraphId, lookup));
        if (path !== 0) {
          return path;
        }
        const lb = barycenter(left.id, neighbors, order);
        const rb = barycenter(right.id, neighbors, order);
        if (Number.isFinite(lb) && Number.isFinite(rb) && lb !== rb) {
          return lb - rb;
        }
        if (Number.isFinite(lb) && !Number.isFinite(rb)) {
          return -1;
        }
        if (!Number.isFinite(lb) && Number.isFinite(rb)) {
          return 1;
        }
        return left.id.localeCompare(right.id);
      });
      grouped.set(rank, nodes);
      nodes.forEach((node, index) => order.set(node.id, index));
    });
  }

  const slots: LayoutPlanSlot[] = ranks.map((rank) => ({
    rank,
    nodeIds: (grouped.get(rank) ?? []).map((node) => node.id),
  }));

  return { direction, slots };
}
