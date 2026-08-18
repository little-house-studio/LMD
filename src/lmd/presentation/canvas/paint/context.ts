import type { GraphDocument, GraphNode, GraphSubgraph } from '../../..';
import type { CanvasPolicy } from '../../../domain/canvasPolicy';
import type { StageSelection } from '../../../domain/selection';
import type { LayoutFrame } from '../../../infrastructure/layout';
import type {
  EdgeGeometry,
  EndpointBox,
  MindFrame,
  MindPaintModel,
  SequenceFrame,
  SequencePaintModel,
} from '../../../placement';
import { worldStrokeWidth } from '../../../infrastructure/hotpath/paintOpt';
import type { Camera } from '../camera';
import type { Rect } from '../math';
import type { DragMode } from '../stageTypes';
import type { PaintCache } from './cache';
import type { SceneMetrics } from '../visibility';

export type SceneContext = {
  camera: Camera;
  dpr: number;
  cssW: number;
  cssH: number;
  ctx: CanvasRenderingContext2D | null;
  policy: CanvasPolicy;
  selection: StageSelection;
  drag: DragMode;
  lockPositions: boolean;
  inlineSession: { kind: string; id: string } | null;
  doc: GraphDocument;
  nodeMap: Map<string, GraphNode>;
  nodeOrder: Map<string, number>;
  subgraphMap: Map<string, GraphSubgraph>;
  groupRectCache: Map<string, Rect>;
  edgeRoutes: Map<string, EdgeGeometry>;
  frames: LayoutFrame[];
  seqFrames: SequenceFrame[];
  mindFrames: MindFrame[];
  groupsPaintOrder: GraphSubgraph[];
  nestDepth: number;
  cache: PaintCache;
  metrics: SceneMetrics;
  queryVisibleNodeIds: (rect: Rect) => string[];
  sequenceModel: (id: string) => SequencePaintModel | null;
  mindModel: (id: string) => MindPaintModel | null;
  endpointBox: (id: string) => EndpointBox | null;
  frameById: (id: string) => LayoutFrame | null;
};

export function screenPx(scene: SceneContext, px: number) {
  return worldStrokeWidth(px, scene.camera.scale);
}
