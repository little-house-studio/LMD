/**
 * @deprecated Prefer `import type { ... } from '../lmd'` for format types.
 * This file re-exports LMD format types and keeps editor-only types used by legacy App.
 */

export type {
  Direction,
  NodeShape,
  EdgeType,
  ViewportState,
  GraphNode,
  GraphEdge,
  GraphSubgraph,
  LayoutSidecar,
  ProjectCompatExtras,
  ProjectCompatLayer,
  GraphDocument,
  ParsedDocument,
} from '../lmd/infrastructure/compat/types';

import type { Direction, EdgeType } from '../lmd/infrastructure/compat/types';

/** Editor shell modes (not part of .lmd file format). */
export type EditorMode = 'canvas' | 'source' | 'history';

export interface GraphSemanticSnapshot {
  revision: number;
  project: {
    name: string;
    summary: string;
    content: string;
  };
  diagram: {
    direction: Direction;
    nodes: Array<{
      id: string;
      label: string;
      title: string;
      description: string;
      subgraphId: string | null;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    edges: Array<{
      id: string;
      from: string;
      to: string;
      label: string;
      type: EdgeType;
    }>;
    subgraphs: Array<{
      id: string;
      title: string;
      parentId: string | null;
      collapsed: boolean;
    }>;
  };
  selection: {
    kind: 'none' | 'node' | 'edge' | 'subgraph' | 'content';
    ids: string[];
    subgraphIds?: string[];
  };
}

export type GraphOperation =
  | {
      type: 'updateProjectMeta';
      projectName?: string;
      projectSummary?: string;
    }
  | {
      type: 'updateContentMarkdown';
      markdown: string;
    }
  | {
      type: 'createNode';
      nodeId?: string;
      label?: string;
      subgraphId?: string | null;
    }
  | {
      type: 'updateNodeLabel';
      nodeId: string;
      label: string;
    }
  | {
      type: 'deleteNode';
      nodeId: string;
    }
  | {
      type: 'createEdge';
      edgeId?: string;
      from: string;
      to: string;
      label?: string;
      edgeType?: EdgeType;
    }
  | {
      type: 'updateEdgeLabel';
      edgeId: string;
      label: string;
    }
  | {
      type: 'deleteEdge';
      edgeId: string;
    }
  | {
      type: 'createSubgraph';
      subgraphId?: string;
      title?: string;
      parentId?: string | null;
      nodeIds?: string[];
    }
  | {
      type: 'updateSubgraphTitle';
      subgraphId: string;
      title: string;
    }
  | {
      type: 'moveNodeToSubgraph';
      nodeId: string;
      subgraphId: string | null;
    };

export interface GraphOperationBatchResult {
  applied: number;
  warnings: string[];
  revision: number;
}

export interface HistoryEntry {
  id: string;
  at: string;
  title: string;
  detail: string;
}

export interface SelectionState {
  kind: 'none' | 'node' | 'edge' | 'subgraph' | 'content';
  ids: string[];
  subgraphIds?: string[];
}
