import {
  buildEntityIdFromTitle,
  measureNodeContentSize,
  toSidecar,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type GraphSubgraph,
} from '../..';
import type { CanvasSelectionKind, StageSelection } from '../../domain/selection';
import {
  collectSelection,
  isCanvasIdSelected,
  mindMapIdOf,
  partsOf,
  sequenceSceneIdOf,
  toggleCanvasIds,
} from '../../domain/selection';
import {
  addMindTopicInDocument,
  addSequenceMessageInDocument,
  addSequenceParticipantInDocument,
  createMindMapInDocument,
  createSequenceSceneInDocument,
  defaultCanvasEditing,
  removeMindTopicInDocument,
  removeSequenceMessageInDocument,
  removeSequenceParticipantInDocument,
  renameMindTopicInDocument,
  renameSequenceParticipantInDocument,
  updateMindMapInDocument,
  updateSequenceMessageInDocument,
  type CanvasEditingPort,
} from '../../application/editing';
import { DEFAULT_CANVAS_POLICY, positionsLocked, type CanvasPolicy } from '../../domain/canvasPolicy';
import {
  createFrameFromRect,
  exclusiveAssign,
  frameAsRect,
  frameInnerRect,
  hitFrameBody,
  hitFrameResize,
  nodesIntersectingRect,
  pruneFrameMembers,
  readLayoutFrames,
  resizeFrame,
  solveOptimalLayout,
  translateFrame,
  unionNodeBounds,
  type LayoutFrame,
} from '../../infrastructure/layout';
import { readMindFrames, writeMindFrames } from '../../infrastructure/layout/mindFrames';
import { readSequenceFrames, writeSequenceFrames } from '../../infrastructure/layout/sequenceFrames';
import {
  isInsideCollapsedSubgraph,
  isSubgraphHiddenByCollapsedAncestor,
  membersOfSubgraph,
  nodeCollisionObstacles,
  searchFreeRect,
  subgraphLookup,
} from '../../application/layout/graphLayout';
import {
  DEFAULT_EDGE_STYLE,
  DEFAULT_NODE_STYLE,
} from '../../domain/style';
import { composeEntityText, isPlaceholderTitle, splitEntityText } from '../../domain/label';
import { SceneSpatialIndex } from '../../infrastructure/hotpath/canvasEngine';
import {
  derivedSceneRevision,
  markDerivedSceneRebuild,
  shouldRebuildDerivedScene,
} from '../../infrastructure/hotpath/paintOpt';
import {
  hotPathCounters,
  interpretCanvasWheel,
  pinchScaleFactor,
  topologyRevisionFromGraph,
} from '../../infrastructure/hotpath/sceneHotPath';
import { Camera } from './camera';
import {
  computeGroupRects,
  fieldAtNodePoint,
  GROUP_HEADER,
  LOD_NAMES_MIN,
  mindFrameAsRect,
  routeSceneEdges,
  subgraphDepth,
  sequenceFrameAsRect,
  snapScalar,
  type EdgeGeometry,
  type EndpointBox,
  type MindFrame,
  type SequenceFrame,
} from '../../placement';
import {
  hitSequenceInterior,
  intersectingSequenceFrameIds,
  intersectingSequenceInterior,
  layoutSequenceScene,
  measureSequenceScene,
  searchFreeSequenceOrigin,
  sequenceColumnIndexAt,
  sequenceColumnInsertIndex,
  sequenceConnectArrow,
  sequenceConnectAttachX,
  sequenceConnectStart,
  sequenceConnectTarget,
  sequenceMessageIndexAt,
  sequenceMessageInsertIndex,
  reorderSequenceSteps,
  syncSequenceFrames,
  translateSequenceFrame,
} from '../../placement/sequence';
import {
  hitMindInterior,
  intersectingMindFrameIds,
  layoutMindMap,
  measureMindMap,
  searchFreeMindOrigin,
  syncMindFrames,
  translateMindFrame,
} from '../../placement/mind';
import {
  collectEndpointBoxes,
  connectBoxes,
  hasEndpoint as endpointExists,
  hitEndpointPort,
  resolveEndpointBox,
  snapSceneConnect,
} from './endpoints';
import { hitEdgeAt, hitGroupAt, hitTestScene } from './interact/hitTest';
import { buildInlineEdit } from './interact/inlineEdit';
import { selectionWorldBounds } from './interact/selectionBounds';
import { groupTitleWorldChip } from './labelChips';
import {
  exportSceneSvg,
  PaintCache,
  paintCanvasFrame,
  paintScene,
  type SceneContext,
} from './paint';
import {
  hidesSceneEdge,
  isGroupHidden,
  isNodeHidden,
  sceneMetrics,
} from './visibility';
import { cloneWorkingDocument, refreshWorkingDocument } from './workingDoc';
import type { DragMode, StageInlineEdit, StageInlineField, StagePerfStats } from './stageTypes';
import {
  rectIntersects,
  unionRects,
  type Rect,
  type Vec2,
} from './math';

export type { StageSelection, StageInlineEdit, StageInlineField, StageInlinePane, StagePerfStats } from './stageTypes';

/**
 * Project-Graph style stage engine:
 * - single Canvas2D surface
 * - rAF tick owns paint
 * - interaction mutates working document without React
 * - commit to host only on structural / drag-end events
 */
export class StageEngine {
  readonly camera = new Camera();
  private doc: GraphDocument;
  private selection: StageSelection = { kind: 'none' };
  private drag: DragMode = { type: 'none' };
  private spaceDown = false;
  private panLocked = false;
  private dirty = true;
  /** Fit when canvas gets a real size (avoids fit with 0×0). */
  private pendingFit: false | 'soft' | 'force' = false;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;

  private raf = 0;
  private lastFrame = performance.now();
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fps = 0;
  private frameMs = 0;
  private paintMs = 0;
  private lastDrawn = { nodes: 0, edges: 0, groups: 0, culled: 0 };

  private onDocumentCommit: ((doc: GraphDocument) => void) | null = null;
  private onViewportCommit: ((viewport: { x: number; y: number; zoom: number }) => void) | null = null;
  private onSelectionChange: ((sel: StageSelection) => void) | null = null;
  private onInlineEdit: ((edit: StageInlineEdit | null) => void) | null = null;
  private inlineSession: {
    kind: StageInlineEdit['kind'];
    id: string;
    field: StageInlineField;
    sceneId?: string;
  } | null = null;

  private groupRectCache = new Map<string, Rect>();
  private nestDepth = 0;
  private subgraphMap = new Map<string, GraphSubgraph>();
  private nodeMap = new Map<string, GraphNode>();
  private nodeOrder = new Map<string, number>();
  private nodeIndex = new SceneSpatialIndex<GraphNode>();
  private edgeRoutes = new Map<string, EdgeGeometry>();
  private frames: LayoutFrame[] = [];
  private seqFrames: SequenceFrame[] = [];
  private mindFrames: MindFrame[] = [];
  private frameTool = false;
  private draggingIds = new Set<string>();
  private paintCache = new PaintCache();
  private topologyRevision = '';
  private derivedRevision = '';
  private groupsPaintOrder: GraphSubgraph[] = [];
  private viewportCommitTimer: number | null = null;
  private gestureScale: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private editing: CanvasEditingPort = defaultCanvasEditing;
  private policy: CanvasPolicy = DEFAULT_CANVAS_POLICY;

  private get lockPositions() {
    return positionsLocked(this.policy);
  }

  private sceneView(): SceneContext {
    return {
      camera: this.camera,
      dpr: this.dpr,
      cssW: this.cssW,
      cssH: this.cssH,
      ctx: this.ctx,
      policy: this.policy,
      selection: this.selection,
      drag: this.drag,
      lockPositions: this.lockPositions,
      inlineSession: this.inlineSession,
      doc: this.doc,
      nodeMap: this.nodeMap,
      nodeOrder: this.nodeOrder,
      subgraphMap: this.subgraphMap,
      groupRectCache: this.groupRectCache,
      edgeRoutes: this.edgeRoutes,
      frames: this.frames,
      seqFrames: this.seqFrames,
      mindFrames: this.mindFrames,
      groupsPaintOrder: this.groupsPaintOrder,
      nestDepth: this.nestDepth,
      cache: this.paintCache,
      metrics: sceneMetrics(this.camera.scale, this.doc.subgraphs.length > 0),
      queryVisibleNodeIds: (rect) => this.queryVisibleNodeIds(rect),
      sequenceModel: (id) => this.sequenceModel(id),
      mindModel: (id) => this.mindModel(id),
      endpointBox: (id) => this.endpointBox(id),
      frameById: (id) => this.frameById(id),
    };
  }


  constructor(initial: GraphDocument, editing: CanvasEditingPort = defaultCanvasEditing) {
    this.editing = editing;
    this.doc = cloneWorkingDocument(initial);
    this.camera.fromViewportState(initial.layout.viewport);
    this.syncFramesFromDoc();
    this.rebuildIndexes();
    this.syncSequenceFramesFromDoc();
    this.syncMindFramesFromDoc();
  }

  setPolicy(policy: CanvasPolicy) {
    this.policy = policy;
    this.markDirty();
  }

  setLockPositions(lock: boolean) {
    this.setPolicy({ ...this.policy, mode: lock ? 'derived' : 'free' });
  }

  private snap(value: number) {
    return this.policy.snap.enabled ? snapScalar(value, this.policy.snap.size) : value;
  }

  setHandlers(handlers: {
    onDocumentCommit?: (doc: GraphDocument) => void;
    onViewportCommit?: (viewport: { x: number; y: number; zoom: number }) => void;
    onSelectionChange?: (sel: StageSelection) => void;
    onInlineEdit?: (edit: StageInlineEdit | null) => void;
  }) {
    this.onDocumentCommit = handlers.onDocumentCommit ?? null;
    this.onViewportCommit = handlers.onViewportCommit ?? null;
    this.onSelectionChange = handlers.onSelectionChange ?? null;
    this.onInlineEdit = handlers.onInlineEdit ?? null;
  }

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.resize();
    this.bindEvents();
    this.markDirty();
  }

  detach() {
    this.stopLoop();
    this.unbindEvents();
    if (this.viewportCommitTimer !== null) {
      window.clearTimeout(this.viewportCommitTimer);
      this.viewportCommitTimer = null;
    }
    this.canvas = null;
    this.ctx = null;
  }

  /**
   * External load (open file / undo / inspector / sample).
   * - restoreViewport: apply saved camera (default true)
   * - fit: always | if-needed (content off-screen / absurd zoom) | never
   */
  loadDocument(
    doc: GraphDocument,
    options?: {
      restoreViewport?: boolean;
      fit?: 'always' | 'if-needed' | 'never';
    },
  ) {
    this.clearInlineEdit();
    this.doc = cloneWorkingDocument(doc);
    if (options?.restoreViewport !== false) {
      this.camera.fromViewportState(doc.layout.viewport);
    }
    this.syncFramesFromDoc();
    this.rebuildIndexes();
    this.syncSequenceFramesFromDoc();
    this.syncMindFramesFromDoc();
    this.drag = { type: 'none' };
    this.markDirty();

    const fitMode = options?.fit ?? 'if-needed';
    if (fitMode === 'always') {
      this.fitView();
    } else if (fitMode === 'if-needed') {
      this.ensureContentInView();
    } else {
      this.markDirty();
    }
  }

  /**
   * Shell patch (inspector / project meta) without remounting the camera.
   * Live viewport stays the source of truth — Project Graph contract.
   */
  applyWorkingDocument(doc: GraphDocument) {
    const live = this.camera.toViewportState();
    this.doc = cloneWorkingDocument(doc);
    this.camera.fromViewportState(live);
    this.syncFramesFromDoc();
    this.rebuildIndexes();
    this.syncSequenceFramesFromDoc();
    this.syncMindFramesFromDoc();
    this.drag = { type: 'none' };
    this.draggingIds.clear();
    this.pruneSelection();
    this.markDirty();
  }

  /** Visible node ids for a world rect (spatial index + live drag overlay). */
  queryVisibleNodeIds(worldRect: Rect): string[] {
    hotPathCounters.cullViewport += 1;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of this.nodeIndex.queryRect(worldRect)) {
      const node = this.nodeMap.get(entry.id) ?? entry.item;
      if (this.isNodeHidden(node) || seen.has(node.id)) {
        continue;
      }
      seen.add(node.id);
      out.push(node.id);
    }
    for (const id of this.draggingIds) {
      if (seen.has(id)) {
        continue;
      }
      const node = this.nodeMap.get(id);
      if (node && !this.isNodeHidden(node)) {
        out.push(id);
      }
    }
    return out;
  }

  getDocument(): GraphDocument {
    return this.snapshot();
  }

  getSelection(): StageSelection {
    return this.selection;
  }

  getPerfStats(): StagePerfStats & { paintMs: number } {
    return {
      fps: this.fps,
      frameMs: this.frameMs,
      paintMs: this.paintMs,
      drawnNodes: this.lastDrawn.nodes,
      drawnEdges: this.lastDrawn.edges,
      drawnGroups: this.lastDrawn.groups,
      culled: this.lastDrawn.culled,
      totalNodes: this.doc.nodes.length,
      totalEdges: this.doc.edges.length,
      totalGroups: this.doc.subgraphs.length,
    };
  }

  contentBounds(): Rect | null {
    const rects: Rect[] = this.doc.nodes.map((n) => ({
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
    }));
    for (const r of this.groupRectCache.values()) {
      rects.push(r);
    }
    for (const frame of this.frames) {
      rects.push(frameAsRect(frame));
    }
    for (const frame of this.seqFrames) {
      rects.push(sequenceFrameAsRect(frame));
    }
    for (const frame of this.mindFrames) {
      rects.push(mindFrameAsRect(frame));
    }
    return unionRects(rects);
  }

  /** True when most of the graph is readable on-screen (not just barely intersecting). */
  isContentInView(): boolean {
    const world = this.contentBounds();
    if (!world) {
      return true;
    }
    if (this.cssW < 8 || this.cssH < 8) {
      return false;
    }
    const view = this.camera.getCoverWorldRectangle(this.cssW, this.cssH);
    const interW = Math.max(0, Math.min(view.x + view.width, world.x + world.width) - Math.max(view.x, world.x));
    const interH = Math.max(0, Math.min(view.y + view.height, world.y + world.height) - Math.max(view.y, world.y));
    const worldArea = Math.max(1, world.width * world.height);
    const visibleFrac = (interW * interH) / worldArea;
    if (visibleFrac < 0.84) {
      return false;
    }
    const screenW = world.width * this.camera.scale;
    const screenH = world.height * this.camera.scale;
    if (screenW < 48 && screenH < 48) {
      return false;
    }
    if (screenW > this.cssW * 0.94 || screenH > this.cssH * 0.94) {
      return false;
    }
    return true;
  }

  ensureContentInView(options?: { force?: boolean }) {
    if (this.cssW < 8 || this.cssH < 8) {
      this.pendingFit = options?.force ? 'force' : 'soft';
      this.markDirty();
      return;
    }
    if (options?.force || !this.isContentInView()) {
      this.fitView();
    } else {
      this.markDirty();
    }
  }

  fitView(padding = 0.14) {
    if (this.cssW < 8 || this.cssH < 8) {
      this.pendingFit = 'force';
      this.markDirty();
      return;
    }
    const world = this.contentBounds();
    if (!world) {
      this.pendingFit = false;
      return;
    }
    this.camera.fitWorldRect(world, this.cssW, this.cssH, padding);
    this.pendingFit = false;
    this.commitViewportOnly();
    this.markDirty();
  }

  createNodeAtViewCenter(label = '新建节点') {
    const center = this.camera.viewToWorld({ x: this.cssW / 2, y: this.cssH / 2 });
    this.createNodeAt(center.x - 70, center.y - 28, label);
  }

  createSequenceAtViewCenter() {
    const created = createSequenceSceneInDocument(this.doc);
    const scene = created.document.sequence?.scenes.find((item) => item.id === created.sceneId);
    if (!scene) {
      return;
    }
    const size = measureSequenceScene(scene);
    const center = this.camera.viewToWorld({ x: this.cssW / 2, y: this.cssH / 2 });
    const origin = searchFreeSequenceOrigin(
      this.seqFrames,
      {
        x: center.x - size.width / 2,
        y: center.y - size.height / 2,
        width: size.width,
        height: size.height,
      },
      (value) => this.snap(value),
    );
    this.doc = writeSequenceFrames(created.document, [
      ...readSequenceFrames(created.document.compat?.extras as Record<string, unknown> | undefined),
      {
        id: created.sceneId,
        x: origin.x,
        y: origin.y,
        width: size.width,
        height: size.height,
      },
    ]);
    this.syncSequenceFramesFromDoc();
    this.rebuildIndexes();
    this.setSelection({ kind: 'sequence', ids: [created.sceneId] });
    this.commitDocument();
    this.openInlineEdit('sequence', created.sceneId, 'title');
    this.markDirty();
  }

  createMindAtViewCenter() {
    const created = createMindMapInDocument(this.doc);
    const map = created.document.mind?.maps.find((item) => item.id === created.mapId);
    if (!map) {
      return;
    }
    const size = measureMindMap(map);
    const center = this.camera.viewToWorld({ x: this.cssW / 2, y: this.cssH / 2 });
    const occupied = [
      ...this.mindFrames,
      ...this.seqFrames.map((frame) => ({ ...frame })),
    ];
    const origin = searchFreeMindOrigin(
      occupied,
      {
        x: center.x - size.width / 2,
        y: center.y - size.height / 2,
        width: size.width,
        height: size.height,
      },
      (value) => this.snap(value),
    );
    this.doc = writeMindFrames(created.document, [
      ...readMindFrames(created.document.compat?.extras as Record<string, unknown> | undefined),
      {
        id: created.mapId,
        x: origin.x,
        y: origin.y,
        width: size.width,
        height: size.height,
      },
    ]);
    this.syncMindFramesFromDoc();
    this.rebuildIndexes();
    this.setSelection({ kind: 'mind', ids: [created.mapId] });
    this.commitDocument();
    this.openInlineEdit('mind', created.mapId, 'title');
    this.markDirty();
  }

  createNodeAt(
    x: number,
    y: number,
    label = '新建节点',
    options?: { subgraphId?: string | null; connectFrom?: string; edgeType?: GraphEdge['type'] },
  ) {
    const used = new Set(this.doc.nodes.map((n) => n.id));
    const id = buildEntityIdFromTitle(label, used);
    const size = measureNodeContentSize(label, '');
    const desired = {
      x: this.snap(x),
      y: this.snap(y),
      width: size.width,
      height: size.height,
    };
    const free = searchFreeRect(
      desired,
      nodeCollisionObstacles(this.doc.nodes),
      { x: 1, y: 0 },
    );
    const node: GraphNode = {
      id,
      label,
      shape: 'rect',
      x: free.x,
      y: free.y,
      width: size.width,
      height: size.height,
      fill: DEFAULT_NODE_STYLE.fill,
      stroke: DEFAULT_NODE_STYLE.stroke,
      textColor: DEFAULT_NODE_STYLE.textColor,
      subgraphId: options?.subgraphId ?? this.hitGroupAt({ x: free.x + size.width / 2, y: free.y + size.height / 2 }),
    };
    this.doc.nodes.push(node);
    this.rebuildIndexes();
    if (options?.connectFrom) {
      this.createEdge(options.connectFrom, id, options.edgeType ?? 'solid');
      return id;
    }
    this.setSelection({ kind: 'node', ids: [id] });
    this.commitDocument();
    this.markDirty();
    return id;
  }

  startInlineEditForSelection() {
    if (this.selection.kind === 'node' && this.selection.ids[0]) {
      const node = this.nodeMap.get(this.selection.ids[0]);
      if (!node) {
        return;
      }
      const parts = splitEntityText(node.label);
      const field = isPlaceholderTitle(parts.title) ? 'title' : 'description';
      this.openInlineEdit('node', node.id, field);
      return;
    }
    if (this.selection.kind === 'edge' && this.selection.ids[0]) {
      this.openInlineEdit('edge', this.selection.ids[0], 'label');
      return;
    }
    if (this.selection.kind === 'group' && this.selection.ids[0]) {
      this.openInlineEdit('group', this.selection.ids[0], 'title');
      return;
    }
    if (this.selection.kind === 'frame' && this.selection.ids[0]) {
      this.openInlineEdit('frame', this.selection.ids[0], 'title');
      return;
    }
    if (this.selection.kind === 'sequence' && this.selection.ids[0]) {
      this.openInlineEdit('sequence', this.selection.ids[0], 'title');
      return;
    }
    if (this.selection.kind === 'seq-actor' && this.selection.ids[0]) {
      this.openInlineEdit('seq-actor', this.selection.ids[0], 'title', this.selection.sceneId);
      return;
    }
    if (this.selection.kind === 'seq-message' && this.selection.ids[0]) {
      this.openInlineEdit('seq-message', this.selection.ids[0], 'label', this.selection.sceneId);
      return;
    }
    if (this.selection.kind === 'mind' && this.selection.ids[0]) {
      this.openInlineEdit('mind', this.selection.ids[0], 'title');
      return;
    }
    if (this.selection.kind === 'mind-node' && this.selection.ids[0]) {
      this.openInlineEdit('mind-node', this.selection.ids[0], 'title', this.selection.mapId);
    }
  }

  setInlineField(field: StageInlineField) {
    if (!this.inlineSession || this.inlineSession.field === field) {
      return;
    }
    if (this.inlineSession.kind !== 'node') {
      return;
    }
    this.openInlineEdit(this.inlineSession.kind, this.inlineSession.id, field);
  }

  applyInlineEdit(value: string, pair?: { title: string; description: string }) {
    const session = this.inlineSession;
    if (!session) {
      return;
    }
    if (session.kind === 'node') {
      const node = this.nodeMap.get(session.id);
      if (node) {
        const parts = splitEntityText(node.label);
        const title = pair ? pair.title : session.field === 'title' ? value : parts.title;
        const description = pair
          ? pair.description
          : session.field === 'description'
            ? value
            : parts.description;
        const label = composeEntityText(title, description);
        const size = measureNodeContentSize(title, description);
        node.label = label;
        node.width = size.width;
        node.height = size.height;
      }
    } else if (session.kind === 'edge') {
      const edge = this.doc.edges.find((entry) => entry.id === session.id);
      if (edge) {
        edge.label = value.trim();
      }
    } else if (session.kind === 'group') {
      const group = this.doc.subgraphs.find((entry) => entry.id === session.id);
      if (group) {
        group.title = value.trim() || group.title;
      }
    } else if (session.kind === 'frame') {
      this.frames = this.frames.map((frame) => (
        frame.id === session.id ? { ...frame, title: value.trim() || frame.title } : frame
      ));
      this.writeFramesToDoc();
    } else if (session.kind === 'sequence') {
      const title = value.trim();
      this.doc = {
        ...this.doc,
        sequence: {
          scenes: (this.doc.sequence?.scenes ?? []).map((scene) => (
            scene.id === session.id ? { ...scene, title: title || scene.title } : scene
          )),
        },
      };
    } else if (session.kind === 'seq-actor' && session.sceneId) {
      this.doc = renameSequenceParticipantInDocument(this.doc, session.sceneId, session.id, value);
    } else if (session.kind === 'seq-message' && session.sceneId) {
      this.doc = updateSequenceMessageInDocument(this.doc, session.sceneId, session.id, { label: value });
    } else if (session.kind === 'mind') {
      this.doc = updateMindMapInDocument(this.doc, session.id, { title: value.trim() || undefined });
    } else if (session.kind === 'mind-node' && session.sceneId) {
      this.doc = renameMindTopicInDocument(this.doc, session.sceneId, session.id, value);
    }
    this.clearInlineEdit();
    this.rebuildIndexes();
    this.commitDocument();
    this.markDirty();
  }

  cancelInlineEdit() {
    this.clearInlineEdit();
    this.markDirty();
  }

  peekInlineEditView(): StageInlineEdit | null {
    if (!this.inlineSession) {
      return null;
    }
    return this.buildInlineEdit(
      this.inlineSession.kind,
      this.inlineSession.id,
      this.inlineSession.field,
      this.inlineSession.sceneId,
    );
  }

  private openInlineEdit(
    kind: StageInlineEdit['kind'],
    id: string,
    field: StageInlineField,
    sceneId?: string,
  ) {
    const edit = this.buildInlineEdit(kind, id, field, sceneId);
    if (!edit) {
      return;
    }
    this.inlineSession = { kind, id, field, sceneId: edit.sceneId ?? sceneId };
    if (kind === 'node') {
      this.setSelection({ kind: 'node', ids: [id] });
    } else if (kind === 'edge') {
      this.setSelection({ kind: 'edge', ids: [id] });
    } else if (kind === 'group') {
      this.setSelection({ kind: 'group', ids: [id] });
    } else if (kind === 'sequence') {
      this.setSelection({ kind: 'sequence', ids: [id] });
    } else if (kind === 'seq-actor' && (edit.sceneId ?? sceneId)) {
      this.setSelection({ kind: 'seq-actor', sceneId: edit.sceneId ?? sceneId ?? '', ids: [id] });
    } else if (kind === 'seq-message' && (edit.sceneId ?? sceneId)) {
      this.setSelection({ kind: 'seq-message', sceneId: edit.sceneId ?? sceneId ?? '', ids: [id] });
    } else if (kind === 'mind') {
      this.setSelection({ kind: 'mind', ids: [id] });
    } else if (kind === 'mind-node' && (edit.sceneId ?? sceneId)) {
      this.setSelection({ kind: 'mind-node', mapId: edit.sceneId ?? sceneId ?? '', ids: [id] });
    } else if (kind === 'frame') {
      this.setSelection({ kind: 'frame', ids: [id] });
    }
    this.onInlineEdit?.(edit);
    this.markDirty();
  }

  private clearInlineEdit() {
    this.inlineSession = null;
    this.onInlineEdit?.(null);
    this.markDirty();
  }

  private buildInlineEdit(
    kind: StageInlineEdit['kind'],
    id: string,
    field: StageInlineField,
    sceneId?: string,
  ): StageInlineEdit | null {
    return buildInlineEdit(this.sceneView(), kind, id, field, sceneId);
  }

  deleteSelection() {
    if (this.selection.kind === 'none' || this.selection.ids.length === 0) {
      return;
    }
    const ids = new Set(this.selection.ids);
    if (this.selection.kind === 'mixed') {
      this.deleteMixedSelection(this.selection);
    } else if (this.selection.kind === 'sequence') {
      this.doc = {
        ...this.doc,
        sequence: {
          scenes: (this.doc.sequence?.scenes ?? []).filter((scene) => !ids.has(scene.id)),
        },
        edges: this.doc.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)),
      };
      this.seqFrames = this.seqFrames.filter((frame) => !ids.has(frame.id));
      this.writeSequenceFramesToDoc();
    } else if (this.selection.kind === 'seq-actor') {
      for (const id of ids) {
        this.doc = removeSequenceParticipantInDocument(this.doc, this.selection.sceneId, id);
      }
      this.syncSequenceFramesFromDoc();
    } else if (this.selection.kind === 'seq-message') {
      for (const id of ids) {
        this.doc = removeSequenceMessageInDocument(this.doc, this.selection.sceneId, id);
      }
      this.syncSequenceFramesFromDoc();
    } else if (this.selection.kind === 'mind') {
      this.doc = {
        ...this.doc,
        mind: {
          maps: (this.doc.mind?.maps ?? []).filter((map) => !ids.has(map.id)),
        },
        edges: this.doc.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)),
      };
      this.mindFrames = this.mindFrames.filter((frame) => !ids.has(frame.id));
      this.writeMindFramesToDoc();
    } else if (this.selection.kind === 'mind-node') {
      for (const id of ids) {
        this.doc = removeMindTopicInDocument(this.doc, this.selection.mapId, id);
      }
      this.syncMindFramesFromDoc();
    } else if (this.selection.kind === 'frame') {
      this.frames = this.frames.filter((frame) => !ids.has(frame.id));
      this.writeFramesToDoc();
    } else if (this.selection.kind === 'edge') {
      this.doc.edges = this.doc.edges.filter((e) => !ids.has(e.id));
    } else if (this.selection.kind === 'group') {
      this.doc.subgraphs = this.doc.subgraphs.filter((s) => !ids.has(s.id));
      for (const n of this.doc.nodes) {
        if (n.subgraphId && ids.has(n.subgraphId)) {
          n.subgraphId = null;
        }
      }
    } else if (this.selection.kind === 'node') {
      this.doc.nodes = this.doc.nodes.filter((n) => !ids.has(n.id));
      this.doc.edges = this.doc.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));
      this.frames = pruneFrameMembers(this.frames, new Set(this.doc.nodes.map((node) => node.id)));
      this.writeFramesToDoc();
    }
    this.setSelection({ kind: 'none' });
    this.rebuildIndexes();
    this.commitDocument();
    this.markDirty();
  }

  private deleteMixedSelection(selection: Extract<StageSelection, { kind: 'mixed' }>) {
    if (selection.sequences.length) {
      const ids = new Set(selection.sequences);
      this.doc = {
        ...this.doc,
        sequence: {
          scenes: (this.doc.sequence?.scenes ?? []).filter((scene) => !ids.has(scene.id)),
        },
      };
      this.seqFrames = this.seqFrames.filter((frame) => !ids.has(frame.id));
      this.doc.edges = this.doc.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to));
      this.writeSequenceFramesToDoc();
    }
    if (selection.minds.length) {
      const ids = new Set(selection.minds);
      this.doc = {
        ...this.doc,
        mind: {
          maps: (this.doc.mind?.maps ?? []).filter((map) => !ids.has(map.id)),
        },
      };
      this.mindFrames = this.mindFrames.filter((frame) => !ids.has(frame.id));
      this.doc.edges = this.doc.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to));
      this.writeMindFramesToDoc();
    }
    if (selection.frames.length) {
      const ids = new Set(selection.frames);
      this.frames = this.frames.filter((frame) => !ids.has(frame.id));
      this.writeFramesToDoc();
    }
    if (selection.edges.length) {
      const ids = new Set(selection.edges);
      this.doc.edges = this.doc.edges.filter((edge) => !ids.has(edge.id));
    }
    if (selection.nodes.length) {
      const ids = new Set(selection.nodes);
      this.doc.nodes = this.doc.nodes.filter((node) => !ids.has(node.id));
      this.doc.edges = this.doc.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to));
      this.frames = pruneFrameMembers(this.frames, new Set(this.doc.nodes.map((node) => node.id)));
      this.writeFramesToDoc();
    }
    if (selection.groups.length) {
      const ids = new Set(selection.groups);
      this.doc.subgraphs = this.doc.subgraphs.filter((subgraph) => !ids.has(subgraph.id));
      for (const node of this.doc.nodes) {
        if (node.subgraphId && ids.has(node.subgraphId)) {
          node.subgraphId = null;
        }
      }
    }
  }

  /** Select every visible canvas object: nodes, groups, sequences, frames, edges. */
  selectAll() {
    this.setSelection(collectSelection({
      nodes: this.doc.nodes.filter((node) => !this.isNodeHidden(node)).map((node) => node.id),
      groups: this.doc.subgraphs.filter((group) => !this.isGroupHidden(group)).map((group) => group.id),
      sequences: this.seqFrames.map((frame) => frame.id),
      minds: this.mindFrames.map((frame) => frame.id),
      frames: this.frames.map((frame) => frame.id),
      edges: this.doc.edges.filter((edge) => !this.hidesSceneEdge(edge)).map((edge) => edge.id),
    }));
  }

  /** Apply selection from shell (outline / toolbar) and optionally frame it. */
  applySelection(sel: StageSelection, options?: { focus?: boolean }) {
    this.setSelection(sel);
    if (options?.focus !== false && sel.kind !== 'none' && sel.ids.length > 0) {
      this.focusSelection();
    }
    this.markDirty();
  }

  /** Pan/zoom so current selection is comfortably visible. */
  focusSelection(padding = 0.28) {
    const bounds = this.selectionBounds();
    if (!bounds) {
      return;
    }
    if (this.cssW < 8 || this.cssH < 8) {
      return;
    }
    // Keep current zoom if selection already reasonably visible; else fit to selection.
    const view = this.camera.getCoverWorldRectangle(this.cssW, this.cssH);
    const fullyInside =
      bounds.x >= view.x &&
      bounds.y >= view.y &&
      bounds.x + bounds.width <= view.x + view.width &&
      bounds.y + bounds.height <= view.y + view.height;
    const screenW = bounds.width * this.camera.scale;
    const screenH = bounds.height * this.camera.scale;
    if (!fullyInside || screenW < 40 || screenH < 24 || screenW > this.cssW * 0.95) {
      this.camera.fitWorldRect(bounds, this.cssW, this.cssH, padding);
      this.commitViewportOnly();
    } else {
      // Soft center
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;
      this.camera.offsetX = this.cssW / 2 - cx * this.camera.scale;
      this.camera.offsetY = this.cssH / 2 - cy * this.camera.scale;
      this.commitViewportOnly();
    }
    this.markDirty();
  }

  /** Groups LOD: zoom a subgraph until its members reappear. */
  private drillIntoGroup(id: string) {
    const rect = this.groupRectCache.get(id);
    if (!rect || this.cssW < 8 || this.cssH < 8) {
      return;
    }
    this.setSelection({ kind: 'group', ids: [id] });
    this.camera.fitWorldRect(rect, this.cssW, this.cssH, 0.16);
    if (this.camera.scale < LOD_NAMES_MIN) {
      this.camera.zoomAt({ x: this.cssW / 2, y: this.cssH / 2 }, LOD_NAMES_MIN / this.camera.scale);
    }
    this.scheduleViewportCommit();
    this.markDirty();
  }

  /** Connect the first two selected nodes / sequences (toolbar / ⌘L). */
  connectSelection() {
    const parts = partsOf(this.selection);
    const ids = [...parts.nodes, ...parts.sequences, ...parts.minds];
    if (ids.length < 2 || !ids[0] || !ids[1]) {
      return;
    }
    this.createEdge(ids[0], ids[1]);
  }

  createEdge(fromId: string, toId: string, edgeType: GraphEdge['type'] = 'solid') {
    if (fromId === toId) return;
    if (!this.hasEndpoint(fromId) || !this.hasEndpoint(toId)) return;
    const exists = this.doc.edges.some((e) => e.from === fromId && e.to === toId);
    if (exists) {
      const edge = this.doc.edges.find((e) => e.from === fromId && e.to === toId)!;
      this.setSelection({ kind: 'edge', ids: [edge.id] });
      return;
    }
    const fromNode = this.nodeMap.get(fromId);
    const id = `edge_${fromId}_${toId}_${Math.random().toString(36).slice(2, 7)}`;
    const edge: GraphEdge = {
      id,
      from: fromId,
      to: toId,
      label: '',
      type: edgeType,
      strokeColor: fromNode?.stroke || DEFAULT_EDGE_STYLE.strokeColor,
      strokeWidth: DEFAULT_EDGE_STYLE.strokeWidth,
    };
    this.doc.edges.push(edge);
    this.setSelection({ kind: 'edge', ids: [id] });
    this.commitDocument();
    this.markDirty();
  }

  /** Jump camera so world point is under view center (minimap). */
  centerOnWorld(world: Vec2) {
    if (this.cssW < 8 || this.cssH < 8) return;
    this.camera.offsetX = this.cssW / 2 - world.x * this.camera.scale;
    this.camera.offsetY = this.cssH / 2 - world.y * this.camera.scale;
    this.commitViewportOnly();
    this.markDirty();
  }

  getViewportRect(): Rect {
    return this.camera.getCoverWorldRectangle(this.cssW, this.cssH);
  }

  getCanvasSize() {
    return { width: this.cssW, height: this.cssH };
  }

  nodeViewBands() {
    return this.doc.nodes
      .filter((node) => !this.isNodeHidden(node))
      .map((node) => {
        const bands = this.nodeBands(node);
        return {
          id: node.id,
          title: bands.parts.title,
          description: bands.parts.description,
          titleBand: this.camera.worldRectToView(bands.title),
          descriptionBand: this.camera.worldRectToView(bands.description),
        };
      });
  }

  selectionViewRect(): Rect | null {
    if (this.selection.kind !== 'node' || this.selection.ids.length === 0) {
      return null;
    }
    const rects: Rect[] = [];
    for (const id of this.selection.ids) {
      const node = this.nodeMap.get(id);
      if (!node || this.isNodeHidden(node)) {
        continue;
      }
      rects.push(this.camera.worldRectToView({
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      }));
    }
    return unionRects(rects);
  }

  /** ⌘+/- : zoom about view center, same as the previous workbench. */
  zoomAtViewCenter(factor: number) {
    this.camera.zoomAt({ x: this.cssW / 2, y: this.cssH / 2 }, factor);
    hotPathCounters.viewportLiveApplies += 1;
    this.markDirty();
    this.scheduleViewportCommit();
  }

  /** ⌘0 : restore the previous default viewport, not fit-to-content. */
  resetViewport() {
    this.camera.fromViewportState({ x: 120, y: 90, zoom: 1 });
    this.commitViewportOnly();
    this.markDirty();
  }

  setViewportState(viewport: { x: number; y: number; zoom: number }) {
    this.camera.fromViewportState(viewport);
    this.commitViewportOnly();
    this.markDirty();
  }

  private hitGroupAt(world: Vec2, excludeIds?: ReadonlySet<string>): string | null {
    return hitGroupAt(this.sceneView(), world, excludeIds);
  }

  private hitEdgeAt(world: Vec2, ignoreEndpointIds?: ReadonlySet<string>): string | null {
    return hitEdgeAt(this.sceneView(), world, ignoreEndpointIds);
  }

  private lod() {
    return sceneMetrics(this.camera.scale, this.doc.subgraphs.length > 0).lod;
  }

  private showsDetails() {
    return this.sceneView().metrics.showsDetails;
  }

  private showsNames() {
    return this.sceneView().metrics.showsNames;
  }

  private showsGroupsOnly() {
    return this.sceneView().metrics.showsGroupsOnly;
  }

  private isGroupHidden(subgraph: GraphSubgraph) {
    return isGroupHidden(subgraph, this.subgraphMap, this.camera.scale, this.nestDepth);
  }

  private hidesSceneEdge(edge: GraphEdge) {
    return hidesSceneEdge(edge, this.nodeMap, this.showsGroupsOnly());
  }

  private nodeBands(node: GraphNode) {
    return this.paintCache.nodeBands(node);
  }

  private groupTitleWorldChip(rect: Rect, title: string): Rect {
    return groupTitleWorldChip(
      this.camera,
      rect,
      title,
      (text, font) => this.paintCache.measureScreenWidth(this.ctx, text, font),
    );
  }

  exportPng(): string | null {
    // Prefer full-graph export; fall back to viewport.
    return this.exportPngFull() ?? this.exportViewportPng();
  }

  exportSvg(): string | null {
    const world = this.contentBounds();
    if (!world) {
      return null;
    }
    this.rebuildEdgeRoutes();
    return exportSceneSvg({
      world,
      doc: this.doc,
      subgraphMap: this.subgraphMap,
      groupRectCache: this.groupRectCache,
      edgeRoutes: this.edgeRoutes,
      isNodeHidden: (node) => this.isNodeHidden(node),
    });
  }

  exportViewportPng(): string | null {
    if (!this.canvas) return null;
    return this.canvas.toDataURL('image/png');
  }

  /** Render entire graph to an offscreen canvas (for export). */
  exportPngFull(maxSide = 4096): string | null {
    const world = this.contentBounds();
    if (!world) return this.exportViewportPng();

    const pad = 48;
    const fullW = world.width + pad * 2;
    const fullH = world.height + pad * 2;
    const scale = Math.min(2, maxSide / Math.max(fullW, fullH, 1));
    const w = Math.max(1, Math.ceil(fullW * scale));
    const h = Math.max(1, Math.ceil(fullH * scale));

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');
    if (!ctx) return null;

    const cam = new Camera();
    cam.scale = scale;
    cam.offsetX = -world.x * scale + pad * scale;
    cam.offsetY = -world.y * scale + pad * scale;

    ctx.fillStyle = '#070708';
    ctx.fillRect(0, 0, w, h);

    // Temporarily swap camera for paint helpers
    const saved = {
      offsetX: this.camera.offsetX,
      offsetY: this.camera.offsetY,
      scale: this.camera.scale,
      cssW: this.cssW,
      cssH: this.cssH,
      ctx: this.ctx,
    };
    this.camera.offsetX = cam.offsetX;
    this.camera.offsetY = cam.offsetY;
    this.camera.scale = cam.scale;
    this.cssW = w;
    this.cssH = h;
    this.ctx = ctx;
    this.dpr = 1;

    try {
      this.paintScene(ctx, false);
    } finally {
      this.camera.offsetX = saved.offsetX;
      this.camera.offsetY = saved.offsetY;
      this.camera.scale = saved.scale;
      this.cssW = saved.cssW;
      this.cssH = saved.cssH;
      this.ctx = saved.ctx;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    }

    return off.toDataURL('image/png');
  }

  private selectionBounds(): Rect | null {
    return selectionWorldBounds(this.sceneView());
  }

  // ——— private core ———
  // ——— private core ———

  private snapshot(): GraphDocument {
    if (!this.lockPositions) {
      this.writeFramesToDoc();
    } else {
      this.writeSequenceFramesToDoc();
      this.writeMindFramesToDoc();
    }
    const vp = this.camera.toViewportState();
    const cloned = cloneWorkingDocument(this.doc);
    cloned.layout = {
      ...cloned.layout,
      viewport: vp,
    };
    return refreshWorkingDocument(cloned);
  }

  private commitDocument() {
    this.onDocumentCommit?.(this.snapshot());
  }

  private commitViewportOnly() {
    // Viewport-only: do not clone the graph or re-run structural layout.
    hotPathCounters.viewportDocumentCommits += 1;
    const viewport = this.camera.toViewportState();
    if (this.onViewportCommit) {
      this.onViewportCommit(viewport);
      return;
    }
    const cloned = cloneWorkingDocument(this.doc);
    cloned.layout = {
      ...toSidecar(cloned),
      viewport,
    };
    this.onDocumentCommit?.(cloned);
  }

  private setSelection(sel: StageSelection) {
    this.selection = sel;
    this.onSelectionChange?.(sel);
    this.markDirty();
  }

  private rebuildIndexes() {
    this.paintCache.clearStructural();
    this.nodeMap = new Map(this.doc.nodes.map((n) => [n.id, n]));
    this.nodeOrder = new Map(this.doc.nodes.map((n, index) => [n.id, index]));
    this.subgraphMap = subgraphLookup(this.doc.subgraphs);
    this.refreshDerivedScene();
  }

  private rebuildSpatialIndex() {
    this.topologyRevision = topologyRevisionFromGraph(this.doc);
    this.nodeIndex = new SceneSpatialIndex(
      this.doc.nodes.map((node) => ({
        id: node.id,
        rect: { x: node.x, y: node.y, width: node.width, height: node.height },
        item: node,
      })),
    );
    hotPathCounters.rebuildBaseScene += 1;
  }

  private pruneSelection() {
    if (this.selection.kind === 'none') {
      return;
    }
    if (this.selection.kind === 'mixed') {
      const next = collectSelection({
        nodes: this.selection.nodes.filter((id) => this.nodeMap.has(id)),
        groups: this.selection.groups.filter((id) => this.doc.subgraphs.some((subgraph) => subgraph.id === id)),
        sequences: this.selection.sequences.filter((id) => this.seqFrames.some((frame) => frame.id === id)),
        minds: this.selection.minds.filter((id) => this.mindFrames.some((frame) => frame.id === id)),
        frames: this.selection.frames.filter((id) => this.frames.some((frame) => frame.id === id)),
        edges: this.selection.edges.filter((id) => this.doc.edges.some((edge) => edge.id === id)),
      });
      if (
        next.kind === this.selection.kind
        && next.kind === 'mixed'
        && next.ids.length === this.selection.ids.length
      ) {
        return;
      }
      this.selection = next;
      this.onSelectionChange?.(this.selection);
      return;
    }
    const selection = this.selection;
    const ids = selection.ids.filter((id) => {
      if (selection.kind === 'node') {
        return this.nodeMap.has(id);
      }
      if (selection.kind === 'group') {
        return this.doc.subgraphs.some((subgraph) => subgraph.id === id);
      }
      if (selection.kind === 'frame') {
        return this.frames.some((frame) => frame.id === id);
      }
      if (selection.kind === 'sequence') {
        return this.seqFrames.some((frame) => frame.id === id);
      }
      if (selection.kind === 'mind') {
        return this.mindFrames.some((frame) => frame.id === id);
      }
      if (selection.kind === 'mind-node') {
        const model = this.mindModel(selection.mapId);
        return Boolean(model && (model.root.id === id || model.nodes.some((item) => item.id === id)));
      }
      if (selection.kind === 'seq-actor') {
        return Boolean(
          this.doc.sequence?.scenes
            .find((item) => item.id === selection.sceneId)
            ?.participants.some((item) => item.id === id),
        );
      }
      if (selection.kind === 'seq-message') {
        return Boolean(this.sequenceModel(selection.sceneId)?.messages.some((item) => item.id === id));
      }
      return this.doc.edges.some((edge) => edge.id === id);
    });
    if (ids.length === this.selection.ids.length) {
      return;
    }
    this.selection = ids.length === 0 ? { kind: 'none' } : { ...this.selection, ids };
    this.onSelectionChange?.(this.selection);
  }

  private rebuildGroupRects() {
    this.refreshDerivedScene();
  }

  /** Group boxes + routes + spatial index. Pan/zoom must not enter here. */
  private refreshDerivedScene() {
    const dragging = this.draggingIds.size > 0;
    const revision = derivedSceneRevision(this.doc);
    if (!shouldRebuildDerivedScene(this.derivedRevision, revision, dragging)) {
      return;
    }
    if (this.subgraphMap.size === 0 && this.doc.subgraphs.length > 0) {
      this.subgraphMap = subgraphLookup(this.doc.subgraphs);
    }
    this.groupRectCache = computeGroupRects(this.doc.subgraphs, this.doc.nodes, this.subgraphMap);
    this.nestDepth = 0;
    for (const subgraph of this.doc.subgraphs) {
      this.nestDepth = Math.max(this.nestDepth, subgraphDepth(subgraph.id, this.subgraphMap));
    }
    this.groupsPaintOrder = [...this.doc.subgraphs].sort(
      (left, right) => subgraphDepth(left.id, this.subgraphMap) - subgraphDepth(right.id, this.subgraphMap),
    );
    this.rebuildEdgeRoutes();
    this.rebuildShapePaths();
    if (dragging) {
      this.derivedRevision = '';
      return;
    }
    this.rebuildSpatialIndex();
    this.derivedRevision = revision;
    markDerivedSceneRebuild();
  }

  private rebuildShapePaths() {
    this.paintCache.rebuildShapePaths(this.doc.nodes, this.edgeRoutes);
  }

  private collectEndpointBoxes(): Map<string, EndpointBox> {
    return collectEndpointBoxes({
      nodes: this.doc.nodes,
      subgraphs: this.doc.subgraphs,
      subgraphMap: this.subgraphMap,
      groupRectCache: this.groupRectCache,
      seqFrames: this.seqFrames,
      mindFrames: this.mindFrames,
      boxOf: (id) => this.endpointBox(id),
    });
  }

  private rebuildEdgeRoutes() {
    const obstacles: Rect[] = [];
    for (const node of this.doc.nodes) {
      if (isInsideCollapsedSubgraph(node, this.subgraphMap)) {
        continue;
      }
      obstacles.push({
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      });
    }
    for (const subgraph of this.doc.subgraphs) {
      if (isSubgraphHiddenByCollapsedAncestor(subgraph, this.subgraphMap)) {
        continue;
      }
      const rect = this.groupRectCache.get(subgraph.id);
      if (!rect) {
        continue;
      }
      const stroke = 12;
      obstacles.push(
        { x: rect.x, y: rect.y, width: rect.width, height: stroke },
        { x: rect.x, y: rect.y + rect.height - stroke, width: rect.width, height: stroke },
        { x: rect.x, y: rect.y, width: stroke, height: rect.height },
        { x: rect.x + rect.width - stroke, y: rect.y, width: stroke, height: rect.height },
      );
      obstacles.push(this.groupTitleWorldChip(
        rect,
        `${subgraph.collapsed ? '▸' : '▾'} ${subgraph.title}`,
      ));
    }
    for (const frame of this.seqFrames) {
      obstacles.push(sequenceFrameAsRect(frame));
    }
    for (const frame of this.mindFrames) {
      obstacles.push(mindFrameAsRect(frame));
    }
    this.edgeRoutes = routeSceneEdges(this.doc.edges, this.collectEndpointBoxes(), {
      resolveLabels: this.draggingIds.size > 0 ? 'fast' : 'full',
      obstacles,
    });
  }

  private syncFramesFromDoc() {
    if (this.lockPositions) {
      this.frames = [];
      return;
    }
    this.frames = readLayoutFrames(this.doc.compat?.extras as Record<string, unknown> | undefined);
  }

  private writeFramesToDoc() {
    const living = new Set(this.doc.nodes.map((node) => node.id));
    this.frames = pruneFrameMembers(this.frames, living);
    this.doc = {
      ...this.doc,
      compat: {
        version: this.doc.compat?.version ?? 1,
        layout: this.doc.compat?.layout ?? this.doc.layout,
        editor: this.doc.compat?.editor,
        extras: {
          ...(this.doc.compat?.extras ?? {}),
          layoutFrames: this.frames.map((frame) => ({ ...frame, nodeIds: [...frame.nodeIds] })),
          sequenceFrames: this.seqFrames.map((frame) => ({ ...frame })),
          mindFrames: this.mindFrames.map((frame) => ({ ...frame })),
        },
      },
    };
  }

  private graphContentBounds(): Rect | null {
    const rects: Rect[] = this.doc.nodes.map((node) => ({
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    }));
    for (const rect of this.groupRectCache.values()) {
      rects.push(rect);
    }
    return unionRects(rects);
  }

  private syncSequenceFramesFromDoc() {
    const stored = readSequenceFrames(this.doc.compat?.extras as Record<string, unknown> | undefined);
    this.seqFrames = syncSequenceFrames(
      this.doc.sequence?.scenes ?? [],
      stored,
      this.graphContentBounds(),
      (value) => this.snap(value),
    );
  }

  private writeSequenceFramesToDoc() {
    this.doc = {
      ...this.doc,
      compat: {
        version: this.doc.compat?.version ?? 1,
        layout: this.doc.compat?.layout ?? this.doc.layout,
        editor: this.doc.compat?.editor,
        extras: {
          ...(this.doc.compat?.extras ?? {}),
          sequenceFrames: this.seqFrames.map((frame) => ({ ...frame })),
          mindFrames: this.mindFrames.map((frame) => ({ ...frame })),
        },
      },
    };
  }

  private seqFrameById(id: string) {
    return this.seqFrames.find((frame) => frame.id === id) ?? null;
  }

  private sequenceModel(sceneId: string) {
    const frame = this.seqFrameById(sceneId);
    const scene = this.doc.sequence?.scenes.find((item) => item.id === sceneId);
    if (!frame || !scene) {
      return null;
    }
    return layoutSequenceScene(scene, frame);
  }

  private syncMindFramesFromDoc() {
    const stored = readMindFrames(this.doc.compat?.extras as Record<string, unknown> | undefined);
    this.mindFrames = syncMindFrames(
      this.doc.mind?.maps ?? [],
      stored,
      this.graphContentBounds(),
      (value) => this.snap(value),
    );
  }

  private writeMindFramesToDoc() {
    this.doc = {
      ...this.doc,
      compat: {
        version: this.doc.compat?.version ?? 1,
        layout: this.doc.compat?.layout ?? this.doc.layout,
        editor: this.doc.compat?.editor,
        extras: {
          ...(this.doc.compat?.extras ?? {}),
          sequenceFrames: this.seqFrames.map((frame) => ({ ...frame })),
          mindFrames: this.mindFrames.map((frame) => ({ ...frame })),
        },
      },
    };
  }

  private mindFrameById(id: string) {
    return this.mindFrames.find((frame) => frame.id === id) ?? null;
  }

  private mindModel(mapId: string) {
    const frame = this.mindFrameById(mapId);
    const map = this.doc.mind?.maps.find((item) => item.id === mapId);
    if (!frame || !map) {
      return null;
    }
    return layoutMindMap(map, frame);
  }

  private addMindTopic(mapId: string, parentId?: string) {
    const created = addMindTopicInDocument(this.doc, mapId, parentId);
    if (!created.topicId) {
      return;
    }
    this.doc = created.document;
    this.syncMindFramesFromDoc();
    this.rebuildIndexes();
    this.setSelection({ kind: 'mind-node', mapId, ids: [created.topicId] });
    this.commitDocument();
    this.openInlineEdit('mind-node', created.topicId, 'title', mapId);
    this.markDirty();
  }

  private addSequenceActor(sceneId: string, atIndex?: number) {
    const created = addSequenceParticipantInDocument(this.doc, sceneId, undefined, atIndex);
    if (!created.participantId) {
      return;
    }
    this.doc = created.document;
    this.syncSequenceFramesFromDoc();
    this.rebuildIndexes();
    this.setSelection({ kind: 'seq-actor', sceneId, ids: [created.participantId] });
    this.commitDocument();
    this.openInlineEdit('seq-actor', created.participantId, 'title', sceneId);
    this.markDirty();
  }

  private addSequenceMessage(sceneId: string, options?: { from?: string; to?: string; arrow?: 'call' | 'return'; atIndex?: number }) {
    const created = addSequenceMessageInDocument(this.doc, sceneId, options);
    if (!created.messageId) {
      return;
    }
    this.doc = created.document;
    this.syncSequenceFramesFromDoc();
    this.rebuildIndexes();
    this.setSelection({ kind: 'seq-message', sceneId, ids: [created.messageId] });
    this.commitDocument();
    this.openInlineEdit('seq-message', created.messageId, 'label', sceneId);
    this.markDirty();
  }

  setPanLocked(on: boolean) {
    this.panLocked = on;
    this.spaceDown = on;
    this.updateCursor();
  }

  setFrameTool(enabled: boolean) {
    this.frameTool = this.lockPositions ? false : enabled;
    if (this.canvas) {
      this.canvas.style.cursor = enabled ? 'crosshair' : this.spaceDown ? 'grab' : '';
    }
    this.markDirty();
  }

  wrapSelectionInFrame() {
    if (this.lockPositions) {
      return;
    }
    const ids = this.selection.kind === 'node'
      ? this.selection.ids
      : this.selection.kind === 'group'
        ? this.doc.nodes
          .filter((node) => node.subgraphId && isCanvasIdSelected(this.selection, 'group', node.subgraphId))
          .map((node) => node.id)
        : [];
    const members = this.doc.nodes.filter((node) => ids.includes(node.id));
    const bounds = unionNodeBounds(members, 48);
    if (!bounds || members.length === 0) {
      this.setFrameTool(true);
      return;
    }
    const frame = createFrameFromRect(this.frames, bounds, members.map((node) => node.id));
    this.frames = exclusiveAssign([...this.frames, frame], frame.id, frame.nodeIds);
    this.applyFrameReflow(frame);
    this.writeFramesToDoc();
    this.setSelection({ kind: 'frame', ids: [frame.id] });
    this.rebuildIndexes();
    this.commitDocument();
    this.markDirty();
  }

  reflowSelectedFrame() {
    if (this.selection.kind !== 'frame' || this.selection.ids.length === 0) {
      return;
    }
    for (const id of this.selection.ids) {
      const frame = this.frames.find((entry) => entry.id === id);
      if (frame) {
        this.applyFrameReflow(frame);
      }
    }
    this.writeFramesToDoc();
    this.rebuildIndexes();
    this.commitDocument();
    this.markDirty();
  }

  updateFrame(id: string, patch: Partial<Pick<LayoutFrame, 'title' | 'padding' | 'x' | 'y' | 'width' | 'height'>>) {
    this.frames = this.frames.map((frame) => {
      if (frame.id !== id) {
        return frame;
      }
      const next = { ...frame, ...patch };
      if (
        patch.x !== undefined ||
        patch.y !== undefined ||
        patch.width !== undefined ||
        patch.height !== undefined ||
        patch.padding !== undefined
      ) {
        this.applyFrameReflow(next);
      }
      return next;
    });
    this.writeFramesToDoc();
    this.rebuildIndexes();
    this.commitDocument();
    this.markDirty();
  }

  private applyFrameReflow(frame: LayoutFrame) {
    if (frame.nodeIds.length === 0) {
      return;
    }
    const grouped = frame.nodeIds.some((id) => Boolean(this.nodeMap.get(id)?.subgraphId));
    const solved = solveOptimalLayout(this.doc, {
      nodeIds: frame.nodeIds,
      bounds: frameInnerRect(frame, grouped ? 36 : 0),
      mode: 'optimal',
    });
    const byId = new Map(solved.nodes.map((node) => [node.id, node]));
    for (const node of this.doc.nodes) {
      const next = byId.get(node.id);
      if (next) {
        node.x = next.x;
        node.y = next.y;
      }
    }
    const index = this.frames.findIndex((entry) => entry.id === frame.id);
    if (index >= 0) {
      this.frames[index] = { ...frame };
    }
  }

  private frameById(id: string) {
    return this.frames.find((frame) => frame.id === id) ?? null;
  }

  private hasEndpoint(id: string) {
    return endpointExists(id, {
      nodeMap: this.nodeMap,
      subgraphMap: this.subgraphMap,
      seqFrames: this.seqFrames,
      mindFrames: this.mindFrames,
    });
  }

  private endpointBox(id: string): EndpointBox | null {
    return resolveEndpointBox(id, {
      nodeMap: this.nodeMap,
      subgraphMap: this.subgraphMap,
      groupRectCache: this.groupRectCache,
      seqFrames: this.seqFrames,
      mindFrames: this.mindFrames,
    });
  }

  private isNodeHidden(node: GraphNode): boolean {
    return isNodeHidden(node, this.subgraphMap, this.showsGroupsOnly());
  }

  private connectBoxes(): EndpointBox[] {
    return connectBoxes({
      nodes: this.doc.nodes,
      seqFrames: this.seqFrames,
      mindFrames: this.mindFrames,
      isNodeHidden: (node) => this.isNodeHidden(node),
    });
  }

  private connectSnap(from: EndpointBox, cursor: Vec2) {
    return snapSceneConnect(from, cursor, this.connectBoxes(), this.camera.scale);
  }

  private hitPort(world: Vec2): { nodeId: string } | null {
    const ids = [...partsOf(this.selection).nodes, ...partsOf(this.selection).sequences, ...partsOf(this.selection).minds];
    return hitEndpointPort(world, ids, this.camera.scale, (id) => this.endpointBox(id));
  }

  private resize = () => {
    if (!this.canvas || !this.ctx) return;
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || this.canvas.clientWidth || 1;
    const h = parent?.clientHeight || this.canvas.clientHeight || 1;
    const prevW = this.cssW;
    const prevH = this.cssH;
    if (w === this.cssW && h === this.cssH && this.canvas.width > 0) {
      const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
      if (nextDpr === this.dpr) return;
    }
    this.cssW = w;
    this.cssH = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(w * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(h * this.dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.markDirty();

    // First real size, or pending fit after 0×0 attach.
    const becameReady = (prevW < 8 || prevH < 8) && w >= 8 && h >= 8;
    if (this.pendingFit === 'soft' || (becameReady && this.pendingFit !== 'force')) {
      this.ensureContentInView();
    } else if (this.pendingFit === 'force') {
      this.fitView();
    }
  };

  private startLoop() {
    this.markDirty();
  }

  private stopLoop() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private requestTick() {
    if (this.raf || !this.canvas) {
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  private markDirty() {
    this.dirty = true;
    this.requestTick();
  }

  private loop = (now: number) => {
    this.raf = 0;
    if (!this.ctx || !this.canvas) {
      return;
    }
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    this.frameMs = this.frameMs * 0.85 + dt * 0.15;
    this.fpsAccum += dt;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 500) {
      this.fps = Math.round((this.fpsFrames * 1000) / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
    if (!this.dirty) {
      return;
    }
    this.paint();
    this.dirty = false;
  };

  // ——— paint / hit ———

  private paint() {
    if (!this.ctx || !this.canvas) {
      return;
    }
    const stats = paintCanvasFrame(this.ctx, this.sceneView(), this.canvas);
    this.lastDrawn = {
      nodes: stats.nodes,
      edges: stats.edges,
      groups: stats.groups,
      culled: stats.culled,
    };
    this.paintMs = stats.paintMs;
  }

  private paintScene(ctx: CanvasRenderingContext2D, interactive: boolean) {
    const drawn = paintScene(ctx, this.sceneView(), interactive);
    if (interactive) {
      this.lastDrawn = drawn;
    }
  }

  private hitTest(world: Vec2): StageSelection {
    return hitTestScene({
      ...this.sceneView(),
      draggingIds: this.draggingIds,
      nodeIndex: this.nodeIndex,
    }, world);
  }

  // ——— events ———

  private onPointerDown = (event: PointerEvent) => {
    if (!this.canvas) return;
    this.canvas.setPointerCapture(event.pointerId);
    const view = this.viewFromEvent(event);
    const world = this.camera.viewToWorld(view);

    // middle / space = pan (Alt on a node is duplicate-drag, matching the previous app)
    if (event.button === 1 || this.spaceDown) {
      event.preventDefault();
      this.drag = { type: 'pan', lastView: view };
      this.updateCursor();
      hotPathCounters.viewportLiveApplies += 1;
      this.markDirty();
      return;
    }

    const edgeType = event.ctrlKey || event.metaKey ? 'line' : 'solid';
    const port = this.hitPort(world);
    if (event.button === 0 && port) {
      this.drag = { type: 'connect', fromId: port.nodeId, currentWorld: world, edgeType };
      this.markDirty();
      return;
    }

    const hit = this.hitTest(world);

    // Right-drag from a node starts a connection (previous canvas).
    if (event.button === 2 && hit.kind === 'node' && hit.ids[0]) {
      event.preventDefault();
      this.setSelection({ kind: 'node', ids: hit.ids });
      this.drag = { type: 'connect', fromId: hit.ids[0], currentWorld: world, edgeType };
      this.markDirty();
      return;
    }

    // Right-drag from a sequence lifeline / activation bar draws a directed message.
    // Right-drag from the block itself starts a flowchart connection, like a node.
    if (event.button === 2 && hit.kind === 'sequence' && !this.lockPositions) {
      const sceneId = hit.ids[0] ?? '';
      const model = this.sequenceModel(sceneId);
      const start = model ? sequenceConnectStart(model, world) : null;
      if (start) {
        event.preventDefault();
        this.setSelection(hit);
        this.drag = {
          type: 'seq-connect',
          sceneId,
          fromId: start.id,
          originWorld: world,
          currentWorld: world,
          arrow: event.altKey ? 'return' : 'call',
        };
        this.markDirty();
        return;
      }
      if (sceneId) {
        event.preventDefault();
        this.setSelection(hit);
        this.drag = { type: 'connect', fromId: sceneId, currentWorld: world, edgeType };
        this.markDirty();
        return;
      }
    }

    if (event.button === 2 && (hit.kind === 'mind' || hit.kind === 'mind-node') && !this.lockPositions) {
      const mapId = hit.kind === 'mind' ? hit.ids[0] : hit.mapId;
      if (mapId) {
        event.preventDefault();
        this.setSelection(hit.kind === 'mind' ? hit : { kind: 'mind', ids: [mapId] });
        this.drag = { type: 'connect', fromId: mapId, currentWorld: world, edgeType };
        this.markDirty();
        return;
      }
    }

    if (event.button !== 0) return;

    if (hit.kind === 'group' && hit.ids[0] && this.hitGroupCollapse(world, hit.ids[0])) {
      this.toggleGroupCollapsed(hit.ids[0]);
      return;
    }

    if (!this.lockPositions && this.selection.kind === 'frame') {
      for (const id of this.selection.ids) {
        const selectedFrame = this.frameById(id);
        const handle = selectedFrame ? hitFrameResize(selectedFrame, world, this.camera.scale) : null;
        if (selectedFrame && handle) {
          this.drag = {
            type: 'frame-resize',
            id: selectedFrame.id,
            handle,
            originWorld: world,
            start: { ...selectedFrame, nodeIds: [...selectedFrame.nodeIds] },
          };
          this.markDirty();
          return;
        }
      }
    }

    if (hit.kind === 'none') {
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
        this.setSelection({ kind: 'none' });
      }
      this.drag = this.frameTool && !this.lockPositions
        ? { type: 'frame-draw', startWorld: world, currentWorld: world }
        : {
            type: 'box',
            startWorld: world,
            currentWorld: world,
            additive: event.shiftKey || event.metaKey || event.ctrlKey,
          };
      this.markDirty();
      return;
    }

    if (hit.kind === 'seq-actor') {
      this.setSelection(hit);
      if (!this.lockPositions) {
        this.drag = {
          type: 'seq-actor-move',
          sceneId: hit.sceneId,
          id: hit.ids[0] ?? '',
          originWorld: world,
        };
      }
      this.markDirty();
      return;
    }

    if (hit.kind === 'seq-message') {
      this.setSelection(hit);
      if (!this.lockPositions) {
        this.drag = {
          type: 'seq-message-move',
          sceneId: hit.sceneId,
          id: hit.ids[0] ?? '',
          originWorld: world,
        };
      }
      this.markDirty();
      return;
    }

    if (hit.kind === 'sequence') {
      const sceneId = hit.ids[0] ?? '';
      const model = this.sequenceModel(sceneId);
      const inner = model ? hitSequenceInterior(model, world) : null;
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      if (inner?.kind === 'add-actor') {
        this.addSequenceActor(sceneId);
        return;
      }
      if ((inner?.kind === 'lifeline' || inner?.kind === 'activation') && !this.lockPositions) {
        this.setSelection(hit);
        this.drag = {
          type: 'seq-connect',
          sceneId,
          fromId: inner.id,
          originWorld: world,
          currentWorld: world,
          arrow: event.altKey ? 'return' : 'call',
        };
        this.markDirty();
        return;
      }
      if (inner?.kind === 'title') {
        if (additive) {
          this.toggleIntoSelection(hit);
          this.markDirty();
          return;
        }
        if (additive) {
          this.toggleIntoSelection(hit);
        } else if (!this.isSelected(hit)) {
          this.setSelection(hit);
        }
        const frame = this.seqFrameById(sceneId);
        if (frame && !this.lockPositions) {
          const sequenceStarts = this.sequenceStartsFromSelection();
          const nodeStarts = this.moveStartsFromSelection();
          if (nodeStarts.size > 0 || sequenceStarts.size > 1) {
            this.draggingIds = new Set(nodeStarts.keys());
            this.drag = {
              type: 'move',
              originWorld: world,
              starts: nodeStarts,
              sequenceStarts,
            };
          } else {
            this.drag = {
              type: 'sequence-move',
              id: frame.id,
              originWorld: world,
              start: { ...frame },
            };
          }
        }
        this.markDirty();
        return;
      }
      if (!additive) {
        this.setSelection(hit);
      }
      this.drag = {
        type: 'seq-box',
        sceneId,
        startWorld: world,
        currentWorld: world,
        additive,
      };
      this.markDirty();
      return;
    }

    if (hit.kind === 'mind-node') {
      this.setSelection(hit);
      this.markDirty();
      return;
    }

    if (hit.kind === 'mind') {
      const mapId = hit.ids[0] ?? '';
      const model = this.mindModel(mapId);
      const inner = model ? hitMindInterior(model, world) : null;
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      if (inner?.kind === 'add-topic') {
        const parentId = this.selection.kind === 'mind-node' && this.selection.mapId === mapId
          ? this.selection.ids[0]
          : mapId;
        this.addMindTopic(mapId, parentId);
        return;
      }
      if (additive) {
        this.toggleIntoSelection(hit);
        this.markDirty();
        return;
      }
      if (!this.isSelected(hit)) {
        this.setSelection(hit);
      }
      const frame = this.mindFrameById(mapId);
      if (frame && !this.lockPositions) {
        const mindStarts = this.mindStartsFromSelection();
        const sequenceStarts = this.sequenceStartsFromSelection();
        const nodeStarts = this.moveStartsFromSelection();
        if (nodeStarts.size > 0 || sequenceStarts.size > 0 || mindStarts.size > 1) {
          this.draggingIds = new Set(nodeStarts.keys());
          this.drag = {
            type: 'move',
            originWorld: world,
            starts: nodeStarts,
            sequenceStarts: sequenceStarts.size > 0 ? sequenceStarts : undefined,
            mindStarts,
          };
        } else {
          this.drag = {
            type: 'mind-move',
            id: frame.id,
            originWorld: world,
            start: { ...frame },
          };
        }
      }
      this.markDirty();
      return;
    }

    if (hit.kind === 'frame') {
      if (this.lockPositions) {
        this.setSelection(hit);
        this.markDirty();
        return;
      }
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        this.toggleIntoSelection(hit);
        this.markDirty();
        return;
      }
      this.setSelection(hit);
      const frame = this.frameById(hit.ids[0]);
      if (frame) {
        const nodeStarts = new Map<string, Vec2>();
        for (const id of frame.nodeIds) {
          const node = this.nodeMap.get(id);
          if (node) {
            nodeStarts.set(id, { x: node.x, y: node.y });
          }
        }
        this.drag = {
          type: 'frame-move',
          id: frame.id,
          originWorld: world,
          start: { ...frame, nodeIds: [...frame.nodeIds] },
          nodeStarts,
        };
      }
      this.markDirty();
      return;
    }

    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      this.toggleIntoSelection(hit);
      this.markDirty();
      return;
    }

    if (!this.isSelected(hit)) {
      this.setSelection(hit);
    }

    if (event.altKey && hit.kind === 'node') {
      const sourceIds = this.selection.kind === 'node' && this.selection.ids.length > 0
        ? this.selection.ids
        : hit.ids;
      const duplicated = this.editing.duplicateNodes(this.doc, sourceIds, 0);
      this.doc = duplicated.document;
      this.rebuildIndexes();
      this.setSelection({ kind: 'node', ids: duplicated.newIds });
      if (this.lockPositions) {
        this.commitDocument();
        this.markDirty();
        return;
      }
      const starts = new Map<string, Vec2>();
      for (const id of duplicated.newIds) {
        const node = this.nodeMap.get(id);
        if (node) {
          starts.set(id, { x: node.x, y: node.y });
        }
      }
      if (starts.size > 0) {
        this.draggingIds = new Set(starts.keys());
        this.drag = { type: 'move', originWorld: world, starts };
      }
      this.markDirty();
      return;
    }

    if (!this.lockPositions && (hit.kind === 'node' || hit.kind === 'group')) {
      const starts = this.moveStartsFromSelection();
      const sequenceStarts = this.sequenceStartsFromSelection();
      const mindStarts = this.mindStartsFromSelection();
      if (starts.size > 0 || sequenceStarts.size > 0 || mindStarts.size > 0) {
        this.draggingIds = new Set(starts.keys());
        this.drag = {
          type: 'move',
          originWorld: world,
          starts,
          sequenceStarts: sequenceStarts.size > 0 ? sequenceStarts : undefined,
          mindStarts: mindStarts.size > 0 ? mindStarts : undefined,
        };
      }
    }

    this.markDirty();
  };

  private onPointerMove = (event: PointerEvent) => {
    const view = this.viewFromEvent(event);
    const world = this.camera.viewToWorld(view);

    if (this.drag.type === 'pan') {
      const dx = view.x - this.drag.lastView.x;
      const dy = view.y - this.drag.lastView.y;
      if (dx === 0 && dy === 0) {
        return;
      }
      this.camera.panByViewDelta(dx, dy);
      this.drag = { type: 'pan', lastView: view };
      hotPathCounters.viewportLiveApplies += 1;
      this.markDirty();
      return;
    }

    if (this.drag.type === 'move') {
      this.applyMoveFromStarts(this.drag, world, event.shiftKey);
      this.rebuildGroupRects();
      this.markDirty();
      return;
    }

    if (this.drag.type === 'box' || this.drag.type === 'seq-box' || this.drag.type === 'frame-draw') {
      this.drag = { ...this.drag, currentWorld: world };
      this.markDirty();
      return;
    }

    if (this.drag.type === 'seq-actor-move') {
      const drag = this.drag;
      const scene = this.doc.sequence?.scenes.find((item) => item.id === drag.sceneId);
      const model = this.sequenceModel(drag.sceneId);
      if (scene && model) {
        const fromIndex = scene.participants.findIndex((item) => item.id === drag.id);
        const toIndex = sequenceColumnIndexAt(model, world.x);
        if (fromIndex >= 0 && fromIndex !== toIndex) {
          const next = [...scene.participants];
          const [moved] = next.splice(fromIndex, 1);
          if (moved) {
            next.splice(toIndex, 0, moved);
            scene.participants = next;
          }
        }
      }
      this.markDirty();
      return;
    }

    if (this.drag.type === 'seq-message-move') {
      const drag = this.drag;
      const scene = this.doc.sequence?.scenes.find((item) => item.id === drag.sceneId);
      const model = this.sequenceModel(drag.sceneId);
      if (scene && model) {
        const toIndex = sequenceMessageIndexAt(model, world.y);
        scene.steps = reorderSequenceSteps(scene.steps, drag.id, toIndex);
      }
      this.markDirty();
      return;
    }

    if (this.drag.type === 'seq-connect') {
      this.drag = { ...this.drag, currentWorld: world };
      this.markDirty();
      return;
    }

    if (this.drag.type === 'sequence-move') {
      const dx = this.snap(world.x - this.drag.originWorld.x);
      const dy = this.snap(world.y - this.drag.originWorld.y);
      const moved = translateSequenceFrame(this.drag.start, dx, dy);
      moved.x = this.snap(moved.x);
      moved.y = this.snap(moved.y);
      this.seqFrames = this.seqFrames.map((frame) => (frame.id === moved.id ? moved : frame));
      this.markDirty();
      return;
    }

    if (this.drag.type === 'mind-move') {
      const dx = this.snap(world.x - this.drag.originWorld.x);
      const dy = this.snap(world.y - this.drag.originWorld.y);
      const moved = translateMindFrame(this.drag.start, dx, dy);
      moved.x = this.snap(moved.x);
      moved.y = this.snap(moved.y);
      this.mindFrames = this.mindFrames.map((frame) => (frame.id === moved.id ? moved : frame));
      this.markDirty();
      return;
    }

    if (this.drag.type === 'frame-move') {
      const dx = world.x - this.drag.originWorld.x;
      const dy = world.y - this.drag.originWorld.y;
      const moved = translateFrame(this.drag.start, dx, dy);
      this.frames = this.frames.map((frame) => (frame.id === moved.id ? moved : frame));
      for (const [id, start] of this.drag.nodeStarts) {
        const node = this.nodeMap.get(id);
        if (node) {
          node.x = this.snap(start.x + dx);
          node.y = this.snap(start.y + dy);
        }
      }
      this.rebuildGroupRects();
      this.markDirty();
      return;
    }

    if (this.drag.type === 'frame-resize') {
      const next = resizeFrame(this.drag.start, this.drag.handle, world);
      this.frames = this.frames.map((frame) => (frame.id === next.id ? next : frame));
      this.applyFrameReflow(next);
      this.rebuildGroupRects();
      this.markDirty();
      return;
    }

    if (this.drag.type === 'connect') {
      this.drag = { ...this.drag, currentWorld: world };
      this.markDirty();
    }
  };

  private applyMoveFromStarts(
    drag: Extract<DragMode, { type: 'move' }>,
    world: Vec2,
    lockAxis = false,
  ) {
    let dx = world.x - drag.originWorld.x;
    let dy = world.y - drag.originWorld.y;
    if (lockAxis) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        dy = 0;
      } else {
        dx = 0;
      }
    }
    for (const [id, start] of drag.starts) {
      const n = this.nodeMap.get(id);
      if (!n) continue;
      n.x = this.snap(start.x + dx);
      n.y = this.snap(start.y + dy);
    }
    if (drag.sequenceStarts) {
      this.seqFrames = this.seqFrames.map((frame) => {
        const start = drag.sequenceStarts?.get(frame.id);
        if (!start) {
          return frame;
        }
        const moved = translateSequenceFrame(start, dx, dy);
        moved.x = this.snap(moved.x);
        moved.y = this.snap(moved.y);
        return moved;
      });
    }
    if (drag.mindStarts) {
      this.mindFrames = this.mindFrames.map((frame) => {
        const start = drag.mindStarts?.get(frame.id);
        if (!start) {
          return frame;
        }
        const moved = translateMindFrame(start, dx, dy);
        moved.x = this.snap(moved.x);
        moved.y = this.snap(moved.y);
        return moved;
      });
    }
  }

  private moveStartsFromSelection() {
    const starts = new Map<string, Vec2>();
    const parts = partsOf(this.selection);
    for (const id of parts.nodes) {
      const node = this.nodeMap.get(id);
      if (node) {
        starts.set(id, { x: node.x, y: node.y });
      }
    }
    for (const gid of parts.groups) {
      for (const node of membersOfSubgraph(this.doc.nodes, gid, this.subgraphMap)) {
        if (!starts.has(node.id)) {
          starts.set(node.id, { x: node.x, y: node.y });
        }
      }
    }
    return starts;
  }

  private sequenceStartsFromSelection() {
    const starts = new Map<string, SequenceFrame>();
    for (const id of partsOf(this.selection).sequences) {
      const frame = this.seqFrameById(id);
      if (frame) {
        starts.set(id, { ...frame });
      }
    }
    return starts;
  }

  private mindStartsFromSelection() {
    const starts = new Map<string, MindFrame>();
    for (const id of partsOf(this.selection).minds) {
      const frame = this.mindFrameById(id);
      if (frame) {
        starts.set(id, { ...frame });
      }
    }
    return starts;
  }

  private onPointerUp = (event: PointerEvent) => {
    const view = this.viewFromEvent(event);
    const world = this.camera.viewToWorld(view);
    const prev = this.drag;
    this.drag = { type: 'none' };

    if (prev.type === 'pan') {
      this.draggingIds.clear();
      this.updateCursor();
      this.commitViewportOnly();
      this.markDirty();
      return;
    }

    if (prev.type === 'move') {
      this.applyMoveFromStarts(prev, world, event.shiftKey);
      if (prev.sequenceStarts && prev.sequenceStarts.size > 0) {
        this.writeSequenceFramesToDoc();
      }
      if (prev.mindStarts && prev.mindStarts.size > 0) {
        this.writeMindFramesToDoc();
      }
      this.rebuildGroupRects();
      if (event.ctrlKey || event.metaKey) {
        const movedIds = [...prev.starts.keys()];
        const edgeTarget = movedIds.length === 1
          ? this.hitEdgeAt(world, new Set(movedIds))
          : null;
        if (edgeTarget && movedIds[0]) {
          this.doc = this.editing.insertNodeIntoEdge(this.doc, edgeTarget, movedIds[0]);
        } else {
          const exclude = this.selection.kind === 'group' ? new Set(this.selection.ids) : undefined;
          const targetGroup = this.hitGroupAt(world, exclude);
          for (const id of movedIds) {
            const node = this.nodeMap.get(id);
            if (node) {
              node.subgraphId = targetGroup;
            }
          }
          const targetFrame = [...this.frames].reverse().find((frame) => hitFrameBody(frame, world));
          if (targetFrame) {
            this.frames = exclusiveAssign(this.frames, targetFrame.id, movedIds);
            const next = this.frameById(targetFrame.id);
            if (next) {
              this.applyFrameReflow(next);
            }
          } else {
            const drop = new Set(movedIds);
            this.frames = this.frames.map((frame) => ({
              ...frame,
              nodeIds: frame.nodeIds.filter((id) => !drop.has(id)),
            }));
          }
        }
      }
      this.draggingIds.clear();
      this.rebuildIndexes();
      this.commitDocument();
      this.markDirty();
      return;
    }

    if (prev.type === 'seq-actor-move' || prev.type === 'seq-message-move') {
      this.rebuildIndexes();
      this.commitDocument();
      this.markDirty();
      return;
    }

    if (prev.type === 'seq-connect') {
      const travel = Math.hypot(world.x - prev.originWorld.x, world.y - prev.originWorld.y);
      const model = this.sequenceModel(prev.sceneId);
      const target = model ? sequenceConnectTarget(model, world) : null;
      const from = model?.columns.find((item) => item.id === prev.fromId);
      if (model && target && from && (travel > 6 || target.id !== prev.fromId)) {
        const toX = sequenceConnectAttachX(from.x, target);
        this.addSequenceMessage(prev.sceneId, {
          from: prev.fromId,
          to: target.id,
          arrow: sequenceConnectArrow(from.x, toX, event.altKey || prev.arrow === 'return'),
          atIndex: sequenceMessageInsertIndex(model, world.y),
        });
        return;
      }
      this.markDirty();
      return;
    }

    if (prev.type === 'sequence-move') {
      this.writeSequenceFramesToDoc();
      this.rebuildIndexes();
      this.commitDocument();
      this.markDirty();
      return;
    }

    if (prev.type === 'mind-move') {
      this.writeMindFramesToDoc();
      this.rebuildIndexes();
      this.commitDocument();
      this.markDirty();
      return;
    }

    if (prev.type === 'frame-move' || prev.type === 'frame-resize') {
      this.writeFramesToDoc();
      this.rebuildIndexes();
      this.commitDocument();
      this.markDirty();
      return;
    }

    if (prev.type === 'frame-draw') {
      const x = Math.min(prev.startWorld.x, prev.currentWorld.x);
      const y = Math.min(prev.startWorld.y, prev.currentWorld.y);
      const width = Math.abs(prev.currentWorld.x - prev.startWorld.x);
      const height = Math.abs(prev.currentWorld.y - prev.startWorld.y);
      if (width > 24 && height > 24) {
        const rect = { x, y, width, height };
        const members = nodesIntersectingRect(this.doc.nodes.filter((node) => !this.isNodeHidden(node)), rect);
        const frame = createFrameFromRect(this.frames, rect, members.map((node) => node.id));
        this.frames = exclusiveAssign([...this.frames, frame], frame.id, frame.nodeIds);
        this.applyFrameReflow(frame);
        this.writeFramesToDoc();
        this.setSelection({ kind: 'frame', ids: [frame.id] });
        this.rebuildIndexes();
        this.commitDocument();
      }
      this.markDirty();
      return;
    }

    if (prev.type === 'seq-box') {
      const x1 = Math.min(prev.startWorld.x, prev.currentWorld.x);
      const y1 = Math.min(prev.startWorld.y, prev.currentWorld.y);
      const x2 = Math.max(prev.startWorld.x, prev.currentWorld.x);
      const y2 = Math.max(prev.startWorld.y, prev.currentWorld.y);
      const box: Rect = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
      if (box.width > 4 || box.height > 4) {
        const model = this.sequenceModel(prev.sceneId);
        const hits = model ? intersectingSequenceInterior(model, box) : { actors: [], messages: [] };
        if (hits.messages.length > 0) {
          const ids = prev.additive && this.selection.kind === 'seq-message' && this.selection.sceneId === prev.sceneId
            ? [...new Set([...this.selection.ids, ...hits.messages])]
            : hits.messages;
          this.setSelection({ kind: 'seq-message', sceneId: prev.sceneId, ids });
        } else if (hits.actors.length > 0) {
          const ids = prev.additive && this.selection.kind === 'seq-actor' && this.selection.sceneId === prev.sceneId
            ? [...new Set([...this.selection.ids, ...hits.actors])]
            : hits.actors;
          this.setSelection({ kind: 'seq-actor', sceneId: prev.sceneId, ids });
        } else if (!prev.additive) {
          this.setSelection({ kind: 'sequence', ids: [prev.sceneId] });
        }
      }
      this.markDirty();
      return;
    }

    if (prev.type === 'box') {
      this.draggingIds.clear();
      const x1 = Math.min(prev.startWorld.x, prev.currentWorld.x);
      const y1 = Math.min(prev.startWorld.y, prev.currentWorld.y);
      const x2 = Math.max(prev.startWorld.x, prev.currentWorld.x);
      const y2 = Math.max(prev.startWorld.y, prev.currentWorld.y);
      const box: Rect = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
      if (box.width > 4 || box.height > 4) {
        const nodeIds = this.nodeIndex
          .queryRect(box)
          .map((entry) => this.nodeMap.get(entry.id) ?? entry.item)
          .filter((node) => (
            !this.isNodeHidden(node)
            && rectIntersects(box, { x: node.x, y: node.y, width: node.width, height: node.height })
          ))
          .map((node) => node.id);
        const sequenceIds = intersectingSequenceFrameIds(this.seqFrames, box);
        const mindIds = intersectingMindFrameIds(this.mindFrames, box);
        const current = prev.additive ? partsOf(this.selection) : undefined;
        this.setSelection(collectSelection({
          nodes: current ? [...current.nodes, ...nodeIds] : nodeIds,
          groups: current?.groups ?? [],
          sequences: current ? [...current.sequences, ...sequenceIds] : sequenceIds,
          minds: current ? [...current.minds, ...mindIds] : mindIds,
          frames: current?.frames ?? [],
          edges: current?.edges ?? [],
        }));
      }
      this.markDirty();
      return;
    }

    if (prev.type === 'connect') {
      this.draggingIds.clear();
      const from = this.endpointBox(prev.fromId);
      const snap = from ? this.connectSnap(from, world) : null;
      const hit = this.hitTest(world);
      const sequenceTarget = hit.kind === 'sequence'
        ? hit.ids[0]
        : hit.kind === 'seq-actor' || hit.kind === 'seq-message'
          ? hit.sceneId
          : hit.kind === 'mind'
            ? hit.ids[0]
            : hit.kind === 'mind-node'
              ? hit.mapId
              : null;
      if (snap) {
        this.createEdge(prev.fromId, snap.id, prev.edgeType);
      } else if (hit.kind === 'node' && hit.ids[0] && hit.ids[0] !== prev.fromId) {
        this.createEdge(prev.fromId, hit.ids[0], prev.edgeType);
      } else if (sequenceTarget && sequenceTarget !== prev.fromId) {
        this.createEdge(prev.fromId, sequenceTarget, prev.edgeType);
      } else if (hit.kind === 'group' && hit.ids[0] && hit.ids[0] !== prev.fromId) {
        const travel = from
          ? Math.hypot(world.x - (from.x + from.width / 2), world.y - (from.y + from.height / 2))
          : 80;
        if (travel > 24) {
          this.createNodeAt(world.x - 70, world.y - 28, '新建节点', {
            subgraphId: hit.ids[0],
            connectFrom: prev.fromId,
            edgeType: prev.edgeType,
          });
        }
      } else if (hit.kind === 'none' || hit.kind === 'edge') {
        const travel = from
          ? Math.hypot(world.x - (from.x + from.width / 2), world.y - (from.y + from.height / 2))
          : 80;
        if (travel > 24) {
          this.createNodeAt(world.x - 70, world.y - 28, '新建节点', {
            subgraphId: this.hitGroupAt(world),
            connectFrom: prev.fromId,
            edgeType: prev.edgeType,
          });
        }
      }
      this.markDirty();
    }
  };

  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    // Safari pinch already arrives via gesturechange — ignore the paired ctrl-wheel.
    if (this.gestureScale !== null && (event.ctrlKey || event.metaKey)) {
      return;
    }
    const intent = interpretCanvasWheel(event, this.cssH || 800);
    if (intent.kind === 'zoom') {
      this.camera.zoomAt(this.viewFromEvent(event), intent.factor);
    } else {
      this.camera.panByViewDelta(-intent.dx, -intent.dy);
    }
    hotPathCounters.viewportLiveApplies += 1;
    this.markDirty();
    this.scheduleViewportCommit();
  };

  private onGestureStart = (event: Event) => {
    event.preventDefault();
    const gesture = event as Event & { scale?: number };
    this.gestureScale = gesture.scale ?? 1;
  };

  private onGestureChange = (event: Event) => {
    event.preventDefault();
    const gesture = event as Event & {
      scale?: number;
      clientX?: number;
      clientY?: number;
    };
    const nextScale = gesture.scale ?? 1;
    const previous = this.gestureScale ?? 1;
    const factor = pinchScaleFactor(previous, nextScale);
    this.gestureScale = nextScale;
    if (factor === 1) {
      return;
    }
    const view = this.viewFromEvent({
      clientX: gesture.clientX ?? window.innerWidth / 2,
      clientY: gesture.clientY ?? window.innerHeight / 2,
    });
    this.camera.zoomAt(view, factor);
    hotPathCounters.viewportLiveApplies += 1;
    this.markDirty();
    this.scheduleViewportCommit();
  };

  private onGestureEnd = (event: Event) => {
    event.preventDefault();
    this.gestureScale = null;
    this.commitViewportOnly();
  };

  private onContextMenu = (event: Event) => {
    event.preventDefault();
  };

  private scheduleViewportCommit() {
    if (this.viewportCommitTimer !== null) {
      window.clearTimeout(this.viewportCommitTimer);
    }
    this.viewportCommitTimer = window.setTimeout(() => {
      this.viewportCommitTimer = null;
      this.commitViewportOnly();
    }, 200);
  }

  private onDblClick = (event: MouseEvent) => {
    event.preventDefault();
    const view = this.viewFromEvent(event);
    const world = this.camera.viewToWorld(view);
    const hit = this.hitTest(world);
    if (hit.kind === 'node' && hit.ids[0]) {
      const node = this.nodeMap.get(hit.ids[0]);
      if (!node) {
        return;
      }
      const field = this.showsDetails() ? fieldAtNodePoint(node, world) : 'title';
      if (this.inlineSession?.kind === 'node' && this.inlineSession.id === node.id) {
        this.setInlineField(field);
        return;
      }
      this.openInlineEdit('node', node.id, field);
      return;
    }
    if (hit.kind === 'edge' && hit.ids[0]) {
      this.openInlineEdit('edge', hit.ids[0], 'label');
      return;
    }
    if (hit.kind === 'group' && hit.ids[0]) {
      if (this.showsGroupsOnly()) {
        this.drillIntoGroup(hit.ids[0]);
        return;
      }
      if (this.hitGroupCollapse(world, hit.ids[0])) {
        this.toggleGroupCollapsed(hit.ids[0]);
        return;
      }
      this.openInlineEdit('group', hit.ids[0], 'title');
      return;
    }
    if (hit.kind === 'frame' && hit.ids[0]) {
      this.openInlineEdit('frame', hit.ids[0], 'title');
      return;
    }
    if (hit.kind === 'seq-actor' && hit.ids[0]) {
      this.openInlineEdit('seq-actor', hit.ids[0], 'title', hit.sceneId);
      return;
    }
    if (hit.kind === 'seq-message' && hit.ids[0]) {
      this.openInlineEdit('seq-message', hit.ids[0], 'label', hit.sceneId);
      return;
    }
    if (hit.kind === 'sequence' && hit.ids[0]) {
      const model = this.sequenceModel(hit.ids[0]);
      const inner = model ? hitSequenceInterior(model, world) : null;
      if (inner?.kind === 'body' || inner?.kind === 'lifeline' || inner?.kind === 'activation') {
        this.addSequenceActor(hit.ids[0], model ? sequenceColumnInsertIndex(model, world.x) : undefined);
        return;
      }
      this.openInlineEdit('sequence', hit.ids[0], 'title');
      return;
    }
    if (hit.kind === 'mind-node' && hit.ids[0]) {
      this.openInlineEdit('mind-node', hit.ids[0], 'title', hit.mapId);
      return;
    }
    if (hit.kind === 'mind' && hit.ids[0]) {
      const model = this.mindModel(hit.ids[0]);
      const inner = model ? hitMindInterior(model, world) : null;
      if (inner?.kind === 'body' || inner?.kind === 'add-topic') {
        const parentId = this.selection.kind === 'mind-node' && this.selection.mapId === hit.ids[0]
          ? this.selection.ids[0]
          : hit.ids[0];
        this.addMindTopic(hit.ids[0], parentId);
        return;
      }
      this.openInlineEdit('mind', hit.ids[0], 'title');
      return;
    }
    if (hit.kind === 'none' && !this.frameTool) {
      const id = this.createNodeAt(world.x - 70, world.y - 28);
      if (id) {
        this.openInlineEdit('node', id, 'title');
      }
    }
  };

  private hitGroupCollapse(world: Vec2, groupId: string) {
    const rect = this.groupRectCache.get(groupId);
    if (!rect) {
      return false;
    }
    return world.x <= rect.x + 22 && world.y >= rect.y && world.y <= rect.y + GROUP_HEADER;
  }

  private toggleGroupCollapsed(groupId: string) {
    const sg = this.doc.subgraphs.find((entry) => entry.id === groupId);
    if (!sg) {
      return;
    }
    sg.collapsed = !sg.collapsed;
    this.commitDocument();
    this.markDirty();
  }

  private onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      return;
    }
    if (event.code === 'Space') {
      this.spaceDown = true;
      this.updateCursor();
      event.preventDefault();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.startInlineEditForSelection();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteSelection();
    }
    if (event.key === 'Escape') {
      this.setSelection({ kind: 'none' });
      this.drag = { type: 'none' };
      this.markDirty();
    }
    if (
      !this.lockPositions &&
      this.selection.kind !== 'none' &&
      this.selection.ids.length > 0 &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      const step = event.shiftKey ? this.policy.snap.major : this.policy.snap.size;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      const parts = partsOf(this.selection);
      const sequenceId = sequenceSceneIdOf(this.selection);
      const sequenceIds = new Set(
        this.selection.kind === 'seq-actor' || this.selection.kind === 'seq-message'
          ? (sequenceId ? [sequenceId] : [])
          : parts.sequences,
      );
      if (sequenceIds.size > 0) {
        this.seqFrames = this.seqFrames.map((frame) => (
          sequenceIds.has(frame.id)
            ? { ...frame, x: this.snap(frame.x + dx), y: this.snap(frame.y + dy) }
            : frame
        ));
        this.writeSequenceFramesToDoc();
      }
      const mindId = mindMapIdOf(this.selection);
      const mindIds = new Set(
        this.selection.kind === 'mind-node'
          ? (mindId ? [mindId] : [])
          : parts.minds,
      );
      if (mindIds.size > 0) {
        this.mindFrames = this.mindFrames.map((frame) => (
          mindIds.has(frame.id)
            ? { ...frame, x: this.snap(frame.x + dx), y: this.snap(frame.y + dy) }
            : frame
        ));
        this.writeMindFramesToDoc();
      }
      const nodeIds = new Set(parts.nodes);
      for (const gid of parts.groups) {
        for (const node of membersOfSubgraph(this.doc.nodes, gid, this.subgraphMap)) {
          nodeIds.add(node.id);
        }
      }
      if (this.selection.kind === 'node') {
        for (const id of this.selection.ids) {
          nodeIds.add(id);
        }
      }
      for (const id of nodeIds) {
        const node = this.nodeMap.get(id);
        if (!node) continue;
        node.x = this.snap(node.x + dx);
        node.y = this.snap(node.y + dy);
      }
      this.rebuildIndexes();
      this.commitDocument();
      this.markDirty();
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space' && !this.panLocked) {
      this.spaceDown = false;
      this.updateCursor();
    }
  };

  private updateCursor() {
    if (!this.canvas) {
      return;
    }
    const panning = this.drag.type === 'pan' || this.spaceDown;
    this.canvas.style.cursor = this.drag.type === 'pan' ? 'grabbing' : panning ? 'grab' : '';
  }

  private viewFromEvent(event: { clientX: number; clientY: number }): Vec2 {
    const rect = this.canvas!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private isSelected(hit: StageSelection): boolean {
    if (hit.kind === 'none' || this.selection.kind === 'none') return false;
    if (hit.kind === 'seq-actor' || hit.kind === 'seq-message') {
      return this.selection.kind === hit.kind
        && this.selection.sceneId === hit.sceneId
        && hit.ids.every((id) => this.selection.kind !== 'none' && this.selection.ids.includes(id));
    }
    if (hit.kind === 'mind-node') {
      return this.selection.kind === 'mind-node'
        && this.selection.mapId === hit.mapId
        && hit.ids.every((id) => this.selection.kind === 'mind-node' && this.selection.ids.includes(id));
    }
    if (hit.kind === 'mixed') {
      return false;
    }
    return hit.ids.every((id) => isCanvasIdSelected(this.selection, hit.kind as CanvasSelectionKind, id));
  }

  private toggleIntoSelection(hit: StageSelection) {
    if (hit.kind === 'none') return;
    if (hit.kind === 'seq-actor' || hit.kind === 'seq-message' || hit.kind === 'mind-node' || hit.kind === 'mixed') {
      this.setSelection(hit);
      return;
    }
    this.setSelection(toggleCanvasIds(this.selection, hit.kind, hit.ids));
  }

  private bound = false;
  private bindEvents() {
    if (!this.canvas || this.bound) return;
    this.bound = true;
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('gesturestart', this.onGestureStart, { passive: false });
    this.canvas.addEventListener('gesturechange', this.onGestureChange, { passive: false });
    this.canvas.addEventListener('gestureend', this.onGestureEnd, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('dblclick', this.onDblClick);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.resize);
    if (typeof ResizeObserver !== 'undefined' && this.canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas.parentElement);
    }
  }

  private unbindEvents() {
    if (!this.canvas || !this.bound) return;
    this.bound = false;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('gesturestart', this.onGestureStart);
    this.canvas.removeEventListener('gesturechange', this.onGestureChange);
    this.canvas.removeEventListener('gestureend', this.onGestureEnd);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('dblclick', this.onDblClick);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.resize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
}

// re-export for label updates from inspector without full rewrite of node size
export function applyNodeLabelSize(node: GraphNode, title: string, description: string) {
  const label = composeEntityText(title, description);
  const size = measureNodeContentSize(title, description);
  node.label = label;
  node.width = size.width;
  node.height = size.height;
}
