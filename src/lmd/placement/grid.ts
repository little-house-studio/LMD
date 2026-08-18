export function snapScalar(value: number, grid: number) {
  const size = Math.max(1, grid);
  return Math.round(value / size) * size;
}

export function snapPoint(point: { x: number; y: number }, grid: number) {
  return {
    x: snapScalar(point.x, grid),
    y: snapScalar(point.y, grid),
  };
}

/** Tile snap: origin to the grid. Size stays content-measured. */
export function snapNodeToGrid<T extends { x: number; y: number }>(node: T, grid: number): T {
  const origin = snapPoint(node, grid);
  return { ...node, x: origin.x, y: origin.y };
}

export function snapNodesToGrid<T extends { x: number; y: number }>(nodes: T[], grid: number): T[] {
  return nodes.map((node) => snapNodeToGrid(node, grid));
}
