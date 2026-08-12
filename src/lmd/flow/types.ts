import type { Edge, Node } from '@xyflow/react';
import type { EdgeType, NodeShape } from '..';

// data must extend Record<string, unknown> for @xyflow Node generics
export type LmdNodeData = {
  kind: 'node';
  title: string;
  description: string;
  shape: NodeShape;
  fill: string;
  stroke: string;
  textColor: string;
  /** Absolute width used when serializing layout. */
  width: number;
  height: number;
  [key: string]: unknown;
};

export type LmdGroupData = {
  kind: 'group';
  title: string;
  fill: string;
  stroke: string;
  textColor: string;
  collapsed: boolean;
  width: number;
  height: number;
  [key: string]: unknown;
};

export type LmdEdgeData = {
  edgeType: EdgeType;
  labelText: string;
  [key: string]: unknown;
};

export type LmdFlowNode = Node<LmdNodeData | LmdGroupData, 'lmdNode' | 'lmdGroup'>;
export type LmdFlowEdge = Edge<LmdEdgeData>;

export const DEFAULT_NODE_STYLE = {
  fill: '#121214',
  stroke: '#d6ff3a',
  textColor: '#f4f4f5',
} as const;

export const DEFAULT_GROUP_STYLE = {
  fill: '#141418',
  stroke: '#00f0ff',
  textColor: '#f4f4f5',
} as const;

export const DEFAULT_EDGE_STYLE = {
  strokeColor: '#8a8a94',
  strokeWidth: 1.75,
} as const;
