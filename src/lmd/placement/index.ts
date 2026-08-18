/**
 * Spatial placement — the only place that owns node / edge / group geometry.
 * Presentation paints these results; it must not reimplement them.
 */
export {
  adaptiveStubLength,
  arrowHeading,
  buildConnectPreview,
  buildEdgeGeometry,
  buildEdgeLaneMap,
  clampLabelToViewport,
  cubicToSvgPath,
  distPointToEdgeSq,
  distanceToBox,
  EDGE_LABEL_MIN_SCALE,
  edgeBounds,
  estimateLabelSize,
  faceNormal,
  facePoint,
  labelHitRect,
  nodeCenter,
  preferredEnterFace,
  preferredExitFace,
  routeSceneEdges,
  snapConnectTarget,
} from './edges';
export type {
  ClampLabelOptions,
  ConnectSnapTarget,
  EdgeGeometry,
  EndpointBox,
  Face,
  RouteLabelMode,
} from './edges';

export {
  computeGroupRects,
  GROUP_HEADER,
  GROUP_NEST_PAD,
  GROUP_PAD,
  groupBounds,
  subgraphDepth,
} from './groups';

export {
  flattenSequenceSteps,
  hitSequenceFrame,
  hitSequenceActivation,
  hitSequenceInterior,
  inferSequenceActivations,
  insertSequenceMessageAt,
  intersectingSequenceFrameIds,
  intersectingSequenceInterior,
  layoutSequenceScene,
  reorderSequenceSteps,
  searchFreeSequenceOrigin,
  sequenceColumnIndexAt,
  sequenceColumnInsertIndex,
  sequenceConnectArrow,
  sequenceConnectAttachX,
  sequenceConnectStart,
  sequenceConnectTarget,
  sequenceMessageIndexAt,
  sequenceMessageInsertIndex,
  measureSequenceScene,
  sequenceFrameAsRect,
  syncSequenceFrames,
  translateSequenceFrame,
  SEQ_ACT_W,
  SEQ_COL_W,
  SEQ_FOOTER,
  SEQ_HEADER,
  SEQ_MIN_HEIGHT,
  SEQ_MIN_WIDTH,
  SEQ_PAD,
  SEQ_ROW_H,
} from './sequence';
export type {
  SequenceConnectTarget,
  SequenceFrame,
  SequenceInteriorHit,
  SequencePaintActivation,
  SequencePaintModel,
} from './sequence';

export {
  hitMindFrame,
  hitMindInterior,
  intersectingMindFrameIds,
  layoutMindMap,
  measureMindMap,
  mindFrameAsRect,
  mindNodeParentId,
  searchFreeMindOrigin,
  syncMindFrames,
  translateMindFrame,
  MIND_ADD,
  MIND_HEADER,
  MIND_MIN_HEIGHT,
  MIND_MIN_WIDTH,
} from './mind';
export type {
  MindFrame,
  MindInteriorHit,
  MindPaintLink,
  MindPaintModel,
  MindPaintNode,
} from './mind';

export { snapNodeToGrid, snapNodesToGrid, snapPoint, snapScalar } from './grid';
export { fieldAtNodePoint, fitWrappedText, nodeContentBands } from './content';
export type { FitWrappedText, NodeContentBands } from './content';

export {
  canvasLod,
  groupVisibleAtScale,
  hidesGroupedEdge,
  LOD_DETAILS_MIN,
  LOD_NAMES_MIN,
  LOD_NEST_MIN,
  LOD_NEST_STEP,
  maxVisibleGroupDepth,
  nodeBelongsToGroup,
} from './lod';
export type { CanvasLod } from './lod';
