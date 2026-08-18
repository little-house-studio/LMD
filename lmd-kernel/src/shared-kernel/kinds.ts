/** Shared graph primitives. Display (Mermaid) and IR use the same unions. */

export type Direction = 'TD' | 'LR' | 'RL' | 'BT';

export type NodeShape =
  | 'rect'
  | 'round'
  | 'diamond'
  | 'circle'
  | 'hexagon'
  | 'database'
  | 'subroutine';

export type EdgeKind = 'solid' | 'dotted' | 'thick' | 'line';

export const CANVAS_DIAGRAM_TYPES = ['flowchart', 'graph'] as const;
export type CanvasDiagramType = (typeof CANVAS_DIAGRAM_TYPES)[number];

export function isCanvasDiagramType(value: string): value is CanvasDiagramType {
  return value === 'flowchart' || value === 'graph';
}
