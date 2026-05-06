import type { GraphNode, GraphSubgraph } from './types';
import {
  LMD_GRID_SIZE,
  ceilToGrid,
  floorToGrid,
  snapRectToGrid,
  type GridPoint,
  type GridRect,
} from './grid';

export interface PixelGroupRegion {
  id: string;
  subgraphId: string;
  rect: GridRect;
}

export interface PixelGroupShape {
  id: string;
  depth: number;
  collapsed: boolean;
  bounds: GridRect;
  regions: PixelGroupRegion[];
  regionCount: number;
}

function getSubgraphDepth(subgraph: GraphSubgraph, lookup: Map<string, GraphSubgraph>) {
  let depth = 0;
  let parentId = subgraph.parentId;

  while (parentId) {
    const parent = lookup.get(parentId);
    if (!parent) {
      break;
    }
    depth += 1;
    parentId = parent.parentId;
  }

  return depth;
}

function nodeBelongsToSubgraph(
  node: GraphNode,
  subgraphId: string,
  lookup: Map<string, GraphSubgraph>,
) {
  let currentId = node.subgraphId;

  while (currentId) {
    if (currentId === subgraphId) {
      return true;
    }

    currentId = lookup.get(currentId)?.parentId ?? null;
  }

  return false;
}

function cellKey(x: number, y: number) {
  return `${x},${y}`;
}

function parseCellKey(key: string) {
  const [x = '0', y = '0'] = key.split(',');
  return { x: Number.parseInt(x, 10), y: Number.parseInt(y, 10) };
}

function rectFromCells(cells: Set<string>, gridSize: number): GridRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  cells.forEach((key) => {
    const cell = parseCellKey(key);
    minX = Math.min(minX, cell.x);
    minY = Math.min(minY, cell.y);
    maxX = Math.max(maxX, cell.x);
    maxY = Math.max(maxY, cell.y);
  });

  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: gridSize, height: gridSize };
  }

  return {
    x: minX * gridSize,
    y: minY * gridSize,
    width: (maxX - minX + 1) * gridSize,
    height: (maxY - minY + 1) * gridSize,
  };
}

function collectComponents(cells: Set<string>) {
  const remaining = new Set(cells);
  const components: Array<Set<string>> = [];
  const neighbors = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  while (remaining.size > 0) {
    const first = remaining.values().next().value as string | undefined;
    if (!first) {
      break;
    }

    const component = new Set<string>();
    const queue = [first];
    remaining.delete(first);

    while (queue.length > 0) {
      const key = queue.pop();
      if (!key) {
        continue;
      }
      component.add(key);
      const cell = parseCellKey(key);
      neighbors.forEach((neighbor) => {
        const nextKey = cellKey(cell.x + neighbor.x, cell.y + neighbor.y);
        if (!remaining.has(nextKey)) {
          return;
        }
        remaining.delete(nextKey);
        queue.push(nextKey);
      });
    }

    components.push(component);
  }

  return components;
}

function compressCellsToRects(cells: Set<string>, gridSize: number) {
  const rows = new Map<number, Array<{ start: number; end: number }>>();

  cells.forEach((key) => {
    const cell = parseCellKey(key);
    const row = rows.get(cell.y) ?? [];
    row.push({ start: cell.x, end: cell.x });
    rows.set(cell.y, row);
  });

  const normalizedRows = [...rows.entries()]
    .map(([y, entries]) => {
      const sorted = entries.sort((left, right) => left.start - right.start);
      const intervals: Array<{ start: number; end: number }> = [];
      sorted.forEach((entry) => {
        const previous = intervals[intervals.length - 1];
        if (previous && entry.start <= previous.end + 1) {
          previous.end = Math.max(previous.end, entry.end);
          return;
        }
        intervals.push({ ...entry });
      });
      return { y, intervals };
    })
    .sort((left, right) => left.y - right.y);

  const open = new Map<string, { x: number; y: number; width: number; height: number; lastY: number }>();
  const rects: GridRect[] = [];

  normalizedRows.forEach((row) => {
    const seen = new Set<string>();
    row.intervals.forEach((interval) => {
      const key = `${interval.start}:${interval.end}`;
      seen.add(key);
      const existing = open.get(key);
      if (existing && existing.lastY === row.y - 1) {
        existing.height += 1;
        existing.lastY = row.y;
        return;
      }

      if (existing) {
        rects.push({
          x: existing.x * gridSize,
          y: existing.y * gridSize,
          width: existing.width * gridSize,
          height: existing.height * gridSize,
        });
      }

      open.set(key, {
        x: interval.start,
        y: row.y,
        width: interval.end - interval.start + 1,
        height: 1,
        lastY: row.y,
      });
    });

    [...open.entries()].forEach(([key, rect]) => {
      if (seen.has(key) || rect.lastY === row.y) {
        return;
      }

      rects.push({
        x: rect.x * gridSize,
        y: rect.y * gridSize,
        width: rect.width * gridSize,
        height: rect.height * gridSize,
      });
      open.delete(key);
    });
  });

  open.forEach((rect) => {
    rects.push({
      x: rect.x * gridSize,
      y: rect.y * gridSize,
      width: rect.width * gridSize,
      height: rect.height * gridSize,
    });
  });

  return rects;
}

function buildCellsForNodes(nodes: GraphNode[], depth: number, gridSize: number) {
  const cells = new Set<string>();
  const paddingCells = 2 + depth;

  nodes.forEach((node) => {
    const rect = snapRectToGrid(node, gridSize);
    const minCellX = Math.floor(rect.x / gridSize) - paddingCells;
    const minCellY = Math.floor(rect.y / gridSize) - paddingCells;
    const maxCellX = Math.ceil((rect.x + rect.width) / gridSize) - 1 + paddingCells;
    const maxCellY = Math.ceil((rect.y + rect.height) / gridSize) - 1 + paddingCells;

    for (let y = minCellY; y <= maxCellY; y += 1) {
      for (let x = minCellX; x <= maxCellX; x += 1) {
        cells.add(cellKey(x, y));
      }
    }
  });

  return cells;
}

export function buildPixelGroupShapes(
  subgraphs: GraphSubgraph[],
  nodes: GraphNode[],
  gridSize = LMD_GRID_SIZE,
): PixelGroupShape[] {
  const lookup = new Map(subgraphs.map((subgraph) => [subgraph.id, subgraph]));

  return subgraphs.flatMap((subgraph) => {
    const depth = getSubgraphDepth(subgraph, lookup);
    const memberNodes = nodes.filter((node) => nodeBelongsToSubgraph(node, subgraph.id, lookup));
    if (memberNodes.length === 0) {
      return [];
    }

    const cells = buildCellsForNodes(memberNodes, depth, gridSize);
    const components = collectComponents(cells);
    const regions = components.flatMap((component, componentIndex) =>
      compressCellsToRects(component, gridSize).map((rect, rectIndex) => ({
        id: `${subgraph.id}:${componentIndex}:${rectIndex}`,
        subgraphId: subgraph.id,
        rect,
      })),
    );

    const rawBounds = regions.reduce<GridRect | null>((bounds, region) => {
      const rect = region.rect;
      if (!bounds) {
        return { ...rect };
      }
      const minX = Math.min(bounds.x, rect.x);
      const minY = Math.min(bounds.y, rect.y);
      const maxX = Math.max(bounds.x + bounds.width, rect.x + rect.width);
      const maxY = Math.max(bounds.y + bounds.height, rect.y + rect.height);
      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    }, null);

    const bounds = rawBounds
      ? {
          x: floorToGrid(rawBounds.x, gridSize),
          y: floorToGrid(rawBounds.y, gridSize),
          width: ceilToGrid(rawBounds.x + rawBounds.width, gridSize) - floorToGrid(rawBounds.x, gridSize),
          height: ceilToGrid(rawBounds.y + rawBounds.height, gridSize) - floorToGrid(rawBounds.y, gridSize),
        }
      : rectFromCells(cells, gridSize);

    return [{
      id: subgraph.id,
      depth,
      collapsed: subgraph.collapsed,
      bounds,
      regions,
      regionCount: components.length,
    }];
  });
}

export function pixelGroupContainsPoint(shape: PixelGroupShape, point: GridPoint) {
  return shape.regions.some((region) => (
    point.x >= region.rect.x &&
    point.x <= region.rect.x + region.rect.width &&
    point.y >= region.rect.y &&
    point.y <= region.rect.y + region.rect.height
  ));
}

export function pixelGroupIntersectsRect(shape: PixelGroupShape, rect: GridRect) {
  return shape.regions.some((region) => (
    rect.x <= region.rect.x + region.rect.width &&
    rect.x + rect.width >= region.rect.x &&
    rect.y <= region.rect.y + region.rect.height &&
    rect.y + rect.height >= region.rect.y
  ));
}

export function findPixelGroupAtPoint(
  shapes: PixelGroupShape[],
  point: GridPoint,
  excludedIds: string[] = [],
) {
  const excluded = new Set(excludedIds);
  return [...shapes]
    .sort((left, right) => right.depth - left.depth)
    .find((shape) => !excluded.has(shape.id) && pixelGroupContainsPoint(shape, point))?.id ?? null;
}
