export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface NodeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  textColor: string;
  shape: 'rect' | 'round' | 'circle' | 'diamond' | 'hexagon' | 'database' | 'subroutine';
}

export interface SceneNode {
  id: string;
  type: 'node' | 'edge' | 'subgraph' | 'content';
  transform: Transform;
  width: number;
  height: number;
  style: NodeStyle;
  label: string;
  description?: string;
  subgraphId?: string | null;
  visible: boolean;
}

export interface SceneEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  type: 'line' | 'arrow' | 'dotted' | 'thick';
  strokeColor: string;
  strokeWidth: number;
}

export interface SceneSubgraph {
  id: string;
  title: string;
  parentId?: string | null;
  collapsed: boolean;
  visible: boolean;
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export class SceneGraph {
  private nodes = new Map<string, SceneNode>();
  private edges = new Map<string, SceneEdge>();
  private subgraphs = new Map<string, SceneSubgraph>();
  private nodeSubgraphMap = new Map<string, string | null>();
  private subgraphChildren = new Map<string, Set<string>>();

  addNode(node: SceneNode): void {
    this.nodes.set(node.id, node);
    this.updateNodeSubgraph(node.id, node.subgraphId);
  }

  removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      this.updateNodeSubgraph(nodeId, null);
    }
    this.nodes.delete(nodeId);
  }

  getNode(nodeId: string): SceneNode | undefined {
    return this.nodes.get(nodeId);
  }

  getAllNodes(): SceneNode[] {
    return Array.from(this.nodes.values());
  }

  addEdge(edge: SceneEdge): void {
    this.edges.set(edge.id, edge);
  }

  removeEdge(edgeId: string): void {
    this.edges.delete(edgeId);
  }

  getAllEdges(): SceneEdge[] {
    return Array.from(this.edges.values());
  }

  addSubgraph(subgraph: SceneSubgraph): void {
    this.subgraphs.set(subgraph.id, subgraph);
    if (!this.subgraphChildren.has(subgraph.id)) {
      this.subgraphChildren.set(subgraph.id, new Set());
    }
    if (subgraph.parentId) {
      const parentChildren = this.subgraphChildren.get(subgraph.parentId) || new Set();
      parentChildren.add(subgraph.id);
      this.subgraphChildren.set(subgraph.parentId, parentChildren);
    }
  }

  removeSubgraph(subgraphId: string): void {
    const children = this.subgraphChildren.get(subgraphId) || new Set();
    children.forEach(childId => this.removeSubgraph(childId));
    this.nodes.forEach((node, nodeId) => {
      if (node.subgraphId === subgraphId) {
        this.updateNodeSubgraph(nodeId, null);
        node.subgraphId = null;
      }
    });
    this.subgraphs.delete(subgraphId);
    this.subgraphChildren.delete(subgraphId);
    const parentId = this.subgraphs.get(subgraphId)?.parentId;
    if (parentId) {
      this.subgraphChildren.get(parentId)?.delete(subgraphId);
    }
  }

  getAllSubgraphs(): SceneSubgraph[] {
    return Array.from(this.subgraphs.values());
  }

  private updateNodeSubgraph(nodeId: string, subgraphId: string | null): void {
    const oldSubgraphId = this.nodeSubgraphMap.get(nodeId);
    if (oldSubgraphId) {
      this.subgraphChildren.get(oldSubgraphId)?.delete(nodeId);
    }
    if (subgraphId) {
      const children = this.subgraphChildren.get(subgraphId) || new Set();
      children.add(nodeId);
      this.subgraphChildren.set(subgraphId, children);
    }
    this.nodeSubgraphMap.set(nodeId, subgraphId);
  }

  getNodesInSubgraph(subgraphId: string): SceneNode[] {
    const children = this.subgraphChildren.get(subgraphId) || new Set();
    return Array.from(children)
      .map(id => this.nodes.get(id))
      .filter((node): node is SceneNode => node !== undefined);
  }

  getSubgraphAncestry(subgraphId: string): string[] {
    const ancestry: string[] = [];
    let current = this.subgraphs.get(subgraphId)?.parentId;
    while (current) {
      ancestry.unshift(current);
      current = this.subgraphs.get(current)?.parentId;
    }
    return ancestry;
  }

  getVisibleNodes(viewRect?: { x: number; y: number; width: number; height: number }): SceneNode[] {
    return this.getAllNodes().filter(node => {
      if (!node.visible) return false;
      if (!viewRect) return true;
      return (
        node.transform.x < viewRect.x + viewRect.width &&
        node.transform.x + node.width > viewRect.x &&
        node.transform.y < viewRect.y + viewRect.height &&
        node.transform.y + node.height > viewRect.y
      );
    });
  }

  getEdgesForNodes(nodeIds: Set<string>): SceneEdge[] {
    return this.getAllEdges().filter(edge => 
      nodeIds.has(edge.from) && nodeIds.has(edge.to)
    );
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.subgraphs.clear();
    this.nodeSubgraphMap.clear();
    this.subgraphChildren.clear();
  }

  getNodeCount(): number {
    return this.nodes.size;
  }

  getEdgeCount(): number {
    return this.edges.size;
  }
}