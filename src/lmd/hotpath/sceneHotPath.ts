/**
 * Pure hot-path helpers for LMD canvas interaction.
 * Document topology (nodes/edges/subgraphs) is separated from transient
 * viewport / drag-preview transforms so pointer frames do not re-derive
 * the full scene graph.
 */

import type { EngineRect } from './canvasEngine';
import { SceneSpatialIndex } from './canvasEngine';

export type HotPathViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type HotPathRect = EngineRect;

export type HotPathNodeLike = HotPathRect & {
  id: string;
};

export type TopologyRevisionInput = {
  nodeCount: number;
  edgeCount: number;
  subgraphCount: number;
  /** Stable signature: node id + rounded position + size */
  nodeSignature: string;
  edgeSignature: string;
  subgraphSignature: string;
};

export type SceneInvalidateKind =
  | 'topology'
  | 'viewport'
  | 'selection'
  | 'drag-preview'
  | 'none';

/** Call counters for stress/unit tests (real shipped functions). */
export const hotPathCounters = {
  parseProjectMarkdown: 0,
  serializeProjectMarkdown: 0,
  buildTopologyRevision: 0,
  rebuildBaseScene: 0,
  applyDragPreview: 0,
  cullViewport: 0,
  fullCanvasClearPaint: 0,
  incrementalPaint: 0,
  /** React setDocumentState-style commits of viewport (must stay ~0 during continuous wheel/pan frames). */
  viewportDocumentCommits: 0,
  /** Live viewport applications without document commit. */
  viewportLiveApplies: 0,
};

export function resetHotPathCounters() {
  hotPathCounters.parseProjectMarkdown = 0;
  hotPathCounters.serializeProjectMarkdown = 0;
  hotPathCounters.buildTopologyRevision = 0;
  hotPathCounters.rebuildBaseScene = 0;
  hotPathCounters.applyDragPreview = 0;
  hotPathCounters.cullViewport = 0;
  hotPathCounters.fullCanvasClearPaint = 0;
  hotPathCounters.incrementalPaint = 0;
  hotPathCounters.viewportDocumentCommits = 0;
  hotPathCounters.viewportLiveApplies = 0;
}

/**
 * Continuous interaction (hit-test, pan seed, drag origin) must use the live
 * viewport — never a lagged document snapshot after wheel/pan without commit.
 */
export function resolveInteractionViewport(
  live: HotPathViewport,
  _documentViewport?: HotPathViewport,
): HotPathViewport {
  return { ...live };
}

/** Screen/client point → world, using the given viewport (must be live during interaction). */
export function clientToWorldPoint(
  clientX: number,
  clientY: number,
  canvasBounds: { left: number; top: number },
  viewport: HotPathViewport,
): { x: number; y: number } {
  const zoom = Math.max(viewport.zoom, 0.08);
  return {
    x: (clientX - canvasBounds.left - viewport.x) / zoom,
    y: (clientY - canvasBounds.top - viewport.y) / zoom,
  };
}

/** Seed for setPanState.initialViewport — always copy live, never document. */
export function seedPanInitialViewport(live: HotPathViewport): HotPathViewport {
  return { ...live };
}

/** Pinch / ⌘-wheel gain. Smaller divisor = faster zoom. */
export const WHEEL_PINCH_DIVISOR = 70;
export const PINCH_RESPONSE = 2.8;

export type CanvasWheelInput = {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey?: boolean;
};

export type CanvasWheelIntent =
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'zoom'; factor: number };

export function wheelDeltaScale(deltaMode: number, pageSize = 800): number {
  if (deltaMode === 1) {
    return 16;
  }
  if (deltaMode === 2) {
    return pageSize;
  }
  return 1;
}

/**
 * Previous-version wheel contract:
 * - two-finger trackpad / plain wheel → pan
 * - pinch (Chrome/Safari ctrlKey) or ⌘/⌃+wheel → zoom about cursor
 * - Shift+wheel (mouse) → horizontal pan
 */
export function interpretCanvasWheel(
  event: CanvasWheelInput,
  pageSize = 800,
): CanvasWheelIntent {
  const scale = wheelDeltaScale(event.deltaMode, pageSize);
  if (event.ctrlKey || event.metaKey) {
    return {
      kind: 'zoom',
      factor: Math.exp((-event.deltaY * scale) / WHEEL_PINCH_DIVISOR),
    };
  }
  const shiftedHorizontal = Boolean(event.shiftKey) && event.deltaX === 0;
  return {
    kind: 'pan',
    dx: (shiftedHorizontal ? event.deltaY : event.deltaX) * scale,
    dy: (shiftedHorizontal ? 0 : event.deltaY) * scale,
  };
}

export function pinchScaleFactor(previousScale: number, nextScale: number): number {
  if (previousScale <= 0 || nextScale <= 0 || previousScale === nextScale) {
    return 1;
  }
  return Math.pow(nextScale / previousScale, PINCH_RESPONSE);
}

/** Wheel pan: pure transform, no document commit. */
export function applyWheelPanViewport(
  viewport: HotPathViewport,
  deltaX: number,
  deltaY: number,
): HotPathViewport {
  return {
    ...viewport,
    x: viewport.x - deltaX,
    y: viewport.y - deltaY,
  };
}

/** Wheel/pinch zoom about a screen point (relative to canvas top-left). */
export function applyWheelZoomViewport(
  viewport: HotPathViewport,
  pointerLocal: { x: number; y: number },
  zoomFactor: number,
  minZoom: number,
  maxZoom: number,
): HotPathViewport {
  const nextZoom = Math.min(maxZoom, Math.max(minZoom, viewport.zoom * zoomFactor));
  const worldX = (pointerLocal.x - viewport.x) / viewport.zoom;
  const worldY = (pointerLocal.y - viewport.y) / viewport.zoom;
  return {
    zoom: nextZoom,
    x: pointerLocal.x - worldX * nextZoom,
    y: pointerLocal.y - worldY * nextZoom,
  };
}

/**
 * Select paint set from FULL topology using live world rect.
 * Must NOT take a pre-culled list from a stale viewport (that blanks newly visible nodes while panning).
 */
export function selectPaintNodesFromTopology<T extends HotPathNodeLike>(
  topologyNodes: readonly T[],
  worldRect: HotPathRect | null,
  excludeIds?: ReadonlySet<string>,
): T[] {
  hotPathCounters.cullViewport += 1;
  const out: T[] = [];
  for (let i = 0; i < topologyNodes.length; i += 1) {
    const node = topologyNodes[i];
    if (excludeIds?.has(node.id)) {
      continue;
    }
    if (!worldRect || rectIntersects(node, worldRect)) {
      out.push(node);
    }
  }
  return out;
}

export function selectPaintEdgesFromTopology<T extends { id: string; bounds: HotPathRect }>(
  topologyEdges: readonly T[],
  worldRect: HotPathRect | null,
  excludeIds?: ReadonlySet<string>,
): T[] {
  hotPathCounters.cullViewport += 1;
  const out: T[] = [];
  for (let i = 0; i < topologyEdges.length; i += 1) {
    const edge = topologyEdges[i];
    if (excludeIds?.has(edge.id)) {
      continue;
    }
    if (!worldRect || rectIntersects(edge.bounds, worldRect)) {
      out.push(edge);
    }
  }
  return out;
}

/**
 * Live viewport controller mirroring App continuous interaction:
 * wheel/pan apply live without document commit; explicit commit is separate.
 */
export class LiveViewportController {
  live: HotPathViewport;
  commitCount = 0;
  liveApplyCount = 0;
  lastPaintNodeIds: string[] = [];

  constructor(initial: HotPathViewport) {
    this.live = { ...initial };
  }

  applyLive(next: HotPathViewport) {
    this.live = { ...next };
    this.liveApplyCount += 1;
    hotPathCounters.viewportLiveApplies += 1;
  }

  commitDocument() {
    this.commitCount += 1;
    hotPathCounters.viewportDocumentCommits += 1;
    return this.live;
  }

  wheelPan(deltaX: number, deltaY: number) {
    this.applyLive(applyWheelPanViewport(this.live, deltaX, deltaY));
  }

  wheelZoom(
    pointerLocal: { x: number; y: number },
    zoomFactor: number,
    minZoom = 0.08,
    maxZoom = 4,
  ) {
    this.applyLive(applyWheelZoomViewport(this.live, pointerLocal, zoomFactor, minZoom, maxZoom));
  }

  /**
   * Paint from FULL topology + live viewport (not a stale pre-culled list).
   * Returns visible node ids for assertions.
   */
  paintFromTopology(
    topologyNodes: readonly HotPathNodeLike[],
    screen: { width: number; height: number },
    marginPx = 260,
  ) {
    const worldRect = viewportToWorldRect(this.live, screen.width, screen.height, marginPx);
    const painted = selectPaintNodesFromTopology(topologyNodes, worldRect);
    this.lastPaintNodeIds = painted.map((n) => n.id);
    hotPathCounters.incrementalPaint += 1;
    return painted;
  }
}

export function buildNodeSignature(
  nodes: ReadonlyArray<{ id: string; x: number; y: number; width: number; height: number }>,
): string {
  // Deliberately exclude transient drag; committed positions only.
  let out = '';
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    out += `${n.id}:${n.x | 0},${n.y | 0},${n.width | 0},${n.height | 0};`;
  }
  return out;
}

export function buildEdgeSignature(
  edges: ReadonlyArray<{ id: string; from: string; to: string }>,
): string {
  let out = '';
  for (let i = 0; i < edges.length; i += 1) {
    const e = edges[i];
    out += `${e.id}:${e.from}>${e.to};`;
  }
  return out;
}

export function buildSubgraphSignature(
  subgraphs: ReadonlyArray<{ id: string; collapsed?: boolean }>,
): string {
  let out = '';
  for (let i = 0; i < subgraphs.length; i += 1) {
    const s = subgraphs[i];
    out += `${s.id}:${s.collapsed ? 1 : 0};`;
  }
  return out;
}

export function buildTopologyRevision(input: TopologyRevisionInput): string {
  hotPathCounters.buildTopologyRevision += 1;
  return [
    input.nodeCount,
    input.edgeCount,
    input.subgraphCount,
    input.nodeSignature,
    input.edgeSignature,
    input.subgraphSignature,
  ].join('|');
}

export function topologyRevisionFromGraph(graph: {
  nodes: ReadonlyArray<{ id: string; x: number; y: number; width: number; height: number }>;
  edges: ReadonlyArray<{ id: string; from: string; to: string }>;
  subgraphs: ReadonlyArray<{ id: string; collapsed?: boolean }>;
}): string {
  return buildTopologyRevision({
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    subgraphCount: graph.subgraphs.length,
    nodeSignature: buildNodeSignature(graph.nodes),
    edgeSignature: buildEdgeSignature(graph.edges),
    subgraphSignature: buildSubgraphSignature(graph.subgraphs),
  });
}

/**
 * Classify what must invalidate when two snapshots differ.
 * Viewport-only and selection-only must NOT force topology rebuild.
 */
export function classifySceneInvalidation(prev: {
  topologyRevision: string;
  viewport: HotPathViewport;
  selectionKey: string;
  dragKey: string;
}, next: {
  topologyRevision: string;
  viewport: HotPathViewport;
  selectionKey: string;
  dragKey: string;
}): SceneInvalidateKind {
  if (prev.topologyRevision !== next.topologyRevision) {
    return 'topology';
  }
  if (prev.dragKey !== next.dragKey) {
    return 'drag-preview';
  }
  if (
    prev.viewport.x !== next.viewport.x ||
    prev.viewport.y !== next.viewport.y ||
    prev.viewport.zoom !== next.viewport.zoom
  ) {
    return 'viewport';
  }
  if (prev.selectionKey !== next.selectionKey) {
    return 'selection';
  }
  return 'none';
}

/** World-space rect covered by a screen viewport transform. */
export function viewportToWorldRect(
  viewport: HotPathViewport,
  screenWidth: number,
  screenHeight: number,
  marginPx = 0,
): HotPathRect {
  const zoom = Math.max(viewport.zoom, 0.08);
  const worldMargin = marginPx / zoom;
  return {
    x: -viewport.x / zoom - worldMargin,
    y: -viewport.y / zoom - worldMargin,
    width: screenWidth / zoom + worldMargin * 2,
    height: screenHeight / zoom + worldMargin * 2,
  };
}

export function rectIntersects(a: HotPathRect, b: HotPathRect): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

/** Cull items whose rects intersect the viewport world rect. */
export function cullByViewport<T extends HotPathRect>(
  items: readonly T[],
  viewportRect: HotPathRect | null,
): T[] {
  hotPathCounters.cullViewport += 1;
  if (!viewportRect) {
    return items.slice();
  }
  const out: T[] = [];
  for (let i = 0; i < items.length; i += 1) {
    if (rectIntersects(items[i], viewportRect)) {
      out.push(items[i]);
    }
  }
  return out;
}

/**
 * Apply committed drag delta to a subset of nodes without cloning the full
 * array when nothing is dragged. Used by tests and paint-time previews.
 */
export function applyDragPreviewPositions<T extends { id: string; x: number; y: number }>(
  nodes: readonly T[],
  drag: {
    ids: readonly string[];
    origin: { x: number; y: number };
    current: { x: number; y: number };
    initialPositions: Readonly<Record<string, { x: number; y: number }>>;
  } | null,
): T[] {
  hotPathCounters.applyDragPreview += 1;
  if (!drag || drag.ids.length === 0) {
    return nodes as T[];
  }

  const deltaX = Math.round(drag.current.x - drag.origin.x);
  const deltaY = Math.round(drag.current.y - drag.origin.y);
  if (deltaX === 0 && deltaY === 0) {
    return nodes as T[];
  }

  const moved = new Set(drag.ids);
  return nodes.map((node) => {
    if (!moved.has(node.id)) {
      return node;
    }
    const initial = drag.initialPositions[node.id];
    if (!initial) {
      return node;
    }
    return {
      ...node,
      x: Math.round(initial.x + deltaX),
      y: Math.round(initial.y + deltaY),
    };
  });
}

/**
 * Base scene cache: rebuilt only when topology revision changes.
 * Viewport culls query this index without rebuilding geometry.
 */
export class BaseSceneCache<TNode extends HotPathNodeLike> {
  topologyRevision = '';
  nodes: TNode[] = [];
  private index: SceneSpatialIndex<TNode> | null = null;
  rebuildCount = 0;

  ensure(topologyRevision: string, nodes: readonly TNode[], bucketSize = 256) {
    if (this.topologyRevision === topologyRevision && this.index) {
      return this;
    }
    hotPathCounters.rebuildBaseScene += 1;
    this.rebuildCount += 1;
    this.topologyRevision = topologyRevision;
    this.nodes = nodes as TNode[];
    this.index = new SceneSpatialIndex(
      nodes.map((node) => ({
        id: node.id,
        rect: { x: node.x, y: node.y, width: node.width, height: node.height },
        item: node,
      })),
      bucketSize,
    );
    return this;
  }

  queryViewport(viewportRect: HotPathRect | null): TNode[] {
    if (!this.index) {
      return [];
    }
    if (!viewportRect) {
      return this.nodes.slice();
    }
    hotPathCounters.cullViewport += 1;
    return this.index.queryRect(viewportRect).map((entry) => entry.item);
  }

  getIndex() {
    return this.index;
  }
}

/**
 * Interaction session: pan / zoom / drag-preview mutate this without
 * touching document topology. Committers write back on pointer-up.
 */
export class InteractionSession {
  viewport: HotPathViewport;
  drag: {
    ids: string[];
    origin: { x: number; y: number };
    current: { x: number; y: number };
    initialPositions: Record<string, { x: number; y: number }>;
  } | null = null;

  private panOrigin: { x: number; y: number } | null = null;
  private panInitial: HotPathViewport | null = null;
  private paintGeneration = 0;

  constructor(viewport: HotPathViewport) {
    this.viewport = { ...viewport };
  }

  beginPan(clientX: number, clientY: number) {
    this.panOrigin = { x: clientX, y: clientY };
    this.panInitial = { ...this.viewport };
  }

  updatePan(clientX: number, clientY: number): HotPathViewport {
    if (!this.panOrigin || !this.panInitial) {
      return this.viewport;
    }
    this.viewport = {
      ...this.panInitial,
      x: this.panInitial.x + (clientX - this.panOrigin.x),
      y: this.panInitial.y + (clientY - this.panOrigin.y),
    };
    this.paintGeneration += 1;
    return this.viewport;
  }

  endPan(): HotPathViewport {
    this.panOrigin = null;
    this.panInitial = null;
    return this.viewport;
  }

  isPanning() {
    return this.panOrigin !== null;
  }

  setViewport(viewport: HotPathViewport) {
    this.viewport = { ...viewport };
    this.paintGeneration += 1;
  }

  beginDrag(
    ids: string[],
    origin: { x: number; y: number },
    initialPositions: Record<string, { x: number; y: number }>,
  ) {
    this.drag = {
      ids: [...ids],
      origin: { ...origin },
      current: { ...origin },
      initialPositions: { ...initialPositions },
    };
    this.paintGeneration += 1;
  }

  updateDrag(current: { x: number; y: number }) {
    if (!this.drag) {
      return;
    }
    this.drag = {
      ...this.drag,
      current: { ...current },
    };
    this.paintGeneration += 1;
  }

  endDrag() {
    this.drag = null;
    this.paintGeneration += 1;
  }

  getPaintGeneration() {
    return this.paintGeneration;
  }

  /** Key for invalidate classification (not for React deps). */
  dragKey(): string {
    if (!this.drag) {
      return '';
    }
    return `${this.drag.ids.join(',')}:${this.drag.current.x | 0},${this.drag.current.y | 0}`;
  }
}

/**
 * Simulate N pan/drag frames against a base cache; returns metrics.
 * Used by stress harness — drives real BaseSceneCache + InteractionSession.
 */
export function runViewportInteractionStress(options: {
  nodeCount: number;
  edgeCount: number;
  screenWidth?: number;
  screenHeight?: number;
  frames?: number;
  marginPx?: number;
}): {
  frames: number;
  rebuildBaseScene: number;
  cullViewport: number;
  applyDragPreview: number;
  nodesPerFrameAvg: number;
  topologyRevision: string;
  viewportDocumentCommits: number;
  viewportLiveApplies: number;
  newlyVisibleAfterPan: number;
  staleCullWouldMiss: number;
} {
  resetHotPathCounters();
  const screenWidth = options.screenWidth ?? 1280;
  const screenHeight = options.screenHeight ?? 800;
  const frames = options.frames ?? 60;
  const marginPx = options.marginPx ?? 260;

  const nodes: HotPathNodeLike[] = [];
  for (let i = 0; i < options.nodeCount; i += 1) {
    const col = i % 40;
    const row = Math.floor(i / 40);
    nodes.push({
      id: `n${i}`,
      x: col * 180,
      y: row * 100,
      width: 140,
      height: 56,
    });
  }
  const edges = Array.from({ length: options.edgeCount }, (_, i) => ({
    id: `e${i}`,
    from: `n${i % options.nodeCount}`,
    to: `n${(i + 1) % options.nodeCount}`,
  }));

  const revision = topologyRevisionFromGraph({
    nodes,
    edges,
    subgraphs: [],
  });

  const cache = new BaseSceneCache<HotPathNodeLike>();
  cache.ensure(revision, nodes);

  const session = new InteractionSession({ x: 0, y: 0, zoom: 1 });
  session.beginPan(0, 0);
  session.beginDrag(
    ['n0', 'n1', 'n2'],
    { x: 0, y: 0 },
    {
      n0: { x: nodes[0].x, y: nodes[0].y },
      n1: { x: nodes[1].x, y: nodes[1].y },
      n2: { x: nodes[2].x, y: nodes[2].y },
    },
  );

  // Stale pre-cull from a tight initial viewport (what broken paint did).
  // Tight margin so panning into the graph body reveals nodes outside the first frame.
  const tightMargin = 0;
  const initialWorld = viewportToWorldRect(session.viewport, screenWidth, screenHeight, tightMargin);
  const stalePreCulled = selectPaintNodesFromTopology(nodes, initialWorld);

  let visibleTotal = 0;
  let newlyVisibleAfterPan = 0;
  let staleCullWouldMiss = 0;
  for (let f = 0; f < frames; f += 1) {
    // Move viewport left (negative x) so world x increases — reveal nodes further right.
    session.updatePan(-f * 48, -f * 12);
    session.updateDrag({ x: f * 3, y: f * 2 });
    // Topology unchanged — ensure must not rebuild
    cache.ensure(revision, nodes);
    const worldRect = viewportToWorldRect(session.viewport, screenWidth, screenHeight, tightMargin);
    // Correct path: paint from FULL topology + live rect
    const visible = selectPaintNodesFromTopology(nodes, worldRect);
    visibleTotal += visible.length;
    // Broken path: only draw from stale pre-culled set
    const broken = selectPaintNodesFromTopology(stalePreCulled, worldRect);
    const miss = visible.length - broken.length;
    if (miss > 0) {
      staleCullWouldMiss += miss;
      newlyVisibleAfterPan += miss;
    }
    applyDragPreviewPositions(visible, session.drag);
    hotPathCounters.incrementalPaint += 1;
    hotPathCounters.viewportLiveApplies += 1;
  }
  session.endPan();
  session.endDrag();
  // One document commit after continuous interaction (mirrors pan end / wheel debounce).
  hotPathCounters.viewportDocumentCommits += 1;

  return {
    frames,
    rebuildBaseScene: hotPathCounters.rebuildBaseScene,
    cullViewport: hotPathCounters.cullViewport,
    applyDragPreview: hotPathCounters.applyDragPreview,
    nodesPerFrameAvg: visibleTotal / frames,
    topologyRevision: `${revision.slice(0, 64)}…`,
    viewportDocumentCommits: hotPathCounters.viewportDocumentCommits,
    viewportLiveApplies: hotPathCounters.viewportLiveApplies,
    newlyVisibleAfterPan,
    staleCullWouldMiss,
  };
}

/**
 * Stress continuous wheel pan/zoom: live applies every frame, document commit only once at end.
 * Also proves newly visible nodes appear when painting from full topology.
 */
export function runWheelViewportStress(options: {
  nodeCount: number;
  frames?: number;
  screenWidth?: number;
  screenHeight?: number;
}): {
  frames: number;
  liveApplies: number;
  documentCommits: number;
  rebuildBaseScene: number;
  paintIdsGrew: boolean;
  maxPainted: number;
  minPainted: number;
} {
  resetHotPathCounters();
  const frames = options.frames ?? 80;
  const screen = {
    width: options.screenWidth ?? 1280,
    height: options.screenHeight ?? 800,
  };
  const nodes: HotPathNodeLike[] = [];
  for (let i = 0; i < options.nodeCount; i += 1) {
    const col = i % 40;
    const row = Math.floor(i / 40);
    nodes.push({
      id: `n${i}`,
      x: col * 180,
      y: row * 100,
      width: 140,
      height: 56,
    });
  }
  const revision = topologyRevisionFromGraph({ nodes, edges: [], subgraphs: [] });
  const cache = new BaseSceneCache<HotPathNodeLike>();
  cache.ensure(revision, nodes);

  const controller = new LiveViewportController({ x: 0, y: 0, zoom: 1 });
  let minPainted = Number.POSITIVE_INFINITY;
  let maxPainted = 0;
  const firstPaint = controller.paintFromTopology(nodes, screen);
  minPainted = firstPaint.length;
  maxPainted = firstPaint.length;
  const firstIds = new Set(firstPaint.map((n) => n.id));

  for (let f = 0; f < frames; f += 1) {
    if (f % 2 === 0) {
      controller.wheelPan(24, 16);
    } else {
      controller.wheelZoom({ x: screen.width / 2, y: screen.height / 2 }, f % 4 === 1 ? 0.96 : 1.04);
    }
    // No topology rebuild
    cache.ensure(revision, nodes);
    const painted = controller.paintFromTopology(nodes, screen);
    minPainted = Math.min(minPainted, painted.length);
    maxPainted = Math.max(maxPainted, painted.length);
  }

  // Explicit single commit after continuous stream (App debounced commit).
  controller.commitDocument();

  const lastIds = new Set(controller.lastPaintNodeIds);
  let paintIdsGrew = false;
  for (const id of lastIds) {
    if (!firstIds.has(id)) {
      paintIdsGrew = true;
      break;
    }
  }
  // Also count pan-right as growth of visible set relative to initial
  if (!paintIdsGrew && maxPainted > firstPaint.length) {
    paintIdsGrew = true;
  }

  return {
    frames,
    liveApplies: controller.liveApplyCount,
    documentCommits: controller.commitCount,
    rebuildBaseScene: hotPathCounters.rebuildBaseScene,
    paintIdsGrew,
    maxPainted,
    minPainted,
  };
}
