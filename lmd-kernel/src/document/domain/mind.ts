export interface MindNodeIR {
  id: string;
  title: string;
  comment?: string;
  children: MindNodeIR[];
}

export interface MindMapIR {
  id: string;
  title: string;
  children: MindNodeIR[];
}

export interface MindIR {
  maps: MindMapIR[];
}

export function emptyMind(): MindIR {
  return { maps: [] };
}

export function flattenMindNodes(nodes: MindNodeIR[]): MindNodeIR[] {
  const rows: MindNodeIR[] = [];
  const visit = (items: MindNodeIR[]) => {
    for (const item of items) {
      rows.push(item);
      visit(item.children);
    }
  };
  visit(nodes);
  return rows;
}

export function findMindNode(nodes: MindNodeIR[], nodeId: string): MindNodeIR | null {
  for (const item of nodes) {
    if (item.id === nodeId) {
      return item;
    }
    const nested = findMindNode(item.children, nodeId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export function mapMindNodes(
  nodes: MindNodeIR[],
  update: (node: MindNodeIR) => MindNodeIR | null,
): MindNodeIR[] {
  const next: MindNodeIR[] = [];
  for (const item of nodes) {
    const mapped = update({
      ...item,
      children: mapMindNodes(item.children, update),
    });
    if (mapped) {
      next.push(mapped);
    }
  }
  return next;
}
