import type { GraphNode } from '../compat/types';
import { expandRect, rectIntersects, type Rect } from '../../shared/geom';

function nodeRect(node: GraphNode): Rect {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

function overlapAmount(a: Rect, b: Rect) {
  const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { ox, oy };
}

function clampNode(node: GraphNode, bounds: Rect): GraphNode {
  const maxX = bounds.x + Math.max(0, bounds.width - node.width);
  const maxY = bounds.y + Math.max(0, bounds.height - node.height);
  return {
    ...node,
    x: Math.round(Math.min(maxX, Math.max(bounds.x, node.x))),
    y: Math.round(Math.min(maxY, Math.max(bounds.y, node.y))),
  };
}

/**
 * Push overlapping nodes apart along the smaller penetration axis,
 * then clamp back into bounds. Iterated so a cluster unpacks.
 */
export function resolveOverlaps(
  nodes: GraphNode[],
  bounds?: Rect,
  options?: { padding?: number; iterations?: number },
): GraphNode[] {
  const padding = options?.padding ?? 12;
  const iterations = options?.iterations ?? 10;
  const next = nodes.map((node) => ({ ...node }));
  const index = new Map(next.map((node, i) => [node.id, i]));

  for (let step = 0; step < iterations; step += 1) {
    let moved = false;
    for (let i = 0; i < next.length; i += 1) {
      for (let j = i + 1; j < next.length; j += 1) {
        const left = next[i];
        const right = next[j];
        const a = expandRect(nodeRect(left), padding / 2);
        const b = expandRect(nodeRect(right), padding / 2);
        if (!rectIntersects(a, b)) {
          continue;
        }
        const { ox, oy } = overlapAmount(a, b);
        if (ox <= 0 || oy <= 0) {
          continue;
        }
        if (ox < oy) {
          const push = ox / 2 + 0.5;
          const dir = left.x + left.width / 2 <= right.x + right.width / 2 ? -1 : 1;
          left.x = Math.round(left.x + dir * push);
          right.x = Math.round(right.x - dir * push);
        } else {
          const push = oy / 2 + 0.5;
          const dir = left.y + left.height / 2 <= right.y + right.height / 2 ? -1 : 1;
          left.y = Math.round(left.y + dir * push);
          right.y = Math.round(right.y - dir * push);
        }
        moved = true;
      }
    }
    if (bounds) {
      for (let i = 0; i < next.length; i += 1) {
        next[i] = clampNode(next[i], bounds);
      }
    }
    if (!moved) {
      break;
    }
  }

  return nodes.map((node) => next[index.get(node.id) ?? 0] ?? node);
}

export function nodesOverlap(nodes: GraphNode[], padding = 8) {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (rectIntersects(expandRect(nodeRect(nodes[i]), padding), expandRect(nodeRect(nodes[j]), padding))) {
        return true;
      }
    }
  }
  return false;
}
