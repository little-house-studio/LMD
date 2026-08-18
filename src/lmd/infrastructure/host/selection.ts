import type { GraphDocument } from '@lths/lmd/legacy';
import type { StageSelection } from '../../domain/selection';

export function selectionForHost(selection: StageSelection, document: GraphDocument) {
  if (selection.kind === 'none') {
    return { kind: 'none' as const };
  }
  if (selection.kind === 'mixed') {
    if (selection.nodes.length) {
      return { kind: 'node' as const, nodeIds: selection.nodes };
    }
    if (selection.groups.length) {
      return { kind: 'subgraph' as const, subgraphIds: selection.groups };
    }
    return { kind: 'none' as const };
  }
  if (selection.kind === 'node') {
    return { kind: 'node' as const, nodeIds: selection.ids };
  }
  if (selection.kind === 'group') {
    return { kind: 'subgraph' as const, subgraphIds: selection.ids };
  }
  if (
    selection.kind === 'frame'
    || selection.kind === 'sequence'
    || selection.kind === 'seq-actor'
    || selection.kind === 'seq-message'
    || selection.kind === 'mind'
    || selection.kind === 'mind-node'
  ) {
    return { kind: 'none' as const };
  }
  return {
    kind: 'edge' as const,
    edges: selection.ids.flatMap((id) => {
      const edge = document.edges.find((entry) => entry.id === id);
      return edge ? [{ from: edge.from, to: edge.to, label: edge.label }] : [];
    }),
  };
}
