import {
  buildEntityIdFromTitle,
  measureNodeContentSize,
  serializeMermaidDocument,
  toSidecar,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type GraphSubgraph,
} from '..';
import { duplicateNodesInDocument } from '../flow/documentOps';
import {
  DEFAULT_EDGE_STYLE,
  DEFAULT_GROUP_STYLE,
  DEFAULT_NODE_STYLE,
} from '../flow/types';
import { composeEntityText, splitEntityText } from '../flow/label';
import { CanvasTextCache, SceneSpatialIndex } from '../hotpath/canvasEngine';
import {
  hotPathCounters,
  interpretCanvasWheel,
  pinchScaleFactor,
  topologyRevisionFromGraph,
} from '../hotpath/sceneHotPath';
import { Camera } from './camera';
import { GROUP_HEADER, groupBounds } from './groupLayout';
import {
  distPointToCubicBezierSq,
  pointInRect,
  rectBorderPoint,
  rectIntersects,
  unionRects,
  type Rect,
  type Vec2,
} from './math';

export type StageSelection =
  | { kind: 'none' }
  | { kind: 'node'; ids: string[] }
  | { kind: 'edge'; ids: string[] }
  | { kind: 'group'; ids: string[] };

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

type DragMode =
  | { type: 'none' }
  | { type: 'pan'; lastView: Vec2 }
  | {
      type: 'move';
      originWorld: Vec2;
      /** node id → start pos at pointer-down */
      starts: Map<string, Vec2>;
    }
  | { type: 'box'; startWorld: Vec2; currentWorld: Vec2; additive: boolean }
  | { type: 'connect'; fromId: string; currentWorld: Vec2; edgeType: GraphEdge['type'] };

const NODE_RADIUS = 8;

function cloneDocument(doc: GraphDocument): GraphDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => ({ ...n })),
    edges: doc.edges.map((e) => ({ ...e })),
    subgraphs: doc.subgraphs.map((s) => ({ ...s })),
    unsupportedLines: [...doc.unsupportedLines],
    warnings: [...doc.warnings],
    layout: {
      ...doc.layout,
      viewport: { ...doc.layout.viewport },
      nodes: { ...doc.layout.nodes },
      subgraphs: { ...doc.layout.subgraphs },
    },
  };
}

function refreshSource(doc: GraphDocument): GraphDocument {
  const next = {
    ...doc,
    source: serializeMermaidDocument(
      doc.direction,
      doc.nodes,
      doc.edges,
      doc.subgraphs,
      doc.unsupportedLines,
    ),
  };
  return {
    ...next,
    layout: toSidecar(next),
  };
}

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
  private onSelectionChange: ((sel: StageSelection) => void) | null = null;
  private onNodeDoubleClick: ((id: string) => void) | null = null;

  private groupRectCache = new Map<string, Rect>();
  private nodeMap = new Map<string, GraphNode>();
  private nodeOrder = new Map<string, number>();
  private nodeIndex = new SceneSpatialIndex<GraphNode>();
  private textCache = new CanvasTextCache();
  private draggingIds = new Set<string>();
  private topologyRevision = '';
  private viewportCommitTimer: number | null = null;
  private gestureScale: number | null = null;

  constructor(initial: GraphDocument) {
    this.doc = cloneDocument(initial);
    this.camera.fromViewportState(initial.layout.viewport);
    this.rebuildIndexes();
  }

  setHandlers(handlers: {
    onDocumentCommit?: (doc: GraphDocument) => void;
    onSelectionChange?: (sel: StageSelection) => void;
    onNodeDoubleClick?: (id: string) => void;
  }) {
    this.onDocumentCommit = handlers.onDocumentCommit ?? null;
    this.onSelectionChange = handlers.onSelectionChange ?? null;
    this.onNodeDoubleClick = handlers.onNodeDoubleClick ?? null;
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
    this.doc = cloneDocument(doc);
    if (options?.restoreViewport !== false) {
      this.camera.fromViewportState(doc.layout.viewport);
    }
    this.rebuildIndexes();
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
    this.doc = cloneDocument(doc);
    this.camera.fromViewportState(live);
    this.rebuildIndexes();
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
    return unionRects(rects);
  }

  /** True when some content is on-screen at a readable scale. */
  isContentInView(): boolean {
    const world = this.contentBounds();
    if (!world) {
      return true;
    }
    if (this.cssW < 8 || this.cssH < 8) {
      return false;
    }
    const view = this.camera.getCoverWorldRectangle(this.cssW, this.cssH);
    if (!rectIntersects(view, world)) {
      return false;
    }
    const screenW = world.width * this.camera.scale;
    const screenH = world.height * this.camera.scale;
    // Too tiny (saved zoom near 0) or absurdly huge (camera inside a pixel)
    if (screenW < 32 && screenH < 32) {
      return false;
    }
    if (screenW > this.cssW * 50 || screenH > this.cssH * 50) {
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

  createNodeAt(x: number, y: number, label = '新建节点') {
    const used = new Set(this.doc.nodes.map((n) => n.id));
    const id = buildEntityIdFromTitle(label, used);
    const size = measureNodeContentSize(label, '');
    const node: GraphNode = {
      id,
      label,
      shape: 'rect',
      x,
      y,
      width: size.width,
      height: size.height,
      fill: DEFAULT_NODE_STYLE.fill,
      stroke: DEFAULT_NODE_STYLE.stroke,
      textColor: DEFAULT_NODE_STYLE.textColor,
      subgraphId: null,
    };
    this.doc.nodes.push(node);
    this.rebuildIndexes();
    this.setSelection({ kind: 'node', ids: [id] });
    this.commitDocument();
    this.markDirty();
  }

  deleteSelection() {
    if (this.selection.kind === 'none' || this.selection.ids.length === 0) {
      return;
    }
    const ids = new Set(this.selection.ids);
    if (this.selection.kind === 'edge') {
      this.doc.edges = this.doc.edges.filter((e) => !ids.has(e.id));
    } else if (this.selection.kind === 'group') {
      this.doc.subgraphs = this.doc.subgraphs.filter((s) => !ids.has(s.id));
      for (const n of this.doc.nodes) {
        if (n.subgraphId && ids.has(n.subgraphId)) {
          n.subgraphId = null;
        }
      }
    } else {
      this.doc.nodes = this.doc.nodes.filter((n) => !ids.has(n.id));
      this.doc.edges = this.doc.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));
    }
    this.setSelection({ kind: 'none' });
    this.rebuildIndexes();
    this.commitDocument();
    this.markDirty();
  }

  /** Select every visible node. */
  selectAll() {
    const ids = this.doc.nodes
      .filter((n) => !this.isNodeHidden(n))
      .map((n) => n.id);
    this.setSelection(ids.length ? { kind: 'node', ids } : { kind: 'none' });
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

  /** Connect the first two selected nodes (toolbar / ⌘L). */
  connectSelection() {
    if (this.selection.kind !== 'node' || this.selection.ids.length < 2) {
      return;
    }
    this.createEdge(this.selection.ids[0], this.selection.ids[1]);
  }

  createEdge(fromId: string, toId: string, edgeType: GraphEdge['type'] = 'solid') {
    if (fromId === toId) return;
    if (!this.nodeMap.has(fromId) || !this.nodeMap.has(toId)) return;
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
    for (let i = this.doc.subgraphs.length - 1; i >= 0; i -= 1) {
      const subgraph = this.doc.subgraphs[i];
      if (excludeIds?.has(subgraph.id)) {
        continue;
      }
      const rect = this.groupRectCache.get(subgraph.id);
      if (rect && pointInRect(world, rect)) {
        return subgraph.id;
      }
    }
    return null;
  }

  exportPng(): string | null {
    // Prefer full-graph export; fall back to viewport.
    return this.exportPngFull() ?? this.exportViewportPng();
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
    if (this.selection.kind === 'none' || this.selection.ids.length === 0) {
      return null;
    }
    const rects: Rect[] = [];
    if (this.selection.kind === 'node') {
      for (const id of this.selection.ids) {
        const n = this.nodeMap.get(id);
        if (n) rects.push({ x: n.x, y: n.y, width: n.width, height: n.height });
      }
    } else if (this.selection.kind === 'group') {
      for (const id of this.selection.ids) {
        const r = this.groupRectCache.get(id);
        if (r) rects.push(r);
      }
    } else if (this.selection.kind === 'edge') {
      for (const id of this.selection.ids) {
        const e = this.doc.edges.find((edge) => edge.id === id);
        if (!e) continue;
        const from = this.nodeMap.get(e.from);
        const to = this.nodeMap.get(e.to);
        if (from) rects.push({ x: from.x, y: from.y, width: from.width, height: from.height });
        if (to) rects.push({ x: to.x, y: to.y, width: to.width, height: to.height });
      }
    }
    return unionRects(rects);
  }

  // ——— private core ———

  private snapshot(): GraphDocument {
    const vp = this.camera.toViewportState();
    const cloned = cloneDocument(this.doc);
    cloned.layout = {
      ...cloned.layout,
      viewport: vp,
    };
    return refreshSource(cloned);
  }

  private commitDocument() {
    this.onDocumentCommit?.(this.snapshot());
  }

  private commitViewportOnly() {
    // Viewport-only: skip mermaid re-serialize (cheap pan/zoom persist).
    hotPathCounters.viewportDocumentCommits += 1;
    const cloned = cloneDocument(this.doc);
    cloned.layout = {
      ...toSidecar(cloned),
      viewport: this.camera.toViewportState(),
    };
    this.onDocumentCommit?.(cloned);
  }

  private setSelection(sel: StageSelection) {
    this.selection = sel;
    this.onSelectionChange?.(sel);
    this.markDirty();
  }

  private rebuildIndexes() {
    this.nodeMap = new Map(this.doc.nodes.map((n) => [n.id, n]));
    this.nodeOrder = new Map(this.doc.nodes.map((n, index) => [n.id, index]));
    this.rebuildGroupRects();
    this.rebuildSpatialIndex();
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
    const ids = this.selection.ids.filter((id) => {
      if (this.selection.kind === 'node') {
        return this.nodeMap.has(id);
      }
      if (this.selection.kind === 'group') {
        return this.doc.subgraphs.some((subgraph) => subgraph.id === id);
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
    this.groupRectCache.clear();
    const byGroup = new Map<string, GraphNode[]>();
    for (const n of this.doc.nodes) {
      if (!n.subgraphId) continue;
      const list = byGroup.get(n.subgraphId) ?? [];
      list.push(n);
      byGroup.set(n.subgraphId, list);
    }
    for (const sg of this.doc.subgraphs) {
      this.groupRectCache.set(sg.id, groupBounds(byGroup.get(sg.id) ?? []));
    }
  }

  private resizeObserver: ResizeObserver | null = null;

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
    if (!this.dirty && this.drag.type === 'none') {
      return;
    }
    this.paint();
    this.dirty = this.drag.type !== 'none';
    if (this.dirty) {
      this.requestTick();
    }
  };

  // ——— paint (Project Graph style cull) ———

  private isOverView(view: Rect, r: Rect): boolean {
    return !rectIntersects(view, r);
  }

  private paint() {
    const paintStart = performance.now();
    const ctx = this.ctx!;
    if (this.cssW < 1 || this.cssH < 1) {
      return;
    }
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.paintScene(ctx, true);
    ctx.restore();
    this.paintMs = performance.now() - paintStart;
  }

  /**
   * Core scene paint. `interactive` draws grid, selection chrome, previews.
   * Used by live canvas and full-graph PNG export.
   */
  private paintScene(ctx: CanvasRenderingContext2D, interactive: boolean) {
    const view = this.camera.getCoverWorldRectangle(this.cssW, this.cssH);
    const pad = 40 / Math.max(this.camera.scale, 0.001);
    const cullView: Rect = {
      x: view.x - pad,
      y: view.y - pad,
      width: view.width + pad * 2,
      height: view.height + pad * 2,
    };

    ctx.fillStyle = '#070708';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    if (interactive) {
      this.paintGrid(ctx);
    }

    let drawnNodes = 0;
    let drawnEdges = 0;
    let drawnGroups = 0;
    let culled = 0;

    const visibleNodeIds = new Set(this.queryVisibleNodeIds(cullView));

    for (const sg of this.doc.subgraphs) {
      const rect = this.groupRectCache.get(sg.id);
      if (!rect) continue;
      if (this.isOverView(cullView, rect)) {
        culled += 1;
        continue;
      }
      this.paintGroup(ctx, sg, rect);
      drawnGroups += 1;
    }

    for (const edge of this.doc.edges) {
      const from = this.nodeMap.get(edge.from);
      const to = this.nodeMap.get(edge.to);
      if (!from || !to) continue;
      if (this.isNodeHidden(from) || this.isNodeHidden(to)) continue;
      const fr: Rect = { x: from.x, y: from.y, width: from.width, height: from.height };
      const tr: Rect = { x: to.x, y: to.y, width: to.width, height: to.height };
      const bound = unionRects([fr, tr]);
      if (bound && this.isOverView(cullView, bound)) {
        culled += 1;
        continue;
      }
      this.paintEdge(ctx, edge, from, to);
      drawnEdges += 1;
    }

    if (interactive && this.drag.type === 'connect') {
      const from = this.nodeMap.get(this.drag.fromId);
      if (from) {
        const a = rectBorderPoint(
          { x: from.x, y: from.y, width: from.width, height: from.height },
          this.drag.currentWorld,
        );
        this.paintConnectPreview(ctx, a, this.drag.currentWorld);
      }
    }

    for (const node of this.doc.nodes) {
      if (this.isNodeHidden(node)) continue;
      if (!visibleNodeIds.has(node.id)) {
        culled += 1;
        continue;
      }
      this.paintNode(ctx, node);
      if (interactive) {
        this.paintNodeHandles(ctx, node);
      }
      drawnNodes += 1;
    }

    if (interactive && this.drag.type === 'box') {
      this.paintBoxSelect(ctx, this.drag.startWorld, this.drag.currentWorld);
    }

    if (interactive) {
      this.lastDrawn = { nodes: drawnNodes, edges: drawnEdges, groups: drawnGroups, culled };
    }
  }

  /** Connection ports on selected nodes (drag without Shift). */
  private paintNodeHandles(ctx: CanvasRenderingContext2D, node: GraphNode) {
    const selected =
      this.selection.kind === 'node' && this.selection.ids.includes(node.id);
    if (!selected || this.camera.scale < 0.35) return;
    const ports = this.nodePorts(node);
    ctx.save();
    for (const p of ports) {
      const v = this.camera.worldToView(p);
      const r = 5;
      ctx.fillStyle = '#0a0a0c';
      ctx.strokeStyle = '#d6ff3a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(v.x, v.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private nodePorts(node: GraphNode): Vec2[] {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    return [
      { x: cx, y: node.y },
      { x: node.x + node.width, y: cy },
      { x: cx, y: node.y + node.height },
      { x: node.x, y: cy },
    ];
  }

  private hitPort(world: Vec2): { nodeId: string } | null {
    if (this.selection.kind !== 'node') return null;
    const threshold = 10 / this.camera.scale;
    for (const id of this.selection.ids) {
      const n = this.nodeMap.get(id);
      if (!n || this.isNodeHidden(n)) continue;
      for (const p of this.nodePorts(n)) {
        const dx = world.x - p.x;
        const dy = world.y - p.y;
        if (dx * dx + dy * dy <= threshold * threshold) {
          return { nodeId: id };
        }
      }
    }
    return null;
  }

  private isNodeHidden(node: GraphNode): boolean {
    if (!node.subgraphId) return false;
    const sg = this.doc.subgraphs.find((s) => s.id === node.subgraphId);
    return Boolean(sg?.collapsed);
  }

  private paintGrid(ctx: CanvasRenderingContext2D) {
    const step = 48 * this.camera.scale;
    if (step < 12) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const ox = this.camera.offsetX % step;
    const oy = this.camera.offsetY % step;
    ctx.beginPath();
    for (let x = ox; x < this.cssW; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.cssH);
    }
    for (let y = oy; y < this.cssH; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.cssW, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private paintGroup(ctx: CanvasRenderingContext2D, sg: GraphSubgraph, rect: Rect) {
    const v = this.camera.worldRectToView(rect);
    const selected =
      this.selection.kind === 'group' && this.selection.ids.includes(sg.id);
    const fill = sg.fill || DEFAULT_GROUP_STYLE.fill;
    const stroke = sg.stroke || DEFAULT_GROUP_STYLE.stroke;
    const text = sg.textColor || DEFAULT_GROUP_STYLE.textColor;

    ctx.save();
    ctx.fillStyle = fill;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    this.roundRect(ctx, v.x, v.y, v.width, v.height, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = selected ? '#d6ff3a' : stroke;
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.stroke();

    // header bar
    const headerH = Math.min(v.height, GROUP_HEADER * this.camera.scale);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(v.x, v.y, v.width, headerH);

    if (this.camera.scale > 0.25) {
      ctx.fillStyle = text;
      ctx.font = `700 ${Math.max(10, 13 * this.camera.scale)}px ui-monospace, SF Mono, Consolas, monospace`;
      ctx.textBaseline = 'middle';
      ctx.fillText(
        sg.collapsed ? `▸ ${sg.title}` : sg.title,
        v.x + 10 * this.camera.scale,
        v.y + headerH / 2,
        Math.max(0, v.width - 16),
      );
    }
    ctx.restore();
  }

  private paintNode(ctx: CanvasRenderingContext2D, node: GraphNode) {
    const v = this.camera.worldRectToView({
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    });
    const selected =
      this.selection.kind === 'node' && this.selection.ids.includes(node.id);
    const fill = node.fill || DEFAULT_NODE_STYLE.fill;
    const stroke = node.stroke || DEFAULT_NODE_STYLE.stroke;
    const textColor = node.textColor || DEFAULT_NODE_STYLE.textColor;
    const r = NODE_RADIUS * this.camera.scale;

    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = selected ? '#d6ff3a' : stroke;
    ctx.lineWidth = selected ? 2.25 : 1.5;

    this.drawShape(ctx, node.shape, v.x, v.y, v.width, v.height, r);
    ctx.fill();
    ctx.stroke();

    // LOD: skip text when tiny
    if (Math.min(v.width, v.height) >= 14 && this.camera.scale > 0.18) {
      const parts = splitEntityText(node.label);
      const titleSize = Math.max(9, 13 * this.camera.scale);
      const cx = v.x + v.width / 2;
      const cy = v.y + v.height / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(v.x + 6, v.y + 4, Math.max(0, v.width - 12), Math.max(0, v.height - 8));
      ctx.clip();
      if (parts.description && v.height > 36 * this.camera.scale) {
        this.textCache.drawCenteredLine(
          ctx,
          parts.title || node.id,
          cx,
          cy - 8 * this.camera.scale,
          `700 ${titleSize}px "Segoe UI", system-ui, sans-serif`,
          textColor,
        );
        this.textCache.drawCenteredLine(
          ctx,
          parts.description.split('\n')[0],
          cx,
          cy + 10 * this.camera.scale,
          `400 ${Math.max(8, 11 * this.camera.scale)}px "Segoe UI", system-ui, sans-serif`,
          textColor,
        );
      } else {
        this.textCache.drawCenteredLine(
          ctx,
          parts.title || node.id,
          cx,
          cy,
          `700 ${titleSize}px "Segoe UI", system-ui, sans-serif`,
          textColor,
        );
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private drawShape(
    ctx: CanvasRenderingContext2D,
    shape: GraphNode['shape'],
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) {
    ctx.beginPath();
    switch (shape) {
      case 'diamond': {
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w / 2, y + h);
        ctx.lineTo(x, y + h / 2);
        ctx.closePath();
        break;
      }
      case 'circle': {
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        break;
      }
      case 'hexagon': {
        const inset = w * 0.15;
        ctx.moveTo(x + inset, y);
        ctx.lineTo(x + w - inset, y);
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w - inset, y + h);
        ctx.lineTo(x + inset, y + h);
        ctx.lineTo(x, y + h / 2);
        ctx.closePath();
        break;
      }
      case 'database': {
        const ry = Math.min(h * 0.18, 14 * this.camera.scale);
        ctx.moveTo(x, y + ry);
        ctx.ellipse(x + w / 2, y + ry, w / 2, ry, 0, Math.PI, 0, false);
        ctx.lineTo(x + w, y + h - ry);
        ctx.ellipse(x + w / 2, y + h - ry, w / 2, ry, 0, 0, Math.PI, false);
        ctx.closePath();
        break;
      }
      case 'round':
      case 'subroutine':
      case 'rect':
      default:
        this.roundRect(ctx, x, y, w, h, r);
        break;
    }
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  private edgeCurveView(from: GraphNode, to: GraphNode) {
    const fromRect: Rect = { x: from.x, y: from.y, width: from.width, height: from.height };
    const toRect: Rect = { x: to.x, y: to.y, width: to.width, height: to.height };
    const fromC = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const toC = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const a = rectBorderPoint(fromRect, toC);
    const b = rectBorderPoint(toRect, fromC);
    const av = this.camera.worldToView(a);
    const bv = this.camera.worldToView(b);
    const dx = bv.x - av.x;
    const c1 = { x: av.x + dx * 0.4, y: av.y };
    const c2 = { x: bv.x - dx * 0.4, y: bv.y };
    return { av, bv, c1, c2 };
  }

  private paintEdge(ctx: CanvasRenderingContext2D, edge: GraphEdge, from: GraphNode, to: GraphNode) {
    const { av, bv, c1, c2 } = this.edgeCurveView(from, to);

    const selected =
      this.selection.kind === 'edge' && this.selection.ids.includes(edge.id);
    const stroke = edge.strokeColor || DEFAULT_EDGE_STYLE.strokeColor;
    const width = (edge.strokeWidth || DEFAULT_EDGE_STYLE.strokeWidth) * Math.min(1.5, this.camera.scale);

    ctx.save();
    ctx.strokeStyle = selected ? '#d6ff3a' : stroke;
    ctx.lineWidth = selected ? width + 1 : width;
    if (edge.type === 'dotted') {
      ctx.setLineDash([6, 5]);
    } else if (edge.type === 'thick') {
      ctx.lineWidth = width + 1.5;
    }
    ctx.beginPath();
    ctx.moveTo(av.x, av.y);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, bv.x, bv.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // arrow head
    const angle = Math.atan2(bv.y - c2.y, bv.x - c2.x);
    const ah = 10 * Math.min(1.4, this.camera.scale);
    ctx.fillStyle = selected ? '#d6ff3a' : stroke;
    ctx.beginPath();
    ctx.moveTo(bv.x, bv.y);
    ctx.lineTo(bv.x - ah * Math.cos(angle - 0.35), bv.y - ah * Math.sin(angle - 0.35));
    ctx.lineTo(bv.x - ah * Math.cos(angle + 0.35), bv.y - ah * Math.sin(angle + 0.35));
    ctx.closePath();
    ctx.fill();

    if (edge.label && this.camera.scale > 0.3) {
      const mx = (av.x + bv.x) / 2;
      const my = (av.y + bv.y) / 2 - 8;
      ctx.font = `600 ${Math.max(9, 11 * this.camera.scale)}px ui-monospace, monospace`;
      ctx.fillStyle = '#b8b8be';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(edge.label, mx, my);
    }
    ctx.restore();
  }

  private paintConnectPreview(ctx: CanvasRenderingContext2D, a: Vec2, bWorld: Vec2) {
    const av = this.camera.worldToView(a);
    const bv = this.camera.worldToView(bWorld);
    ctx.save();
    ctx.strokeStyle = '#d6ff3a';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(av.x, av.y);
    ctx.lineTo(bv.x, bv.y);
    ctx.stroke();
    ctx.restore();
  }

  private paintBoxSelect(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2) {
    const ra = this.camera.worldToView(a);
    const rb = this.camera.worldToView(b);
    const x = Math.min(ra.x, rb.x);
    const y = Math.min(ra.y, rb.y);
    const w = Math.abs(rb.x - ra.x);
    const h = Math.abs(rb.y - ra.y);
    ctx.save();
    ctx.fillStyle = 'rgba(214,255,58,0.08)';
    ctx.strokeStyle = '#d6ff3a';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  // ——— hit test ———

  private hitTest(world: Vec2): StageSelection {
    let bestNodeId: string | null = null;
    let bestOrder = -1;
    const considerNode = (node: GraphNode) => {
      if (this.isNodeHidden(node)) {
        return;
      }
      if (!pointInRect(world, { x: node.x, y: node.y, width: node.width, height: node.height })) {
        return;
      }
      const order = this.nodeOrder.get(node.id) ?? -1;
      if (order >= bestOrder) {
        bestNodeId = node.id;
        bestOrder = order;
      }
    };

    for (const id of this.draggingIds) {
      const node = this.nodeMap.get(id);
      if (node) {
        considerNode(node);
      }
    }
    for (const entry of this.nodeIndex.queryPoint(world, 2)) {
      if (this.draggingIds.has(entry.id)) {
        continue;
      }
      considerNode(this.nodeMap.get(entry.id) ?? entry.item);
    }
    if (bestNodeId) {
      return { kind: 'node', ids: [bestNodeId] };
    }

    const viewPoint = this.camera.worldToView(world);
    const threshold = 8 ** 2;
    for (let i = this.doc.edges.length - 1; i >= 0; i -= 1) {
      const e = this.doc.edges[i];
      const from = this.nodeMap.get(e.from);
      const to = this.nodeMap.get(e.to);
      if (!from || !to) continue;
      if (this.isNodeHidden(from) || this.isNodeHidden(to)) continue;
      const curve = this.edgeCurveView(from, to);
      if (distPointToCubicBezierSq(viewPoint, curve.av, curve.c1, curve.c2, curve.bv) <= threshold) {
        return { kind: 'edge', ids: [e.id] };
      }
    }
    // groups (header preferred)
    for (let i = this.doc.subgraphs.length - 1; i >= 0; i -= 1) {
      const sg = this.doc.subgraphs[i];
      const rect = this.groupRectCache.get(sg.id);
      if (!rect) continue;
      if (pointInRect(world, rect)) {
        return { kind: 'group', ids: [sg.id] };
      }
    }
    return { kind: 'none' };
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

    if (event.button !== 0) return;

    if (hit.kind === 'none') {
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
        this.setSelection({ kind: 'none' });
      }
      this.drag = {
        type: 'box',
        startWorld: world,
        currentWorld: world,
        additive: event.shiftKey || event.metaKey || event.ctrlKey,
      };
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
      const duplicated = duplicateNodesInDocument(this.doc, sourceIds, 0);
      this.doc = duplicated.document;
      this.rebuildIndexes();
      this.setSelection({ kind: 'node', ids: duplicated.newIds });
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

    if (hit.kind === 'node' || hit.kind === 'group') {
      const starts = new Map<string, Vec2>();

      if (this.selection.kind === 'node') {
        for (const id of this.selection.ids) {
          const n = this.nodeMap.get(id);
          if (n) starts.set(id, { x: n.x, y: n.y });
        }
      } else if (this.selection.kind === 'group') {
        for (const gid of this.selection.ids) {
          for (const n of this.doc.nodes) {
            if (n.subgraphId === gid && !starts.has(n.id)) {
              starts.set(n.id, { x: n.x, y: n.y });
            }
          }
        }
      }

      if (starts.size > 0) {
        this.draggingIds = new Set(starts.keys());
        this.drag = { type: 'move', originWorld: world, starts };
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
      this.camera.panByViewDelta(dx, dy);
      this.drag = { type: 'pan', lastView: view };
      hotPathCounters.viewportLiveApplies += 1;
      this.markDirty();
      return;
    }

    if (this.drag.type === 'move') {
      this.applyMoveFromStarts(this.drag, world);
      this.rebuildGroupRects();
      this.markDirty();
      return;
    }

    if (this.drag.type === 'box') {
      this.drag = { ...this.drag, currentWorld: world };
      this.markDirty();
      return;
    }

    if (this.drag.type === 'connect') {
      this.drag = { ...this.drag, currentWorld: world };
      this.markDirty();
    }
  };

  private applyMoveFromStarts(drag: Extract<DragMode, { type: 'move' }>, world: Vec2) {
    const dx = world.x - drag.originWorld.x;
    const dy = world.y - drag.originWorld.y;
    for (const [id, start] of drag.starts) {
      const n = this.nodeMap.get(id);
      if (!n) continue;
      n.x = start.x + dx;
      n.y = start.y + dy;
    }
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
      this.applyMoveFromStarts(prev, world);
      this.rebuildGroupRects();
      if (event.ctrlKey || event.metaKey) {
        const exclude = this.selection.kind === 'group' ? new Set(this.selection.ids) : undefined;
        const targetGroup = this.hitGroupAt(world, exclude);
        for (const id of prev.starts.keys()) {
          const node = this.nodeMap.get(id);
          if (node) {
            node.subgraphId = targetGroup;
          }
        }
      }
      this.draggingIds.clear();
      this.rebuildIndexes();
      this.commitDocument();
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
        const ids = this.nodeIndex
          .queryRect(box)
          .map((entry) => this.nodeMap.get(entry.id) ?? entry.item)
          .filter((node) => (
            !this.isNodeHidden(node)
            && rectIntersects(box, { x: node.x, y: node.y, width: node.width, height: node.height })
          ))
          .map((node) => node.id);
        if (prev.additive && this.selection.kind === 'node') {
          const merged = [...new Set([...this.selection.ids, ...ids])];
          this.setSelection(merged.length ? { kind: 'node', ids: merged } : { kind: 'none' });
        } else {
          this.setSelection(ids.length ? { kind: 'node', ids } : { kind: 'none' });
        }
      }
      this.markDirty();
      return;
    }

    if (prev.type === 'connect') {
      this.draggingIds.clear();
      const hit = this.hitTest(world);
      if (hit.kind === 'node' && hit.ids[0] && hit.ids[0] !== prev.fromId) {
        this.createEdge(prev.fromId, hit.ids[0], prev.edgeType);
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
    const view = this.viewFromEvent(event);
    const world = this.camera.viewToWorld(view);
    const hit = this.hitTest(world);
    if (hit.kind === 'node') {
      this.onNodeDoubleClick?.(hit.ids[0]);
      return;
    }
    if (hit.kind === 'group') {
      const sg = this.doc.subgraphs.find((s) => s.id === hit.ids[0]);
      if (sg) {
        sg.collapsed = !sg.collapsed;
        this.commitDocument();
        this.markDirty();
      }
      return;
    }
    if (hit.kind === 'none') {
      this.createNodeAt(world.x - 70, world.y - 28);
    }
  };

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
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteSelection();
    }
    if (event.key === 'Escape') {
      this.setSelection({ kind: 'none' });
      this.drag = { type: 'none' };
      this.markDirty();
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space') {
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
    if (hit.kind !== this.selection.kind) return false;
    return hit.ids.every((id) => this.selection.kind !== 'none' && this.selection.ids.includes(id));
  }

  private toggleIntoSelection(hit: StageSelection) {
    if (hit.kind === 'none') return;
    if (this.selection.kind !== hit.kind) {
      this.setSelection(hit);
      return;
    }
    const set = new Set(this.selection.ids);
    for (const id of hit.ids) {
      if (set.has(id)) set.delete(id);
      else set.add(id);
    }
    const ids = [...set];
    this.setSelection(ids.length ? { kind: hit.kind, ids } : { kind: 'none' });
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
