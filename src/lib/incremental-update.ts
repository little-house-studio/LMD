import type { SceneNode, SceneEdge, SceneSubgraph } from './scenegraph';

export type UpdateType = 'create' | 'update' | 'delete';

export interface NodeUpdate {
  type: UpdateType;
  node: SceneNode;
  previous?: SceneNode;
}

export interface EdgeUpdate {
  type: UpdateType;
  edge: SceneEdge;
  previous?: SceneEdge;
}

export interface SubgraphUpdate {
  type: UpdateType;
  subgraph: SceneSubgraph;
  previous?: SceneSubgraph;
}

export interface ViewportUpdate {
  type: 'viewport';
  x: number;
  y: number;
  zoom: number;
}

export type SceneUpdate = NodeUpdate | EdgeUpdate | SubgraphUpdate | ViewportUpdate;

export interface UpdateBatch {
  nodes: NodeUpdate[];
  edges: EdgeUpdate[];
  subgraphs: SubgraphUpdate[];
  viewport?: ViewportUpdate;
  timestamp: number;
}

export class UpdateTracker {
  private nodeHistory = new Map<string, SceneNode>();
  private edgeHistory = new Map<string, SceneEdge>();
  private subgraphHistory = new Map<string, SceneSubgraph>();
  private pendingUpdates: SceneUpdate[] = [];
  private updateId = 0;
  private batchSize = 100;

  trackNode(node: SceneNode): void {
    const existing = this.nodeHistory.get(node.id);
    if (existing) {
      if (this.hasNodeChanged(existing, node)) {
        this.pendingUpdates.push({
          type: 'update',
          node,
          previous: existing,
        });
      }
    } else {
      this.pendingUpdates.push({
        type: 'create',
        node,
      });
    }
    this.nodeHistory.set(node.id, { ...node });
  }

  trackEdge(edge: SceneEdge): void {
    const existing = this.edgeHistory.get(edge.id);
    if (existing) {
      if (this.hasEdgeChanged(existing, edge)) {
        this.pendingUpdates.push({
          type: 'update',
          edge,
          previous: existing,
        });
      }
    } else {
      this.pendingUpdates.push({
        type: 'create',
        edge,
      });
    }
    this.edgeHistory.set(edge.id, { ...edge });
  }

  trackSubgraph(subgraph: SceneSubgraph): void {
    const existing = this.subgraphHistory.get(subgraph.id);
    if (existing) {
      if (this.hasSubgraphChanged(existing, subgraph)) {
        this.pendingUpdates.push({
          type: 'update',
          subgraph,
          previous: existing,
        });
      }
    } else {
      this.pendingUpdates.push({
        type: 'create',
        subgraph,
      });
    }
    this.subgraphHistory.set(subgraph.id, { ...subgraph });
  }

  trackDeletedNode(nodeId: string): void {
    const existing = this.nodeHistory.get(nodeId);
    if (existing) {
      this.pendingUpdates.push({
        type: 'delete',
        node: existing,
      });
      this.nodeHistory.delete(nodeId);
    }
  }

  trackDeletedEdge(edgeId: string): void {
    const existing = this.edgeHistory.get(edgeId);
    if (existing) {
      this.pendingUpdates.push({
        type: 'delete',
        edge: existing,
      });
      this.edgeHistory.delete(edgeId);
    }
  }

  trackDeletedSubgraph(subgraphId: string): void {
    const existing = this.subgraphHistory.get(subgraphId);
    if (existing) {
      this.pendingUpdates.push({
        type: 'delete',
        subgraph: existing,
      });
      this.subgraphHistory.delete(subgraphId);
    }
  }

  trackViewport(x: number, y: number, zoom: number): void {
    this.pendingUpdates.push({
      type: 'viewport',
      x,
      y,
      zoom,
    });
  }

  private hasNodeChanged(a: SceneNode, b: SceneNode): boolean {
    return (
      a.transform.x !== b.transform.x ||
      a.transform.y !== b.transform.y ||
      a.width !== b.width ||
      a.height !== b.height ||
      a.style.fill !== b.style.fill ||
      a.style.stroke !== b.style.stroke ||
      a.label !== b.label ||
      a.subgraphId !== b.subgraphId ||
      a.visible !== b.visible
    );
  }

  private hasEdgeChanged(a: SceneEdge, b: SceneEdge): boolean {
    return (
      a.from !== b.from ||
      a.to !== b.to ||
      a.label !== b.label ||
      a.type !== b.type ||
      a.strokeColor !== b.strokeColor ||
      a.strokeWidth !== b.strokeWidth
    );
  }

  private hasSubgraphChanged(a: SceneSubgraph, b: SceneSubgraph): boolean {
    return (
      a.title !== b.title ||
      a.parentId !== b.parentId ||
      a.collapsed !== b.collapsed ||
      a.visible !== b.visible
    );
  }

  getBatch(): UpdateBatch | null {
    if (this.pendingUpdates.length === 0) {
      return null;
    }

    const batch: UpdateBatch = {
      nodes: [],
      edges: [],
      subgraphs: [],
      timestamp: Date.now(),
    };

    let count = 0;
    while (this.pendingUpdates.length > 0 && count < this.batchSize) {
      const update = this.pendingUpdates.shift()!;
      count++;

      switch (update.type) {
        case 'viewport':
          batch.viewport = update;
          break;
        case 'create':
        case 'update':
        case 'delete':
          if ('node' in update) {
            batch.nodes.push(update);
          } else if ('edge' in update) {
            batch.edges.push(update);
          } else if ('subgraph' in update) {
            batch.subgraphs.push(update);
          }
          break;
      }
    }

    return batch;
  }

  getPendingCount(): number {
    return this.pendingUpdates.length;
  }

  clear(): void {
    this.nodeHistory.clear();
    this.edgeHistory.clear();
    this.subgraphHistory.clear();
    this.pendingUpdates = [];
  }

  reset(): void {
    this.clear();
    this.updateId = 0;
  }

  setBatchSize(size: number): void {
    this.batchSize = Math.max(1, size);
  }
}

export class DebouncedUpdater {
  private updateTracker: UpdateTracker;
  private callback: (batch: UpdateBatch) => void;
  private timeoutId: number | null = null;
  private delay: number;
  private isScheduled = false;

  constructor(callback: (batch: UpdateBatch) => void, delay = 16) {
    this.updateTracker = new UpdateTracker();
    this.callback = callback;
    this.delay = delay;
  }

  trackNode(node: SceneNode): void {
    this.updateTracker.trackNode(node);
    this.schedule();
  }

  trackEdge(edge: SceneEdge): void {
    this.updateTracker.trackEdge(edge);
    this.schedule();
  }

  trackSubgraph(subgraph: SceneSubgraph): void {
    this.updateTracker.trackSubgraph(subgraph);
    this.schedule();
  }

  trackDeletedNode(nodeId: string): void {
    this.updateTracker.trackDeletedNode(nodeId);
    this.schedule();
  }

  trackDeletedEdge(edgeId: string): void {
    this.updateTracker.trackDeletedEdge(edgeId);
    this.schedule();
  }

  trackDeletedSubgraph(subgraphId: string): void {
    this.updateTracker.trackDeletedSubgraph(subgraphId);
    this.schedule();
  }

  trackViewport(x: number, y: number, zoom: number): void {
    this.updateTracker.trackViewport(x, y, zoom);
    this.schedule();
  }

  private schedule(): void {
    if (this.isScheduled) return;

    this.isScheduled = true;
    this.timeoutId = window.setTimeout(() => {
      this.flush();
    }, this.delay);
  }

  flush(): void {
    this.isScheduled = false;

    const batch = this.updateTracker.getBatch();
    if (batch) {
      this.callback(batch);
    }

    if (this.updateTracker.getPendingCount() > 0) {
      this.schedule();
    }
  }

  clear(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.isScheduled = false;
    this.updateTracker.clear();
  }

  setDelay(delay: number): void {
    this.delay = delay;
    if (this.isScheduled && this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.isScheduled = false;
      this.schedule();
    }
  }
}