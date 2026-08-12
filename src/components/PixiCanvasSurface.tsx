// Incoming from origin/main; not wired into FlowApp. Types are incomplete.
// @ts-nocheck
import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Text,
  TextStyle,
  type FederatedPointerEvent,
} from 'pixi.js';
import { useEffect, useMemo, useRef } from 'react';
import type { GraphEdge, GraphNode, GraphSubgraph, SelectionState, ViewportState } from '../lib/types';
import type { PixelGroupShape } from '../lib/pixelGroups';
import type { SceneIndex } from '../lib/sceneIndex';
import { LMD_GRID_SIZE, snapToGrid } from '../lib/grid';

export interface PixiScenePointer {
  clientX: number;
  clientY: number;
  button: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  pointerType: string;
}

export interface PixiSceneModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  subgraphs: GraphSubgraph[];
  groupShapes: PixelGroupShape[];
  viewport: ViewportState;
  selection: SelectionState;
  hoveredNodeId: string | null;
  editingNodeId: string | null;
  dragTargetNodeId: string | null;
  dragTargetSubgraphId: string | null;
  dragTargetEdgeId: string | null;
  searchNodeIds: Set<string>;
  searchSubgraphIds: Set<string>;
  collapsedNodeDescriptionIds: Set<string>;
  sceneIndex: SceneIndex;
}

interface PixiCanvasSurfaceProps {
  model: PixiSceneModel;
  enabled: boolean;
  onReadyChange: (ready: boolean) => void;
  onNodePointerDown: (pointer: PixiScenePointer, nodeId: string) => void;
  onSubgraphPointerDown: (pointer: PixiScenePointer, subgraphId: string) => void;
  onEdgePointerDown: (pointer: PixiScenePointer, edgeId: string) => void;
  onBackgroundPointerDown: (pointer: PixiScenePointer) => void;
  onEndpointPointerDown: (pointer: PixiScenePointer, endpointId: string, side: 'left' | 'right') => void;
  onNodeDescriptionToggle: (nodeId: string) => void;
  onNodeHoverChange: (nodeId: string | null) => void;
}

interface NodeDisplayObject {
  container: Container;
  box: Graphics;
  titleBand: Graphics;
  title: Text;
  description: Text;
  startHandle: Graphics;
  endHandle: Graphics;
}

interface EdgeDisplayObject {
  visual: Graphics;
  labelBackground: Graphics;
  label: Text;
}

interface GroupDisplayObject {
  container: Container;
  fill: Graphics;
  dither: Graphics;
  outline: Graphics;
  labels: Text[];
}

interface EdgeTooltipObject {
  container: Container;
  background: Graphics;
  text: Text;
}

const RETRO_NODE_PALETTE = [
  { fill: 0xfff05a, stroke: 0xff8a00, text: 0x111111, band: 0x241000 },
  { fill: 0x00f5d4, stroke: 0x00a896, text: 0x061516, band: 0x062321 },
  { fill: 0xff4d8d, stroke: 0xff006e, text: 0x14020a, band: 0x2a0010 },
  { fill: 0x7cff6b, stroke: 0x17c964, text: 0x041707, band: 0x08240c },
  { fill: 0x56c7ff, stroke: 0x0088ff, text: 0x06111b, band: 0x061729 },
  { fill: 0xff9f1c, stroke: 0xff5f1f, text: 0x180900, band: 0x2b0b00 },
  { fill: 0xd8ff33, stroke: 0x9ef01a, text: 0x111700, band: 0x1d2500 },
  { fill: 0xc77dff, stroke: 0x7b2cff, text: 0x16051f, band: 0x220437 },
] as const;

const RETRO_GROUP_PALETTE = [
  { fill: 0x1e3a5f, stroke: 0x54d2ff, text: 0xdff7ff },
  { fill: 0x3b2f12, stroke: 0xffc857, text: 0xfff3c4 },
  { fill: 0x123d2e, stroke: 0x36f08d, text: 0xd9ffe8 },
  { fill: 0x4a1029, stroke: 0xff4d8d, text: 0xffd7e4 },
  { fill: 0x2c1759, stroke: 0xc77dff, text: 0xf1ddff },
  { fill: 0x103f45, stroke: 0x00f5d4, text: 0xd3fffa },
] as const;

const EDGE_COLORS = [0x00f5d4, 0xffc857, 0xff4d8d, 0x54d2ff, 0x9ef01a, 0xc77dff] as const;
const NODE_TITLE_HEIGHT = LMD_GRID_SIZE;
const NODE_ARROW_SIZE = 18;
const DESCRIPTION_LOD_ZOOM = 0.68;
const TITLE_LOD_ZOOM = 0.24;
const EDGE_LABEL_LOD_ZOOM = 0.72;
const GROUP_LABEL_LOD_ZOOM = 0.18;

function splitEntityText(value: string) {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  const [titleLine = '', ...restLines] = normalized.split('\n');
  return {
    title: titleLine.trim() || '未命名内容',
    description: restLines.join('\n').trim(),
  };
}

function colorToNumber(color: string, fallback = 0xffffff) {
  const normalized = color.trim();
  const shortHex = normalized.match(/^#([\da-f]{3})$/i);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split('');
    return Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
  }

  const longHex = normalized.match(/^#([\da-f]{6})$/i);
  if (longHex) {
    return Number.parseInt(longHex[1], 16);
  }

  const rgb = normalized.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/i);
  if (rgb) {
    const r = Number.parseInt(rgb[1], 10);
    const g = Number.parseInt(rgb[2], 10);
    const b = Number.parseInt(rgb[3], 10);
    return (r << 16) + (g << 8) + b;
  }

  return fallback;
}

function hashStringToNumber(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function retroNodeColors(node: GraphNode) {
  const entry = RETRO_NODE_PALETTE[hashStringToNumber(`${node.subgraphId ?? 'root'}:${node.id}`) % RETRO_NODE_PALETTE.length];
  return entry ?? RETRO_NODE_PALETTE[0];
}

function retroGroupColors(id: string, depth: number) {
  const entry = RETRO_GROUP_PALETTE[(hashStringToNumber(id) + depth) % RETRO_GROUP_PALETTE.length];
  return entry ?? RETRO_GROUP_PALETTE[0];
}

function edgeColorFor(edge: GraphEdge, fallbackKey: string) {
  if (edge.strokeColor && edge.strokeColor !== '#bfd2de') {
    return colorToNumber(edge.strokeColor, EDGE_COLORS[hashStringToNumber(edge.id) % EDGE_COLORS.length]);
  }
  return EDGE_COLORS[hashStringToNumber(`${fallbackKey}:${edge.id}`) % EDGE_COLORS.length];
}

function toPixiPointer(event: FederatedPointerEvent): PixiScenePointer {
  const native = event.nativeEvent as PointerEvent | MouseEvent | undefined;
  return {
    clientX: native?.clientX ?? event.global.x,
    clientY: native?.clientY ?? event.global.y,
    button: native?.button ?? event.button ?? 0,
    altKey: native?.altKey ?? event.altKey,
    ctrlKey: native?.ctrlKey ?? event.ctrlKey,
    metaKey: native?.metaKey ?? event.metaKey,
    shiftKey: native?.shiftKey ?? event.shiftKey,
    pointerType: 'pointerType' in event ? event.pointerType : 'mouse',
  };
}

function stopPixiEvent(event: FederatedPointerEvent) {
  event.stopPropagation();
  const native = event.nativeEvent as Event | undefined;
  native?.stopPropagation();
}

function rectIntersects(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  );
}

function getViewportWorldRect(
  host: HTMLElement | null,
  viewport: ViewportState,
  padding = 256,
) {
  if (!host) {
    return { x: -padding, y: -padding, width: padding * 2, height: padding * 2 };
  }
  return {
    x: -viewport.x / viewport.zoom - padding / viewport.zoom,
    y: -viewport.y / viewport.zoom - padding / viewport.zoom,
    width: host.clientWidth / viewport.zoom + (padding * 2) / viewport.zoom,
    height: host.clientHeight / viewport.zoom + (padding * 2) / viewport.zoom,
  };
}

function buildEndpointMap(nodes: GraphNode[], groupShapes: PixelGroupShape[]) {
  const map = new Map<string, { id: string; x: number; y: number; width: number; height: number; stroke: string }>();
  nodes.forEach((node) => {
    map.set(node.id, node);
  });
  groupShapes.forEach((shape) => {
    map.set(shape.id, {
      id: shape.id,
      ...shape.bounds,
      stroke: '#d1d5db',
    });
  });
  return map;
}

function buildRetroEdgePoints(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
) {
  const fromCenter = {
    x: from.x + from.width / 2,
    y: from.y + from.height / 2,
  };
  const toCenter = {
    x: to.x + to.width / 2,
    y: to.y + to.height / 2,
  };
  const fromRight = toCenter.x >= fromCenter.x;
  const start = {
    x: snapToGrid(fromRight ? from.x + from.width : from.x),
    y: snapToGrid(fromCenter.y),
  };
  const end = {
    x: snapToGrid(fromRight ? to.x : to.x + to.width),
    y: snapToGrid(toCenter.y),
  };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const signX = dx >= 0 ? 1 : -1;
  const signY = dy >= 0 ? 1 : -1;
  const midX = snapToGrid((start.x + end.x) / 2);
  const diagonal = Math.abs(dy) >= LMD_GRID_SIZE
    ? Math.max(LMD_GRID_SIZE, snapToGrid(Math.min(Math.abs(dy), Math.max(LMD_GRID_SIZE, Math.abs(dx) / 3))))
    : 0;

  if (diagonal === 0) {
    return [
      start,
      { x: midX, y: start.y },
      end,
    ];
  }

  return [
    start,
    { x: snapToGrid(midX - signX * diagonal / 2), y: start.y },
    {
      x: snapToGrid(midX + signX * diagonal / 2),
      y: snapToGrid(start.y + signY * diagonal),
    },
    { x: snapToGrid(midX + signX * diagonal / 2), y: end.y },
    end,
  ];
}

function drawPolyline(graphics: Graphics, points: Array<{ x: number; y: number }>) {
  const [first, ...rest] = points;
  if (!first) {
    return;
  }
  graphics.moveTo(first.x, first.y);
  rest.forEach((point) => graphics.lineTo(point.x, point.y));
}

function polylineMidpoint(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const length = Math.hypot(current.x - previous.x, current.y - previous.y);
    lengths.push(length);
    total += length;
  }
  let cursor = 0;
  const target = total / 2;
  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = lengths[index - 1] ?? 0;
    if (cursor + segmentLength >= target && segmentLength > 0) {
      const previous = points[index - 1];
      const current = points[index];
      const t = (target - cursor) / segmentLength;
      return {
        x: previous.x + (current.x - previous.x) * t,
        y: previous.y + (current.y - previous.y) * t,
      };
    }
    cursor += segmentLength;
  }
  return points[points.length - 1] ?? { x: 0, y: 0 };
}

function distancePointToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function distancePointToPolyline(point: { x: number; y: number }, points: Array<{ x: number; y: number }>) {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    best = Math.min(best, distancePointToSegment(point, points[index - 1], points[index]));
  }
  return best;
}

function drawArrowHead(graphics: Graphics, points: Array<{ x: number; y: number }>, color: number, scale = 1) {
  if (points.length < 2) {
    return;
  }
  const end = points[points.length - 1];
  const previous = [...points].reverse().find((point) => Math.hypot(end.x - point.x, end.y - point.y) > 1);
  if (!previous) {
    return;
  }
  const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
  const size = 15 * scale;
  const spread = Math.PI / 6;
  const left = {
    x: end.x - Math.cos(angle - spread) * size,
    y: end.y - Math.sin(angle - spread) * size,
  };
  const right = {
    x: end.x - Math.cos(angle + spread) * size,
    y: end.y - Math.sin(angle + spread) * size,
  };
  graphics.poly([end.x, end.y, left.x, left.y, right.x, right.y]).fill({ color, alpha: 1 });
}

function drawEdgeLabelBadge(graphics: Graphics, x: number, y: number, width: number, height: number, stroke: number) {
  graphics
    .rect(x - width / 2, y - height / 2, width, height)
    .fill({ color: 0x080b0f, alpha: 0.94 });
  graphics
    .rect(x - width / 2, y - height / 2, width, height)
    .stroke({ width: 2, color: stroke, alpha: 0.98 });
}

function drawNodeCollapseArrow(graphics: Graphics, collapsed: boolean, color: number) {
  const x = 10;
  const y = NODE_TITLE_HEIGHT / 2;
  if (collapsed) {
    graphics.poly([
      x, y - NODE_ARROW_SIZE / 2,
      x, y + NODE_ARROW_SIZE / 2,
      x + NODE_ARROW_SIZE / 1.2, y,
    ]).fill({ color, alpha: 0.95 });
    return;
  }
  graphics.poly([
    x - 1, y - NODE_ARROW_SIZE / 3,
    x + NODE_ARROW_SIZE, y - NODE_ARROW_SIZE / 3,
    x + NODE_ARROW_SIZE / 2, y + NODE_ARROW_SIZE / 2,
  ]).fill({ color, alpha: 0.95 });
}

function makeLayer() {
  const layer = new Container();
  layer.eventMode = 'passive';
  return layer;
}

export function PixiCanvasSurface({
  model,
  enabled,
  onReadyChange,
  onNodePointerDown,
  onSubgraphPointerDown,
  onEdgePointerDown,
  onBackgroundPointerDown,
  onEndpointPointerDown,
  onNodeDescriptionToggle,
  onNodeHoverChange,
}: PixiCanvasSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const gridLayerRef = useRef<Graphics | null>(null);
  const groupLayerRef = useRef<Container | null>(null);
  const edgeLayerRef = useRef<Container | null>(null);
  const nodeLayerRef = useRef<Container | null>(null);
  const overlayLayerRef = useRef<Container | null>(null);
  const nodeObjectsRef = useRef<Map<string, NodeDisplayObject>>(new Map());
  const edgeObjectsRef = useRef<Map<string, EdgeDisplayObject>>(new Map());
  const groupObjectsRef = useRef<Map<string, GroupDisplayObject>>(new Map());
  const edgeTooltipRef = useRef<EdgeTooltipObject | null>(null);
  const modelRef = useRef(model);
  const hoveredEdgeIdRef = useRef<string | null>(null);
  const hoveredNodeIdRef = useRef<string | null>(null);
  const readyNotifiedRef = useRef(false);
  const handlersRef = useRef({
    onBackgroundPointerDown,
    onEdgePointerDown,
    onEndpointPointerDown,
    onNodeDescriptionToggle,
    onNodeHoverChange,
    onNodePointerDown,
    onSubgraphPointerDown,
  });

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    handlersRef.current = {
      onBackgroundPointerDown,
      onEdgePointerDown,
      onEndpointPointerDown,
      onNodeDescriptionToggle,
      onNodeHoverChange,
      onNodePointerDown,
      onSubgraphPointerDown,
    };
  }, [
    onBackgroundPointerDown,
    onEdgePointerDown,
    onEndpointPointerDown,
    onNodeDescriptionToggle,
    onNodeHoverChange,
    onNodePointerDown,
    onSubgraphPointerDown,
  ]);

  const subgraphMap = useMemo(
    () => new Map(model.subgraphs.map((subgraph) => [subgraph.id, subgraph])),
    [model.subgraphs],
  );
  const viewport = model.viewport;

  useEffect(() => {
    if (!enabled || !hostRef.current || appRef.current) {
      return undefined;
    }

    let destroyed = false;
    let initTimer: number | null = null;
    const host = hostRef.current;
    const app = new Application();
    const nodeObjects = nodeObjectsRef.current;
    const edgeObjects = edgeObjectsRef.current;
    const groupObjects = groupObjectsRef.current;

    async function initPixi() {
      try {
        await app.init({
          antialias: false,
          autoDensity: true,
          backgroundAlpha: 0,
          eventFeatures: {
            click: true,
            globalMove: true,
            move: true,
            wheel: false,
          },
          preference: 'webgl',
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          resizeTo: host,
        });

        if (destroyed) {
          app.destroy(true);
          return;
        }

        app.canvas.className = 'pixi-canvas-surface__canvas';
        host.appendChild(app.canvas);
        app.stage.eventMode = 'static';
        app.stage.hitArea = new Rectangle(0, 0, host.clientWidth || 1, host.clientHeight || 1);
        app.stage.on('pointerdown', (event) => {
          stopPixiEvent(event);
          const activeModel = modelRef.current;
          const worldPoint = worldRef.current?.toLocal(event.global) ?? { x: 0, y: 0 };
          const pointer = toPixiPointer(event);
          const nodeId = activeModel.sceneIndex.hitNode(worldPoint);

          if (nodeId) {
            const node = activeModel.nodes.find((entry) => entry.id === nodeId);
            if (node && (activeModel.selection.kind === 'node' || activeModel.hoveredNodeId === nodeId)) {
              const localX = worldPoint.x - node.x;
              const localY = worldPoint.y - node.y;
              const nearLeftHandle = localX >= -12 && localX <= 28 && Math.abs(localY - node.height / 2) <= 18;
              const nearRightHandle = localX >= node.width - 28 && localX <= node.width + 12 && Math.abs(localY - node.height / 2) <= 18;
              if (nearLeftHandle || nearRightHandle) {
                handlersRef.current.onEndpointPointerDown(pointer, nodeId, nearLeftHandle ? 'left' : 'right');
                return;
              }
            }

            if (
              node &&
              worldPoint.x >= node.x + 6 &&
              worldPoint.x <= node.x + 36 &&
              worldPoint.y >= node.y + 4 &&
              worldPoint.y <= node.y + NODE_TITLE_HEIGHT - 4
            ) {
              handlersRef.current.onNodeDescriptionToggle(nodeId);
              return;
            }

            handlersRef.current.onNodePointerDown(pointer, nodeId);
            return;
          }

          const endpointMap = buildEndpointMap(activeModel.nodes, activeModel.groupShapes);
          let edgeHit: { id: string; distance: number } | null = null;
          activeModel.edges.forEach((edge) => {
            const from = endpointMap.get(edge.from);
            const to = endpointMap.get(edge.to);
            if (!from || !to) {
              return;
            }
            const distance = distancePointToPolyline(worldPoint, buildRetroEdgePoints(from, to));
            if (distance <= 18 && (!edgeHit || distance < edgeHit.distance)) {
              edgeHit = { id: edge.id, distance };
            }
          });
          if (edgeHit) {
            handlersRef.current.onEdgePointerDown(pointer, edgeHit.id);
            return;
          }

          const hit = activeModel.sceneIndex.hitTest(worldPoint);
          if (hit?.kind === 'subgraph') {
            handlersRef.current.onSubgraphPointerDown(pointer, hit.id);
            return;
          }

          handlersRef.current.onBackgroundPointerDown(pointer);
        });
        app.stage.on('pointermove', (event) => {
          const activeModel = modelRef.current;
          const worldPoint = worldRef.current?.toLocal(event.global) ?? { x: 0, y: 0 };
          const nodeId = activeModel.sceneIndex.hitNode(worldPoint);
          if (nodeId !== hoveredNodeIdRef.current) {
            hoveredNodeIdRef.current = nodeId;
            handlersRef.current.onNodeHoverChange(nodeId);
          }

          const endpointMap = buildEndpointMap(activeModel.nodes, activeModel.groupShapes);
          let edgeHit: { edge: GraphEdge; distance: number } | null = null;
          if (!nodeId) {
            activeModel.edges.forEach((edge) => {
              const from = endpointMap.get(edge.from);
              const to = endpointMap.get(edge.to);
              if (!from || !to) {
                return;
              }
              const distance = distancePointToPolyline(worldPoint, buildRetroEdgePoints(from, to));
              if (distance <= 16 && (!edgeHit || distance < edgeHit.distance)) {
                edgeHit = { edge, distance };
              }
            });
          }

          hoveredEdgeIdRef.current = edgeHit?.edge.id ?? null;
          const tooltip = edgeTooltipRef.current;
          if (!tooltip) {
            return;
          }
          const label = edgeHit?.edge.label.trim() ?? '';
          tooltip.container.visible = label.length > 0;
          if (!label) {
            return;
          }
          tooltip.text.text = label;
          tooltip.text.position.set(12, 8);
          const width = Math.max(96, tooltip.text.width + 24);
          const height = Math.max(30, tooltip.text.height + 16);
          tooltip.background.clear();
          tooltip.background.rect(0, 0, width, height).fill({ color: 0x05070a, alpha: 0.96 });
          tooltip.background.rect(0, 0, width, height).stroke({ width: 2, color: 0x00f5d4, alpha: 1 });
          tooltip.container.position.set(event.global.x + 16, event.global.y + 16);
        });
        app.stage.on('pointerleave', () => {
          hoveredNodeIdRef.current = null;
          hoveredEdgeIdRef.current = null;
          handlersRef.current.onNodeHoverChange(null);
          if (edgeTooltipRef.current) {
            edgeTooltipRef.current.container.visible = false;
          }
        });

        const world = new Container();
        const grid = new Graphics();
        const groups = makeLayer();
        const edges = makeLayer();
        const nodes = makeLayer();
        const overlay = new Container();
        groups.interactiveChildren = false;
        edges.interactiveChildren = false;
        nodes.interactiveChildren = false;
        world.addChild(grid, groups, edges, nodes);
        app.stage.addChild(world, overlay);

        const tooltipContainer = new Container();
        const tooltipBackground = new Graphics();
        const tooltipText = new Text({
          text: '',
          style: new TextStyle({
            fill: 0xf5fff8,
            fontFamily: 'monospace',
            fontSize: 13,
            fontWeight: '800',
          }),
        });
        tooltipContainer.visible = false;
        tooltipContainer.eventMode = 'none';
        tooltipContainer.addChild(tooltipBackground, tooltipText);
        overlay.addChild(tooltipContainer);

        appRef.current = app;
        worldRef.current = world;
        gridLayerRef.current = grid;
        groupLayerRef.current = groups;
        edgeLayerRef.current = edges;
        nodeLayerRef.current = nodes;
        overlayLayerRef.current = overlay;
        edgeTooltipRef.current = {
          container: tooltipContainer,
          background: tooltipBackground,
          text: tooltipText,
        };
        if (!readyNotifiedRef.current) {
          readyNotifiedRef.current = true;
          onReadyChange(true);
        }
      } catch (error) {
        console.warn('[LMD] Pixi canvas unavailable, falling back to DOM canvas.', error);
        if (readyNotifiedRef.current) {
          readyNotifiedRef.current = false;
          onReadyChange(false);
        }
      }
    }

    initTimer = window.setTimeout(() => {
      initTimer = null;
      void initPixi();
    }, 0);

    return () => {
      destroyed = true;
      if (initTimer !== null) {
        window.clearTimeout(initTimer);
        initTimer = null;
      }
      nodeObjects.clear();
      edgeObjects.clear();
      groupObjects.clear();
      readyNotifiedRef.current = false;
      app.destroy(true);
      appRef.current = null;
      worldRef.current = null;
      gridLayerRef.current = null;
      groupLayerRef.current = null;
      edgeLayerRef.current = null;
      nodeLayerRef.current = null;
      overlayLayerRef.current = null;
      edgeTooltipRef.current = null;
    };
  }, [enabled, onReadyChange]);

  useEffect(() => {
    const app = appRef.current;
    if (!app || !hostRef.current) {
      return;
    }
    app.stage.hitArea = new Rectangle(0, 0, hostRef.current.clientWidth || 1, hostRef.current.clientHeight || 1);
  });

  useEffect(() => {
    const world = worldRef.current;
    if (!world) {
      return;
    }
    world.position.set(model.viewport.x, model.viewport.y);
    world.scale.set(model.viewport.zoom);
  }, [model.viewport]);

  useEffect(() => {
    const grid = gridLayerRef.current;
    const host = hostRef.current;
    if (!grid || !host) {
      return;
    }

    const worldLeft = -viewport.x / viewport.zoom;
    const worldTop = -viewport.y / viewport.zoom;
    const worldRight = worldLeft + host.clientWidth / viewport.zoom;
    const worldBottom = worldTop + host.clientHeight / viewport.zoom;
    const startX = Math.floor(worldLeft / LMD_GRID_SIZE) * LMD_GRID_SIZE;
    const startY = Math.floor(worldTop / LMD_GRID_SIZE) * LMD_GRID_SIZE;
    const lineWidth = Math.max(1 / viewport.zoom, 0.75);

    grid.clear();
    for (let x = startX; x <= worldRight + LMD_GRID_SIZE; x += LMD_GRID_SIZE) {
      const major = Math.round(x / LMD_GRID_SIZE) % 4 === 0;
      grid.moveTo(x, worldTop - LMD_GRID_SIZE);
      grid.lineTo(x, worldBottom + LMD_GRID_SIZE);
      grid.stroke({ width: lineWidth, color: major ? 0x4b5563 : 0x2f3338, alpha: major ? 0.42 : 0.28 });
    }
    for (let y = startY; y <= worldBottom + LMD_GRID_SIZE; y += LMD_GRID_SIZE) {
      const major = Math.round(y / LMD_GRID_SIZE) % 4 === 0;
      grid.moveTo(worldLeft - LMD_GRID_SIZE, y);
      grid.lineTo(worldRight + LMD_GRID_SIZE, y);
      grid.stroke({ width: lineWidth, color: major ? 0x4b5563 : 0x2f3338, alpha: major ? 0.42 : 0.28 });
    }
  }, [viewport]);

  useEffect(() => {
    const layer = groupLayerRef.current;
    if (!layer) {
      return;
    }

    const activeIds = new Set(model.groupShapes.map((shape) => shape.id));
    groupObjectsRef.current.forEach((object, id) => {
      if (activeIds.has(id)) {
        return;
      }
      object.container.destroy({ children: true });
      groupObjectsRef.current.delete(id);
    });

    [...model.groupShapes]
      .sort((left, right) => left.depth - right.depth)
      .forEach((shape) => {
        const subgraph = subgraphMap.get(shape.id);
        if (!subgraph) {
          return;
        }

        let object = groupObjectsRef.current.get(shape.id);
        if (!object) {
          const container = new Container();
          container.eventMode = 'none';
          const fill = new Graphics();
          const dither = new Graphics();
          const outline = new Graphics();
          container.addChild(fill, dither, outline);
          layer.addChild(container);
          object = { container, fill, dither, outline, labels: [] };
          groupObjectsRef.current.set(shape.id, object);
        }

        const selected = model.selection.kind === 'subgraph' && model.selection.ids.includes(shape.id);
        const dropTarget = model.dragTargetSubgraphId === shape.id;
        const searchMatch = model.searchSubgraphIds.has(shape.id);
        const colors = retroGroupColors(shape.id, shape.depth);
        const strokeColor = dropTarget ? 0xffffff : selected ? 0xfff05a : colors.stroke;
        const alpha = Math.max(0.16, 0.42 - shape.depth * 0.03);
        const viewRect = getViewportWorldRect(hostRef.current, model.viewport, 512);
        const labelText = splitEntityText(subgraph.title).title;

        object.fill.clear();
        object.dither.clear();
        object.outline.clear();
        object.labels.forEach((label) => label.destroy());
        object.labels = [];
        shape.regions.forEach((region) => {
          if (!rectIntersects(viewRect, region.rect)) {
            return;
          }
          object.fill.rect(region.rect.x, region.rect.y, region.rect.width, region.rect.height).fill({
            color: colors.fill,
            alpha,
          });
          if (model.viewport.zoom >= 0.16) {
            for (let y = region.rect.y; y < region.rect.y + region.rect.height; y += LMD_GRID_SIZE * 2) {
              for (let x = region.rect.x + ((y / LMD_GRID_SIZE) % 4 === 0 ? 0 : LMD_GRID_SIZE); x < region.rect.x + region.rect.width; x += LMD_GRID_SIZE * 2) {
                object.dither.rect(x + 4, y + 4, 6, 6).fill({ color: colors.stroke, alpha: 0.22 });
              }
            }
          }
          object.outline.rect(region.rect.x, region.rect.y, region.rect.width, region.rect.height).stroke({
            width: selected || dropTarget ? 3 : searchMatch ? 2 : 1,
            color: strokeColor,
            alpha: selected || dropTarget ? 1 : 0.76,
          });
          if (model.viewport.zoom >= GROUP_LABEL_LOD_ZOOM) {
            const label = new Text({
              text: labelText,
              style: {
                fill: colors.text,
                fontFamily: 'monospace',
                fontSize: 13,
                fontWeight: '900',
              },
            });
            label.position.set(region.rect.x + LMD_GRID_SIZE / 2, region.rect.y + LMD_GRID_SIZE / 2);
            object.container.addChild(label);
            object.labels.push(label);
          }
        });
      });
  }, [
    model.dragTargetSubgraphId,
    model.groupShapes,
    model.searchSubgraphIds,
    model.selection,
    model.viewport,
    subgraphMap,
  ]);

  useEffect(() => {
    const layer = edgeLayerRef.current;
    if (!layer) {
      return;
    }

    const endpointMap = buildEndpointMap(model.nodes, model.groupShapes);
    const activeIds = new Set(model.edges.map((edge) => edge.id));
    edgeObjectsRef.current.forEach((object, id) => {
      if (activeIds.has(id)) {
        return;
      }
      object.visual.destroy();
      object.hit.destroy();
      object.label.destroy();
      edgeObjectsRef.current.delete(id);
    });

    model.edges.forEach((edge) => {
      const from = endpointMap.get(edge.from);
      const to = endpointMap.get(edge.to);
      if (!from || !to) {
        return;
      }

      let object = edgeObjectsRef.current.get(edge.id);
      if (!object) {
        const visual = new Graphics();
        const hit = new Graphics();
        const label = new Text({
          text: '',
          style: {
            fill: 0xe5e7eb,
            fontFamily: 'monospace',
            fontSize: 12,
            fontWeight: '700',
          },
        });
        hit.eventMode = 'static';
        hit.cursor = 'pointer';
        layer.addChild(visual, hit, label);
        object = { visual, hit, label };
        edgeObjectsRef.current.set(edge.id, object);
      }

      object.hit.removeAllListeners();
      object.hit.on('pointerdown', (event) => {
        stopPixiEvent(event);
        onEdgePointerDown(toPixiPointer(event), edge.id);
      });

      const points = buildOrthogonalEdgePoints(from, to);
      const selected = model.selection.kind === 'edge' && model.selection.ids.includes(edge.id);
      const dropTarget = model.dragTargetEdgeId === edge.id;
      const strokeColor = colorToNumber(edge.strokeColor || from.stroke, colorToNumber(from.stroke, 0x93c5fd));
      const strokeWidth = Math.max(2, edge.strokeWidth || 1);

      object.visual.clear();
      drawPolyline(object.visual, points);
      object.visual.stroke({
        width: selected || dropTarget ? strokeWidth + 3 : strokeWidth + 1,
        color: selected || dropTarget ? 0xffffff : 0x111827,
        alpha: selected || dropTarget ? 0.76 : 0.46,
      });
      drawPolyline(object.visual, points);
      object.visual.stroke({
        width: selected || dropTarget ? strokeWidth + 1 : strokeWidth,
        color: strokeColor,
        alpha: 0.95,
      });

      object.hit.clear();
      drawPolyline(object.hit, points);
      object.hit.stroke({ width: 20, color: 0xffffff, alpha: 0.001 });

      const labelText = edge.label.trim();
      object.label.visible = labelText.length > 0 && model.viewport.zoom >= 0.35;
      object.label.text = labelText;
      object.label.position.set(
        snapToGrid((points[1].x + points[2].x) / 2),
        snapToGrid((points[1].y + points[2].y) / 2),
      );
      object.label.anchor.set(0.5);
    });
  }, [
    model.dragTargetEdgeId,
    model.edges,
    model.groupShapes,
    model.nodes,
    model.selection,
    model.viewport.zoom,
    onEdgePointerDown,
  ]);

  useEffect(() => {
    const layer = nodeLayerRef.current;
    if (!layer) {
      return;
    }

    const activeIds = new Set(model.nodes.map((node) => node.id));
    nodeObjectsRef.current.forEach((object, id) => {
      if (activeIds.has(id)) {
        return;
      }
      object.container.destroy({ children: true });
      nodeObjectsRef.current.delete(id);
    });

    model.nodes.forEach((node) => {
      let object = nodeObjectsRef.current.get(node.id);
      if (!object) {
        const container = new Container();
        const box = new Graphics();
        const titleBand = new Graphics();
        const title = new Text({
          text: '',
          style: {
            align: 'center',
            fill: colorToNumber(node.textColor, 0x111827),
            fontFamily: 'monospace',
            fontSize: 15,
            fontWeight: '800',
            wordWrap: true,
            wordWrapWidth: Math.max(64, node.width - 20),
          },
        });
        const description = new Text({
          text: '',
          style: {
            align: 'center',
            fill: colorToNumber(node.textColor, 0x111827),
            fontFamily: 'monospace',
            fontSize: 12,
            fontWeight: '500',
            wordWrap: true,
            wordWrapWidth: Math.max(64, node.width - 20),
          },
        });
        const startHandle = new Graphics();
        const endHandle = new Graphics();
        container.addChild(box, titleBand, title, description, startHandle, endHandle);
        layer.addChild(container);
        object = { container, box, titleBand, title, description, startHandle, endHandle };
        nodeObjectsRef.current.set(node.id, object);
      }

      const selected = model.selection.kind === 'node' && model.selection.ids.includes(node.id);
      const hovered = model.hoveredNodeId === node.id;
      const dropTarget = model.dragTargetNodeId === node.id;
      const searchMatch = model.searchNodeIds.has(node.id);
      const isEditing = model.editingNodeId === node.id;
      const parts = splitEntityText(node.label);
      const fillColor = colorToNumber(node.fill, 0xf8fafc);
      const strokeColor = colorToNumber(dropTarget ? '#7dd3fc' : selected ? '#f8fafc' : node.stroke, 0x334155);
      const textColor = colorToNumber(node.textColor, 0x111827);
      const titleBandHeight = Math.max(LMD_GRID_SIZE, Math.min(64, Math.floor(node.height * 0.44)));

      object.container.position.set(node.x, node.y);
      object.container.alpha = isEditing ? 0.18 : 1;
      object.container.eventMode = isEditing ? 'none' : 'static';
      object.container.cursor = 'grab';
      object.container.hitArea = new Rectangle(0, 0, node.width, node.height);
      object.container.removeAllListeners();
      object.container.on('pointerdown', (event) => {
        stopPixiEvent(event);
        onNodePointerDown(toPixiPointer(event), node.id);
      });
      object.container.on('pointerover', () => onNodeHoverChange(node.id));
      object.container.on('pointerout', () => onNodeHoverChange(null));

      object.box.clear();
      object.box.rect(0, 0, node.width, node.height).fill({ color: fillColor, alpha: 1 });
      object.box.rect(0, 0, node.width, node.height).stroke({
        width: selected || dropTarget ? 4 : searchMatch ? 3 : 2,
        color: strokeColor,
        alpha: selected || dropTarget ? 1 : 0.86,
      });
      object.titleBand.clear();
      object.titleBand.rect(0, 0, node.width, titleBandHeight).fill({
        color: colorToNumber(node.stroke, 0x334155),
        alpha: 0.16,
      });
      object.titleBand.rect(0, titleBandHeight - 2, node.width, 2).fill({
        color: colorToNumber(node.stroke, 0x334155),
        alpha: 0.38,
      });

      object.title.text = parts.title;
      object.title.style.fill = textColor;
      object.title.style.wordWrapWidth = Math.max(64, node.width - 20);
      object.title.anchor.set(0.5);
      object.title.position.set(node.width / 2, titleBandHeight / 2);

      object.description.visible = model.viewport.zoom >= 0.42;
      object.description.text = parts.description || '（空）';
      object.description.style.fill = textColor;
      object.description.style.wordWrapWidth = Math.max(64, node.width - 20);
      object.description.anchor.set(0.5);
      object.description.position.set(node.width / 2, titleBandHeight + (node.height - titleBandHeight) / 2);

      const handleVisible = selected || hovered || dropTarget;
      [
        { handle: object.startHandle, x: -10, side: 'left' as const },
        { handle: object.endHandle, x: node.width - 10, side: 'right' as const },
      ].forEach(({ handle, x, side }) => {
        handle.clear();
        handle.visible = handleVisible;
        handle.eventMode = handleVisible ? 'static' : 'none';
        handle.cursor = 'crosshair';
        handle.rect(x, node.height / 2 - 10, 20, 20).fill({ color: 0x111827, alpha: 1 });
        handle.rect(x, node.height / 2 - 10, 20, 20).stroke({ width: 2, color: 0xf8fafc, alpha: 0.95 });
        handle.removeAllListeners();
        handle.on('pointerdown', (event) => {
          stopPixiEvent(event);
          onEndpointPointerDown(toPixiPointer(event), node.id, side);
        });
      });
    });
  }, [
    model.dragTargetNodeId,
    model.editingNodeId,
    model.hoveredNodeId,
    model.nodes,
    model.searchNodeIds,
    model.selection,
    model.viewport.zoom,
    onEndpointPointerDown,
    onNodeHoverChange,
    onNodePointerDown,
  ]);

  return (
    <div
      aria-hidden="true"
      className="pixi-canvas-surface"
      ref={hostRef}
    />
  );
}

export default PixiCanvasSurface;
