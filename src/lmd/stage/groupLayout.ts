import type { GraphNode } from '..';
import type { Rect } from './math';

export const GROUP_PAD = 28;
export const GROUP_HEADER = 44;

export function groupBounds(nodes: GraphNode[]): Rect {
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
  return {
    x: minX - GROUP_PAD,
    y: minY - GROUP_PAD - GROUP_HEADER,
    width: Math.max(200, maxX - minX + GROUP_PAD * 2),
    height: Math.max(120, maxY - minY + GROUP_PAD * 2 + GROUP_HEADER),
  };
}
