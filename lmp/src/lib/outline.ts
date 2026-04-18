export type NodeColor = 'amber' | 'sage' | 'sky' | 'teal' | 'violet' | 'rose' | 'coral' | 'slate';
export type DropPosition = 'child' | 'before' | 'after';
export type LayoutMode = 'balanced' | 'right' | 'down';

export interface OutlineNode {
  id: string;
  text: string;
  color: NodeColor | null;
  children: OutlineNode[];
}

export interface ParsedOutline {
  roots: OutlineNode[];
  warnings: string[];
  layoutMode: LayoutMode;
}

export interface NodeBox {
  id: string;
  text: string;
  color: NodeColor | null;
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

interface OutlineMetadata {
  version: number;
  layoutMode?: LayoutMode;
  nodes: Record<string, { color?: NodeColor | null }>;
}

export const DEFAULT_LMP_DOCUMENT = [
  '├── Little House Markmap',
  '│   ├── Topics',
  '│   │   ├── Notes',
  '│   │   └── Decisions',
  '│   └── Tasks',
  '│       ├── Draft outline',
  '│       └── Review branches',
  '└── Archive',
  '    └── References',
].join('\n');

const META_MARKER = '<!-- lmp:meta';
const VALID_COLORS = new Set<NodeColor>(['amber', 'sage', 'sky', 'teal', 'violet', 'rose', 'coral', 'slate']);
const ROOT_CHILD_COLOR_SEQUENCE: NodeColor[] = ['amber', 'sky', 'rose', 'teal', 'violet', 'sage', 'coral', 'slate'];

let nodeSerial = 0;

function slugify(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'topic';
}

function normalizeNodeColor(value: unknown): NodeColor | null {
  return typeof value === 'string' && VALID_COLORS.has(value as NodeColor)
    ? value as NodeColor
    : null;
}

function normalizeLayoutMode(value: unknown): LayoutMode {
  return value === 'right' || value === 'down' ? value : 'balanced';
}

function encodeNodeText(text: string) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n');
}

function decodeNodeText(text: string) {
  let result = '';
  for (let index = 0; index < text.length; index += 1) {
    const current = text[index];
    if (current !== '\\') {
      result += current;
      continue;
    }

    const next = text[index + 1];
    if (next === 'n') {
      result += '\n';
      index += 1;
      continue;
    }
    if (next === '\\') {
      result += '\\';
      index += 1;
      continue;
    }
    if (next) {
      result += next;
      index += 1;
      continue;
    }
    result += current;
  }
  return result;
}

function splitVisualLines(text: string, maxChars = 14) {
  const sourceLines = (text.trim() || 'Topic').split('\n');
  return sourceLines.flatMap((line) => {
    const chunks = line.match(new RegExp(`.{1,${maxChars}}`, 'gu'));
    return chunks && chunks.length > 0 ? chunks : [' '];
  });
}

function extractOutlineMetadata(source: string): { outlineSource: string; metadata: OutlineMetadata | null } {
  const normalized = source.replace(/\r\n/g, '\n');
  const markerIndex = normalized.lastIndexOf(META_MARKER);
  if (markerIndex < 0) {
    return {
      outlineSource: normalized.trim(),
      metadata: null,
    };
  }

  const commentStart = normalized.lastIndexOf('\n', markerIndex);
  const sliceIndex = commentStart >= 0 ? commentStart + 1 : markerIndex;
  const commentBlock = normalized.slice(sliceIndex).trim();
  if (!commentBlock.startsWith(META_MARKER) || !commentBlock.endsWith('-->')) {
    return {
      outlineSource: normalized.trim(),
      metadata: null,
    };
  }

  const jsonSource = commentBlock
    .replace(/^<!--\s*lmp:meta\s*/u, '')
    .replace(/\s*-->$/u, '')
    .trim();

  try {
    const parsed = JSON.parse(jsonSource) as OutlineMetadata;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.nodes !== 'object') {
      throw new Error('invalid metadata');
    }
    return {
      outlineSource: normalized.slice(0, sliceIndex).trim(),
      metadata: parsed,
    };
  } catch {
    return {
      outlineSource: normalized.trim(),
      metadata: null,
    };
  }
}

export function createNode(text = 'New Topic', color: NodeColor | null = null): OutlineNode {
  nodeSerial += 1;
  return {
    id: `${slugify(text)}-${nodeSerial.toString(36)}`,
    text,
    color,
    children: [],
  };
}

export function cloneRoots(roots: OutlineNode[]) {
  return roots.map((root) => cloneNode(root));
}

function cloneNode(node: OutlineNode): OutlineNode {
  return {
    id: node.id,
    text: node.text,
    color: node.color,
    children: node.children.map((child) => cloneNode(child)),
  };
}

function applyColorToBranch(node: OutlineNode, color: NodeColor | null) {
  node.color = color;
  node.children.forEach((child) => applyColorToBranch(child, color));
}

function resolveFirstLevelColor(siblings: OutlineNode[]) {
  const usedColors = new Set(
    siblings
      .map((node) => node.color)
      .filter((color): color is NodeColor => color !== null),
  );

  const unusedColor = ROOT_CHILD_COLOR_SEQUENCE.find((color) => !usedColors.has(color));
  if (unusedColor) {
    return unusedColor;
  }

  return ROOT_CHILD_COLOR_SEQUENCE[siblings.length % ROOT_CHILD_COLOR_SEQUENCE.length];
}

function resolveReparentedColor(
  parent: OutlineNode | null,
  parentDepth: number,
  siblings: OutlineNode[],
  movedNode: OutlineNode,
) {
  if (!parent) {
    return movedNode.color;
  }

  if (parentDepth === 0) {
    const otherSiblings = siblings.filter((node) => node.id !== movedNode.id);
    return movedNode.color ?? resolveFirstLevelColor(otherSiblings);
  }

  return parent.color;
}

function getNodeMetrics(text: string) {
  const lines = splitVisualLines(text);
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 5);
  return {
    width: Math.min(360, Math.max(148, 50 + longest * 12)),
    height: 36 + lines.length * 24,
  };
}

function getPath(roots: OutlineNode[], targetId: string, prefix: number[] = []): number[] | null {
  for (let index = 0; index < roots.length; index += 1) {
    const node = roots[index];
    const path = [...prefix, index];
    if (node.id === targetId) {
      return path;
    }
    const childPath = getPath(node.children, targetId, path);
    if (childPath) {
      return childPath;
    }
  }
  return null;
}

function getNodeAtPath(roots: OutlineNode[], path: number[]) {
  let currentList = roots;
  let currentNode: OutlineNode | null = null;
  for (const index of path) {
    currentNode = currentList[index] ?? null;
    if (!currentNode) {
      return null;
    }
    currentList = currentNode.children;
  }
  return currentNode;
}

function getListAtPath(roots: OutlineNode[], path: number[]) {
  if (path.length === 0) {
    return roots;
  }
  const parent = getNodeAtPath(roots, path.slice(0, -1));
  return parent?.children ?? null;
}

function comparePaths(left: number[], right: number[]) {
  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return left.length - right.length;
}

function isAncestorPath(ancestor: number[], descendant: number[]) {
  if (ancestor.length >= descendant.length) {
    return false;
  }
  return ancestor.every((segment, index) => descendant[index] === segment);
}

function parseLine(rawLine: string) {
  const line = rawLine.replace(/\t/g, '    ');
  const match = line.match(/^((?:(?:│   )|(?:    ))*)(?:├── |└── )?(.*)$/u);
  if (!match) {
    return {
      depth: 0,
      text: rawLine.trim(),
    };
  }

  const prefix = match[1] ?? '';
  const text = (match[2] ?? '').trim();
  return {
    depth: prefix.length / 4,
    text: decodeNodeText(text || 'Topic'),
  };
}

export function parseOutline(source: string): ParsedOutline {
  const { outlineSource, metadata } = extractOutlineMetadata(source);
  const layoutMode = normalizeLayoutMode(metadata?.layoutMode);
  const lines = outlineSource
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return {
      roots: [createNode('Central Topic')],
      warnings: [],
      layoutMode,
    };
  }

  const warnings: string[] = [];
  const roots: OutlineNode[] = [];
  const nodeStack: OutlineNode[] = [];
  const pathStack: string[] = [];

  lines.forEach((line) => {
    const parsed = parseLine(line);
    const depth = Math.max(0, Math.floor(parsed.depth));

    if (depth > nodeStack.length) {
      warnings.push(`Skipped malformed tree indentation: ${line}`);
      return;
    }

    while (nodeStack.length > depth) {
      nodeStack.pop();
      pathStack.pop();
    }

    const siblings = depth === 0 ? roots : nodeStack[depth - 1]?.children;
    if (!siblings) {
      warnings.push(`Skipped malformed tree indentation: ${line}`);
      return;
    }

    const index = siblings.length;
    const path = depth === 0 ? `${index}` : `${pathStack[depth - 1]}.${index}`;
    const node = createNode(
      parsed.text,
      normalizeNodeColor(metadata?.nodes?.[path]?.color),
    );

    siblings.push(node);
    nodeStack[depth] = node;
    pathStack[depth] = path;
    nodeStack.length = depth + 1;
    pathStack.length = depth + 1;
  });

  return {
    roots: roots.length > 0 ? roots : [createNode('Central Topic')],
    warnings,
    layoutMode,
  };
}

function serializeNode(
  node: OutlineNode,
  prefix: string,
  isLast: boolean,
  path: string,
  lines: string[],
  metadataNodes: OutlineMetadata['nodes'],
) {
  const text = encodeNodeText(node.text.trim() || 'Topic');
  lines.push(`${prefix}${isLast ? '└── ' : '├── '}${text}`);

  if (node.color) {
    metadataNodes[path] = { color: node.color };
  }

  const childPrefix = `${prefix}${isLast ? '    ' : '│   '}`;
  node.children.forEach((child, index) => {
    serializeNode(
      child,
      childPrefix,
      index === node.children.length - 1,
      `${path}.${index}`,
      lines,
      metadataNodes,
    );
  });
}

export function serializeOutline(roots: OutlineNode[], options?: { layoutMode?: LayoutMode }) {
  const lines: string[] = [];
  const metadataNodes: OutlineMetadata['nodes'] = {};

  roots.forEach((root, index) => {
    serializeNode(root, '', index === roots.length - 1, `${index}`, lines, metadataNodes);
  });

  const outline = lines.join('\n');
  const layoutMode = options?.layoutMode ?? 'balanced';
  if (Object.keys(metadataNodes).length === 0 && layoutMode === 'balanced') {
    return outline;
  }

  return [
    outline,
    '',
    META_MARKER,
    JSON.stringify({
      version: 1,
      layoutMode,
      nodes: metadataNodes,
    }, null, 2),
    '-->',
  ].join('\n');
}

export function updateNodeText(roots: OutlineNode[], nodeId: string, text: string) {
  const nextRoots = cloneRoots(roots);
  const path = getPath(nextRoots, nodeId);
  if (!path) {
    return nextRoots;
  }
  const node = getNodeAtPath(nextRoots, path);
  if (node) {
    node.text = text;
  }
  return nextRoots;
}

export function updateNodeColors(roots: OutlineNode[], nodeIds: string[], color: NodeColor | null) {
  const nextRoots = cloneRoots(roots);
  const targetIds = new Set(nodeIds);

  const visit = (nodes: OutlineNode[]) => {
    nodes.forEach((node) => {
      if (targetIds.has(node.id)) {
        applyColorToBranch(node, color);
        return;
      }
      visit(node.children);
    });
  };

  visit(nextRoots);
  return nextRoots;
}

export function addRootNode(roots: OutlineNode[], text = 'New Root') {
  const nextRoots = cloneRoots(roots);
  const node = createNode(text);
  nextRoots.push(node);
  return {
    roots: nextRoots,
    nodeId: node.id,
  };
}

export function addChildNode(roots: OutlineNode[], parentId: string, text = 'New Topic') {
  const nextRoots = cloneRoots(roots);
  const path = getPath(nextRoots, parentId);
  if (!path) {
    return {
      roots: nextRoots,
      nodeId: null,
    };
  }
  const parent = getNodeAtPath(nextRoots, path);
  if (!parent) {
    return {
      roots: nextRoots,
      nodeId: null,
    };
  }
  const childColor = path.length === 1
    ? resolveFirstLevelColor(parent.children)
    : parent.color;
  const child = createNode(text, childColor);
  parent.children.push(child);
  return {
    roots: nextRoots,
    nodeId: child.id,
  };
}

export function addSiblingNode(roots: OutlineNode[], nodeId: string, text = 'New Topic') {
  const nextRoots = cloneRoots(roots);
  const path = getPath(nextRoots, nodeId);
  if (!path) {
    return {
      roots: nextRoots,
      nodeId: null,
    };
  }
  const siblings = getListAtPath(nextRoots, path);
  const index = path[path.length - 1];
  if (!siblings || index === undefined) {
    return {
      roots: nextRoots,
      nodeId: null,
    };
  }
  const parent = path.length > 1 ? getNodeAtPath(nextRoots, path.slice(0, -1)) : null;
  const current = getNodeAtPath(nextRoots, path);
  const siblingColor = path.length === 2
    ? resolveFirstLevelColor(siblings)
    : parent?.color ?? current?.color ?? null;
  const sibling = createNode(text, siblingColor);
  siblings.splice(index + 1, 0, sibling);
  return {
    roots: nextRoots,
    nodeId: sibling.id,
  };
}

export function deleteNode(roots: OutlineNode[], nodeId: string) {
  const nextRoots = cloneRoots(roots);
  const path = getPath(nextRoots, nodeId);
  if (!path) {
    return {
      roots: nextRoots,
      nextSelectedId: nextRoots[0]?.id ?? null,
    };
  }

  const siblings = getListAtPath(nextRoots, path);
  const index = path[path.length - 1];
  if (!siblings || index === undefined) {
    return {
      roots: nextRoots,
      nextSelectedId: nextRoots[0]?.id ?? null,
    };
  }

  siblings.splice(index, 1);

  if (nextRoots.length === 0) {
    const fallback = createNode('Central Topic');
    nextRoots.push(fallback);
    return {
      roots: nextRoots,
      nextSelectedId: fallback.id,
    };
  }

  const fallback =
    siblings[index]?.id ??
    siblings[index - 1]?.id ??
    getNodeAtPath(nextRoots, path.slice(0, -1))?.id ??
    nextRoots[0]?.id ??
    null;

  return {
    roots: nextRoots,
    nextSelectedId: fallback,
  };
}

export function deleteNodes(roots: OutlineNode[], nodeIds: string[]) {
  let nextRoots = cloneRoots(roots);
  const sortedIds = [...new Set(nodeIds)].sort((left, right) => {
    const leftPath = getPath(nextRoots, left);
    const rightPath = getPath(nextRoots, right);
    return (rightPath?.length ?? 0) - (leftPath?.length ?? 0);
  });

  let nextSelectedId: string | null = nextRoots[0]?.id ?? null;
  sortedIds.forEach((nodeId) => {
    const result = deleteNode(nextRoots, nodeId);
    nextRoots = result.roots;
    nextSelectedId = result.nextSelectedId;
  });

  return {
    roots: nextRoots,
    nextSelectedId,
  };
}

export function moveNodeUp(roots: OutlineNode[], nodeId: string) {
  const nextRoots = cloneRoots(roots);
  const path = getPath(nextRoots, nodeId);
  if (!path) {
    return nextRoots;
  }
  const siblings = getListAtPath(nextRoots, path);
  const index = path[path.length - 1];
  if (!siblings || index === undefined || index <= 0) {
    return nextRoots;
  }
  [siblings[index - 1], siblings[index]] = [siblings[index], siblings[index - 1]];
  return nextRoots;
}

export function moveNodeDown(roots: OutlineNode[], nodeId: string) {
  const nextRoots = cloneRoots(roots);
  const path = getPath(nextRoots, nodeId);
  if (!path) {
    return nextRoots;
  }
  const siblings = getListAtPath(nextRoots, path);
  const index = path[path.length - 1];
  if (!siblings || index === undefined || index >= siblings.length - 1) {
    return nextRoots;
  }
  [siblings[index], siblings[index + 1]] = [siblings[index + 1], siblings[index]];
  return nextRoots;
}

export function indentNode(roots: OutlineNode[], nodeId: string) {
  const nextRoots = cloneRoots(roots);
  const path = getPath(nextRoots, nodeId);
  if (!path) {
    return nextRoots;
  }
  const siblings = getListAtPath(nextRoots, path);
  const index = path[path.length - 1];
  if (!siblings || index === undefined || index <= 0) {
    return nextRoots;
  }
  const [node] = siblings.splice(index, 1);
  const nextParent = siblings[index - 1];
  applyColorToBranch(
    node,
    resolveReparentedColor(nextParent, path.length - 1, nextParent.children, node),
  );
  nextParent.children.push(node);
  return nextRoots;
}

export function outdentNode(roots: OutlineNode[], nodeId: string) {
  const nextRoots = cloneRoots(roots);
  const path = getPath(nextRoots, nodeId);
  if (!path || path.length <= 1) {
    return nextRoots;
  }
  const siblings = getListAtPath(nextRoots, path);
  const index = path[path.length - 1];
  const parentPath = path.slice(0, -1);
  const parentSiblings = getListAtPath(nextRoots, parentPath);
  const parentIndex = parentPath[parentPath.length - 1];
  if (!siblings || !parentSiblings || index === undefined || parentIndex === undefined) {
    return nextRoots;
  }
  const [node] = siblings.splice(index, 1);
  const nextParent = parentPath.length > 1 ? getNodeAtPath(nextRoots, parentPath.slice(0, -1)) : null;
  applyColorToBranch(
    node,
    resolveReparentedColor(nextParent, parentPath.length - 1, parentSiblings, node),
  );
  parentSiblings.splice(parentIndex + 1, 0, node);
  return nextRoots;
}

export function getNodeById(roots: OutlineNode[], nodeId: string | null) {
  if (!nodeId) {
    return null;
  }
  const path = getPath(roots, nodeId);
  if (!path) {
    return null;
  }
  return getNodeAtPath(roots, path);
}

export function getNodeBranchIds(roots: OutlineNode[], nodeId: string) {
  const target = getNodeById(roots, nodeId);
  if (!target) {
    return new Set<string>();
  }

  const ids = new Set<string>();
  const visit = (node: OutlineNode) => {
    ids.add(node.id);
    node.children.forEach((child) => visit(child));
  };
  visit(target);
  return ids;
}

export function getMovableNodeIds(roots: OutlineNode[], nodeIds: string[]) {
  const entries = [...new Set(nodeIds)]
    .map((nodeId) => {
      const path = getPath(roots, nodeId);
      return path ? { nodeId, path } : null;
    })
    .filter((entry): entry is { nodeId: string; path: number[] } => Boolean(entry))
    .sort((left, right) => comparePaths(left.path, right.path));

  return entries
    .filter((entry, index) => !entries.some((candidate, candidateIndex) => (
      candidateIndex !== index && isAncestorPath(candidate.path, entry.path)
    )))
    .map((entry) => entry.nodeId);
}

export function moveNode(roots: OutlineNode[], nodeId: string, targetId: string, position: DropPosition) {
  if (nodeId === targetId) {
    return roots;
  }

  const invalidTargets = getNodeBranchIds(roots, nodeId);
  if (invalidTargets.has(targetId)) {
    return roots;
  }

  const nextRoots = cloneRoots(roots);
  const sourcePath = getPath(nextRoots, nodeId);
  if (!sourcePath) {
    return nextRoots;
  }

  const sourceSiblings = getListAtPath(nextRoots, sourcePath);
  const sourceIndex = sourcePath[sourcePath.length - 1];
  if (!sourceSiblings || sourceIndex === undefined) {
    return nextRoots;
  }

  const [movedNode] = sourceSiblings.splice(sourceIndex, 1);
  if (!movedNode) {
    return nextRoots;
  }

  const targetPath = getPath(nextRoots, targetId);
  if (!targetPath) {
    sourceSiblings.splice(sourceIndex, 0, movedNode);
    return nextRoots;
  }

  if (position === 'child') {
    const target = getNodeAtPath(nextRoots, targetPath);
    if (!target) {
      sourceSiblings.splice(sourceIndex, 0, movedNode);
      return nextRoots;
    }
    applyColorToBranch(
      movedNode,
      resolveReparentedColor(target, targetPath.length - 1, target.children, movedNode),
    );
    target.children.push(movedNode);
    return nextRoots;
  }

  const targetSiblings = getListAtPath(nextRoots, targetPath);
  const targetIndex = targetPath[targetPath.length - 1];
  if (!targetSiblings || targetIndex === undefined) {
    sourceSiblings.splice(sourceIndex, 0, movedNode);
    return nextRoots;
  }

  const insertionIndex = position === 'before' ? targetIndex : targetIndex + 1;
  const nextParent = targetPath.length > 1 ? getNodeAtPath(nextRoots, targetPath.slice(0, -1)) : null;
  applyColorToBranch(
    movedNode,
    resolveReparentedColor(nextParent, targetPath.length - 2, targetSiblings, movedNode),
  );
  targetSiblings.splice(insertionIndex, 0, movedNode);
  return nextRoots;
}

export function moveNodes(roots: OutlineNode[], nodeIds: string[], targetId: string, position: DropPosition) {
  const movableIds = getMovableNodeIds(roots, nodeIds);
  if (movableIds.length === 0) {
    return roots;
  }
  if (movableIds.length === 1) {
    return moveNode(roots, movableIds[0], targetId, position);
  }

  const invalidTargets = new Set<string>();
  movableIds.forEach((nodeId) => {
    getNodeBranchIds(roots, nodeId).forEach((branchId) => invalidTargets.add(branchId));
  });
  if (invalidTargets.has(targetId)) {
    return roots;
  }

  const nextRoots = cloneRoots(roots);
  const sourceEntries = movableIds
    .map((nodeId) => {
      const path = getPath(nextRoots, nodeId);
      return path ? { nodeId, path } : null;
    })
    .filter((entry): entry is { nodeId: string; path: number[] } => Boolean(entry))
    .sort((left, right) => comparePaths(left.path, right.path));

  const removedById = new Map<string, OutlineNode>();
  [...sourceEntries]
    .sort((left, right) => comparePaths(right.path, left.path))
    .forEach((entry) => {
      const siblings = getListAtPath(nextRoots, entry.path);
      const index = entry.path[entry.path.length - 1];
      if (!siblings || index === undefined) {
        return;
      }
      const [removedNode] = siblings.splice(index, 1);
      if (removedNode) {
        removedById.set(entry.nodeId, removedNode);
      }
    });

  const movedNodes = sourceEntries
    .map((entry) => removedById.get(entry.nodeId))
    .filter((node): node is OutlineNode => Boolean(node));
  if (movedNodes.length === 0) {
    return roots;
  }

  const targetPath = getPath(nextRoots, targetId);
  if (!targetPath) {
    return roots;
  }

  if (position === 'child') {
    const target = getNodeAtPath(nextRoots, targetPath);
    if (!target) {
      return roots;
    }

    movedNodes.forEach((movedNode) => {
      applyColorToBranch(
        movedNode,
        resolveReparentedColor(target, targetPath.length - 1, target.children, movedNode),
      );
      target.children.push(movedNode);
    });
    return nextRoots;
  }

  const targetSiblings = getListAtPath(nextRoots, targetPath);
  const targetIndex = targetPath[targetPath.length - 1];
  if (!targetSiblings || targetIndex === undefined) {
    return roots;
  }

  const nextParent = targetPath.length > 1 ? getNodeAtPath(nextRoots, targetPath.slice(0, -1)) : null;
  let insertionIndex = position === 'before' ? targetIndex : targetIndex + 1;
  movedNodes.forEach((movedNode) => {
    applyColorToBranch(
      movedNode,
      resolveReparentedColor(nextParent, targetPath.length - 2, targetSiblings, movedNode),
    );
    targetSiblings.splice(insertionIndex, 0, movedNode);
    insertionIndex += 1;
  });
  return nextRoots;
}

function getBranchHeight(node: OutlineNode): number {
  const metrics = getNodeMetrics(node.text);
  if (node.children.length === 0) {
    return metrics.height;
  }
  const childrenHeight = node.children.reduce((sum, child, index) => {
    const childHeight = getBranchHeight(child);
    return sum + childHeight + (index > 0 ? 26 : 0);
  }, 0);
  return Math.max(metrics.height, childrenHeight);
}

function getSideHeight(children: OutlineNode[]) {
  if (children.length === 0) {
    return 0;
  }
  return children.reduce((sum, child, index) => {
    const childHeight = getBranchHeight(child);
    return sum + childHeight + (index > 0 ? 34 : 0);
  }, 0);
}

function getDownBranchWidth(node: OutlineNode): number {
  const metrics = getNodeMetrics(node.text);
  if (node.children.length === 0) {
    return metrics.width;
  }

  const childrenWidth = node.children.reduce((sum, child, index) => {
    const childWidth = getDownBranchWidth(child);
    return sum + childWidth + (index > 0 ? 42 : 0);
  }, 0);

  return Math.max(metrics.width, childrenWidth);
}

function getDownBranchHeight(node: OutlineNode): number {
  const metrics = getNodeMetrics(node.text);
  if (node.children.length === 0) {
    return metrics.height;
  }

  const tallestChild = node.children.reduce((max, child) => {
    return Math.max(max, getDownBranchHeight(child));
  }, 0);

  return metrics.height + 110 + tallestChild;
}

function placeBranch(
  node: OutlineNode,
  parentId: string,
  x: number,
  centerY: number,
  depth: number,
  direction: 1 | -1,
  placed: NodeBox[],
) {
  const metrics = getNodeMetrics(node.text);
  placed.push({
    id: node.id,
    text: node.text,
    color: node.color,
    parentId,
    x,
    y: centerY,
    width: metrics.width,
    height: metrics.height,
    depth,
  });

  if (node.children.length === 0) {
    return;
  }

  const totalHeight = getSideHeight(node.children);
  let cursor = centerY - totalHeight / 2;

  node.children.forEach((child) => {
    const childHeight = getBranchHeight(child);
    const childMetrics = getNodeMetrics(child.text);
    const childCenterY = cursor + childHeight / 2;
    const childX = x + direction * ((metrics.width + childMetrics.width) / 2 + 120);
    placeBranch(child, node.id, childX, childCenterY, depth + 1, direction, placed);
    cursor += childHeight + 34;
  });
}

function placeBranchDown(
  node: OutlineNode,
  parentId: string | null,
  centerX: number,
  centerY: number,
  depth: number,
  placed: NodeBox[],
) {
  const metrics = getNodeMetrics(node.text);
  placed.push({
    id: node.id,
    text: node.text,
    color: node.color,
    parentId,
    x: centerX,
    y: centerY,
    width: metrics.width,
    height: metrics.height,
    depth,
  });

  if (node.children.length === 0) {
    return;
  }

  const totalWidth = node.children.reduce((sum, child, index) => {
    return sum + getDownBranchWidth(child) + (index > 0 ? 42 : 0);
  }, 0);
  let cursor = centerX - totalWidth / 2;

  node.children.forEach((child) => {
    const childWidth = getDownBranchWidth(child);
    const childMetrics = getNodeMetrics(child.text);
    const childCenterX = cursor + childWidth / 2;
    const childCenterY = centerY + metrics.height / 2 + 110 + childMetrics.height / 2;
    placeBranchDown(child, node.id, childCenterX, childCenterY, depth + 1, placed);
    cursor += childWidth + 42;
  });
}

export function computeMindMapLayout(roots: OutlineNode[], mode: LayoutMode = 'balanced') {
  const placed: NodeBox[] = [];

  if (mode === 'down') {
    const rootHeights = roots.map((root) => getDownBranchHeight(root));
    const totalHeight = rootHeights.reduce((sum, height, index) => sum + height + (index > 0 ? 140 : 0), 0);
    let cursor = -totalHeight / 2;

    roots.forEach((root, rootIndex) => {
      const rootMetrics = getNodeMetrics(root.text);
      const centerY = cursor + rootMetrics.height / 2;
      placeBranchDown(root, null, 0, centerY, 0, placed);
      cursor += rootHeights[rootIndex] + 140;
    });

    return placed;
  }

  const rootHeights = roots.map((root) => {
    const leftChildren = mode === 'balanced' ? root.children.filter((_, index) => index % 2 === 1) : [];
    const rightChildren = mode === 'balanced' ? root.children.filter((_, index) => index % 2 === 0) : root.children;
    const rootMetrics = getNodeMetrics(root.text);
    return Math.max(rootMetrics.height, getSideHeight(leftChildren), getSideHeight(rightChildren));
  });

  const totalHeight = rootHeights.reduce((sum, height, index) => sum + height + (index > 0 ? 120 : 0), 0);
  let cursor = -totalHeight / 2;

  roots.forEach((root, rootIndex) => {
    const rootMetrics = getNodeMetrics(root.text);
    const rootHeight = rootHeights[rootIndex];
    const centerY = cursor + rootHeight / 2;

    placed.push({
      id: root.id,
      text: root.text,
      color: root.color,
      parentId: null,
      x: 0,
      y: centerY,
      width: rootMetrics.width,
      height: rootMetrics.height,
      depth: 0,
    });

    const leftChildren = mode === 'balanced' ? root.children.filter((_, index) => index % 2 === 1) : [];
    const rightChildren = mode === 'balanced' ? root.children.filter((_, index) => index % 2 === 0) : root.children;

    if (rightChildren.length > 0) {
      const totalRightHeight = getSideHeight(rightChildren);
      let rightCursor = centerY - totalRightHeight / 2;
      rightChildren.forEach((child) => {
        const childHeight = getBranchHeight(child);
        const childMetrics = getNodeMetrics(child.text);
        const childCenterY = rightCursor + childHeight / 2;
        const childX = (rootMetrics.width + childMetrics.width) / 2 + 120;
        placeBranch(child, root.id, childX, childCenterY, 1, 1, placed);
        rightCursor += childHeight + 34;
      });
    }

    if (leftChildren.length > 0) {
      const totalLeftHeight = getSideHeight(leftChildren);
      let leftCursor = centerY - totalLeftHeight / 2;
      leftChildren.forEach((child) => {
        const childHeight = getBranchHeight(child);
        const childMetrics = getNodeMetrics(child.text);
        const childCenterY = leftCursor + childHeight / 2;
        const childX = -((rootMetrics.width + childMetrics.width) / 2 + 120);
        placeBranch(child, root.id, childX, childCenterY, 1, -1, placed);
        leftCursor += childHeight + 34;
      });
    }

    cursor += rootHeight + 120;
  });

  return placed;
}
