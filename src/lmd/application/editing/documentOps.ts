/** Compatibility barrel. Prefer `application/editing`. */
export {
  createNodeInDocument,
  duplicateNodesInDocument,
  pasteClonedNodesInDocument,
  updateNodeInDocument,
} from './nodes';
export { insertNodeIntoEdge, updateEdgeInDocument } from './edges';
export {
  groupNodesInDocument,
  ungroupNodesInDocument,
  updateSubgraphInDocument,
} from './groups';
export { deleteIdsFromDocument } from './selection';
export {
  createRelatedNodesInDocument,
  placementForRelatedNode,
} from './related';
export type { RelatedNodeRelation } from './related';
export { autoLayoutDocument, tidyLayoutDocument } from './layoutOps';
export { standardizeDocument, updateProjectMeta } from './project';
export { defaultCanvasEditing } from './ports';
export type { CanvasEditingPort } from '../../domain/ports';
export { composeEntityText, isPlaceholderTitle, splitEntityText } from '../../domain/label';
