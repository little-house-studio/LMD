import type { GraphNode } from './types';
import type { GridPoint, GridRect } from './grid';
import { LMD_GRID_SIZE } from './grid';
import type { PixelGroupShape } from './pixelGroups';
import {
  findPixelGroupAtPoint,
  pixelGroupIntersectsRect,
} from './pixelGroups';

export type SceneHit =
  | { kind: 'node'; id: string }
  | { kind: 'subgraph'; id: string }
  | null;

export interface SceneIndexQueryResult {
  nodeIds: string[];
  subgraphIds: string[];
}

function rectIntersects(left: GridRect, right: GridRect) {
  return (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  );
}

function rectContainsPoint(rect: GridRect, point: GridPoint, padding = 0) {
  return (
    point.x >= rect.x - padding &&
    point.x <= rect.x + rect.width + padding &&
    point.y >= rect.y - padding &&
    point.y <= rect.y + rect.height + padding
  );
}

function bucketKey(x: number, y: number) {
  return `${x},${y}`;
}

export class SceneIndex {
  private readonly cellSize: number;
  private readonly nodeMap: Map<string, GraphNode>;
  private readonly nodeBuckets: Map<string, string[]>;
  private readonly groupShapes: PixelGroupShape[];

  constructor(nodes: GraphNode[], groupShapes: PixelGroupShape[], cellSize = LMD_GRID_SIZE * 4) {
    this.cellSize = cellSize;
    this.nodeMap = new Map(nodes.map((node) => [node.id, node]));
    this.nodeBuckets = new Map();
    this.groupShapes = groupShapes;

    nodes.forEach((node) => {
      const minX = Math.floor(node.x / this.cellSize);
      const minY = Math.floor(node.y / this.cellSize);
      const maxX = Math.floor((node.x + node.width) / this.cellSize);
      const maxY = Math.floor((node.y + node.height) / this.cellSize);

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const key = bucketKey(x, y);
          const bucket = this.nodeBuckets.get(key) ?? [];
          bucket.push(node.id);
          this.nodeBuckets.set(key, bucket);
        }
      }
    });
  }

  hitTest(point: GridPoint): SceneHit {
    const nodeId = this.hitNode(point);
    if (nodeId) {
      return { kind: 'node', id: nodeId };
    }

    const subgraphId = findPixelGroupAtPoint(this.groupShapes, point);
    if (subgraphId) {
      return { kind: 'subgraph', id: subgraphId };
    }

    return null;
  }

  hitNode(point: GridPoint, padding = 0) {
    const bucket = this.nodeBuckets.get(bucketKey(
      Math.floor(point.x / this.cellSize),
      Math.floor(point.y / this.cellSize),
    )) ?? [];

    for (let index = bucket.length - 1; index >= 0; index -= 1) {
      const node = this.nodeMap.get(bucket[index]);
      if (node && rectContainsPoint(node, point, padding)) {
        return node.id;
      }
    }

    return null;
  }

  queryRect(rect: GridRect): SceneIndexQueryResult {
    const nodeIds = new Set<string>();
    const minX = Math.floor(rect.x / this.cellSize);
    const minY = Math.floor(rect.y / this.cellSize);
    const maxX = Math.floor((rect.x + rect.width) / this.cellSize);
    const maxY = Math.floor((rect.y + rect.height) / this.cellSize);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const bucket = this.nodeBuckets.get(bucketKey(x, y)) ?? [];
        bucket.forEach((nodeId) => {
          const node = this.nodeMap.get(nodeId);
          if (node && rectIntersects(rect, node)) {
            nodeIds.add(nodeId);
          }
        });
      }
    }

    const subgraphIds = this.groupShapes
      .filter((shape) => pixelGroupIntersectsRect(shape, rect))
      .map((shape) => shape.id);

    return {
      nodeIds: [...nodeIds],
      subgraphIds,
    };
  }
}

export function createSceneIndex(nodes: GraphNode[], groupShapes: PixelGroupShape[]) {
  return new SceneIndex(nodes, groupShapes);
}
