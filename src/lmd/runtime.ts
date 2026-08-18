/**
 * Editor library facade. Hosts embed this — not FlowApp internals.
 *
 * Protocol / parse stays on `@lths/lmd`.
 * Canvas behavior is `CanvasPolicy` (mode, snap, tools).
 * 整理 is `organizeDocument` / kernel `layout.tidy`.
 */
export {
  DEFAULT_CANVAS_POLICY,
  positionsLocked,
  resolveCanvasPolicy,
} from './domain/canvasPolicy';
export type {
  CanvasPolicy,
  CanvasToolsPolicy,
  GridSnapPolicy,
  LayoutMode,
} from './domain/canvasPolicy';
export type { CanvasEditingPort } from './domain/ports';
export {
  applyStructuralLayout,
  hydrateViewDocument,
  markdownPersistsNodeLayout,
  organizeDocument,
  persistCompatLayout,
} from './application/layout/organize';
export { autoLayoutDocument, tidyLayoutDocument } from './application/editing/layoutOps';
export {
  documentToMarkdown,
  documentToMermaid,
  documentToMeta,
  documentToRelation,
  initialDocument,
  parseSafe,
  printProjectBundle,
} from './application/io/documentIo';
export type { ProjectBundle } from './application/io/documentIo';
export { StageCanvas } from './presentation/canvas/StageCanvas';
export type { StageInlineEdit, StageSelection } from './presentation/canvas/StageCanvas';
export { default as FlowApp } from './presentation/shell/FlowApp';
