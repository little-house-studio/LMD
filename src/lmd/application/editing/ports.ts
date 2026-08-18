import type { CanvasEditingPort } from '../../domain/ports';
import { insertNodeIntoEdge } from './edges';
import { duplicateNodesInDocument } from './nodes';

export const defaultCanvasEditing: CanvasEditingPort = {
  duplicateNodes: duplicateNodesInDocument,
  insertNodeIntoEdge,
};
