export type EditorMode = 'canvas' | 'source' | 'history';
export type Direction = 'TD' | 'LR' | 'RL' | 'BT';
export type NodeShape =
  | 'rect'
  | 'round'
  | 'diamond'
  | 'circle'
  | 'hexagon'
  | 'database'
  | 'subroutine';
export type EdgeType = 'solid' | 'dotted' | 'thick' | 'line';

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface GraphNode {
  id: string;
  label: string;
  shape: NodeShape;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  textColor: string;
  subgraphId: string | null;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  type: EdgeType;
  strokeColor: string;
  strokeWidth: number;
}

export interface GraphSubgraph {
  id: string;
  title: string;
  parentId: string | null;
  collapsed: boolean;
}

export interface LayoutSidecar {
  version: number;
  viewport: ViewportState;
  nodes: Record<string, Pick<GraphNode, 'x' | 'y' | 'width' | 'height'>>;
  subgraphs: Record<string, { collapsed: boolean }>;
}

export interface GraphDocument {
  direction: Direction;
  nodes: GraphNode[];
  edges: GraphEdge[];
  subgraphs: GraphSubgraph[];
  warnings: string[];
  unsupportedLines: string[];
  source: string;
  layout: LayoutSidecar;
}

export interface HistoryEntry {
  id: string;
  at: string;
  title: string;
  detail: string;
}

export interface SelectionState {
  kind: 'none' | 'node' | 'edge' | 'subgraph';
  ids: string[];
}

export interface ParsedDocument {
  direction: Direction;
  nodes: GraphNode[];
  edges: GraphEdge[];
  subgraphs: GraphSubgraph[];
  warnings: string[];
  unsupportedLines: string[];
  layout: LayoutSidecar;
}
