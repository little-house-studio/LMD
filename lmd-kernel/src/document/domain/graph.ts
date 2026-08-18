import type { Direction, EdgeKind, NodeShape } from '../../shared-kernel/kinds';

export interface TodoIR {
  message?: string;
  prio?: string;
  status?: string;
}

export interface NodeIR {
  id: string;
  /** Display name written in `.lmd` quotes. */
  title: string;
  /** Optional description (from Mermaid label on migrate). */
  label: string;
  shape: NodeShape;
  groupId: string | null;
  comment?: string;
  todo?: TodoIR;
  url?: string;
}

export interface EdgeIR {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: EdgeKind;
  comment?: string;
  todo?: TodoIR;
  url?: string;
}

export interface GroupIR {
  id: string;
  title: string;
  parentId: string | null;
  comment?: string;
  todo?: TodoIR;
  url?: string;
}

export interface GraphIR {
  direction: Direction;
  nodes: NodeIR[];
  edges: EdgeIR[];
  groups: GroupIR[];
}

export function emptyGraph(direction: Direction = 'LR'): GraphIR {
  return { direction, nodes: [], edges: [], groups: [] };
}

export function nodeById(graph: GraphIR, id: string) {
  return graph.nodes.find((node) => node.id === id) ?? null;
}

export function edgeById(graph: GraphIR, id: string) {
  return graph.edges.find((edge) => edge.id === id) ?? null;
}

export function groupById(graph: GraphIR, id: string) {
  return graph.groups.find((group) => group.id === id) ?? null;
}

export function usedNodeIds(graph: GraphIR) {
  return new Set(graph.nodes.map((node) => node.id));
}

export function usedGroupIds(graph: GraphIR) {
  return new Set(graph.groups.map((group) => group.id));
}

export function usedEdgeIds(graph: GraphIR) {
  return new Set(graph.edges.map((edge) => edge.id));
}

export function endpointIds(graph: GraphIR) {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    ids.add(node.id);
  }
  for (const group of graph.groups) {
    ids.add(group.id);
  }
  return ids;
}
