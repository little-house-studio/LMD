export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface QuadtreeItem {
  id: string;
  rect: Rect;
  data?: unknown;
}

interface QuadtreeNode {
  rect: Rect;
  items: QuadtreeItem[];
  children: QuadtreeNode[];
  depth: number;
}

export class Quadtree {
  private root: QuadtreeNode;
  private maxItems: number;
  private maxDepth: number;
  private itemCount: number;

  constructor(bounds: Rect, maxItems = 8, maxDepth = 8) {
    this.root = {
      rect: bounds,
      items: [],
      children: [],
      depth: 0,
    };
    this.maxItems = maxItems;
    this.maxDepth = maxDepth;
    this.itemCount = 0;
  }

  insert(item: QuadtreeItem): void {
    this.insertNode(this.root, item);
  }

  private insertNode(node: QuadtreeNode, item: QuadtreeItem): void {
    if (node.children.length > 0) {
      const index = this.getChildIndex(node, item.rect);
      if (index !== -1) {
        this.insertNode(node.children[index], item);
        return;
      }
    }

    node.items.push(item);
    this.itemCount++;

    if (node.items.length > this.maxItems && node.depth < this.maxDepth) {
      this.split(node);
      this.reinsertItems(node);
    }
  }

  private split(node: QuadtreeNode): void {
    const { x, y, width, height } = node.rect;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const depth = node.depth + 1;

    node.children = [
      { rect: { x, y, width: halfWidth, height: halfHeight }, items: [], children: [], depth },
      { rect: { x: x + halfWidth, y, width: halfWidth, height: halfHeight }, items: [], children: [], depth },
      { rect: { x, y: y + halfHeight, width: halfWidth, height: halfHeight }, items: [], children: [], depth },
      { rect: { x: x + halfWidth, y: y + halfHeight, width: halfWidth, height: halfHeight }, items: [], children: [], depth },
    ];
  }

  private reinsertItems(node: QuadtreeNode): void {
    const items = node.items;
    node.items = [];

    for (const item of items) {
      const index = this.getChildIndex(node, item.rect);
      if (index !== -1) {
        this.insertNode(node.children[index], item);
      } else {
        node.items.push(item);
      }
    }
  }

  private getChildIndex(node: QuadtreeNode, rect: Rect): number {
    const { x, y, width, height } = node.rect;
    const midX = x + width / 2;
    const midY = y + height / 2;

    const left = rect.x + rect.width <= midX;
    const right = rect.x >= midX;
    const top = rect.y + rect.height <= midY;
    const bottom = rect.y >= midY;

    if (top) {
      if (left) return 0;
      if (right) return 1;
    }
    if (bottom) {
      if (left) return 2;
      if (right) return 3;
    }

    return -1;
  }

  query(queryRect: Rect): QuadtreeItem[] {
    const results: QuadtreeItem[] = [];
    this.queryNode(this.root, queryRect, results);
    return results;
  }

  private queryNode(node: QuadtreeNode, queryRect: Rect, results: QuadtreeItem[]): void {
    if (!this.intersects(node.rect, queryRect)) {
      return;
    }

    for (const item of node.items) {
      if (this.intersects(item.rect, queryRect)) {
        results.push(item);
      }
    }

    for (const child of node.children) {
      this.queryNode(child, queryRect, results);
    }
  }

  private intersects(a: Rect, b: Rect): boolean {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  queryPoint(point: Point): QuadtreeItem[] {
    const results: QuadtreeItem[] = [];
    this.queryPointNode(this.root, point, results);
    return results;
  }

  private queryPointNode(node: QuadtreeNode, point: Point, results: QuadtreeItem[]): void {
    if (!this.pointInRect(point, node.rect)) {
      return;
    }

    for (const item of node.items) {
      if (this.pointInRect(point, item.rect)) {
        results.push(item);
      }
    }

    for (const child of node.children) {
      this.queryPointNode(child, point, results);
    }
  }

  private pointInRect(point: Point, rect: Rect): boolean {
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
  }

  remove(id: string): boolean {
    return this.removeNode(this.root, id);
  }

  private removeNode(node: QuadtreeNode, id: string): boolean {
    const index = node.items.findIndex(item => item.id === id);
    if (index !== -1) {
      node.items.splice(index, 1);
      this.itemCount--;
      return true;
    }

    for (const child of node.children) {
      if (this.removeNode(child, id)) {
        return true;
      }
    }

    return false;
  }

  update(id: string, newRect: Rect): boolean {
    if (this.remove(id)) {
      this.insert({ id, rect: newRect });
      return true;
    }
    return false;
  }

  clear(): void {
    this.root = {
      rect: this.root.rect,
      items: [],
      children: [],
      depth: 0,
    };
    this.itemCount = 0;
  }

  resize(newBounds: Rect): void {
    const items = this.query(this.root.rect);
    this.root = {
      rect: newBounds,
      items: [],
      children: [],
      depth: 0,
    };
    this.itemCount = 0;
    for (const item of items) {
      this.insert(item);
    }
  }

  getCount(): number {
    return this.itemCount;
  }

  getStats(): { nodes: number; items: number; depth: number } {
    let nodes = 0;
    let items = 0;
    let maxDepth = 0;

    const traverse = (node: QuadtreeNode) => {
      nodes++;
      items += node.items.length;
      maxDepth = Math.max(maxDepth, node.depth);
      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(this.root);
    return { nodes, items, depth: maxDepth };
  }

  getAllItems(): QuadtreeItem[] {
    const results: QuadtreeItem[] = [];
    const traverse = (node: QuadtreeNode) => {
      results.push(...node.items);
      for (const child of node.children) {
        traverse(child);
      }
    };
    traverse(this.root);
    return results;
  }
}