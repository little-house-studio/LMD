import type { SceneNode, SceneEdge, SceneSubgraph, ViewportState } from './scenegraph';
import { Quadtree } from './quadtree';

export interface RenderBatch {
  id: string;
  type: 'nodes' | 'edges' | 'subgraphs';
  vertices: Float32Array;
  indices: Uint32Array;
  colors: Float32Array;
  transform: Float32Array;
  count: number;
}

export interface RenderCache {
  nodeCache: Map<string, number>;
  edgeCache: Map<string, number>;
  batches: RenderBatch[];
  invalidated: boolean;
}

export interface RenderStats {
  visibleNodes: number;
  visibleEdges: number;
  drawCalls: number;
  triangles: number;
  batchCount: number;
}

export class RenderTree {
  private quadtree: Quadtree | null = null;
  private cache: RenderCache = {
    nodeCache: new Map(),
    edgeCache: new Map(),
    batches: [],
    invalidated: true,
  };
  private viewport: ViewportState = { x: 0, y: 0, zoom: 1 };
  private nodePositions = new Map<string, { x: number; y: number; width: number; height: number }>();

  updateViewport(viewport: ViewportState): void {
    this.viewport = viewport;
    this.cache.invalidated = true;
  }

  build(sceneNodes: SceneNode[], sceneEdges: SceneEdge[]): void {
    this.rebuildQuadtree(sceneNodes);
    this.cache.invalidated = true;
  }

  private rebuildQuadtree(nodes: SceneNode[]): void {
    if (nodes.length === 0) {
      this.quadtree = null;
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.transform.x);
      minY = Math.min(minY, node.transform.y);
      maxX = Math.max(maxX, node.transform.x + node.width);
      maxY = Math.max(maxY, node.transform.y + node.height);
      this.nodePositions.set(node.id, {
        x: node.transform.x,
        y: node.transform.y,
        width: node.width,
        height: node.height,
      });
    }

    const padding = 500;
    this.quadtree = new Quadtree({
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    });

    for (const node of nodes) {
      this.quadtree.insert({
        id: node.id,
        rect: {
          x: node.transform.x,
          y: node.transform.y,
          width: node.width,
          height: node.height,
        },
        data: node,
      });
    }
  }

  getVisibleNodes(): SceneNode[] {
    if (!this.quadtree) return [];

    const viewRect = this.getViewRect();
    const items = this.quadtree.query(viewRect);
    return items.map(item => item.data as SceneNode);
  }

  getVisibleEdges(edges: SceneEdge[]): SceneEdge[] {
    const visibleNodeIds = new Set<string>();
    const visibleNodes = this.getVisibleNodes();
    visibleNodes.forEach(node => visibleNodeIds.add(node.id));

    return edges.filter(edge => 
      visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)
    );
  }

  private getViewRect(): { x: number; y: number; width: number; height: number } {
    const { x, y, zoom } = this.viewport;
    const viewWidth = window.innerWidth / zoom;
    const viewHeight = window.innerHeight / zoom;
    return {
      x: -x / zoom,
      y: -y / zoom,
      width: viewWidth,
      height: viewHeight,
    };
  }

  queryPoint(x: number, y: number): SceneNode | null {
    if (!this.quadtree) return null;

    const worldX = (x - this.viewport.x) / this.viewport.zoom;
    const worldY = (y - this.viewport.y) / this.viewport.zoom;

    const items = this.quadtree.queryPoint({ x: worldX, y: worldY });
    for (const item of items) {
      const node = item.data as SceneNode;
      if (
        worldX >= node.transform.x &&
        worldX <= node.transform.x + node.width &&
        worldY >= node.transform.y &&
        worldY <= node.transform.y + node.height
      ) {
        return node;
      }
    }
    return null;
  }

  queryRect(rect: { x: number; y: number; width: number; height: number }): SceneNode[] {
    if (!this.quadtree) return [];

    const worldRect = {
      x: (rect.x - this.viewport.x) / this.viewport.zoom,
      y: (rect.y - this.viewport.y) / this.viewport.zoom,
      width: rect.width / this.viewport.zoom,
      height: rect.height / this.viewport.zoom,
    };

    const items = this.quadtree.query(worldRect);
    return items.map(item => item.data as SceneNode);
  }

  buildNodeBatch(nodes: SceneNode[]): RenderBatch {
    const vertices: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const transform = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    let vertexOffset = 0;

    for (const node of nodes) {
      this.addNodeToBatch(node, vertices, indices, colors, vertexOffset);
      vertexOffset += 4;
    }

    return {
      id: 'nodes',
      type: 'nodes',
      vertices: new Float32Array(vertices),
      indices: new Uint32Array(indices),
      colors: new Float32Array(colors),
      transform,
      count: nodes.length,
    };
  }

  private addNodeToBatch(
    node: SceneNode,
    vertices: number[],
    indices: number[],
    colors: number[],
    offset: number,
  ): void {
    const { x, y, width, height } = node.transform;
    const hw = width / 2;
    const hh = height / 2;

    vertices.push(
      x - hw, y - hh, 0, 1,
      x + hw, y - hh, 0, 1,
      x + hw, y + hh, 0, 1,
      x - hw, y + hh, 0, 1,
    );

    indices.push(
      offset, offset + 1, offset + 2,
      offset, offset + 2, offset + 3,
    );

    const fill = this.hexToFloatArray(node.style.fill);
    for (let i = 0; i < 4; i++) {
      colors.push(...fill);
    }
  }

  buildEdgeBatch(edges: SceneEdge[], nodePositions: Map<string, { x: number; y: number; width: number; height: number }>): RenderBatch {
    const vertices: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const transform = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    let vertexOffset = 0;

    for (const edge of edges) {
      const from = nodePositions.get(edge.from);
      const to = nodePositions.get(edge.to);
      if (!from || !to) continue;

      this.addEdgeToBatch(edge, from, to, vertices, indices, colors, vertexOffset);
      vertexOffset += 2;
    }

    return {
      id: 'edges',
      type: 'edges',
      vertices: new Float32Array(vertices),
      indices: new Uint32Array(indices),
      colors: new Float32Array(colors),
      transform,
      count: edges.length,
    };
  }

  private addEdgeToBatch(
    edge: SceneEdge,
    from: { x: number; y: number; width: number; height: number },
    to: { x: number; y: number; width: number; height: number },
    vertices: number[],
    indices: number[],
    colors: number[],
    offset: number,
  ): void {
    const fromX = from.x + from.width / 2;
    const fromY = from.y + from.height / 2;
    const toX = to.x + to.width / 2;
    const toY = to.y + to.height / 2;

    vertices.push(
      fromX, fromY, 0, 1,
      toX, toY, 0, 1,
    );

    indices.push(offset, offset + 1);

    const color = this.hexToFloatArray(edge.strokeColor);
    for (let i = 0; i < 2; i++) {
      colors.push(...color);
    }
  }

  private hexToFloatArray(hex: string): number[] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      return [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255,
        1,
      ];
    }
    return [0.5, 0.5, 0.5, 1];
  }

  getStats(nodes: SceneNode[], edges: SceneEdge[]): RenderStats {
    const visibleNodes = this.getVisibleNodes();
    const visibleEdges = this.getVisibleEdges(edges);

    return {
      visibleNodes: visibleNodes.length,
      visibleEdges: visibleEdges.length,
      drawCalls: this.cache.batches.length,
      triangles: visibleNodes.length * 2 + visibleEdges.length,
      batchCount: this.cache.batches.length,
    };
  }

  invalidate(): void {
    this.cache.invalidated = true;
    this.cache.batches = [];
    this.cache.nodeCache.clear();
    this.cache.edgeCache.clear();
  }

  updateNodePosition(nodeId: string, x: number, y: number): void {
    const pos = this.nodePositions.get(nodeId);
    if (pos) {
      pos.x = x;
      pos.y = y;
    }
    if (this.quadtree) {
      const nodePos = this.nodePositions.get(nodeId);
      if (nodePos) {
        this.quadtree.update(nodeId, {
          x: nodePos.x,
          y: nodePos.y,
          width: nodePos.width,
          height: nodePos.height,
        });
      }
    }
    this.cache.invalidated = true;
  }

  clear(): void {
    this.quadtree = null;
    this.cache = {
      nodeCache: new Map(),
      edgeCache: new Map(),
      batches: [],
      invalidated: true,
    };
    this.nodePositions.clear();
  }
}