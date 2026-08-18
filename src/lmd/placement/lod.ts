/**
 * Project Graph-style canvas LOD from camera scale.
 * details → names → groups (grouped members fold; nested groups peel inward).
 */
export const LOD_DETAILS_MIN = 0.5;
export const LOD_NAMES_MIN = 0.28;
/** Extra zoom-out before the next nesting level folds into its parent. */
export const LOD_NEST_STEP = 0.08;
export const LOD_NEST_MIN = LOD_NAMES_MIN - LOD_NEST_STEP;

export type CanvasLod = 'details' | 'names' | 'groups';

export function canvasLod(scale: number, hasGroups = true): CanvasLod {
  if (scale >= LOD_DETAILS_MIN) {
    return 'details';
  }
  if (scale >= LOD_NAMES_MIN || !hasGroups) {
    return 'names';
  }
  return 'groups';
}

export function nodeBelongsToGroup(node: { subgraphId?: string | null }): boolean {
  return Boolean(node.subgraphId);
}

/** Deepest group chrome still drawn. Infinity = every nesting level. */
export function maxVisibleGroupDepth(scale: number, maxDepthInDoc = 0): number {
  if (scale >= LOD_NEST_MIN) {
    return Number.POSITIVE_INFINITY;
  }
  const peeled = Math.floor((LOD_NEST_MIN - scale) / LOD_NEST_STEP) + 1;
  return Math.max(0, maxDepthInDoc - peeled);
}

export function groupVisibleAtScale(depth: number, scale: number, maxDepthInDoc = 0): boolean {
  return depth <= maxVisibleGroupDepth(scale, maxDepthInDoc);
}

/** An edge folds away when either endpoint lives in a subgraph. */
export function hidesGroupedEdge(
  from?: { subgraphId?: string | null } | null,
  to?: { subgraphId?: string | null } | null,
): boolean {
  return Boolean((from && nodeBelongsToGroup(from)) || (to && nodeBelongsToGroup(to)));
}
