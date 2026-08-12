/**
 * LMD format domain types.
 *
 * Pure data shapes for `.lmd` project documents, Mermaid flowchart graphs,
 * and the editor compat sidecar (`lths-compat`). No React / canvas / UI.
 */

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
  fill: string;
  stroke: string;
  textColor: string;
}

export interface LayoutSidecar {
  version: number;
  viewport: ViewportState;
  nodes: Record<string, Pick<GraphNode, 'x' | 'y' | 'width' | 'height'>>;
  subgraphs: Record<string, { collapsed: boolean }>;
}

export interface ProjectCompatExtras {
  contentBox?: [number, number] | [number, number, 1];
  contentBoxSize?: [number, number];
  [key: string]: unknown;
}

export interface ProjectCompatLayer {
  version: number;
  layout: LayoutSidecar;
  editor?: {
    localFileActions?: {
      enabled: boolean;
    };
  };
  extras?: ProjectCompatExtras;
}

/** Full in-memory LMD project (Markdown shell + parsed Mermaid + layout). */
export interface GraphDocument {
  diagramType: string;
  direction: Direction;
  nodes: GraphNode[];
  edges: GraphEdge[];
  subgraphs: GraphSubgraph[];
  warnings: string[];
  unsupportedLines: string[];
  source: string;
  layout: LayoutSidecar;
  markdown?: string;
  projectName?: string;
  projectSummary?: string;
  prefixMarkdown?: string;
  suffixMarkdown?: string;
  contentMarkdown?: string;
  compat?: ProjectCompatLayer;
}

/** Result of parsing only the Mermaid flowchart body. */
export interface ParsedDocument {
  diagramType: string;
  direction: Direction;
  nodes: GraphNode[];
  edges: GraphEdge[];
  subgraphs: GraphSubgraph[];
  warnings: string[];
  unsupportedLines: string[];
  layout: LayoutSidecar;
}
