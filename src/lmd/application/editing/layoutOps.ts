import type { GraphDocument } from '@lths/lmd/legacy';
import { DEFAULT_CANVAS_POLICY, type CanvasPolicy } from '../../domain/canvasPolicy';
import { organizeDocument } from '../layout/organize';
import type { LayoutSelection } from '../layout/graphLayout';

/** Kernel `layout.auto` / 最优布局 — same structural organize as 整理. */
export function autoLayoutDocument(
  document: GraphDocument,
  selection?: LayoutSelection,
  policy: CanvasPolicy = DEFAULT_CANVAS_POLICY,
): GraphDocument {
  return organizeDocument(document, selection, policy);
}

/** Kernel `layout.tidy` / 整理. */
export function tidyLayoutDocument(
  document: GraphDocument,
  selection?: LayoutSelection,
  policy: CanvasPolicy = DEFAULT_CANVAS_POLICY,
): GraphDocument {
  return organizeDocument(document, selection, policy);
}
