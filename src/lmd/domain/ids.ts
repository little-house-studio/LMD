import type { GraphDocument } from '@lths/lmd/legacy';

export function usedNodeIds(document: GraphDocument) {
  return new Set(document.nodes.map((node) => node.id));
}

export function usedSubgraphIds(document: GraphDocument) {
  return new Set(document.subgraphs.map((subgraph) => subgraph.id));
}
