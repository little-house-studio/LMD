import type { Edge, Node } from '@xyflow/react';
import type { EdgeType, NodeShape } from '../..';

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

export { DEFAULT_EDGE_STYLE, DEFAULT_GROUP_STYLE, DEFAULT_NODE_STYLE } from '../../domain/style';
