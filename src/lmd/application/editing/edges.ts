import type { EdgeType, GraphDocument } from '@lths/lmd/legacy';
import { refreshSource } from './source';

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

export function insertNodeIntoEdge(
  document: GraphDocument,
  edgeId: string,
  insertedId: string,
): GraphDocument {
  const target = document.edges.find((edge) => edge.id === edgeId);
  if (!target || target.from === insertedId || target.to === insertedId) {
    return document;
  }
  return refreshSource({
    ...document,
    edges: document.edges.flatMap((edge) => {
      if (edge.id !== edgeId) {
        return [edge];
      }
      return [
        { ...edge, to: insertedId },
        {
          ...edge,
          id: `edge_${insertedId}_${edge.to}_${Math.random().toString(36).slice(2, 6)}`,
          from: insertedId,
          to: edge.to,
          label: '',
        },
      ];
    }),
  });
}
