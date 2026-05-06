import type { GraphNode } from './types';

export const LMD_GRID_SIZE = 32;

export interface GridPoint {
  x: number;
  y: number;
}

export interface GridRect extends GridPoint {
  width: number;
  height: number;
}

export function snapToGrid(value: number, gridSize = LMD_GRID_SIZE) {
  return Math.round(value / gridSize) * gridSize;
}

export function floorToGrid(value: number, gridSize = LMD_GRID_SIZE) {
  return Math.floor(value / gridSize) * gridSize;
}

export function ceilToGrid(value: number, gridSize = LMD_GRID_SIZE) {
  return Math.ceil(value / gridSize) * gridSize;
}

export function snapDimensionToGrid(value: number, minimum = LMD_GRID_SIZE, gridSize = LMD_GRID_SIZE) {
  return Math.max(minimum, Math.ceil(value / gridSize) * gridSize);
}

export function snapPointToGrid(point: GridPoint, gridSize = LMD_GRID_SIZE): GridPoint {
  return {
    x: snapToGrid(point.x, gridSize),
    y: snapToGrid(point.y, gridSize),
  };
}

export function snapRectToGrid(rect: GridRect, gridSize = LMD_GRID_SIZE): GridRect {
  const x = floorToGrid(rect.x, gridSize);
  const y = floorToGrid(rect.y, gridSize);
  const right = ceilToGrid(rect.x + rect.width, gridSize);
  const bottom = ceilToGrid(rect.y + rect.height, gridSize);

  return {
    x,
    y,
    width: Math.max(gridSize, right - x),
    height: Math.max(gridSize, bottom - y),
  };
}

export function quantizeNodeToGrid(node: GraphNode, gridSize = LMD_GRID_SIZE): GraphNode {
  const rect = snapRectToGrid(node, gridSize);
  return {
    ...node,
    x: rect.x,
    y: rect.y,
    width: snapDimensionToGrid(rect.width, gridSize * 3, gridSize),
    height: snapDimensionToGrid(rect.height, gridSize * 2, gridSize),
  };
}

export function quantizeNodesToGrid(nodes: GraphNode[], gridSize = LMD_GRID_SIZE): GraphNode[] {
  return nodes.map((node) => quantizeNodeToGrid(node, gridSize));
}
