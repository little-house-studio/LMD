import type { GraphNode, GraphSubgraph } from '@lths/lmd/legacy';
import { unionRects, type Rect } from '../shared/geom';

export const GROUP_PAD = 16;
export const GROUP_NEST_PAD = 18;
export const GROUP_HEADER = 28;

export function groupBounds(nodes: GraphNode[], extraPad = 0): Rect {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 240, height: 160 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  const pad = GROUP_PAD + extraPad;
  return {
    x: minX - pad,
    y: minY - pad - GROUP_HEADER,
    width: Math.max(200, maxX - minX + pad * 2),
    height: Math.max(120, maxY - minY + pad * 2 + GROUP_HEADER),
  };
}

export function subgraphDepth(id: string, lookup: Map<string, GraphSubgraph>): number {
  let depth = 0;
  let current = lookup.get(id)?.parentId ?? null;
  while (current) {
    depth += 1;
    current = lookup.get(current)?.parentId ?? null;
  }
  return depth;
}

function wrapContent(content: Rect, nest: boolean): Rect {
  const pad = GROUP_PAD + (nest ? GROUP_NEST_PAD : 0);
  return {
    x: content.x - pad,
    y: content.y - pad - GROUP_HEADER,
    width: Math.max(200, content.width + pad * 2),
    height: Math.max(120, content.height + pad * 2 + GROUP_HEADER),
  };
}

/** Leaf groups hug their nodes; parents wrap child group rects so nesting is visible. */
export function computeGroupRects(
  subgraphs: GraphSubgraph[],
  nodes: GraphNode[],
  lookup: Map<string, GraphSubgraph>,
): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  const childrenOf = new Map<string, string[]>();
  for (const subgraph of subgraphs) {
    if (!subgraph.parentId) {
      continue;
    }
    const bucket = childrenOf.get(subgraph.parentId) ?? [];
    bucket.push(subgraph.id);
    childrenOf.set(subgraph.parentId, bucket);
  }

  const ordered = [...subgraphs].sort(
    (left, right) => subgraphDepth(right.id, lookup) - subgraphDepth(left.id, lookup),
  );
  for (const subgraph of ordered) {
    const childRects = (childrenOf.get(subgraph.id) ?? [])
      .map((id) => rects.get(id))
      .filter((rect): rect is Rect => Boolean(rect));
    const direct = nodes.filter((node) => node.subgraphId === subgraph.id);
    const parts: Rect[] = [...childRects];
    if (direct.length > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const node of direct) {
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + node.width);
        maxY = Math.max(maxY, node.y + node.height);
      }
      parts.push({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    }
    const content = unionRects(parts);
    rects.set(subgraph.id, content ? wrapContent(content, childRects.length > 0) : groupBounds([]));
  }
  return rects;
}
