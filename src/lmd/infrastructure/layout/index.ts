/**
 * Dedicated layout module: topology-optimal placement, collision-free packing,
 * and persistent editable shape frames (compat extras.layoutFrames).
 */
export type {
  FrameHandle,
  LayoutFrame,
  LayoutPlan,
  LayoutPlanSlot,
  LayoutSolveMode,
  LayoutSolveOptions,
  LayoutSolveResult,
} from './types';
export {
  FRAME_DEFAULT_PADDING,
  FRAME_HEADER,
  FRAME_MIN_HEIGHT,
  FRAME_MIN_WIDTH,
} from './types';
export { buildLayoutPlan } from './topology';
export { nodesOverlap, resolveOverlaps } from './overlap';
export { nestedLayoutDirection, placeCompoundComponent } from './compound';
export { innerRect, solveOptimalLayout } from './solver';
export {
  cloneFrame,
  createFrameFromRect,
  createFrameId,
  exclusiveAssign,
  frameAsRect,
  frameInnerRect,
  handleRects,
  hitFrameBody,
  hitFrameHandle,
  hitFrameResize,
  nodesIntersectingRect,
  normalizeFrame,
  normalizeRect,
  pruneFrameMembers,
  readLayoutFrames,
  reflowFrame,
  resizeFrame,
  translateFrame,
  unionNodeBounds,
  writeLayoutFrames,
} from './frames';
export { readSequenceFrames, writeSequenceFrames } from './sequenceFrames';
export { readMindFrames, writeMindFrames } from './mindFrames';
