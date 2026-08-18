import type { MindMapIR, MindNodeIR } from '@lths/lmd';
import { pointInRect, type Rect } from '../shared/geom';

export const MIND_HEADER = 36;
export const MIND_PAD = 18;
export const MIND_NODE_H = 26;
export const MIND_GAP_Y = 8;
export const MIND_GAP_X = 28;
export const MIND_ADD = 22;
export const MIND_MIN_WIDTH = 220;
export const MIND_MIN_HEIGHT = 140;

export type MindFrame = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MindPaintNode = {
  id: string;
  title: string;
  comment?: string;
  depth: number;
  parentId: string | null;
  box: Rect;
};

export type MindPaintLink = {
  fromId: string;
  toId: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
};

export type MindPaintModel = {
  frame: MindFrame;
  title: string;
  titleHit: Rect;
  addTopic: Rect;
  root: MindPaintNode;
  nodes: MindPaintNode[];
  links: MindPaintLink[];
};

export type MindInteriorHit =
  | { kind: 'title' }
  | { kind: 'add-topic' }
  | { kind: 'topic'; id: string }
  | { kind: 'body' };

function textWidth(title: string) {
  return Math.max(48, title.length * 8 + 20);
}

function subtreeHeight(node: MindNodeIR): number {
  if (node.children.length === 0) {
    return MIND_NODE_H;
  }
  return node.children.reduce((sum, child, index) => (
    sum + subtreeHeight(child) + (index > 0 ? MIND_GAP_Y : 0)
  ), 0);
}

function placeTree(
  node: MindNodeIR,
  x: number,
  y: number,
  depth: number,
  parentId: string | null,
  nodes: MindPaintNode[],
  links: MindPaintLink[],
) {
  const width = textWidth(node.title);
  const height = subtreeHeight(node);
  const box = {
    x,
    y: y + (height - MIND_NODE_H) / 2,
    width,
    height: MIND_NODE_H,
  };
  nodes.push({
    id: node.id,
    title: node.title,
    comment: node.comment,
    depth,
    parentId,
    box,
  });
  let childY = y;
  for (const child of node.children) {
    const childHeight = subtreeHeight(child);
    placeTree(child, x + width + MIND_GAP_X, childY, depth + 1, node.id, nodes, links);
    links.push({
      fromId: node.id,
      toId: child.id,
      start: { x: box.x + box.width, y: box.y + box.height / 2 },
      end: {
        x: x + width + MIND_GAP_X,
        y: childY + (childHeight - MIND_NODE_H) / 2 + MIND_NODE_H / 2,
      },
    });
    childY += childHeight + MIND_GAP_Y;
  }
}

export function measureMindMap(map: MindMapIR) {
  const root: MindNodeIR = { id: map.id, title: map.title, children: map.children };
  const placed: MindPaintNode[] = [];
  placeTree(root, 0, 0, 0, null, placed, []);
  const right = placed.reduce((max, item) => Math.max(max, item.box.x + item.box.width), 0);
  const bottom = placed.reduce((max, item) => Math.max(max, item.box.y + item.box.height), MIND_NODE_H);
  return {
    width: Math.max(MIND_MIN_WIDTH, MIND_PAD * 2 + right),
    height: Math.max(MIND_MIN_HEIGHT, MIND_HEADER + MIND_PAD * 2 + bottom),
  };
}

export function layoutMindMap(map: MindMapIR, frame: MindFrame): MindPaintModel {
  const size = measureMindMap(map);
  const width = Math.max(frame.width, size.width);
  const height = Math.max(frame.height, size.height);
  const root: MindNodeIR = { id: map.id, title: map.title, children: map.children };
  const nodes: MindPaintNode[] = [];
  const links: MindPaintLink[] = [];
  placeTree(root, frame.x + MIND_PAD, frame.y + MIND_HEADER + MIND_PAD, 0, null, nodes, links);
  const rootNode = nodes[0]!;
  const sized = { ...frame, width, height };
  return {
    frame: sized,
    title: map.title,
    titleHit: { x: sized.x, y: sized.y, width: Math.max(80, sized.width - 40), height: MIND_HEADER },
    addTopic: {
      x: sized.x + sized.width - MIND_ADD - 10,
      y: sized.y + (MIND_HEADER - MIND_ADD) / 2,
      width: MIND_ADD,
      height: MIND_ADD,
    },
    root: rootNode,
    nodes: nodes.filter((item) => item.id !== map.id),
    links,
  };
}

export function hitMindFrame(frame: MindFrame, world: { x: number; y: number }) {
  return (
    world.x >= frame.x
    && world.y >= frame.y
    && world.x <= frame.x + frame.width
    && world.y <= frame.y + frame.height
  );
}

export function mindFrameAsRect(frame: MindFrame): Rect {
  return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
}

export function hitMindInterior(
  model: MindPaintModel,
  world: { x: number; y: number },
): MindInteriorHit | null {
  if (!hitMindFrame(model.frame, world)) {
    return null;
  }
  if (pointInRect(world, model.addTopic)) {
    return { kind: 'add-topic' };
  }
  for (let i = model.nodes.length - 1; i >= 0; i -= 1) {
    const node = model.nodes[i];
    if (node && pointInRect(world, node.box)) {
      return { kind: 'topic', id: node.id };
    }
  }
  if (pointInRect(world, model.titleHit) && world.y <= model.frame.y + MIND_HEADER) {
    return { kind: 'title' };
  }
  if (pointInRect(world, model.root.box)) {
    return { kind: 'title' };
  }
  return { kind: 'body' };
}

export function intersectingMindFrameIds(frames: MindFrame[], box: Rect): string[] {
  return frames
    .filter((frame) => (
      frame.x < box.x + box.width
      && frame.x + frame.width > box.x
      && frame.y < box.y + box.height
      && frame.y + frame.height > box.y
    ))
    .map((frame) => frame.id);
}

export function translateMindFrame(frame: MindFrame, dx: number, dy: number): MindFrame {
  return { ...frame, x: frame.x + dx, y: frame.y + dy };
}

export function searchFreeMindOrigin(
  frames: MindFrame[],
  desired: Pick<MindFrame, 'x' | 'y' | 'width' | 'height'>,
  snap: (value: number) => number,
): { x: number; y: number } {
  const overlaps = (x: number, y: number) => frames.some((frame) => (
    x < frame.x + frame.width
    && x + desired.width > frame.x
    && y < frame.y + frame.height
    && y + desired.height > frame.y
  ));
  let x = snap(desired.x);
  let y = snap(desired.y);
  for (let step = 0; step < 24 && overlaps(x, y); step += 1) {
    x = snap(x + 28);
    y = snap(y + 20);
  }
  return { x, y };
}

export function syncMindFrames(
  maps: MindMapIR[],
  stored: MindFrame[],
  graphBounds: Rect | null,
  snap: (value: number) => number,
): MindFrame[] {
  const kept = new Map(stored.filter((frame) => maps.some((map) => map.id === frame.id)).map((frame) => [frame.id, frame]));
  const next: MindFrame[] = [];
  let cursorX = snap(graphBounds ? graphBounds.x + graphBounds.width + 40 : 48);
  let cursorY = snap(graphBounds ? graphBounds.y : 48);
  for (const map of maps) {
    const size = measureMindMap(map);
    const existing = kept.get(map.id);
    if (existing) {
      next.push({
        ...existing,
        width: Math.max(existing.width, size.width),
        height: Math.max(existing.height, size.height),
      });
      continue;
    }
    const origin = searchFreeMindOrigin(next, {
      x: cursorX,
      y: cursorY,
      width: size.width,
      height: size.height,
    }, snap);
    next.push({
      id: map.id,
      x: origin.x,
      y: origin.y,
      width: size.width,
      height: size.height,
    });
    cursorY = origin.y + size.height + 24;
  }
  return next;
}

export function mindNodeParentId(map: MindMapIR, nodeId: string): string | null {
  const walk = (nodes: MindNodeIR[], parentId: string): string | null => {
    for (const node of nodes) {
      if (node.id === nodeId) {
        return parentId;
      }
      const nested = walk(node.children, node.id);
      if (nested) {
        return nested;
      }
    }
    return null;
  };
  return walk(map.children, map.id);
}
