import type { Direction, GraphNode } from '../compat/types';
import type { Rect } from '../../shared/geom';

/** Persistent, editable layout shape stored in lths-compat extras. */
export type LayoutFrame = {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeIds: string[];
  padding: number;
};

export type LayoutSolveMode = 'optimal' | 'tidy';

export type LayoutSolveOptions = {
  /** Restrict to these node ids. Default: every node. */
  nodeIds?: Iterable<string>;
  /** Pack into this world rect (already the inner content box). */
  bounds?: Rect;
  mode?: LayoutSolveMode;
  /** `origin` ignores leftover coordinates so placement is topology-only. */
  anchor?: 'origin' | 'centroid';
};

export type LayoutPlanSlot = {
  rank: number;
  nodeIds: string[];
};

export type LayoutPlan = {
  direction: Direction;
  slots: LayoutPlanSlot[];
};

export type LayoutSolveResult = {
  nodes: GraphNode[];
  plan: LayoutPlan;
};

export type FrameHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const FRAME_MIN_WIDTH = 168;
export const FRAME_MIN_HEIGHT = 128;
export const FRAME_DEFAULT_PADDING = 28;
export const FRAME_HEADER = 26;
