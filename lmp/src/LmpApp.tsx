import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  DEFAULT_LMP_DOCUMENT,
  addChildNode,
  addRootNode,
  addSiblingNode,
  computeMindMapLayout,
  deleteNode,
  deleteNodes,
  getMovableNodeIds,
  getNodeBranchIds,
  getNodeById,
  indentNode,
  moveNode,
  moveNodes,
  moveNodeDown,
  moveNodeUp,
  outdentNode,
  parseOutline,
  serializeOutline,
  updateNodeColors,
  updateNodeText,
  type DropPosition,
  type LayoutMode,
  type NodeBox,
  type NodeColor,
  type OutlineNode,
  type ParsedOutline,
} from './lib/outline';

interface HostConfig {
  platform: 'web' | 'vscode';
  initialMarkdown?: string;
  fileName?: string;
}

interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

interface CanvasState {
  width: number;
  height: number;
}

interface InlineEditorState {
  nodeId: string;
  value: string;
}

interface DropPreview {
  targetId: string;
  position: DropPosition;
}

interface DragOverlay {
  nodeId: string;
  nodeIds: string[];
  ghostX: number;
  ghostY: number;
  preview: DropPreview | null;
}

interface MarqueeOverlay {
  left: number;
  top: number;
  width: number;
  height: number;
}

type DragSession =
  | {
      kind: 'marquee';
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startWorldX: number;
      startWorldY: number;
      additive: boolean;
      baseSelection: string[];
    }
  | {
      kind: 'pending-node';
      pointerId: number;
      nodeId: string;
      nodeIds: string[];
      selectionIds: string[];
      startClientX: number;
      startClientY: number;
      offsetWorldX: number;
      offsetWorldY: number;
    }
  | {
      kind: 'drag-node';
      pointerId: number;
      nodeId: string;
      nodeIds: string[];
      selectionIds: string[];
      offsetWorldX: number;
      offsetWorldY: number;
    };

interface VsCodeApiLike {
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    __LMP_EDITOR_CONFIG__?: HostConfig;
    acquireVsCodeApi?: () => VsCodeApiLike;
  }
}

const STORAGE_KEY = 'lmp-editer/document';
const INITIAL_VIEWPORT: ViewportState = { x: 0, y: 0, zoom: 1 };
const DRAG_START_DISTANCE = 5;
const COLOR_SWATCHES: Array<{ id: NodeColor; label: string; preview: string }> = [
  { id: 'amber', label: 'Amber', preview: 'linear-gradient(135deg, #f4d29a, #d88a34)' },
  { id: 'sage', label: 'Sage', preview: 'linear-gradient(135deg, #d8e3cb, #7ea06e)' },
  { id: 'sky', label: 'Sky', preview: 'linear-gradient(135deg, #d7ecfb, #6ca7d4)' },
  { id: 'teal', label: 'Teal', preview: 'linear-gradient(135deg, #cce8e4, #3f988d)' },
  { id: 'violet', label: 'Violet', preview: 'linear-gradient(135deg, #e7dcf8, #9b79c5)' },
  { id: 'rose', label: 'Rose', preview: 'linear-gradient(135deg, #f8d6dc, #d57f92)' },
  { id: 'coral', label: 'Coral', preview: 'linear-gradient(135deg, #ffd6c8, #d77558)' },
  { id: 'slate', label: 'Slate', preview: 'linear-gradient(135deg, #d8dde6, #70839e)' },
];
const LAYOUT_BUTTONS: Array<{ mode: LayoutMode; label: string }> = [
  { mode: 'balanced', label: '平衡' },
  { mode: 'right', label: '右向' },
  { mode: 'down', label: '下向' },
];
const SHORTCUTS = [
  { keys: 'Tab', label: 'Create child topic and edit it' },
  { keys: 'Shift + Tab', label: 'Create sibling topic and edit it' },
  { keys: 'Enter', label: 'Enter or exit topic editing' },
  { keys: 'Shift + Enter', label: 'Insert a line break while editing' },
  { keys: 'Double click node', label: 'Edit topic inline' },
  { keys: 'Cmd/Ctrl click', label: 'Add or remove topics from selection' },
  { keys: 'Drag topic', label: 'Snap to child, before, or after insertion' },
  { keys: 'Delete', label: 'Remove the active topic or current selection' },
  { keys: 'Pinch / Ctrl+wheel', label: 'Zoom around the pointer' },
  { keys: 'Two-finger scroll', label: 'Pan the stage with a trackpad' },
];

function readHostConfig(): HostConfig {
  const config = window.__LMP_EDITOR_CONFIG__;
  if (!config || typeof config !== 'object') {
    return { platform: 'web' };
  }
  return {
    platform: config.platform === 'vscode' ? 'vscode' : 'web',
    initialMarkdown: typeof config.initialMarkdown === 'string' ? config.initialMarkdown : undefined,
    fileName: typeof config.fileName === 'string' ? config.fileName : undefined,
  };
}

function getInitialDocument(config: HostConfig) {
  if (config.initialMarkdown && config.initialMarkdown.trim()) {
    return config.initialMarkdown;
  }
  if (config.platform === 'web') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored.trim()) {
      return stored;
    }
  }
  return DEFAULT_LMP_DOCUMENT;
}

function getFileTitle(fileName?: string) {
  if (!fileName) {
    return 'Untitled LMP';
  }
  return fileName.replace(/\.lmp$/i, '') || 'Untitled LMP';
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  const tagName = element.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || element.isContentEditable;
}

function clampZoom(nextZoom: number) {
  return Math.min(2.5, Math.max(0.35, nextZoom));
}

function wrapText(text: string, maxChars = 14) {
  const sourceLines = (text.trim() || 'Topic').split('\n');
  return sourceLines.flatMap((line) => {
    const chunks = line.match(new RegExp(`.{1,${maxChars}}`, 'gu'));
    return chunks && chunks.length > 0 ? chunks : [' '];
  });
}

function downloadDocument(fileName: string, markdown: string) {
  const blob = new Blob([markdown], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.endsWith('.lmp') ? fileName : `${fileName}.lmp`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function clientToWorld(
  wrapper: HTMLDivElement | null,
  viewport: ViewportState,
  clientX: number,
  clientY: number,
) {
  if (!wrapper) {
    return null;
  }

  const rect = wrapper.getBoundingClientRect();
  return {
    x: (clientX - rect.left - rect.width / 2 - viewport.x) / viewport.zoom,
    y: (clientY - rect.top - rect.height / 2 - viewport.y) / viewport.zoom,
  };
}

function hitTestNode(
  layout: NodeBox[],
  wrapper: HTMLDivElement | null,
  viewport: ViewportState,
  clientX: number,
  clientY: number,
) {
  const point = clientToWorld(wrapper, viewport, clientX, clientY);
  if (!point) {
    return null;
  }

  return [...layout]
    .reverse()
    .find((node) =>
      point.x >= node.x - node.width / 2 &&
      point.x <= node.x + node.width / 2 &&
      point.y >= node.y - node.height / 2 &&
      point.y <= node.y + node.height / 2,
    ) ?? null;
}

function worldToScreen(node: NodeBox, size: CanvasState, viewport: ViewportState) {
  const centerX = size.width / 2 + viewport.x + node.x * viewport.zoom;
  const centerY = size.height / 2 + viewport.y + node.y * viewport.zoom;
  return {
    left: centerX - (node.width * viewport.zoom) / 2,
    top: centerY - (node.height * viewport.zoom) / 2,
    width: Math.max(1, node.width * viewport.zoom),
    height: Math.max(1, node.height * viewport.zoom),
  };
}

function getInspectorWidth(size: CanvasState, inspectorOpen: boolean) {
  return inspectorOpen ? Math.min(240, size.width * 0.22) : 0;
}

function keepNodeInView(
  node: NodeBox,
  size: CanvasState,
  viewport: ViewportState,
  inspectorOpen: boolean,
) {
  const box = worldToScreen(node, size, viewport);
  const leftInset = 24;
  const topInset = 76;
  const rightInset = getInspectorWidth(size, inspectorOpen) + (inspectorOpen ? 24 : 72);
  const bottomInset = 24;
  const availableWidth = Math.max(120, size.width - leftInset - rightInset);
  const availableHeight = Math.max(120, size.height - topInset - bottomInset);
  let nextX = viewport.x;
  let nextY = viewport.y;

  if (box.width > availableWidth) {
    const targetCenterX = leftInset + availableWidth / 2;
    nextX += targetCenterX - (box.left + box.width / 2);
  } else if (box.left < leftInset) {
    nextX += leftInset - box.left;
  } else if (box.left + box.width > size.width - rightInset) {
    nextX -= box.left + box.width - (size.width - rightInset);
  }

  if (box.height > availableHeight) {
    const targetCenterY = topInset + availableHeight / 2;
    nextY += targetCenterY - (box.top + box.height / 2);
  } else if (box.top < topInset) {
    nextY += topInset - box.top;
  } else if (box.top + box.height > size.height - bottomInset) {
    nextY -= box.top + box.height - (size.height - bottomInset);
  }

  if (Math.abs(nextX - viewport.x) < 0.5 && Math.abs(nextY - viewport.y) < 0.5) {
    return viewport;
  }

  return {
    ...viewport,
    x: nextX,
    y: nextY,
  };
}

function getFloatingPalettePosition(
  layout: NodeBox[],
  selectedIds: string[],
  size: CanvasState,
  viewport: ViewportState,
) {
  const selectedNodes = selectedIds
    .map((nodeId) => layout.find((node) => node.id === nodeId))
    .filter((node): node is NodeBox => Boolean(node));

  if (selectedNodes.length === 0) {
    return null;
  }

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  selectedNodes.forEach((node) => {
    const box = worldToScreen(node, size, viewport);
    left = Math.min(left, box.left);
    top = Math.min(top, box.top);
    right = Math.max(right, box.left + box.width);
    bottom = Math.max(bottom, box.top + box.height);
  });

  const centerX = (left + right) / 2;
  const clampedLeft = Math.min(size.width - 20, Math.max(20, centerX));
  const preferredTop = top - 108;
  const resolvedTop = preferredTop < 76 ? bottom + 16 : preferredTop;

  return {
    left: clampedLeft,
    top: Math.min(size.height - 84, Math.max(76, resolvedTop)),
  };
}

function getIntersectingNodeIds(
  layout: NodeBox[],
  startWorldX: number,
  startWorldY: number,
  endWorldX: number,
  endWorldY: number,
) {
  const left = Math.min(startWorldX, endWorldX);
  const right = Math.max(startWorldX, endWorldX);
  const top = Math.min(startWorldY, endWorldY);
  const bottom = Math.max(startWorldY, endWorldY);

  return layout
    .filter((node) =>
      node.x + node.width / 2 >= left &&
      node.x - node.width / 2 <= right &&
      node.y + node.height / 2 >= top &&
      node.y - node.height / 2 <= bottom,
    )
    .map((node) => node.id);
}

function getMarqueeOverlay(
  wrapper: HTMLDivElement | null,
  startClientX: number,
  startClientY: number,
  endClientX: number,
  endClientY: number,
): MarqueeOverlay | null {
  if (!wrapper) {
    return null;
  }

  const rect = wrapper.getBoundingClientRect();
  const startX = startClientX - rect.left;
  const startY = startClientY - rect.top;
  const endX = endClientX - rect.left;
  const endY = endClientY - rect.top;

  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

function resolveDropPreview(
  layout: NodeBox[],
  roots: OutlineNode[],
  draggedNodeIds: string[],
  ghostX: number,
  ghostY: number,
): DropPreview | null {
  const forbiddenIds = new Set<string>();
  draggedNodeIds.forEach((nodeId) => {
    getNodeBranchIds(roots, nodeId).forEach((branchId) => forbiddenIds.add(branchId));
  });
  let bestNode: NodeBox | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const node of layout) {
    if (forbiddenIds.has(node.id)) {
      continue;
    }

    const dx = Math.max(Math.abs(ghostX - node.x) - node.width / 2 - 54, 0);
    const dy = Math.max(Math.abs(ghostY - node.y) - node.height / 2 - 38, 0);
    const score = dx * dx + dy * dy;
    if (score < bestScore) {
      bestNode = node;
      bestScore = score;
    }
  }

  if (!bestNode || bestScore > 24000) {
    return null;
  }

  const localY = ghostY - bestNode.y;
  const verticalBand = Math.max(18, bestNode.height * 0.28);
  const position =
    localY < -verticalBand
      ? 'before'
      : localY > verticalBand
        ? 'after'
        : 'child';

  return {
    targetId: bestNode.id,
    position,
  };
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    return hex;
  }
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function resolveNodePalette(node: NodeBox) {
  const isRoot = node.depth === 0;
  const hasExplicitColor = node.color !== null;

  const buildPalette = (accent: string) => (
    isRoot
      ? {
          fill: accent,
          stroke: accent,
          text: '#050505',
          accent,
          shadow: hexToRgba(accent, 0.36),
          line: accent,
        }
      : hasExplicitColor
        ? {
            fill: hexToRgba(accent, 0.24),
            stroke: accent,
            text: '#f8fbff',
            accent,
            shadow: hexToRgba(accent, 0.3),
            line: hexToRgba(accent, 0.58),
          }
        : {
            fill: 'rgba(8, 10, 12, 0.94)',
            stroke: hexToRgba(accent, 0.34),
            text: '#f3f6ef',
            accent,
            shadow: hexToRgba(accent, 0.18),
            line: 'rgba(140, 150, 160, 0.4)',
          }
  );

  switch (node.color) {
    case 'amber':
      return buildPalette('#ffc247');
    case 'sage':
      return buildPalette('#97d86f');
    case 'sky':
      return buildPalette('#6ebfff');
    case 'teal':
      return buildPalette('#56d7bf');
    case 'violet':
      return buildPalette('#b68bff');
    case 'rose':
      return buildPalette('#ff789f');
    case 'coral':
      return buildPalette('#ff9365');
    case 'slate':
      return buildPalette('#aab6c4');
    default:
      return buildPalette('#d5ff00');
  }
}

function traceCutPanel(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  cut: number,
) {
  context.beginPath();
  context.moveTo(left + cut, top);
  context.lineTo(left + width - cut, top);
  context.lineTo(left + width, top + cut);
  context.lineTo(left + width, top + height - cut);
  context.lineTo(left + width - cut, top + height);
  context.lineTo(left + cut, top + height);
  context.lineTo(left, top + height - cut);
  context.lineTo(left, top + cut);
  context.closePath();
}

function drawPreview(
  context: CanvasRenderingContext2D,
  target: NodeBox | undefined,
  preview: DropPreview | null,
) {
  if (!preview || !target) {
    return;
  }

  context.save();
  context.strokeStyle = '#d5ff00';
  context.fillStyle = 'rgba(213, 255, 0, 0.08)';
  context.lineWidth = 2.6;
  context.setLineDash([12, 8]);

  if (preview.position === 'child') {
    traceCutPanel(
      context,
      target.x - target.width / 2 - 16,
      target.y - target.height / 2 - 14,
      target.width + 32,
      target.height + 28,
      target.depth === 0 ? 18 : 14,
    );
    context.fill();
    context.stroke();
  } else {
    const y = preview.position === 'before'
      ? target.y - target.height / 2 - 20
      : target.y + target.height / 2 + 20;
    const startX = target.x - target.width / 2 - 34;
    const endX = target.x + target.width / 2 + 34;
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(startX, y);
    context.lineTo(endX, y);
    context.stroke();
    context.beginPath();
    context.arc(startX, y, 5.5, 0, Math.PI * 2);
    context.arc(endX, y, 5.5, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

function drawGhostNode(
  context: CanvasRenderingContext2D,
  node: NodeBox,
  ghostX: number,
  ghostY: number,
) {
  const palette = resolveNodePalette(node);
  const left = ghostX - node.width / 2;
  const top = ghostY - node.height / 2;
  const lines = wrapText(node.text, node.depth === 0 ? 12 : 14);

  context.save();
  context.globalAlpha = 0.76;
  traceCutPanel(context, left, top, node.width, node.height, node.depth === 0 ? 18 : 12);
  context.shadowColor = palette.shadow;
  context.shadowBlur = 22;
  context.shadowOffsetY = 0;
  context.fillStyle = palette.fill;
  context.fill();
  context.shadowColor = 'transparent';
  context.strokeStyle = palette.accent;
  context.lineWidth = 2.2;
  context.stroke();
  context.fillStyle = palette.accent;
  context.fillRect(left + 10, top + 10, Math.max(22, node.width * 0.12), 5);

  context.fillStyle = palette.text;
  context.font = node.depth === 0
    ? '700 18px "Avenir Next Condensed", "Arial Narrow", sans-serif'
    : '600 14px "IBM Plex Mono", monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const lineHeight = node.depth === 0 ? 24 : 22;
  const startY = ghostY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    context.fillText(line, ghostX, startY + index * lineHeight);
  });
  context.restore();
}

function drawScene(
  canvas: HTMLCanvasElement,
  size: CanvasState,
  viewport: ViewportState,
  layout: NodeBox[],
  selectedIds: string[],
  activeId: string | null,
  editingNodeId: string | null,
  dragOverlay: DragOverlay | null,
) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(size.width));
  const height = Math.max(1, Math.floor(size.height));
  if (width <= 0 || height <= 0) {
    return;
  }

  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }

  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const stageGradient = context.createLinearGradient(0, 0, width, height);
  stageGradient.addColorStop(0, '#050706');
  stageGradient.addColorStop(0.5, '#060907');
  stageGradient.addColorStop(1, '#070906');
  context.fillStyle = stageGradient;
  context.fillRect(0, 0, width, height);

  const sideWash = context.createLinearGradient(0, 0, width, 0);
  sideWash.addColorStop(0, 'rgba(120, 148, 42, 0.14)');
  sideWash.addColorStop(0.18, 'rgba(42, 52, 18, 0.08)');
  sideWash.addColorStop(0.5, 'rgba(24, 30, 15, 0.04)');
  sideWash.addColorStop(0.82, 'rgba(42, 52, 18, 0.08)');
  sideWash.addColorStop(1, 'rgba(120, 148, 42, 0.14)');
  context.fillStyle = sideWash;
  context.fillRect(0, 0, width, height);

  const haze = context.createRadialGradient(width * 0.28, height * 0.88, 20, width * 0.28, height * 0.88, width * 0.78);
  haze.addColorStop(0, 'rgba(213,255,0,0.16)');
  haze.addColorStop(0.28, 'rgba(49,78,9,0.08)');
  haze.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = haze;
  context.fillRect(0, 0, width, height);

  context.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = 60; y < height; y += 4) {
    context.fillRect(0, y, width, 1);
  }

  context.strokeStyle = 'rgba(255, 255, 255, 0.055)';
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += 72) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 60; y <= height; y += 72) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.save();
  context.translate(width / 2 + viewport.x, height / 2 + viewport.y);
  context.scale(viewport.zoom, viewport.zoom);

  const selectedSet = new Set(selectedIds);
  const nodesById = new Map(layout.map((node) => [node.id, node]));
  drawPreview(
    context,
    dragOverlay?.preview ? nodesById.get(dragOverlay.preview.targetId) : undefined,
    dragOverlay?.preview ?? null,
  );

  layout.forEach((node) => {
    const parent = node.parentId ? nodesById.get(node.parentId) : null;
    if (!parent || node.depth === 0) {
      return;
    }

    const fromX = parent.x + (node.x >= parent.x ? parent.width / 2 : -parent.width / 2);
    const toX = node.x + (node.x >= parent.x ? -node.width / 2 : node.width / 2);
    const midX = (fromX + toX) / 2;
    const activeStroke = selectedSet.has(node.id) || selectedSet.has(parent.id);
    const palette = resolveNodePalette(node);

    context.beginPath();
    context.moveTo(fromX, parent.y);
    context.bezierCurveTo(midX, parent.y, midX, node.y, toX, node.y);
    context.strokeStyle = activeStroke ? '#d5ff00' : palette.line;
    context.lineWidth = node.depth === 1 ? 2.2 : 1.5;
    context.lineCap = 'round';
    context.stroke();
  });

  layout.forEach((node) => {
    const palette = resolveNodePalette(node);
    const isSelected = selectedSet.has(node.id);
    const isActive = node.id === activeId;
    const isEditing = node.id === editingNodeId;
    const isDragged = dragOverlay?.nodeIds.includes(node.id) ?? false;
    const left = node.x - node.width / 2;
    const top = node.y - node.height / 2;
    const lines = wrapText(node.text, node.depth === 0 ? 12 : 14);

    context.save();
    context.globalAlpha = isDragged ? 0.22 : 1;
    traceCutPanel(context, left, top, node.width, node.height, node.depth === 0 ? 18 : 12);
    context.shadowColor = isActive || isEditing ? '#d5ff0055' : palette.shadow;
    context.shadowBlur = isActive || isEditing ? 30 : 18;
    context.shadowOffsetY = 0;
    context.fillStyle = isEditing
      ? (
          node.depth === 0
            ? palette.fill
            : node.color
              ? hexToRgba(palette.accent, 0.34)
              : 'rgba(255, 255, 255, 0.12)'
        )
      : palette.fill;
    context.fill();
    context.shadowColor = 'transparent';
    context.strokeStyle =
      isEditing
        ? '#ffffff'
        : isActive
          ? '#d5ff00'
          : isSelected
            ? palette.accent
            : palette.stroke;
    context.lineWidth = isEditing || isActive ? 2.4 : isSelected ? 2 : 1.2;
    context.stroke();

    context.fillStyle = isActive || isSelected ? palette.accent : 'rgba(255, 255, 255, 0.18)';
    context.fillRect(left + 10, top + 10, Math.max(20, node.width * 0.12), 5);

    if (!isEditing) {
      context.fillStyle = palette.text;
      context.font = node.depth === 0
        ? '700 18px "Avenir Next Condensed", "Arial Narrow", sans-serif'
        : '600 14px "IBM Plex Mono", monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const lineHeight = node.depth === 0 ? 24 : 22;
      const startY = node.y - ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, index) => {
        context.fillText(line, node.x, startY + index * lineHeight);
      });
    }
    context.restore();
  });

  if (dragOverlay) {
    const draggedNode = nodesById.get(dragOverlay.nodeId);
    if (draggedNode) {
      drawGhostNode(context, draggedNode, dragOverlay.ghostX, dragOverlay.ghostY);
    }
  }

  context.restore();
}

export function LmpApp() {
  const hostConfigRef = useRef<HostConfig>(readHostConfig());
  const initialDocumentRef = useRef(getInitialDocument(hostConfigRef.current));
  const initialParsedRef = useRef(parseOutline(initialDocumentRef.current));
  const vscodeApiRef = useRef<VsCodeApiLike | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const inlineEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const focusedInlineEditorIdRef = useRef<string | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const lastSentMarkdownRef = useRef('');
  const [canvasState, setCanvasState] = useState<CanvasState>({ width: 1200, height: 780 });
  const [viewport, setViewport] = useState<ViewportState>(INITIAL_VIEWPORT);
  const [status, setStatus] = useState('Canvas ready');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [sourceValue, setSourceValue] = useState(() => initialDocumentRef.current);
  const [sourceDirty, setSourceDirty] = useState(false);
  const [inlineEditor, setInlineEditor] = useState<InlineEditorState | null>(null);
  const [dragOverlay, setDragOverlay] = useState<DragOverlay | null>(null);
  const [marqueeOverlay, setMarqueeOverlay] = useState<MarqueeOverlay | null>(null);
  const [documentState, setDocumentState] = useState<ParsedOutline>(() => initialParsedRef.current);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => (
    initialParsedRef.current.roots[0] ? [initialParsedRef.current.roots[0].id] : []
  ));
  const [activeId, setActiveId] = useState<string | null>(() => initialParsedRef.current.roots[0]?.id ?? null);

  if (hostConfigRef.current.platform === 'vscode' && !vscodeApiRef.current && typeof window.acquireVsCodeApi === 'function') {
    vscodeApiRef.current = window.acquireVsCodeApi();
  }

  const { roots, warnings, layoutMode } = documentState;
  const renderRoots = inlineEditor
    ? updateNodeText(roots, inlineEditor.nodeId, inlineEditor.value || ' ')
    : roots;
  const layout = computeMindMapLayout(renderRoots, layoutMode);
  const fileTitle = getFileTitle(hostConfigRef.current.fileName);
  const currentNode = activeId ? getNodeById(renderRoots, activeId) : null;
  const documentText = serializeOutline(roots, { layoutMode });
  const selectedCount = selectedIds.length;
  const paletteTargets = selectedIds.length > 0 ? selectedIds : activeId ? [activeId] : [];
  const paletteNodes = paletteTargets
    .map((nodeId) => getNodeById(roots, nodeId))
    .filter((node): node is OutlineNode => Boolean(node));
  const paletteColor =
    paletteNodes.length > 0 && paletteNodes.every((node) => node.color === paletteNodes[0]?.color)
      ? paletteNodes[0]?.color ?? null
      : undefined;
  const editingLayoutNode = inlineEditor ? layout.find((node) => node.id === inlineEditor.nodeId) ?? null : null;
  const editingPalette = editingLayoutNode ? resolveNodePalette(editingLayoutNode) : null;
  const inlineEditorBox = editingLayoutNode ? worldToScreen(editingLayoutNode, canvasState, viewport) : null;
  const floatingPalettePosition = !inlineEditor && !inspectorOpen
    ? getFloatingPalettePosition(layout, paletteTargets, canvasState, viewport)
    : null;

  const resolveSelection = (nextRoots: OutlineNode[], nextIds: string[], nextActiveId: string | null) => {
    const validIds = nextIds.filter((nodeId, index) => (
      nextIds.indexOf(nodeId) === index && getNodeById(nextRoots, nodeId)
    ));
    const resolvedActiveId =
      nextActiveId && getNodeById(nextRoots, nextActiveId)
        ? nextActiveId
        : validIds[validIds.length - 1] ?? nextRoots[0]?.id ?? null;
    const resolvedIds =
      validIds.length > 0
        ? validIds
        : resolvedActiveId
          ? [resolvedActiveId]
          : [];
    return {
      ids: resolvedIds,
      activeId: resolvedActiveId,
    };
  };

  const applyRoots = (
    nextRoots: OutlineNode[],
    options: {
      ids?: string[];
      activeId?: string | null;
      editNodeId?: string | null;
      revealNodeId?: string | null;
      status: string;
    },
  ) => {
    const selection = resolveSelection(
      nextRoots,
      options.ids ?? selectedIds,
      options.activeId ?? activeId,
    );
    const revealNodeId = options.editNodeId ?? options.revealNodeId ?? null;
    const nextLayout = revealNodeId ? computeMindMapLayout(nextRoots, layoutMode) : null;
    const revealNode = revealNodeId ? nextLayout?.find((node) => node.id === revealNodeId) ?? null : null;

    if (revealNode) {
      setViewport((current) => keepNodeInView(
        revealNode,
        canvasState,
        current,
        inspectorOpen,
      ));
    }

    startTransition(() => {
      setDocumentState((current) => ({
        roots: nextRoots,
        warnings: current.warnings,
        layoutMode: current.layoutMode,
      }));
      setSelectedIds(selection.ids);
      setActiveId(selection.activeId);
      setDragOverlay(null);
      setMarqueeOverlay(null);
      setSourceDirty(false);
      setStatus(options.status);
      if (options.editNodeId) {
        const node = getNodeById(nextRoots, options.editNodeId);
        setInlineEditor(node ? { nodeId: options.editNodeId, value: node.text } : null);
      } else {
        setInlineEditor(null);
      }
    });
  };

  const startEditingNode = (nodeId: string | null) => {
    if (!nodeId) {
      return;
    }
    const node = getNodeById(roots, nodeId);
    if (!node) {
      return;
    }
    setSelectedIds((current) => current.includes(nodeId) ? current : [nodeId]);
    setActiveId(nodeId);
    setInlineEditor({
      nodeId,
      value: node.text,
    });
    setStatus('Editing topic');
  };

  const commitInlineEditing = () => {
    if (!inlineEditor) {
      return;
    }
    const nextText = inlineEditor.value.trim() || 'Topic';
    applyRoots(
      updateNodeText(roots, inlineEditor.nodeId, nextText),
      {
        ids: selectedIds.includes(inlineEditor.nodeId) ? selectedIds : [inlineEditor.nodeId],
        activeId: inlineEditor.nodeId,
        status: 'Topic updated',
      },
    );
  };

  const cancelInlineEditing = () => {
    setInlineEditor(null);
    setStatus('Edit canceled');
  };

  const setSingleSelection = (nodeId: string) => {
    setSelectedIds([nodeId]);
    setActiveId(nodeId);
  };

  const toggleSelection = (nodeId: string) => {
    if (selectedIds.includes(nodeId)) {
      if (selectedIds.length === 1) {
        setSingleSelection(nodeId);
        return;
      }
      const nextIds = selectedIds.filter((current) => current !== nodeId);
      setSelectedIds(nextIds);
      if (activeId === nodeId) {
        setActiveId(nextIds[nextIds.length - 1] ?? null);
      }
      setStatus(`Selected ${nextIds.length} topics`);
      return;
    }

    const nextIds = [...selectedIds, nodeId];
    setSelectedIds(nextIds);
    setActiveId(nodeId);
    setStatus(`Selected ${nextIds.length} topics`);
  };

  const deleteCurrentSelection = () => {
    if (selectedIds.length > 1) {
      const result = deleteNodes(roots, selectedIds);
      applyRoots(result.roots, {
        ids: result.nextSelectedId ? [result.nextSelectedId] : [],
        activeId: result.nextSelectedId,
        status: `Removed ${selectedIds.length} topics`,
      });
      return;
    }

    if (!activeId) {
      return;
    }
    const result = deleteNode(roots, activeId);
    applyRoots(result.roots, {
      ids: result.nextSelectedId ? [result.nextSelectedId] : [],
      activeId: result.nextSelectedId,
      status: 'Removed topic',
    });
  };

  const centerOnNode = (nodeId: string | null) => {
    if (!nodeId) {
      return;
    }
    const node = layout.find((entry) => entry.id === nodeId);
    if (!node) {
      return;
    }
    setViewport((current) => ({
      ...current,
      x: -node.x * current.zoom,
      y: -node.y * current.zoom,
    }));
    setStatus('Centered selection');
  };

  const handleApplySource = () => {
    const parsed = parseOutline(sourceValue);
    const fallbackId = parsed.roots[0]?.id ?? null;
    startTransition(() => {
      setDocumentState(parsed);
      setSelectedIds(fallbackId ? [fallbackId] : []);
      setActiveId(fallbackId);
      setInlineEditor(null);
      setSourceDirty(false);
      setDragOverlay(null);
      setMarqueeOverlay(null);
      setStatus(parsed.warnings.length > 0 ? 'Applied source with parser notes' : 'Applied source changes');
    });
  };

  useEffect(() => {
    if (canvasRef.current) {
      drawScene(
        canvasRef.current,
        canvasState,
        viewport,
        layout,
        selectedIds,
        activeId,
        inlineEditor?.nodeId ?? null,
        dragOverlay,
      );
    }
  }, [activeId, canvasState, dragOverlay, inlineEditor, layout, selectedIds, viewport]);

  useLayoutEffect(() => {
    const element = canvasWrapRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setCanvasState({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (hostConfigRef.current.platform === 'web') {
      localStorage.setItem(STORAGE_KEY, documentText);
    }

    if (documentText === lastSentMarkdownRef.current) {
      return;
    }

    lastSentMarkdownRef.current = documentText;
    vscodeApiRef.current?.postMessage({
      type: 'lmp/updateDocument',
      markdown: documentText,
    });
  }, [documentText]);

  useEffect(() => {
    if (!sourceDirty) {
      setSourceValue(documentText);
    }
  }, [documentText, sourceDirty]);

  useEffect(() => {
    if (!inlineEditor) {
      focusedInlineEditorIdRef.current = null;
      return;
    }
    if (focusedInlineEditorIdRef.current === inlineEditor.nodeId) {
      return;
    }
    const timer = window.setTimeout(() => {
      inlineEditorRef.current?.focus();
      inlineEditorRef.current?.setSelectionRange(inlineEditor.value.length, inlineEditor.value.length);
      focusedInlineEditorIdRef.current = inlineEditor.nodeId;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [inlineEditor?.nodeId]);

  useLayoutEffect(() => {
    if (!editingLayoutNode) {
      return;
    }

    setViewport((current) => keepNodeInView(
      editingLayoutNode,
      canvasState,
      current,
      inspectorOpen,
    ));
  }, [canvasState, editingLayoutNode, inspectorOpen]);

  useEffect(() => {
    if (activeId === null || currentNode) {
      return;
    }
    const fallbackId = roots[0]?.id ?? null;
    setSelectedIds(fallbackId ? [fallbackId] : []);
    setActiveId(fallbackId);
  }, [activeId, currentNode, roots]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || typeof payload !== 'object' || !('type' in payload)) {
        return;
      }
      if (payload.type !== 'lmp/document' || typeof payload.markdown !== 'string') {
        return;
      }

      if (payload.markdown === lastSentMarkdownRef.current) {
        return;
      }

      startTransition(() => {
        const parsed = parseOutline(payload.markdown);
        const fallbackId = parsed.roots[0]?.id ?? null;
        setDocumentState(parsed);
        setSelectedIds(fallbackId ? [fallbackId] : []);
        setActiveId(fallbackId);
        setInlineEditor(null);
        setDragOverlay(null);
        setMarqueeOverlay(null);
        setSourceDirty(false);
        hostConfigRef.current = {
          ...hostConfigRef.current,
          fileName: typeof payload.fileName === 'string' ? payload.fileName : hostConfigRef.current.fileName,
        };
        setStatus(parsed.warnings.length > 0 ? 'Synced from host with parser notes' : 'Document synced from host');
      });
    };

    window.addEventListener('message', handleMessage);
    vscodeApiRef.current?.postMessage({ type: 'lmp/ready' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && inlineEditor) {
        event.preventDefault();
        cancelInlineEditing();
        return;
      }

      const metaPressed = event.metaKey || event.ctrlKey;
      if (metaPressed && event.key.toLowerCase() === 'a') {
        if (isEditableTarget(event.target)) {
          return;
        }
        event.preventDefault();
        const allIds = layout.map((node) => node.id);
        setSelectedIds(allIds);
        setActiveId(activeId && allIds.includes(activeId) ? activeId : allIds[0] ?? null);
        setStatus(`Selected ${allIds.length} topics`);
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (!activeId) {
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        const result = event.shiftKey
          ? addSiblingNode(roots, activeId)
          : addChildNode(roots, activeId);
        if (result.nodeId) {
          applyRoots(result.roots, {
            ids: [result.nodeId],
            activeId: result.nodeId,
            editNodeId: result.nodeId,
            status: event.shiftKey ? 'Added sibling topic' : 'Added child topic',
          });
        }
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        if (inlineEditor) {
          commitInlineEditing();
          return;
        }
        startEditingNode(activeId);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteCurrentSelection();
        return;
      }

      if (event.key === 'F2') {
        event.preventDefault();
        startEditingNode(activeId);
        return;
      }

      if (metaPressed && event.key === 'ArrowUp') {
        event.preventDefault();
        applyRoots(moveNodeUp(roots, activeId), {
          ids: selectedIds,
          activeId,
          status: 'Moved topic up',
        });
        return;
      }

      if (metaPressed && event.key === 'ArrowDown') {
        event.preventDefault();
        applyRoots(moveNodeDown(roots, activeId), {
          ids: selectedIds,
          activeId,
          status: 'Moved topic down',
        });
        return;
      }

      if (metaPressed && event.key === ']') {
        event.preventDefault();
        applyRoots(indentNode(roots, activeId), {
          ids: selectedIds,
          activeId,
          status: 'Indented topic',
        });
        return;
      }

      if (metaPressed && event.key === '[') {
        event.preventDefault();
        applyRoots(outdentNode(roots, activeId), {
          ids: selectedIds,
          activeId,
          status: 'Outdented topic',
        });
        return;
      }

      if (event.key === '0') {
        event.preventDefault();
        setViewport(INITIAL_VIEWPORT);
        setStatus('Reset view');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeId, inlineEditor, layout, roots, selectedIds]);

  const handleCanvasPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return;
    }

    const additiveSelection = event.metaKey || event.ctrlKey || event.shiftKey;
    const hit = hitTestNode(layout, canvasWrapRef.current, viewport, event.clientX, event.clientY);

    if (hit) {
      if (additiveSelection) {
        toggleSelection(hit.id);
        return;
      }

      const isDraggingSelection = selectedIds.length > 1 && selectedIds.includes(hit.id);
      const selectionIds = isDraggingSelection ? selectedIds : [hit.id];
      const dragNodeIds = getMovableNodeIds(roots, selectionIds);

      if (isDraggingSelection) {
        setActiveId(hit.id);
      } else {
        setSingleSelection(hit.id);
      }

      const world = clientToWorld(canvasWrapRef.current, viewport, event.clientX, event.clientY);
      if (!world) {
        return;
      }
      dragSessionRef.current = {
        kind: 'pending-node',
        pointerId: event.pointerId,
        nodeId: hit.id,
        nodeIds: dragNodeIds,
        selectionIds,
        startClientX: event.clientX,
        startClientY: event.clientY,
        offsetWorldX: world.x - hit.x,
        offsetWorldY: world.y - hit.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const world = clientToWorld(canvasWrapRef.current, viewport, event.clientX, event.clientY);
    if (!world) {
      return;
    }

    dragSessionRef.current = {
      kind: 'marquee',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorldX: world.x,
      startWorldY: world.y,
      additive: additiveSelection,
      baseSelection: additiveSelection ? selectedIds : [],
    };
    setMarqueeOverlay(getMarqueeOverlay(
      canvasWrapRef.current,
      event.clientX,
      event.clientY,
      event.clientX,
      event.clientY,
    ));
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCanvasDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitTestNode(layout, canvasWrapRef.current, viewport, event.clientX, event.clientY);
    if (hit) {
      startEditingNode(hit.id);
      return;
    }
    if (inlineEditor) {
      commitInlineEditing();
    }
  };

  const handleCanvasPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (session.kind === 'marquee') {
      const world = clientToWorld(canvasWrapRef.current, viewport, event.clientX, event.clientY);
      if (!world) {
        return;
      }

      setMarqueeOverlay(getMarqueeOverlay(
        canvasWrapRef.current,
        session.startClientX,
        session.startClientY,
        event.clientX,
        event.clientY,
      ));

      const movement = Math.hypot(event.clientX - session.startClientX, event.clientY - session.startClientY);
      if (movement < DRAG_START_DISTANCE) {
        return;
      }

      const hits = getIntersectingNodeIds(
        layout,
        session.startWorldX,
        session.startWorldY,
        world.x,
        world.y,
      );

      if (hits.length === 0) {
        if (session.additive) {
          setSelectedIds(session.baseSelection);
          setActiveId(session.baseSelection[session.baseSelection.length - 1] ?? activeId);
          setStatus(session.baseSelection.length > 0 ? `Selected ${session.baseSelection.length} topics` : 'Selection cleared');
        } else {
          setSelectedIds([]);
          setActiveId(null);
          setStatus('Selection cleared');
        }
        return;
      }

      const nextIds = session.additive
        ? [...new Set([...session.baseSelection, ...hits])]
        : hits;
      setSelectedIds(nextIds);
      setActiveId(nextIds[nextIds.length - 1] ?? activeId);
      setStatus(`Selected ${nextIds.length} topics`);
      return;
    }

    if (session.kind === 'pending-node') {
      const movement = Math.hypot(event.clientX - session.startClientX, event.clientY - session.startClientY);
      if (movement < DRAG_START_DISTANCE) {
        return;
      }
    }

    const world = clientToWorld(canvasWrapRef.current, viewport, event.clientX, event.clientY);
    if (!world) {
      return;
    }

    const activeSession = session.kind === 'drag-node'
      ? session
      : {
          kind: 'drag-node' as const,
          pointerId: session.pointerId,
          nodeId: session.nodeId,
          nodeIds: session.nodeIds,
          selectionIds: session.selectionIds,
          offsetWorldX: session.offsetWorldX,
          offsetWorldY: session.offsetWorldY,
        };
    dragSessionRef.current = activeSession;

    const ghostX = world.x - activeSession.offsetWorldX;
    const ghostY = world.y - activeSession.offsetWorldY;
    const preview = resolveDropPreview(layout, roots, activeSession.nodeIds, ghostX, ghostY);
    setDragOverlay({
      nodeId: activeSession.nodeId,
      nodeIds: activeSession.nodeIds,
      ghostX,
      ghostY,
      preview,
    });
    setStatus(
      preview
        ? `${activeSession.nodeIds.length > 1 ? activeSession.nodeIds.length : 1} topics → ${preview.position}`
        : activeSession.nodeIds.length > 1
          ? `Dragging ${activeSession.nodeIds.length} topics`
          : 'Dragging topic',
    );
  };

  const handleCanvasPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    dragSessionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (session.kind === 'marquee') {
      const movement = Math.hypot(event.clientX - session.startClientX, event.clientY - session.startClientY);
      if (movement < DRAG_START_DISTANCE) {
        setSelectedIds([]);
        setActiveId(null);
        setStatus('Selection cleared');
      }
      setMarqueeOverlay(null);
      return;
    }

    if (session.kind === 'drag-node' && dragOverlay?.preview) {
      const nextRoots = session.nodeIds.length > 1
        ? moveNodes(roots, session.nodeIds, dragOverlay.preview.targetId, dragOverlay.preview.position)
        : moveNode(roots, session.nodeId, dragOverlay.preview.targetId, dragOverlay.preview.position);
      applyRoots(nextRoots, {
        ids: session.selectionIds,
        activeId: session.nodeId,
        status:
          session.nodeIds.length > 1
            ? (
                dragOverlay.preview.position === 'child'
                  ? `Moved ${session.nodeIds.length} topics as child topics`
                  : dragOverlay.preview.position === 'before'
                    ? `Inserted ${session.nodeIds.length} topics before target`
                    : `Inserted ${session.nodeIds.length} topics after target`
              )
            : (
                dragOverlay.preview.position === 'child'
                  ? 'Dropped as child topic'
                  : dragOverlay.preview.position === 'before'
                    ? 'Inserted before topic'
                    : 'Inserted after topic'
              ),
      });
      return;
    }

    setDragOverlay(null);
    setMarqueeOverlay(null);
  };

  const handleCanvasWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const wrapper = canvasWrapRef.current;
    if (!wrapper) {
      return;
    }

    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvasState.height : 1;
    if (!event.ctrlKey) {
      setViewport((current) => ({
        ...current,
        x: current.x - event.deltaX * scale,
        y: current.y - event.deltaY * scale,
      }));
      return;
    }

    const rect = wrapper.getBoundingClientRect();
    const offsetX = event.clientX - rect.left - rect.width / 2;
    const offsetY = event.clientY - rect.top - rect.height / 2;
    setViewport((current) => {
      const nextZoom = clampZoom(current.zoom * (event.deltaY > 0 ? 0.94 : 1.06));
      const worldX = (offsetX - current.x) / current.zoom;
      const worldY = (offsetY - current.y) / current.zoom;
      return {
        zoom: nextZoom,
        x: offsetX - worldX * nextZoom,
        y: offsetY - worldY * nextZoom,
      };
    });
  };

  const handleAddRoot = () => {
    const result = addRootNode(roots);
    applyRoots(result.roots, {
      ids: result.nodeId ? [result.nodeId] : [],
      activeId: result.nodeId,
      editNodeId: result.nodeId,
      status: 'Added root topic',
    });
  };

  const handleAddChild = () => {
    if (!activeId) {
      return;
    }
    const result = addChildNode(roots, activeId);
    if (result.nodeId) {
      applyRoots(result.roots, {
        ids: [result.nodeId],
        activeId: result.nodeId,
        editNodeId: result.nodeId,
        status: 'Added child topic',
      });
    }
  };

  const handleAddSibling = () => {
    if (!activeId) {
      return;
    }
    const result = addSiblingNode(roots, activeId);
    if (result.nodeId) {
      applyRoots(result.roots, {
        ids: [result.nodeId],
        activeId: result.nodeId,
        editNodeId: result.nodeId,
        status: 'Added sibling topic',
      });
    }
  };

  const handleApplyColor = (color: NodeColor | null) => {
    const targets = selectedIds.length > 0 ? selectedIds : activeId ? [activeId] : [];
    if (targets.length === 0) {
      return;
    }
    applyRoots(updateNodeColors(roots, targets, color), {
      ids: targets,
      activeId: activeId ?? targets[0],
      status: targets.length > 1 ? `Updated ${targets.length} topic colors` : 'Updated topic color',
    });
  };

  const handleSetLayoutMode = (nextMode: LayoutMode) => {
    setDocumentState((current) => (
      current.layoutMode === nextMode
        ? current
        : {
            ...current,
            layoutMode: nextMode,
          }
    ));
    setStatus(
      nextMode === 'balanced'
        ? 'Balanced layout'
        : nextMode === 'right'
          ? 'Right-growing layout'
          : 'Downward layout',
    );
  };

  const handleResetView = () => {
    setViewport(INITIAL_VIEWPORT);
    setStatus('Reset view');
  };

  return (
    <div className="lmp-workspace">
      <div className="lmp-stage" ref={canvasWrapRef}>
        <div className="lmp-frame">
          <header className="lmp-topbar">
            <button
              className="lmp-logo-badge"
              type="button"
              onClick={handleResetView}
              aria-label="Little House Markmap"
              title="Little House Markmap"
            >
              LMP
            </button>
            <div className="lmp-toolbar">
              <button className="lmp-toolbar-button" type="button" onClick={handleAddRoot}>
                根节点
              </button>
              <button className="lmp-toolbar-button" type="button" onClick={handleAddChild} disabled={!activeId}>
                子节点
              </button>
              <button className="lmp-toolbar-button" type="button" onClick={handleAddSibling} disabled={!activeId}>
                同级
              </button>
              <button className="lmp-toolbar-button" type="button" onClick={() => startEditingNode(activeId)} disabled={!activeId}>
                编辑
              </button>
              {LAYOUT_BUTTONS.map((layoutTool) => (
                <button
                  key={layoutTool.mode}
                  className={`lmp-toolbar-button${layoutMode === layoutTool.mode ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => handleSetLayoutMode(layoutTool.mode)}
                >
                  {layoutTool.label}
                </button>
              ))}
              <button className="lmp-toolbar-button" type="button" onClick={() => centerOnNode(activeId)} disabled={!activeId}>
                居中
              </button>
              <button className="lmp-toolbar-button" type="button" onClick={handleResetView}>
                重置视图
              </button>
              <button className="lmp-toolbar-button" type="button" onClick={deleteCurrentSelection} disabled={!activeId}>
                删除
              </button>
            </div>
            {hostConfigRef.current.platform === 'vscode' ? (
              <button
                className="lmp-source-button"
                type="button"
                onClick={() => vscodeApiRef.current?.postMessage({ type: 'lmp/openSource' })}
              >
                回到源码
              </button>
            ) : (
              <div className="lmp-source-button lmp-source-button--static">WEB MODE</div>
            )}
          </header>
        </div>

        <canvas
          ref={canvasRef}
          className="lmp-canvas"
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={handleCanvasPointerUp}
          onWheel={handleCanvasWheel}
          onDoubleClick={handleCanvasDoubleClick}
        />

        {marqueeOverlay && marqueeOverlay.width > 0 && marqueeOverlay.height > 0 ? (
          <div
            className="lmp-marquee"
            style={{
              left: `${marqueeOverlay.left}px`,
              top: `${marqueeOverlay.top}px`,
              width: `${marqueeOverlay.width}px`,
              height: `${marqueeOverlay.height}px`,
            }}
          />
        ) : null}

        {floatingPalettePosition && paletteTargets.length > 0 ? (
          <div
            className="lmp-floating-palette"
            style={{
              left: `${floatingPalettePosition.left}px`,
              top: `${floatingPalettePosition.top}px`,
            }}
          >
            <div className="lmp-floating-palette__swatches">
              {COLOR_SWATCHES.map((swatch) => (
                <button
                  key={`floating-${swatch.label}`}
                  className={`lmp-palette-swatch${paletteColor === swatch.id ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => handleApplyColor(swatch.id)}
                  title={swatch.label}
                  aria-label={swatch.label}
                >
                  <span
                    className="lmp-palette-swatch__fill"
                    style={{ background: swatch.preview }}
                  />
                </button>
              ))}
            </div>
            <button className="lmp-floating-palette__clear" type="button" onClick={() => handleApplyColor(null)}>
              清除
            </button>
          </div>
        ) : null}

        {inlineEditor && inlineEditorBox ? (
          <div
            className="lmp-inline-editor-shell"
            style={{
              left: `${inlineEditorBox.left}px`,
              top: `${inlineEditorBox.top}px`,
              width: `${inlineEditorBox.width}px`,
              height: `${inlineEditorBox.height}px`,
              ['--editor-fill' as string]: editingPalette?.fill ?? 'rgba(7, 9, 11, 0.96)',
              ['--editor-accent' as string]: editingPalette?.accent ?? '#d5ff00',
              ['--editor-text' as string]: editingPalette?.text ?? '#f3f6ef',
              ['--editor-shadow' as string]: editingPalette?.shadow ?? 'rgba(213, 255, 0, 0.24)',
              ['--editor-cut' as string]: `${(editingLayoutNode?.depth === 0 ? 18 : 12) * viewport.zoom}px`,
              ['--editor-font-size' as string]: `${(editingLayoutNode?.depth === 0 ? 18 : 14) * viewport.zoom}px`,
              ['--editor-line-height' as string]: `${(editingLayoutNode?.depth === 0 ? 24 : 22) * viewport.zoom}px`,
              ['--editor-padding-y' as string]: `${(editingLayoutNode?.depth === 0 ? 18 : 16) * viewport.zoom}px`,
              ['--editor-padding-x' as string]: `${(editingLayoutNode?.depth === 0 ? 20 : 18) * viewport.zoom}px`,
              ['--editor-font-family' as string]: editingLayoutNode?.depth === 0
                ? '"Avenir Next Condensed", "Arial Narrow", sans-serif'
                : '"IBM Plex Mono", monospace',
              ['--editor-font-weight' as string]: `${editingLayoutNode?.depth === 0 ? 700 : 600}`,
            }}
          >
            <textarea
              ref={inlineEditorRef}
              className="lmp-inline-editor"
              value={inlineEditor.value}
              onChange={(event) => setInlineEditor((current) => (
                current ? { ...current, value: event.target.value } : current
              ))}
              onBlur={commitInlineEditing}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelInlineEditing();
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  commitInlineEditing();
                }
              }}
              spellCheck={false}
              aria-label="编辑节点文字"
            />
          </div>
        ) : null}

        <aside className={`lmp-inspector-drawer${inspectorOpen ? ' is-open' : ''}`}>
          <div className="lmp-inspector-header">
            <div>
              <span className="lmp-inspector-label">SYSTEM PANEL // {fileTitle}.lmp</span>
              <h2>{selectedCount > 1 ? `${selectedCount} nodes active` : currentNode?.text ?? 'No active node'}</h2>
            </div>
            <button className="lmp-close-button" type="button" onClick={() => setInspectorOpen(false)}>
              CLOSE
            </button>
          </div>

          <div className="lmp-inspector-body">
            <section className="lmp-section">
              <div className="lmp-section-heading">
                <span>文本</span>
                <small>{currentNode ? `Depth ${layout.find((node) => node.id === currentNode.id)?.depth ?? 0}` : 'No active topic'}</small>
              </div>
              <textarea
                className="lmp-textarea"
                value={currentNode?.text ?? ''}
                onChange={(event) => {
                  if (!activeId) {
                    return;
                  }
                  applyRoots(updateNodeText(roots, activeId, event.target.value), {
                    ids: selectedIds,
                    activeId,
                    status: 'Topic updated',
                  });
                }}
                placeholder="Select a topic in the canvas"
              />
            </section>

            <section className="lmp-section">
              <div className="lmp-section-heading">
                <span>结构</span>
                <small>{dragOverlay?.preview ? '拖拽预览中' : 'Tree operations'}</small>
              </div>
              <div className="lmp-button-grid">
                <button className="lmp-panel-button" type="button" onClick={handleAddRoot}>
                  Add root
                </button>
                <button className="lmp-panel-button" type="button" onClick={handleAddChild} disabled={!activeId}>
                  Add child
                </button>
                <button className="lmp-panel-button" type="button" onClick={handleAddSibling} disabled={!activeId}>
                  Add sibling
                </button>
                <button className="lmp-panel-button" type="button" onClick={() => startEditingNode(activeId)} disabled={!activeId}>
                  Edit
                </button>
                <button className="lmp-panel-button" type="button" onClick={() => activeId && applyRoots(moveNodeUp(roots, activeId), { ids: selectedIds, activeId, status: 'Moved topic up' })} disabled={!activeId}>
                  Move up
                </button>
                <button className="lmp-panel-button" type="button" onClick={() => activeId && applyRoots(moveNodeDown(roots, activeId), { ids: selectedIds, activeId, status: 'Moved topic down' })} disabled={!activeId}>
                  Move down
                </button>
                <button className="lmp-panel-button" type="button" onClick={() => activeId && applyRoots(indentNode(roots, activeId), { ids: selectedIds, activeId, status: 'Indented topic' })} disabled={!activeId}>
                  Indent
                </button>
                <button className="lmp-panel-button" type="button" onClick={() => activeId && applyRoots(outdentNode(roots, activeId), { ids: selectedIds, activeId, status: 'Outdented topic' })} disabled={!activeId}>
                  Outdent
                </button>
                <button className="lmp-panel-button" type="button" onClick={() => centerOnNode(activeId)} disabled={!activeId}>
                  Center
                </button>
                <button className="lmp-panel-button" type="button" onClick={() => setViewport(INITIAL_VIEWPORT)}>
                  Reset view
                </button>
                <button className="lmp-panel-button" type="button" onClick={deleteCurrentSelection} disabled={!activeId}>
                  Delete
                </button>
                <button className="lmp-panel-button" type="button" onClick={() => downloadDocument(`${fileTitle}.lmp`, documentText)}>
                  Export
                </button>
              </div>
            </section>

            {paletteTargets.length > 0 ? (
              <section className="lmp-section">
                <div className="lmp-section-heading">
                  <span>颜色</span>
                  <small>{selectedCount > 1 ? `应用到 ${selectedCount} 个节点` : '应用到当前节点'}</small>
                </div>
                <div className="lmp-palette-grid">
                  {COLOR_SWATCHES.map((swatch) => (
                    <button
                      key={swatch.label}
                      className={`lmp-palette-swatch${paletteColor === swatch.id ? ' is-active' : ''}`}
                      type="button"
                      onClick={() => handleApplyColor(swatch.id)}
                      title={swatch.label}
                      aria-label={swatch.label}
                    >
                      <span
                        className="lmp-palette-swatch__fill"
                        style={{ background: swatch.preview }}
                      />
                    </button>
                  ))}
                </div>
                <button className="lmp-color-reset" type="button" onClick={() => handleApplyColor(null)}>
                  CLEAR COLOR
                </button>
              </section>
            ) : null}

            <section className="lmp-section">
              <div className="lmp-section-heading">
                <span>Plain text outline</span>
                <small>`\n` becomes a line break inside topics</small>
              </div>
              <textarea
                className="lmp-source"
                value={sourceValue}
                onChange={(event) => {
                  setSourceValue(event.target.value);
                  setSourceDirty(true);
                }}
                spellCheck={false}
              />
              <div className="lmp-inline-actions">
                <button
                  className="lmp-panel-button"
                  type="button"
                  onClick={() => {
                    setSourceValue(documentText);
                    setSourceDirty(false);
                  }}
                >
                  Reset
                </button>
                <button className="lmp-panel-button lmp-panel-button--accent" type="button" onClick={handleApplySource}>
                  Apply source
                </button>
              </div>
            </section>

            <section className="lmp-section">
              <div className="lmp-section-heading">
                <span>Interaction model</span>
                <small>Trackpad, keyboard, and drag behavior</small>
              </div>
              <div className="lmp-shortcuts">
                {SHORTCUTS.map((shortcut) => (
                  <div className="lmp-shortcut" key={shortcut.keys}>
                    <span>{shortcut.label}</span>
                    <code>{shortcut.keys}</code>
                  </div>
                ))}
              </div>
            </section>

            {warnings.length > 0 ? (
              <section className="lmp-section">
                <div className="lmp-section-heading">
                  <span>Parser notes</span>
                  <small>Source cleanup</small>
                </div>
                <textarea className="lmp-source" value={warnings.join('\n')} readOnly />
              </section>
            ) : null}
          </div>
        </aside>

        {!inspectorOpen ? (
          <button className="lmp-drawer-toggle" type="button" onClick={() => setInspectorOpen(true)}>
            属性
          </button>
        ) : null}
      </div>
    </div>
  );
}
