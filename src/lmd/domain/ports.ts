import type { GraphDocument } from '@lths/lmd/legacy';

/** Canvas talks to editing through this port — never import FlowApp. */
export type CanvasEditingPort = {
  duplicateNodes: (
    document: GraphDocument,
    nodeIds: string[],
    offset?: number,
  ) => { document: GraphDocument; newIds: string[] };
  insertNodeIntoEdge: (
    document: GraphDocument,
    edgeId: string,
    insertedId: string,
  ) => GraphDocument;
};
