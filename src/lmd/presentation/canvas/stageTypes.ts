import type { GraphEdge } from '../..';
import type { FrameHandle, LayoutFrame } from '../../infrastructure/layout';
import type { MindFrame, SequenceFrame } from '../../placement';
import type { Rect, Vec2 } from './math';

export type { StageSelection } from '../../domain/selection';

export type StageInlineField = 'title' | 'description' | 'label';

export type StageInlinePane = {
  field: StageInlineField;
  value: string;
  viewRect: Rect;
  fill: string;
  color: string;
  fontSize: number;
  fontWeight: number;
  selectAll: boolean;
  multiline: boolean;
  placeholder?: string;
};

export type StageInlineEdit = StageInlinePane & {
  kind: 'node' | 'edge' | 'group' | 'frame' | 'sequence' | 'seq-actor' | 'seq-message' | 'mind' | 'mind-node';
  id: string;
  sceneId?: string;
  stroke?: string;
  /** The other title/description pane so both stay visible while editing. */
  companion?: StageInlinePane;
};

export type StagePerfStats = {
  fps: number;
  frameMs: number;
  drawnNodes: number;
  drawnEdges: number;
  drawnGroups: number;
  culled: number;
  totalNodes: number;
  totalEdges: number;
  totalGroups: number;
};

export type DragMode =
  | { type: 'none' }
  | { type: 'pan'; lastView: Vec2 }
  | {
      type: 'move';
      originWorld: Vec2;
      /** node id → start pos at pointer-down */
      starts: Map<string, Vec2>;
      sequenceStarts?: Map<string, SequenceFrame>;
      mindStarts?: Map<string, MindFrame>;
    }
  | { type: 'box'; startWorld: Vec2; currentWorld: Vec2; additive: boolean }
  | { type: 'seq-box'; sceneId: string; startWorld: Vec2; currentWorld: Vec2; additive: boolean }
  | { type: 'connect'; fromId: string; currentWorld: Vec2; edgeType: GraphEdge['type'] }
  | { type: 'frame-draw'; startWorld: Vec2; currentWorld: Vec2 }
  | {
      type: 'frame-move';
      id: string;
      originWorld: Vec2;
      start: LayoutFrame;
      nodeStarts: Map<string, Vec2>;
    }
  | {
      type: 'frame-resize';
      id: string;
      handle: FrameHandle;
      originWorld: Vec2;
      start: LayoutFrame;
    }
  | {
      type: 'sequence-move';
      id: string;
      originWorld: Vec2;
      start: SequenceFrame;
    }
  | {
      type: 'mind-move';
      id: string;
      originWorld: Vec2;
      start: MindFrame;
    }
  | {
      type: 'seq-actor-move';
      sceneId: string;
      id: string;
      originWorld: Vec2;
    }
  | {
      type: 'seq-message-move';
      sceneId: string;
      id: string;
      originWorld: Vec2;
    }
  | {
      type: 'seq-connect';
      sceneId: string;
      fromId: string;
      originWorld: Vec2;
      currentWorld: Vec2;
      arrow: 'call' | 'return';
    };
