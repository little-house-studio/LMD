import type { GraphDocument, GraphNode } from '../compat/types';
import { pointInRect, type Rect, type Vec2 } from '../../shared/geom';
import { innerRect, solveOptimalLayout } from './solver';
import {
  FRAME_DEFAULT_PADDING,
  FRAME_HEADER,
  FRAME_MIN_HEIGHT,
  FRAME_MIN_WIDTH,
  type FrameHandle,
  type LayoutFrame,
} from './types';

export function cloneFrame(frame: LayoutFrame): LayoutFrame {
  return { ...frame, nodeIds: [...frame.nodeIds] };
}

export function normalizeFrame(input: Partial<LayoutFrame> & Pick<LayoutFrame, 'id'>): LayoutFrame {
  return {
    id: input.id,
    title: (input.title ?? '形状框').trim() || '形状框',
    x: Math.round(input.x ?? 0),
    y: Math.round(input.y ?? 0),
    width: Math.max(FRAME_MIN_WIDTH, Math.round(input.width ?? FRAME_MIN_WIDTH)),
    height: Math.max(FRAME_MIN_HEIGHT, Math.round(input.height ?? FRAME_MIN_HEIGHT)),
    nodeIds: [...new Set(input.nodeIds ?? [])],
    padding: Math.max(12, Math.round(input.padding ?? FRAME_DEFAULT_PADDING)),
  };
}

export function readLayoutFrames(extras: Record<string, unknown> | undefined): LayoutFrame[] {
  const raw = extras?.layoutFrames;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const value = entry as Partial<LayoutFrame>;
    const id = typeof value.id === 'string' && value.id ? value.id : `frame_${index + 1}`;
    return [normalizeFrame({ ...value, id })];
  });
}

export function writeLayoutFrames(document: GraphDocument, frames: LayoutFrame[]): GraphDocument {
  return {
    ...document,
    compat: {
      version: document.compat?.version ?? 1,
      layout: document.compat?.layout ?? document.layout,
      editor: document.compat?.editor,
      extras: {
        ...(document.compat?.extras ?? {}),
        layoutFrames: frames.map(cloneFrame),
      },
    },
  };
}

export function createFrameId(existing: LayoutFrame[]) {
  const used = new Set(existing.map((frame) => frame.id));
  let index = existing.length + 1;
  while (used.has(`frame_${index}`)) {
    index += 1;
  }
  return `frame_${index}`;
}

export function nodesIntersectingRect(nodes: GraphNode[], rect: Rect) {
  return nodes.filter((node) => (
    node.x < rect.x + rect.width &&
    node.x + node.width > rect.x &&
    node.y < rect.y + rect.height &&
    node.y + node.height > rect.y
  ));
}

export function unionNodeBounds(nodes: GraphNode[], pad = 0): Rect | null {
  if (nodes.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach((node) => {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  });
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(FRAME_MIN_WIDTH, maxX - minX + pad * 2),
    height: Math.max(FRAME_MIN_HEIGHT, maxY - minY + pad * 2),
  };
}

export function createFrameFromRect(
  existing: LayoutFrame[],
  rect: Rect,
  nodeIds: string[],
  title?: string,
): LayoutFrame {
  const normalized = normalizeRect(rect);
  return normalizeFrame({
    id: createFrameId(existing),
    title: title ?? `形状框 ${existing.length + 1}`,
    ...normalized,
    nodeIds,
    padding: FRAME_DEFAULT_PADDING,
  });
}

export function normalizeRect(rect: Rect): Rect {
  const x = Math.min(rect.x, rect.x + rect.width);
  const y = Math.min(rect.y, rect.y + rect.height);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(FRAME_MIN_WIDTH, Math.round(Math.abs(rect.width))),
    height: Math.max(FRAME_MIN_HEIGHT, Math.round(Math.abs(rect.height))),
  };
}

export function exclusiveAssign(frames: LayoutFrame[], frameId: string, nodeIds: string[]) {
  const take = new Set(nodeIds);
  const previousCount = new Map(frames.map((frame) => [frame.id, frame.nodeIds.length]));
  return frames
    .map((frame) => {
      if (frame.id === frameId) {
        return { ...frame, nodeIds: [...new Set([...frame.nodeIds, ...nodeIds])] };
      }
      return { ...frame, nodeIds: frame.nodeIds.filter((id) => !take.has(id)) };
    })
    .filter((frame) => (
      frame.id === frameId ||
      frame.nodeIds.length > 0 ||
      (previousCount.get(frame.id) ?? 0) === 0
    ));
}

export function pruneFrameMembers(frames: LayoutFrame[], livingIds: Set<string>) {
  return frames.map((frame) => ({
    ...frame,
    nodeIds: frame.nodeIds.filter((id) => livingIds.has(id)),
  }));
}

export function frameInnerRect(frame: LayoutFrame, extraTop = 0): Rect {
  return innerRect(
    {
      x: frame.x,
      y: frame.y + FRAME_HEADER + extraTop,
      width: frame.width,
      height: Math.max(40, frame.height - FRAME_HEADER - extraTop),
    },
    frame.padding,
  );
}

export function reflowFrame(document: GraphDocument, frame: LayoutFrame): GraphDocument {
  if (frame.nodeIds.length === 0) {
    return document;
  }
  const grouped = frame.nodeIds.some((id) =>
    Boolean(document.nodes.find((node) => node.id === id)?.subgraphId),
  );
  const solved = solveOptimalLayout(document, {
    nodeIds: frame.nodeIds,
    bounds: frameInnerRect(frame, grouped ? 36 : 0),
    mode: 'optimal',
  });
  return { ...document, nodes: solved.nodes };
}

export function translateFrame(frame: LayoutFrame, dx: number, dy: number): LayoutFrame {
  return {
    ...frame,
    x: Math.round(frame.x + dx),
    y: Math.round(frame.y + dy),
  };
}

export function resizeFrame(frame: LayoutFrame, handle: FrameHandle, world: Vec2): LayoutFrame {
  let { x, y, width, height } = frame;
  const right = x + width;
  const bottom = y + height;
  if (handle.includes('w')) {
    x = Math.min(world.x, right - FRAME_MIN_WIDTH);
    width = right - x;
  }
  if (handle.includes('e')) {
    width = Math.max(FRAME_MIN_WIDTH, world.x - x);
  }
  if (handle.includes('n')) {
    y = Math.min(world.y, bottom - FRAME_MIN_HEIGHT);
    height = bottom - y;
  }
  if (handle.includes('s')) {
    height = Math.max(FRAME_MIN_HEIGHT, world.y - y);
  }
  return normalizeFrame({ ...frame, x, y, width, height });
}

export function handleRects(frame: LayoutFrame, scale: number, viewSize = 12): Array<{ handle: FrameHandle; rect: Rect }> {
  const size = Math.max(10, viewSize / Math.max(scale, 0.001));
  const half = size / 2;
  const midX = frame.x + frame.width / 2;
  const midY = frame.y + frame.height / 2;
  const points: Array<{ handle: FrameHandle; x: number; y: number }> = [
    { handle: 'nw', x: frame.x, y: frame.y },
    { handle: 'n', x: midX, y: frame.y },
    { handle: 'ne', x: frame.x + frame.width, y: frame.y },
    { handle: 'e', x: frame.x + frame.width, y: midY },
    { handle: 'se', x: frame.x + frame.width, y: frame.y + frame.height },
    { handle: 's', x: midX, y: frame.y + frame.height },
    { handle: 'sw', x: frame.x, y: frame.y + frame.height },
    { handle: 'w', x: frame.x, y: midY },
  ];
  return points.map((point) => ({
    handle: point.handle,
    rect: { x: point.x - half, y: point.y - half, width: size, height: size },
  }));
}

export function hitFrameHandle(frame: LayoutFrame, world: Vec2, scale: number): FrameHandle | null {
  const hit = handleRects(frame, scale, 20).find((entry) => pointInRect(world, entry.rect));
  return hit?.handle ?? null;
}

/** Handles first, then a thick border band — used so edges don't steal resize. */
export function hitFrameResize(frame: LayoutFrame, world: Vec2, scale: number): FrameHandle | null {
  const handle = hitFrameHandle(frame, world, scale);
  if (handle) {
    return handle;
  }
  const band = Math.max(10, 14 / Math.max(scale, 0.001));
  const { x, y, width, height } = frame;
  const onLeft = world.x >= x - band && world.x <= x + band && world.y >= y - band && world.y <= y + height + band;
  const onRight = world.x >= x + width - band && world.x <= x + width + band && world.y >= y - band && world.y <= y + height + band;
  const onTop = world.y >= y - band && world.y <= y + band && world.x >= x - band && world.x <= x + width + band;
  const onBottom = world.y >= y + height - band && world.y <= y + height + band && world.x >= x - band && world.x <= x + width + band;
  if (onTop && onLeft) return 'nw';
  if (onTop && onRight) return 'ne';
  if (onBottom && onLeft) return 'sw';
  if (onBottom && onRight) return 'se';
  if (onTop) return 'n';
  if (onBottom) return 's';
  if (onLeft) return 'w';
  if (onRight) return 'e';
  return null;
}

export function hitFrameBody(frame: LayoutFrame, world: Vec2, border = 8): boolean {
  const outer = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  if (!pointInRect(world, outer)) {
    return false;
  }
  const header = { x: frame.x, y: frame.y, width: frame.width, height: FRAME_HEADER };
  if (pointInRect(world, header)) {
    return true;
  }
  const inset = {
    x: frame.x + border,
    y: frame.y + FRAME_HEADER,
    width: frame.width - border * 2,
    height: frame.height - FRAME_HEADER - border,
  };
  return !pointInRect(world, inset, 0) || frame.nodeIds.length === 0;
}

export function frameAsRect(frame: LayoutFrame): Rect {
  return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
}
