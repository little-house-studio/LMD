import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';
import {
  createDefaultLayout,
  defaultSubgraphStyle,
  defaultEdgeStyle,
  measureNodeContentSize,
  normalizeEdgeStyle,
  serializeMermaidDocument,
} from './lib/mermaid';
import {
  buildProjectSuffixMarkdown,
  createProjectMarkdownTemplate,
  extractMermaidFromProjectMarkdown,
  parseProjectMarkdown,
  serializeProjectMarkdown,
  standardizeProjectMarkdown,
} from './lib/projectMarkdown';
import {
  buildEntityIdFromTitle,
  normalizeEntityIdBase,
} from './lib/entityId';
import {
  createStressTestProjectMarkdown,
  defaultStressTestProjectLabel,
  sampleProjectMarkdown,
} from './lib/sample';
import { storageKeys } from './lib/storage';
import {
  CanvasTextCache,
  SceneSpatialIndex,
  type SceneIndexEntry,
} from './lib/canvasEngine';
import {
  BaseSceneCache,
  applyWheelPanViewport,
  applyWheelZoomViewport,
  clientToWorldPoint,
  hotPathCounters,
  resolveInteractionViewport,
  seedPanInitialViewport,
  selectPaintEdgesFromTopology,
  selectPaintNodesFromTopology,
  topologyRevisionFromGraph,
  viewportToWorldRect,
  type HotPathViewport,
} from './lib/sceneHotPath';
import type {
  Direction,
  EditorMode,
  GraphDocument,
  GraphEdge,
  GraphNode,
  GraphOperation,
  GraphOperationBatchResult,
  GraphSemanticSnapshot,
  GraphSubgraph,
  HistoryEntry,
  LayoutSidecar,
  NodeShape,
  EdgeType,
  ProjectCompatExtras,
  SelectionState,
  ViewportState,
} from './lib/types';

type LeftPanel = 'files' | 'graph';
type WorkspaceTabId = 'diagram';

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EdgeEndpointBox extends Rect {
  id: string;
  kind: 'node' | 'subgraph';
  fill: string;
  stroke: string;
  textColor: string;
}

interface DragState {
  kind: 'node' | 'subgraph' | 'content';
  origin: Point;
  current: Point;
  ids: string[];
  initialPositions: Record<string, Point>;
  entityId?: string | null;
}

interface BoxState {
  origin: Point;
  current: Point;
  toggle: boolean;
}

interface PanState {
  origin: Point;
  initialViewport: ViewportState;
}

interface ConnectingState {
  fromId: string;
  fromIds: string[];
  origin: Point;
  current: Point;
  edgeType: GraphEdge['type'];
  handleSide: 'left' | 'right';
}

interface GestureState {
  scale: number;
}

interface SubgraphFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  collapsed: boolean;
  headerHeight: number;
  memberCount: number;
  summaryLabels: string[];
}

interface SubgraphBlobShape {
  id: string;
  bounds: Rect;
  defaultBadgeAnchor: Point;
  fieldThreshold: number;
  depth: number;
  collapsed: boolean;
  primitives: BlobPrimitive[];
  regions: Array<{
    bounds: Rect;
    path: string;
  }>;
}

interface ContourSegment {
  start: Point;
  end: Point;
}

interface BlobRoundedRectPrimitive {
  kind: 'rounded-rect';
  rect: Rect;
  radius: number;
  softness: number;
  weight: number;
}

interface BlobCapsulePrimitive {
  kind: 'capsule';
  start: Point;
  end: Point;
  radius: number;
  softness: number;
  weight: number;
}

type BlobPrimitive = BlobRoundedRectPrimitive | BlobCapsulePrimitive;
type BlobContourDetail = 'full' | 'interactive';

interface SubgraphBadgeAnchor {
  offsetX: number;
  offsetY: number;
}

interface GraphTreeItem {
  id: string;
  depth: number;
  kind: 'subgraph' | 'node';
  label: string;
  meta: string;
}

interface ContentInspectorDraft {
  markdown: string;
}

interface ProjectInspectorDraft {
  projectName: string;
  projectSummary: string;
  contentMarkdown: string;
}

interface ContentCardLayout {
  x: number;
  y: number;
  collapsed: boolean;
  width?: number;
  height?: number;
}

interface MiniMapDragState {
  pointerId: number;
  grabOffsetX: number;
  grabOffsetY: number;
}

interface PanelResizeState {
  side: 'left' | 'right';
  startX: number;
  startWidth: number;
}

interface ContentCardResizeState {
  edge: 'right' | 'bottom' | 'corner';
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  width: number;
  height: number;
}

interface NodeClipboardState {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const PINCH_RESPONSE = 1.3;
const WHEEL_PINCH_DIVISOR = 360;
const MIN_CANVAS_ZOOM = 0.05;
const MAX_CANVAS_ZOOM = 2.8;
const NAV_RAIL_WIDTH = 38;
const DEFAULT_SIDEBAR_WIDTH = 188;
const DEFAULT_INSPECTOR_WIDTH = 320;
const CONTENT_CARD_MIN_WIDTH = 116;
const CONTENT_CARD_MAX_WIDTH = 360;
const CONTENT_CARD_COLLAPSED_HEIGHT = 38;
const CONTENT_CARD_MIN_HEIGHT = 80;
const CONTENT_CARD_MAX_HEIGHT = 320;
const DEFAULT_CONTENT_CARD_X = 18;
const DEFAULT_CONTENT_CARD_Y = 64;
const MIN_SIDEBAR_WIDTH = 164;
const MIN_INSPECTOR_WIDTH = 272;
const MAX_SIDEBAR_WIDTH = 280;
const MAX_INSPECTOR_WIDTH = 420;
const MIN_WORKSPACE_CENTER_WIDTH = 360;
const SUBGRAPH_HEADER_HEIGHT = 42;
const SUBGRAPH_MIN_WIDTH = 284;
const SUBGRAPH_MIN_HEIGHT = 176;
const SUBGRAPH_COLLAPSED_HEIGHT = 88;
const SUBGRAPH_COLLAPSED_MIN_WIDTH = 220;
const SUBGRAPH_HORIZONTAL_PADDING = 28;
const SUBGRAPH_TOP_PADDING = 18;
const SUBGRAPH_BOTTOM_PADDING = 24;
const CONTENT_CARD_ID = '__content__';
const MINIMAP_WIDTH = 208;
const MINIMAP_HEIGHT = 128;
const PERF_DEBUG_QUERY_KEY = 'lmdPerf';
const PERF_DEBUG_SUMMARY_INTERVAL_MS = 1200;
const PERF_DEBUG_SLOW_SAMPLE_MS = 8;
const PERF_DEBUG_LOG_THRESHOLD_MS = 12;
const HYBRID_SCENE_NODE_THRESHOLD = 220;
const HYBRID_SCENE_EDGE_THRESHOLD = 320;
const HYBRID_SCENE_VIEWPORT_MARGIN_PX = 260;
const HYBRID_SCENE_TITLE_ZOOM_THRESHOLD = 0.38;
const HYBRID_SCENE_DESCRIPTION_ZOOM_THRESHOLD = 0.72;
const HYBRID_SCENE_SIMPLIFIED_ZOOM_THRESHOLD = 0.22;
const HYBRID_SCENE_ARROW_ZOOM_THRESHOLD = 0.28;
const SCENE_INDEX_BUCKET_SIZE = 512;
const SCENE_EDGE_INDEX_BUCKET_SIZE = 768;
const NODE_DRAG_PREVIEW_CLASS = 'is-engine-dragging';
const sceneTextCache = new CanvasTextCache(2400);

interface ExplorerItem {
  id: string;
  label: string;
  meta: string;
  depth: number;
  kind: 'project' | 'folder' | 'file';
  path: string;
  parentId?: string | null;
  tabId?: WorkspaceTabId;
  mode?: EditorMode;
}

interface LocalProjectWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface LocalProjectFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable?(): Promise<LocalProjectWritable>;
}

interface LocalProjectDirectoryHandle {
  kind: 'directory';
  name: string;
  entries(): AsyncIterableIterator<[string, LocalProjectHandle]>;
  getFileHandle?(name: string, options?: { create?: boolean }): Promise<LocalProjectFileHandle>;
  getDirectoryHandle?(name: string, options?: { create?: boolean }): Promise<LocalProjectDirectoryHandle>;
  removeEntry?(name: string, options?: { recursive?: boolean }): Promise<void>;
}

type LocalProjectHandle = LocalProjectFileHandle | LocalProjectDirectoryHandle;

interface LocalHandleEntry {
  handle: LocalProjectHandle;
  parentId: string | null;
  parentHandle: LocalProjectDirectoryHandle | null;
}

interface NodeInspectorDraft {
  label: string;
  description: string;
  shape: NodeShape;
  fill: string;
  stroke: string;
  textColor: string;
}

interface EdgeInspectorDraft {
  label: string;
  type: GraphEdge['type'];
  strokeColor: string;
  strokeWidthInput: string;
}

interface SubgraphInspectorDraft {
  title: string;
  description: string;
  collapsed: boolean;
  fill: string;
  stroke: string;
  textColor: string;
}

interface AiSettingsDraft {
  apiKey: string;
  apiUrl: string;
  model: string;
  contextWindow: number;
  systemPrompt: string;
  lockProjectMeta: boolean;
  lockAdditionalInfo: boolean;
  lockDiagram: boolean;
}

interface AiMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  createdAt: string;
  status?: 'error';
}

interface AiConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AiMessage[];
}

type AiChangeTargetKind = 'project' | 'content' | 'node' | 'edge' | 'subgraph';

interface AiChangeBubble {
  id: string;
  kind: AiChangeTargetKind;
  label: string;
  detail: string;
  targetId?: string;
}

interface AiToolChangeTarget {
  kind: AiChangeTargetKind;
  label: string;
  detail: string;
  targetId?: string;
}

interface AiToolExecutionResult {
  ok: boolean;
  revision?: number;
  markdown?: string;
  warnings?: string[];
  changes?: AiToolChangeTarget[];
  [key: string]: unknown;
}

interface AppHostConfig {
  platform?: 'web' | 'vscode';
  initialMarkdown?: string;
  fileName?: string;
  perfDebug?: boolean;
}

interface VsCodeWebviewApi {
  postMessage(message: unknown): void;
  setState?(state: unknown): void;
  getState?(): unknown;
}

type AiPanelTab = 'chat' | 'settings';
type InlineNodeField = 'title' | 'description';
type SearchResultKind = 'subgraph' | 'node';

interface CanvasSearchResult {
  id: string;
  kind: SearchResultKind;
  label: string;
  meta: string;
  rect: Rect;
  score: number;
}
interface SceneRenderableEdge {
  edge: GraphEdge;
  fromEndpoint: EdgeEndpointBox;
  toEndpoint: EdgeEndpointBox;
  geometry: ReturnType<typeof buildEdgeGeometry>;
}
type InspectorView = 'properties' | 'ai';

interface PerfMetricAccumulator {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  slowCount: number;
}

interface PerfMetricEntry extends PerfMetricAccumulator {
  label: string;
  avgMs: number;
}

interface PerfDebugSnapshot {
  visibleNodeCount: number;
  visibleEdgeCount: number;
  subgraphFrameCount: number;
  blobRegionCount: number;
  blobPrimitiveCount: number;
  canvasNodeCount: number;
  canvasEdgeCount: number;
  overlayNodeCount: number;
  overlayEdgeCount: number;
}

interface PerfDebugSummary {
  windowMs: number;
  renderCount: number;
  pointerMoves: number;
  dragPointerMoves: number;
  boxPointerMoves: number;
  panPointerMoves: number;
  connectPointerMoves: number;
  hotLabel: string | null;
  snapshot: PerfDebugSnapshot;
  entries: PerfMetricEntry[];
}

type IconName =
  | 'menu'
  | 'files'
  | 'graph'
  | 'inspect'
  | 'canvas'
  | 'source'
  | 'history'
  | 'copy'
  | 'share'
  | 'download'
  | 'cursor'
  | 'node'
  | 'group'
  | 'reset'
  | 'minus'
  | 'plus'
  | 'preview'
  | 'chevron-left'
  | 'chevron-right'
  | 'link-start'
  | 'link-end'
  | 'trash'
  | 'chat'
  | 'settings'
  | 'layout'
  | 'tidy'
  | 'standardize'
  | 'search';

const shapeOptions: Array<{ label: string; value: NodeShape }> = [
  { label: '矩形', value: 'rect' },
  { label: '圆角', value: 'round' },
  { label: '菱形', value: 'diamond' },
  { label: '圆形', value: 'circle' },
  { label: '六边形', value: 'hexagon' },
  { label: '数据库', value: 'database' },
  { label: '子程序', value: 'subroutine' },
];

const nodeStylePresets = [
  { id: 'void', label: '虚空', fill: '#121214', stroke: '#d6ff3a', textColor: '#f4f4f5' },
  { id: 'acid', label: '酸青', fill: '#0e1a14', stroke: '#00f0ff', textColor: '#e8fffb' },
  { id: 'signal', label: '信号', fill: '#1a1808', stroke: '#ffe600', textColor: '#fff8c8' },
  { id: 'hotzone', label: '热区', fill: '#1a0a12', stroke: '#ff2a6d', textColor: '#ffe0ea' },
  { id: 'matrix', label: '矩阵', fill: '#10160c', stroke: '#7cff6b', textColor: '#e8ffe4' },
  { id: 'plasma', label: '等离子', fill: '#140e1c', stroke: '#c77dff', textColor: '#f3e8ff' },
  { id: 'ember', label: '燃核', fill: '#1a100a', stroke: '#ff6b2c', textColor: '#ffe8d8' },
  { id: 'mono', label: '单色', fill: '#0a0a0c', stroke: '#f4f4f5', textColor: '#f4f4f5' },
  { id: 'invert', label: '反相', fill: '#f4f4f5', stroke: '#0a0a0c', textColor: '#0a0a0c' },
  { id: 'runner', label: 'Runner', fill: '#0c0c10', stroke: '#d6ff3a', textColor: '#d6ff3a' },
] as const;

const subgraphColorPresets = [
  { fill: '#121418', stroke: '#00f0ff', textColor: '#e8fffb' },
  { fill: '#14120a', stroke: '#ffe600', textColor: '#fff8c8' },
  { fill: '#141018', stroke: '#c77dff', textColor: '#f3e8ff' },
  { fill: '#10160e', stroke: '#7cff6b', textColor: '#e8ffe4' },
  { fill: '#180c12', stroke: '#ff2a6d', textColor: '#ffe0ea' },
  { fill: '#121214', stroke: '#d6ff3a', textColor: '#f4f4f5' },
  { fill: '#1a100a', stroke: '#ff6b2c', textColor: '#ffe8d8' },
  { fill: '#0a0a0c', stroke: '#f4f4f5', textColor: '#f4f4f5' },
] as const;

const collaboratorPresets = [
  { id: 'lin', name: 'Lin', role: '画布', color: '#d6ff3a' },
  { id: 'mina', name: 'Mina', role: '源码', color: '#00f0ff' },
  { id: 'kai', name: 'Kai', role: '评审', color: '#ff2a6d' },
] as const;

function hashStringToNumber(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getSubgraphStyle(
  subgraph: Pick<GraphSubgraph, 'id' | 'fill' | 'stroke' | 'textColor'> | null | undefined,
) {
  const hasCustomStyle =
    subgraph != null &&
    (
      subgraph.fill !== defaultSubgraphStyle.fill ||
      subgraph.stroke !== defaultSubgraphStyle.stroke ||
      subgraph.textColor !== defaultSubgraphStyle.textColor
    );
  if (!hasCustomStyle) {
    const preset = subgraphColorPresets[
      hashStringToNumber(subgraph?.id ?? 'subgraph-default') % subgraphColorPresets.length
    ];
    return {
      fill: preset.fill,
      stroke: preset.stroke,
      textColor: preset.textColor,
    };
  }

  return {
    fill: subgraph?.fill ?? defaultSubgraphStyle.fill,
    stroke: subgraph?.stroke ?? defaultSubgraphStyle.stroke,
    textColor: subgraph?.textColor ?? defaultSubgraphStyle.textColor,
  };
}

const workspaceTabs: Array<{ id: WorkspaceTabId; label: string; detail: string }> = [
  { id: 'diagram', label: 'diagram.lmd', detail: '主图' },
];

const defaultLocalProjectItems: ExplorerItem[] = [];

async function scanLocalProjectDirectory(root: LocalProjectDirectoryHandle) {
  const nextItems: ExplorerItem[] = [
    {
      id: 'local-project',
      label: root.name,
      meta: '本地项目',
      depth: 0,
      kind: 'project',
      path: `local://${root.name}`,
      parentId: null,
    },
  ];
  const nextHandles: Record<string, LocalHandleEntry> = {
    'local-project': {
      handle: root,
      parentId: null,
      parentHandle: null,
    },
  };
  let folderIndex = 0;
  let fileIndex = 0;

  const walk = async (
    directory: LocalProjectDirectoryHandle,
    parentId: string,
    depth: number,
    basePath: string,
  ) => {
    const entries: Array<[string, LocalProjectHandle]> = [];
    for await (const entry of directory.entries()) {
      entries.push(entry);
    }

    entries.sort((left, right) => {
      if (left[1].kind !== right[1].kind) {
        return left[1].kind === 'directory' ? -1 : 1;
      }
      return left[0].localeCompare(right[0]);
    });

    for (const [name, handle] of entries) {
      const nextPath = `${basePath}/${name}`;
      if (handle.kind === 'directory') {
        const id = `local-folder-${folderIndex++}`;
        nextItems.push({
          id,
          label: name,
          meta: '文件夹',
          depth,
          kind: 'folder',
          path: nextPath,
          parentId,
        });
        nextHandles[id] = {
          handle,
          parentId,
          parentHandle: directory,
        };
        await walk(handle, id, depth + 1, nextPath);
        continue;
      }

      if (!/\.lmd$/i.test(name)) {
        continue;
      }

      const id = `local-file-${fileIndex++}`;
      nextItems.push({
        id,
        label: name,
        meta: 'LMD 工程',
        depth,
        kind: 'file',
        path: nextPath,
        parentId,
        tabId: 'diagram',
        mode: 'canvas',
      });
      nextHandles[id] = {
        handle,
        parentId,
        parentHandle: directory,
      };
    }
  };

  await walk(root, 'local-project', 1, `local://${root.name}`);

  return {
    items: nextItems,
    handles: nextHandles,
  };
}

const leftPanelMeta: Array<{ id: LeftPanel; label: string; icon: IconName }> = [
  { id: 'files', label: '文件', icon: 'files' },
  { id: 'graph', label: '图谱', icon: 'graph' },
];

const modeMeta: Array<{ id: EditorMode; label: string; icon: IconName }> = [
  { id: 'canvas', label: '画布', icon: 'canvas' },
  { id: 'source', label: '源码', icon: 'source' },
  { id: 'history', label: '历史', icon: 'history' },
];

const defaultAiSettings: AiSettingsDraft = {
  apiKey: '',
  apiUrl: 'https://api.gpt.ge/v1/chat/completions',
  model: 'gpt-5.4-mini',
  contextWindow: 200000,
  systemPrompt: [
    'You are the internal assistant for an LMD workspace.',
    'LMD is a single-file Markdown format stored as a .lmd file.',
    'Use the current graph semantic snapshot and the latest full LMD document as the primary context.',
    'Be concise, practical, and grounded in the provided workspace state.',
    'When tools are available, you must use them to read or write instead of claiming that structured updates are impossible.',
    'If a request is local, prefer local tools. Do not demand an operations array unless you truly need structural graph operations.',
    'Unless the request requires it, avoid changing already-written text.',
    'Prefer targeted edits over refactors.',
    'Prefer creating groups, and nested groups when they improve clarity.',
    'Prefer arranging related nodes into clear functional blocks or progressive workflow blocks when it improves readability.',
    'The current structured canvas and semantic tools support Mermaid flowchart/graph diagrams only.',
    'Do not introduce classDiagram, sequenceDiagram, ER, UML-like structures, or any other Mermaid diagram type unless the user explicitly asks for source-only Mermaid that will not be edited on the canvas.',
    'Current LMD file structure is: `# Project Name`, `## Summary`, `## Diagram` with one standard ```mermaid``` block, `## Content`, and one final ```lths-compat``` block.',
    'The Mermaid block must remain standard Mermaid syntax.',
    'Canvas nodes conceptually have a title and a description. In Mermaid source, the node ID should be derived from the title with a short unique suffix, and the Mermaid label should contain the description only.',
    'There is no separate `Node Annotations` section in the current format.',
    'When editing only part of the document, preserve unrelated text, node positions, and unaffected groups.',
  ].join(' '),
  lockProjectMeta: true,
  lockAdditionalInfo: true,
  lockDiagram: false,
};

function createAiMessage(
  role: AiMessage['role'],
  content: string,
  status?: AiMessage['status'],
): AiMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    ...(status ? { status } : {}),
  };
}

const defaultAiMessages: AiMessage[] = [
  {
    id: 'ai-welcome',
    role: 'assistant',
    content: 'AI 验证入口已打开。现在会附带完整 LMD 文档、相对上一轮的改动、当前选中内容，并允许 AI 调用本地工具修改文档。',
    createdAt: new Date().toISOString(),
  },
];

function createAiConversationRecord(
  title = '新对话',
  messages: AiMessage[] = defaultAiMessages,
): AiConversationRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    messages,
  };
}

const aiLockControls = [
  { key: 'lockProjectMeta', label: '标题 / 简介', unlocked: '允许修改标题与简介' },
  { key: 'lockAdditionalInfo', label: '附加信息', unlocked: '允许修改附加信息' },
  { key: 'lockDiagram', label: '流程图', unlocked: '允许修改流程图' },
] as const;

function deriveAiConversationTitle(messages: AiMessage[]) {
  const userMessage = messages.find((message) => message.role === 'user');
  if (!userMessage) {
    return '新对话';
  }

  const normalized = userMessage.content.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 20) || '新对话';
}

function normalizeStoredAiMessages(messages: AiMessage[]) {
  return messages.map((message) => ({
    ...message,
    createdAt: message.createdAt ?? new Date().toISOString(),
  }));
}

function sameAiMessages(left: AiMessage[], right: AiMessage[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((message, index) => {
    const candidate = right[index];
    return (
      candidate &&
      message.id === candidate.id &&
      message.role === candidate.role &&
      message.content === candidate.content &&
      message.createdAt === candidate.createdAt &&
      message.status === candidate.status
    );
  });
}

function readInitialAiConversationRecords() {
  const storedRecords = readStoredArray<AiConversationRecord>(storageKeys.aiSessions, []);
  if (storedRecords.length > 0) {
    return storedRecords.map((record) => ({
      ...record,
      messages: normalizeStoredAiMessages(record.messages ?? defaultAiMessages),
      title: record.title || deriveAiConversationTitle(record.messages ?? defaultAiMessages),
      createdAt: record.createdAt ?? new Date().toISOString(),
      updatedAt: record.updatedAt ?? new Date().toISOString(),
    }));
  }

  const legacyMessages = readStoredArray<AiMessage>(storageKeys.aiChat, defaultAiMessages);
  return [
    createAiConversationRecord(
      deriveAiConversationTitle(legacyMessages),
      normalizeStoredAiMessages(legacyMessages),
    ),
  ];
}

const aiToolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_graph_semantic_snapshot',
      description: 'Read the current semantic LMD project snapshot for a flowchart-based LMD document, including Project Name, Summary, Additional Information, nodes with title/description semantics, unique node IDs, node coordinates and sizes, edges, subgraphs, and current selection.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_lmd_sections',
      description: 'Update top-level LMD sections without rewriting the whole file. Use this for Project Name, Summary, or Additional Information changes. This is the preferred tool for partial Markdown edits outside the flowchart structure.',
      parameters: {
        type: 'object',
        properties: {
          projectName: {
            type: 'string',
          },
          projectSummary: {
            type: 'string',
          },
          contentMarkdown: {
            type: 'string',
          },
          detail: {
            type: 'string',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_lmd_entities',
      description: 'Update existing nodes, edges, or subgraphs by ID without describing generic operations. Use this for local text/label/title/description edits. Always prefer IDs from the current selection or graph semantic snapshot.',
      parameters: {
        type: 'object',
        properties: {
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
          edges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                type: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
          subgraphs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                collapsed: { type: 'boolean' },
              },
              additionalProperties: false,
            },
          },
          detail: {
            type: 'string',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_graph_operation_batch',
      description: 'Apply structured graph operations to the current LMD document when the Diagram section is a flowchart/graph Mermaid diagram. Use this only for structural changes such as creating, deleting, connecting, regrouping, or moving entities. It requires an explicit operations array.',
      parameters: {
        type: 'object',
        properties: {
          operations: {
            type: 'array',
            items: {
              type: 'object',
            },
          },
          expectedRevision: {
            type: 'number',
          },
          title: {
            type: 'string',
          },
          detail: {
            type: 'string',
          },
        },
        required: ['operations'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_project_markdown',
      description: 'Read the latest full LMD document, including Project Name, Summary, Diagram, Additional Information, and the final lths-compat block.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_project_markdown',
      description: 'Write the full LMD document and normalize it into the current structure: Project Name, Summary, Diagram, Content, and a final lths-compat block.',
      parameters: {
        type: 'object',
        properties: {
          markdown: {
            type: 'string',
          },
        },
        required: ['markdown'],
        additionalProperties: false,
      },
    },
  },
] as const;

const aiToolRules = [
  'Prefer tools over guesswork whenever the user asks to change the document.',
  'Prefer update_lmd_sections for Project Name, Summary, or Additional Information edits.',
  'Prefer update_lmd_entities for local node, edge, or subgraph text edits.',
  'Prefer apply_graph_operation_batch for structural diagram edits.',
  'Never answer that you need an operations array if the request can be satisfied by update_lmd_sections, update_lmd_entities, get_project_markdown, or set_project_markdown.',
  'For partial document edits, use update_lmd_sections or update_lmd_entities before attempting a full rewrite.',
  'Treat the project as an LMD document: a single Markdown file with the sections Project Name, Summary, Diagram, Content, and a final lths-compat block.',
  'Use the full LMD file syntax exactly. Do not invent old sections such as Node Annotations.',
  'The current structured canvas model supports Mermaid flowchart/graph only.',
  'Do not generate classDiagram, sequenceDiagram, stateDiagram, ER, UML-like structures, or other Mermaid diagram types unless the user explicitly asks for source-only Mermaid and accepts that it will not be editable on the canvas.',
  'If the current Diagram is not a flowchart/graph, preserve it as source. Do not try to convert it into flowchart unless the user explicitly asks for a conversion.',
  'Prefer the smallest valid layer: graph operations first, section-preserving Markdown edits second, full rewrites last.',
  'Do not invent new top-level sections unless the user explicitly asks for them.',
  'Prefer preserving the existing section structure instead of rewriting the whole file.',
  'Node IDs are unique and stable within the document. Node coordinates in the semantic snapshot correspond to those IDs and should be used to keep local edits local.',
  'When there is an active selection, treat it as the primary scope. Mention the selected IDs in tool arguments whenever possible.',
  'When structure changes are not required, avoid apply_graph_operation_batch and do not complain that operations are missing; use update_lmd_sections, update_lmd_entities, or set_project_markdown instead.',
  'Use set_project_markdown only for broader Markdown rewrites or when the batch tool cannot express the change cleanly.',
  'Treat the current selection as the primary scope unless the user clearly asks for a wider change.',
  'After editing, briefly summarize what changed.',
].join('\n');

const aiProjectFormatGuide = [
  'LMD document format:',
  'LMD stands for a single-file Markdown document used by this editor and stored as a `.lmd` file.',
  '1. `# Project Name`',
  '2. `## Summary`',
  '3. `## Diagram` with one standard ```mermaid``` block',
  '4. `## Content` for Additional Information Markdown',
  '5. final ```lths-compat``` block for editor-only layout state',
  'Example:',
  '```md',
  '# Project Name',
  '',
  '## Summary',
  '',
  'Short project summary.',
  '',
  '## Diagram',
  '',
  '```mermaid',
  'flowchart LR',
  '  产品说明_a7c["整理需求与范围"]',
  '  评审完成_p4k["通过"]',
  '  产品说明_a7c -->|通过| 评审完成_p4k',
  '```',
  '',
  '## Content',
  '',
  '- Any normal Markdown content can live here.',
  '',
  '```lths-compat',
  'v1',
  '```',
  '```',
  'The Mermaid block should stay standard Mermaid syntax.',
  'The current format does not use a separate `Node Annotations` section.',
  'Canvas nodes conceptually have a title and a description. In source, the node ID is title-derived with a short unique suffix, and the Mermaid label stores the description only.',
  'Node IDs must remain unique. They are the stable reference for local graph edits and correspond to node coordinates in the graph semantic snapshot.',
  'The current canvas editor and structured AI tools support flowchart/graph diagrams only.',
  'Other Mermaid diagram types may exist in source form and preview correctly, but they should be preserved as source instead of being rewritten through flowchart graph operations.',
  'Edit the smallest valid layer possible. Prefer section-preserving changes over full rewrites.',
].join('\n');

function readAppHostConfig(): AppHostConfig {
  const config = (window as Window & { __LMD_EDITOR_CONFIG__?: AppHostConfig }).__LMD_EDITOR_CONFIG__;
  if (!config || typeof config !== 'object') {
    return { platform: 'web' };
  }

  return {
    platform: config.platform === 'vscode' ? 'vscode' : 'web',
    initialMarkdown: typeof config.initialMarkdown === 'string' ? config.initialMarkdown : undefined,
    fileName: typeof config.fileName === 'string' ? config.fileName : undefined,
    perfDebug: typeof config.perfDebug === 'boolean' ? config.perfDebug : undefined,
  };
}

function getProjectFallbackName(fileName?: string) {
  if (!fileName) {
    return 'Untitled LMD';
  }

  return fileName.replace(/\.lmd$/i, '') || 'Untitled LMD';
}

function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fallback;
    }

    return {
      ...(fallback as object),
      ...(parsed as object),
    } as T;
  } catch {
    return fallback;
  }
}

function readStoredArray<T>(key: string, fallback: T[]) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
}

function readStoredString(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function readStoredNumber(key: string, fallback: number) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }

    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readStoredBoolean(key: string, fallback: boolean) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }

    return raw === '1' || raw === 'true';
  } catch {
    return fallback;
  }
}

function readPerfDebugEnabled(hostConfig: AppHostConfig) {
  if (typeof hostConfig.perfDebug === 'boolean') {
    return hostConfig.perfDebug;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const queryValue = params.get(PERF_DEBUG_QUERY_KEY) ?? params.get('perf');
    if (queryValue === '1' || queryValue === 'true') {
      return true;
    }
    if (queryValue === '0' || queryValue === 'false') {
      return false;
    }
  } catch {
    // Ignore malformed URLs and fall back to persisted state.
  }

  return readStoredBoolean(storageKeys.perfDebug, false);
}

function createPerfCounterSnapshot() {
  return {
    pointerMoves: 0,
    dragPointerMoves: 0,
    boxPointerMoves: 0,
    panPointerMoves: 0,
    connectPointerMoves: 0,
  };
}

function createPerfDebugSnapshot(): PerfDebugSnapshot {
  return {
    visibleNodeCount: 0,
    visibleEdgeCount: 0,
    subgraphFrameCount: 0,
    blobRegionCount: 0,
    blobPrimitiveCount: 0,
    canvasNodeCount: 0,
    canvasEdgeCount: 0,
    overlayNodeCount: 0,
    overlayEdgeCount: 0,
  };
}

function createEmptyPerfDebugSummary(): PerfDebugSummary {
  return {
    windowMs: 0,
    renderCount: 0,
    pointerMoves: 0,
    dragPointerMoves: 0,
    boxPointerMoves: 0,
    panPointerMoves: 0,
    connectPointerMoves: 0,
    hotLabel: null,
    snapshot: createPerfDebugSnapshot(),
    entries: [],
  };
}

function WorkbenchIcon({ name, className }: { name: IconName; className?: string }) {
  const props = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'square' as const,
    strokeLinejoin: 'miter' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'menu':
      return (
        <svg {...props}>
          <path d="M5 7h14M5 12h14M5 17h14" />
        </svg>
      );
    case 'files':
      return (
        <svg {...props}>
          <path d="M3 6.5h6l2 2H21v9.5A2 2 0 0 1 19 20H5a2 2 0 0 1-2-2z" />
          <path d="M3 8.5h18" />
        </svg>
      );
    case 'graph':
      return (
        <svg {...props}>
          <circle cx="6" cy="7" r="2.2" />
          <circle cx="18" cy="6" r="2.2" />
          <circle cx="12" cy="17" r="2.2" />
          <path d="M8 8.2l2.5 6M16 7.8l-2.6 6M8.2 7.1h7.6" />
        </svg>
      );
    case 'inspect':
      return (
        <svg {...props}>
          <path d="M6 5v14M18 5v14" />
          <circle cx="6" cy="9" r="2.5" />
          <circle cx="18" cy="15" r="2.5" />
        </svg>
      );
    case 'canvas':
      return (
        <svg {...props}>
          <path d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      );
    case 'source':
      return (
        <svg {...props}>
          <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
        </svg>
      );
    case 'history':
      return (
        <svg {...props}>
          <path d="M4 12a8 8 0 1 0 2.3-5.7" />
          <path d="M4 4v4h4M12 8v5l3 2" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...props}>
          <rect x="9" y="9" width="10" height="10" rx="2" />
          <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
        </svg>
      );
    case 'share':
      return (
        <svg {...props}>
          <circle cx="6" cy="12" r="2.3" />
          <circle cx="18" cy="6" r="2.3" />
          <circle cx="18" cy="18" r="2.3" />
          <path d="M8.1 10.9l7.8-3.8M8.1 13.1l7.8 3.8" />
        </svg>
      );
    case 'download':
      return (
        <svg {...props}>
          <path d="M12 4v10" />
          <path d="M8 10l4 4 4-4" />
          <path d="M5 18h14" />
        </svg>
      );
    case 'cursor':
      return (
        <svg {...props}>
          <path d="M6 4l10 8-5 1.2L12.5 19 10 13.5 6 14z" />
        </svg>
      );
    case 'node':
      return (
        <svg {...props}>
          <rect x="5" y="5" width="14" height="14" rx="3" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      );
    case 'group':
      return (
        <svg {...props}>
          <rect x="4" y="6" width="10" height="10" rx="2" />
          <rect x="10" y="10" width="10" height="10" rx="2" />
        </svg>
      );
    case 'reset':
      return (
        <svg {...props}>
          <path d="M12 4v4M12 16v4M4 12h4M16 12h4" />
          <circle cx="12" cy="12" r="4.5" />
        </svg>
      );
    case 'minus':
      return (
        <svg {...props}>
          <path d="M6 12h12" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...props}>
          <path d="M12 6v12M6 12h12" />
        </svg>
      );
    case 'preview':
      return (
        <svg {...props}>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
          <circle cx="12" cy="12" r="2.8" />
        </svg>
      );
    case 'chevron-left':
      return (
        <svg {...props}>
          <path d="M14 6l-6 6 6 6" />
        </svg>
      );
    case 'chevron-right':
      return (
        <svg {...props}>
          <path d="M10 6l6 6-6 6" />
        </svg>
      );
    case 'link-start':
      return (
        <svg {...props}>
          <path d="M20 12H8" />
          <path d="M12 8l-4 4 4 4" />
        </svg>
      );
    case 'link-end':
      return (
        <svg {...props}>
          <path d="M4 12h12" />
          <path d="M12 8l4 4-4 4" />
        </svg>
      );
    case 'trash':
      return (
        <svg {...props}>
          <path d="M5 7h14" />
          <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
          <path d="M7 7l.8 11.2A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.8L17 7" />
          <path d="M10 11v5M14 11v5" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...props}>
          <path d="M5 6.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H11l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z" />
          <path d="M8 10h8M8 13h5" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="2.5" />
          <path d="M19 12a7.2 7.2 0 0 0-.1-1l2-1.6-2-3.4-2.3.8a7.4 7.4 0 0 0-1.7-1L14.5 3h-5L9 5.8a7.4 7.4 0 0 0-1.7 1L5 6l-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.6L5 18l2.3-.8a7.4 7.4 0 0 0 1.7 1l.5 2.8h5l.5-2.8a7.4 7.4 0 0 0 1.7-1L19 18l2-3.4-2-1.6c.1-.3.1-.7.1-1z" />
        </svg>
      );
    case 'layout':
      return (
        <svg {...props}>
          <rect x="4.5" y="5" width="5" height="5" rx="1.2" />
          <rect x="14.5" y="5" width="5" height="5" rx="1.2" />
          <rect x="9.5" y="14" width="5" height="5" rx="1.2" />
          <path d="M9.5 7.5h5M7 10v4M17 10v4" />
        </svg>
      );
    case 'tidy':
      return (
        <svg {...props}>
          <path d="M5 7h14M5 12h10M5 17h14" />
          <path d="M17 10l2 2-2 2" />
        </svg>
      );
    case 'standardize':
      return (
        <svg {...props}>
          <path d="M7 4.5h8l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 19V6A1.5 1.5 0 0 1 7.5 4.5z" />
          <path d="M15 4.5V9h4" />
          <path d="M9 13l2 2 4-4" />
        </svg>
      );
    case 'search':
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="5.5" />
          <path d="M16 16l4 4" />
        </svg>
      );
    default:
      return null;
  }
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target.tagName === 'TEXTAREA') {
    return true;
  }

  if (target.tagName !== 'INPUT') {
    return false;
  }

  const input = target as HTMLInputElement;
  const textLikeTypes = new Set([
    '',
    'text',
    'search',
    'url',
    'tel',
    'email',
    'password',
    'number',
  ]);

  return (
    !input.readOnly &&
    !input.disabled &&
    textLikeTypes.has(input.type)
  );
}

function focusControlWithoutScroll(element: HTMLInputElement | HTMLTextAreaElement) {
  try {
    (element as HTMLInputElement & { focus(options?: { preventScroll?: boolean }): void }).focus({
      preventScroll: true,
    });
  } catch {
    element.focus();
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function selectionKindLabel(kind: SelectionState['kind']) {
  switch (kind) {
    case 'node':
      return '节点';
    case 'edge':
      return '连线';
    case 'subgraph':
      return '分组';
    case 'content':
      return '内容';
    default:
      return '项目';
  }
}

function createHistoryEntry(title: string, detail: string): HistoryEntry {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    title,
    detail,
  };
}

function localizeLegacyHistoryEntry(entry: HistoryEntry): HistoryEntry {
  const titleMap: Record<string, string> = {
    'Workspace started': '工作区已启动',
    'Node updated': '已更新节点',
    'Edge updated': '已更新连线',
    'Subgraph updated': '已更新分组',
    'Node created': '已创建节点',
    'Selection deleted': '已删除选中内容',
    'Selection duplicated': '已复制选中节点',
    'Subgraph created': '已创建分组',
    'Direction updated': '已更新方向',
    'Nodes moved': '已移动节点',
    'Viewport moved': '视口已移动',
    'Edge created': '已创建连线',
    'Node renamed': '已重命名节点',
    'Viewport reset': '视口已重置',
  };

  let detail = entry.detail
    .replace('Opened the prototype.', '已打开原型编辑器。')
    .replace('Reset local history cache.', '已重置本地历史缓存。')
    .replace('Removed the selected item(s) from the graph.', '已从图中移除当前选中的项目。')
    .replace('Adjusted canvas position.', '已调整画布视口位置。')
    .replace('Reset the canvas camera.', '已重置画布视角。');

  detail = detail.replace(/Updated (\d+) node property value\./, '已更新 $1 个节点属性。');
  detail = detail.replace(/Updated (\d+) edge property value\./, '已更新 $1 条连线属性。');
  detail = detail.replace(/Updated (\d+) subgraph setting\./, '已更新 $1 个分组设置。');
  detail = detail.replace(/Created (.+) and linked it from (.+)\./, '已创建 $1，并从 $2 建立连接。');
  detail = detail.replace(/Created (.+) on the canvas\./, '已在画布中创建 $1。');
  detail = detail.replace(/Duplicated (\d+) node\(s\)\./, '已复制 $1 个节点。');
  detail = detail.replace(/Wrapped (\d+) nodes into (.+)\./, '已将 $1 个节点归入 $2。');
  detail = detail.replace(/Changed the flow direction to (.+)\./, '已将流向改为 $1。');
  detail = detail.replace(/Moved (\d+) node\(s\) on the canvas\./, '已在画布中移动 $1 个节点。');
  detail = detail.replace(/Connected (.+) to (.+)\./, '已将 $1 连接到 $2。');
  detail = detail.replace(/Updated the label for (.+)\./, '已更新 $1 的标签。');

  return {
    ...entry,
    title: titleMap[entry.title] ?? entry.title,
    detail,
  };
}

function materializeDocument(
  candidate: GraphDocument,
  options?: {
    preserveNodeIds?: Iterable<string>;
  },
): GraphDocument {
  const normalizedCandidate = normalizeFlowchartDocumentNodeIds(candidate, options);
  const normalizedNodes = normalizedCandidate.nodes.map((node) => resizeNodeToContent(node, node.label));
  const normalizedEdges = normalizedCandidate.edges.map(normalizeEdgeStyle);
  const layout: LayoutSidecar = {
    version: normalizedCandidate.layout.version,
    viewport: { ...normalizedCandidate.layout.viewport },
    nodes: Object.fromEntries(
      normalizedNodes.map((node) => [
        node.id,
        {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
        },
      ]),
    ),
    subgraphs: Object.fromEntries(
      normalizedCandidate.subgraphs.map((subgraph) => [
        subgraph.id,
        { collapsed: subgraph.collapsed },
      ]),
    ),
  };

  const source = normalizedCandidate.diagramType === 'flowchart'
    ? serializeMermaidDocument(
      normalizedCandidate.direction,
      normalizedNodes,
      normalizedEdges,
      normalizedCandidate.subgraphs,
      normalizedCandidate.unsupportedLines,
    )
    : normalizedCandidate.source.trim();
  const projectName = normalizedCandidate.projectName ?? 'Untitled Project';
  const projectSummary = normalizedCandidate.projectSummary ?? '';
  const contentMarkdown = normalizeContentMarkdown(normalizedCandidate.contentMarkdown ?? extractContentMarkdown(normalizedCandidate.suffixMarkdown));
  const extras = sanitizeCompatExtras(normalizedCandidate.compat?.extras);
  const compat = {
    version: normalizedCandidate.compat?.version ?? 1,
    layout,
    editor: {
      localFileActions: {
        enabled: normalizedCandidate.compat?.editor?.localFileActions?.enabled ?? true,
      },
    },
    extras,
  };
  const markdown = serializeProjectMarkdown({
    projectName,
    projectSummary,
    prefixMarkdown: candidate.prefixMarkdown,
    contentMarkdown,
    mermaidSource: source,
    compat,
    nodes: normalizedNodes,
    subgraphs: normalizedCandidate.subgraphs,
  });

  return {
    ...normalizedCandidate,
    nodes: normalizedNodes,
    edges: normalizedEdges,
    layout,
    source,
    markdown,
    projectName,
    projectSummary,
    prefixMarkdown: normalizedCandidate.prefixMarkdown ?? '',
    suffixMarkdown: buildProjectSuffixMarkdown(contentMarkdown),
    contentMarkdown,
    compat,
  };
}

function loadWorkspace(initialMarkdown?: string, fallbackName = 'Untitled Project', skipStoredState = false) {
  const savedProject = skipStoredState ? null : localStorage.getItem(storageKeys.project);
  const savedHistory = skipStoredState ? null : localStorage.getItem(storageKeys.history);

  let history: HistoryEntry[] = [createHistoryEntry('工作区已启动', '已打开原型编辑器。')];

  if (savedHistory) {
    try {
      history = (JSON.parse(savedHistory) as HistoryEntry[]).map(localizeLegacyHistoryEntry);
    } catch {
      history = [createHistoryEntry('工作区已启动', '已重置本地历史缓存。')];
    }
  } else if (skipStoredState) {
    history = [createHistoryEntry('工作区已启动', '已打开 LMD_EDITER。')];
  }

  const projectMarkdown = initialMarkdown ?? savedProject ?? sampleProjectMarkdown;
  let parsed: GraphDocument;
  try {
    parsed = parseProjectMarkdown(projectMarkdown, fallbackName, createDefaultLayout());
  } catch {
    parsed = standardizeProjectMarkdown(projectMarkdown, fallbackName, createDefaultLayout());
  }

  return {
    document: materializeDocument(parsed),
    history,
  };
}

function normalizeInlineEntityText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

function isEdgeType(value: unknown): value is GraphEdge['type'] {
  return value === 'solid' || value === 'dotted' || value === 'thick' || value === 'line';
}

function splitEntityText(value: string) {
  const normalized = normalizeInlineEntityText(value).trimEnd();
  const [titleLine = '', ...restLines] = normalized.split('\n');
  return {
    title: titleLine.trim() || '未命名内容',
    description: restLines.join('\n').trim(),
  };
}

function splitEntityDraft(value: string) {
  // Preserve in-progress trailing newlines while editing the draft.
  const normalized = normalizeInlineEntityText(value);
  const [titleLine = '', ...restLines] = normalized.split('\n');
  return {
    title: titleLine,
    description: restLines.join('\n'),
  };
}

const NODE_TITLE_ID_SAFE_PATTERN = /^[\p{L}\p{N}\s_:-]+$/u;

function isNodeTitleIllegal(title: string) {
  const normalized = title.normalize('NFKC').trim();
  if (!normalized) {
    return false;
  }

  if (!NODE_TITLE_ID_SAFE_PATTERN.test(normalized)) {
    return true;
  }

  const withUnderscores = normalized.replace(/\s+/g, '_');
  return normalizeEntityIdBase(normalized) !== withUnderscores;
}

function buildNodeTitleValidationMap(
  nodes: GraphNode[],
  editingNodeId: string | null,
  editingValue: string,
) {
  const resolved = nodes.map((node) => {
    const label = editingNodeId === node.id ? (editingValue || ' ') : node.label;
    const parts = editingNodeId === node.id ? splitEntityDraft(label) : splitEntityText(label);
    const title = parts.title.trim();
    return {
      id: node.id,
      title,
    };
  });

  const titleCounts = new Map<string, number>();
  resolved.forEach(({ title }) => {
    if (!title) {
      return;
    }
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  });

  return new Map(
    resolved.map(({ id, title }) => {
      const duplicate = title.length > 0 && (titleCounts.get(title) ?? 0) > 1;
      const illegal = isNodeTitleIllegal(title);
      const reasons: string[] = [];
      if (duplicate) {
        reasons.push('节点标题重复');
      }
      if (illegal) {
        reasons.push('节点标题包含非法字符');
      }
      return [id, {
        duplicate,
        illegal,
        hasWarning: duplicate || illegal,
        tooltip: reasons.join(' / '),
      }];
    }),
  );
}

function composeEntityText(title: string, description = '') {
  const normalizedTitle = title.trim() || '未命名内容';
  const normalizedDescription = description.replace(/\r\n/g, '\n').trim();
  return normalizedDescription
    ? `${normalizedTitle}\n${normalizedDescription}`
    : normalizedTitle;
}

function composeEntityDraft(title: string, description = '') {
  const normalizedTitle = title.replace(/\r\n/g, '\n');
  // Keep in-progress line breaks while editing; final trimming happens on commit.
  const normalizedDescription = description.replace(/\r\n/g, '\n');
  return normalizedDescription
    ? `${normalizedTitle}\n${normalizedDescription}`
    : normalizedTitle;
}

function ensureInlineEntityFieldValue(value: string, field: InlineNodeField) {
  const normalized = normalizeInlineEntityText(value);
  if (field === 'description' && !normalized.includes('\n')) {
    return `${normalized}\n`;
  }

  return normalized;
}

function getInlineEntityFieldValue(value: string, field: InlineNodeField) {
  const parts = splitEntityDraft(value);
  return field === 'title' ? parts.title : parts.description;
}

function setInlineEntityFieldValue(value: string, field: InlineNodeField, nextValue: string) {
  const parts = splitEntityDraft(value);
  return field === 'title'
    ? composeEntityDraft(nextValue, parts.description)
    : composeEntityDraft(parts.title, nextValue);
}

function shouldSelectAllInlineNodeField(value: string, field: InlineNodeField) {
  if (field !== 'title') {
    return false;
  }

  const normalized = value.trim();
  return normalized === '新建节点' || normalized === '未命名内容';
}

function isPlaceholderNodeTitle(value: string) {
  const normalized = value.trim();
  return normalized === '新建节点' || normalized === '未命名内容';
}

function getEntitySelectionRange(value: string, field: InlineNodeField) {
  const normalized = normalizeInlineEntityText(value);
  const newlineIndex = normalized.indexOf('\n');
  if (field === 'title') {
    return {
      start: 0,
      end: newlineIndex < 0 ? normalized.length : newlineIndex,
    };
  }

  if (newlineIndex < 0) {
    return {
      start: normalized.length,
      end: normalized.length,
    };
  }

  const start = newlineIndex + 1;
  return {
    start,
    end: normalized.length,
  };
}

function nextNodeId(nodes: GraphNode[], title = '新建节点', preserveCurrentId?: string) {
  const usedIds = new Set(
    nodes
      .map((node) => node.id)
      .filter((id) => id !== preserveCurrentId),
  );
  return buildEntityIdFromTitle(title || '未命名内容', usedIds, preserveCurrentId);
}

function buildNode(
  id: string,
  label: string,
  position: Point,
  subgraphId: string | null,
): GraphNode {
  const { title, description } = splitEntityText(label);
  const size = measureNodeContentSize(title, description);
  return {
    id,
    label: composeEntityText(title, description),
    shape: 'rect',
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    fill: '#121214',
    stroke: '#d6ff3a',
    textColor: '#f4f4f5',
    subgraphId,
  };
}

function normalizeFlowchartDocumentNodeIds(
  candidate: GraphDocument,
  options?: {
    preserveNodeIds?: Iterable<string>;
  },
) {
  if (candidate.diagramType !== 'flowchart') {
    return candidate;
  }

  const preservedIds = new Set(options?.preserveNodeIds ?? []);
  const usedIds = new Set<string>();
  const finalRemap = new Map<string, string>();

  const nodes = candidate.nodes.map((node) => {
    const parts = splitEntityText(node.label);
    const nextId = preservedIds.has(node.id)
      ? node.id
      : buildEntityIdFromTitle(parts.title || '未命名内容', usedIds, node.id);
    usedIds.add(nextId);
    finalRemap.set(node.id, nextId);
    return {
      ...resizeNodeToContent(node, parts.title, parts.description),
      id: nextId,
    };
  });

  const edges = candidate.edges.map((edge) => ({
    ...edge,
    from: finalRemap.get(edge.from) ?? edge.from,
    to: finalRemap.get(edge.to) ?? edge.to,
  }));

  const layout: LayoutSidecar = {
    version: candidate.layout.version,
    viewport: { ...candidate.layout.viewport },
    nodes: Object.fromEntries(
      Object.entries(candidate.layout.nodes).map(([id, value]) => [
        finalRemap.get(id) ?? id,
        { ...value },
      ]),
    ),
    subgraphs: Object.fromEntries(
      Object.entries(candidate.layout.subgraphs).map(([id, value]) => [id, { ...value }]),
    ),
  };

  return {
    ...candidate,
    nodes,
    edges,
    layout,
  };
}

function resizeNodeToContent(node: GraphNode, content: string, description?: string) {
  const nextText = description === undefined ? content : composeEntityText(content, description);
  const nextParts = splitEntityText(nextText);
  const size = measureNodeContentSize(nextParts.title, nextParts.description);

  return {
    ...node,
    label: composeEntityText(nextParts.title, nextParts.description),
    width: size.width,
    height: size.height,
  };
}

function getShortcutNodePlacement(
  node: GraphNode,
  direction: Direction,
  relation: 'linked' | 'sibling' | 'mirrored',
) {
  const gapX = 96;
  const gapY = 84;

  if (relation === 'linked') {
    switch (direction) {
      case 'LR':
        return { x: node.x + node.width + gapX, y: node.y };
      case 'RL':
        return { x: node.x - node.width - gapX, y: node.y };
      case 'BT':
        return { x: node.x, y: node.y - node.height - gapY };
      case 'TD':
      default:
        return { x: node.x, y: node.y + node.height + gapY };
    }
  }

  switch (direction) {
    case 'LR':
    case 'RL':
      return { x: node.x, y: node.y + node.height + gapY };
    case 'BT':
    case 'TD':
    default:
      return { x: node.x + node.width + gapX, y: node.y };
  }
}

function sideFromAnchor(anchor: { dirX: number; dirY: number }) {
  if (anchor.dirX > 0) {
    return 'right';
  }
  if (anchor.dirX < 0) {
    return 'left';
  }
  if (anchor.dirY > 0) {
    return 'bottom';
  }
  return 'top';
}

function normalFromAnchor(anchor: { dirX: number; dirY: number }) {
  return anchor.dirX !== 0 ? { x: 0, y: 1 } : { x: 1, y: 0 };
}

function cubicPoint(start: Point, controlA: Point, controlB: Point, end: Point, t: number) {
  const mt = 1 - t;
  return {
    x:
      mt ** 3 * start.x +
      3 * mt ** 2 * t * controlA.x +
      3 * mt * t ** 2 * controlB.x +
      t ** 3 * end.x,
    y:
      mt ** 3 * start.y +
      3 * mt ** 2 * t * controlA.y +
      3 * mt * t ** 2 * controlB.y +
      t ** 3 * end.y,
  };
}

function expandRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function rectsIntersect(left: Rect, right: Rect) {
  return !(
    left.x + left.width <= right.x ||
    left.x >= right.x + right.width ||
    left.y + left.height <= right.y ||
    left.y >= right.y + right.height
  );
}

function normalizeVector(vector: Point) {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 0.001) {
    return { x: 1, y: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function withAlpha(color: string, alpha: number) {
  const normalizedAlpha = clamp(alpha, 0, 1);
  const hex = color.trim();
  const shortMatch = hex.match(/^#([\da-f]{3})$/i);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('').map((value) => Number.parseInt(value + value, 16));
    return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
  }

  const longMatch = hex.match(/^#([\da-f]{6})$/i);
  if (longMatch) {
    const raw = longMatch[1];
    const r = Number.parseInt(raw.slice(0, 2), 16);
    const g = Number.parseInt(raw.slice(2, 4), 16);
    const b = Number.parseInt(raw.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
  }

  if (hex.startsWith('rgb(')) {
    return hex.replace(/^rgb\((.+)\)$/i, `rgba($1, ${normalizedAlpha})`);
  }

  if (hex.startsWith('rgba(')) {
    return hex.replace(/^rgba\((.+),\s*[\d.]+\)$/i, `rgba($1, ${normalizedAlpha})`);
  }

  return color;
}

function parseColorChannels(color: string) {
  const hex = color.trim();
  const shortMatch = hex.match(/^#([\da-f]{3})$/i);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('').map((value) => Number.parseInt(value + value, 16));
    return { r, g, b };
  }

  const longMatch = hex.match(/^#([\da-f]{6})$/i);
  if (longMatch) {
    const raw = longMatch[1];
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16),
    };
  }

  const rgbMatch = hex.match(/^rgba?\(([\d.\s]+),\s*([\d.\s]+),\s*([\d.\s]+)/i);
  if (rgbMatch) {
    return {
      r: Number.parseInt(rgbMatch[1].trim(), 10),
      g: Number.parseInt(rgbMatch[2].trim(), 10),
      b: Number.parseInt(rgbMatch[3].trim(), 10),
    };
  }

  return null;
}

function mixColors(baseColor: string, targetColor: string, targetWeight: number) {
  const base = parseColorChannels(baseColor);
  const target = parseColorChannels(targetColor);
  if (!base || !target) {
    return targetColor;
  }

  const weight = clamp(targetWeight, 0, 1);
  const inverse = 1 - weight;
  const r = Math.round(base.r * inverse + target.r * weight);
  const g = Math.round(base.g * inverse + target.g * weight);
  const b = Math.round(base.b * inverse + target.b * weight);
  return `rgb(${r}, ${g}, ${b})`;
}

function getRelativeLuminance(color: string) {
  const channels = parseColorChannels(color);
  if (!channels) {
    return 0;
  }

  const normalizeChannel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  const r = normalizeChannel(channels.r);
  const g = normalizeChannel(channels.g);
  const b = normalizeChannel(channels.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getContrastRatio(leftColor: string, rightColor: string) {
  const left = getRelativeLuminance(leftColor);
  const right = getRelativeLuminance(rightColor);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

function getColorSaturation(color: string) {
  const channels = parseColorChannels(color);
  if (!channels) {
    return 0;
  }

  const { r, g, b } = channels;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function getReadableLabelTextColor(background: string, preferred: string) {
  if (getContrastRatio(preferred, background) >= 4.5) {
    return preferred;
  }

  const darkCandidate = '#0f172a';
  if (getContrastRatio(darkCandidate, background) >= 4.5) {
    return darkCandidate;
  }

  return '#f8fafc';
}

function getEndpointAccentColor(endpoint: EdgeEndpointBox) {
  return endpoint.stroke;
}

function shouldInheritSourceEdgeColor(strokeColor: string) {
  const normalized = strokeColor.trim().toLowerCase();
  if (normalized === defaultEdgeStyle.strokeColor.toLowerCase()) {
    return true;
  }

  const explicitlyNeutral = new Set([
    '#ffffff',
    '#f8fafc',
    '#f1f5f9',
    '#e2e8f0',
    '#dbe7f0',
    '#d9e4ee',
    '#e6eef5',
    'rgb(255, 255, 255)',
    'rgb(248, 250, 252)',
    'rgb(241, 245, 249)',
    'rgb(226, 232, 240)',
  ]);
  if (explicitlyNeutral.has(normalized)) {
    return true;
  }

  return getRelativeLuminance(strokeColor) >= 0.72 && getColorSaturation(strokeColor) <= 0.38;
}

function trimMultilineBlock(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
}

function extractContentMarkdown(suffixMarkdown?: string) {
  const normalized = trimMultilineBlock(suffixMarkdown ?? '');
  if (!normalized) {
    return '';
  }

  const match = normalized.match(/^##\s+Content\s*\n?([\s\S]*)$/i);
  return trimMultilineBlock(match?.[1] ?? normalized);
}

function normalizeContentMarkdown(markdown: string) {
  return markdown
    .replace(/&lt;br\s*\/?&gt;/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
}

function buildProjectPrefixMarkdown(projectName: string, projectSummary: string) {
  const normalizedName = projectName.trim() || 'Untitled Project';
  const normalizedSummary = trimMultilineBlock(projectSummary);
  const lines = [`# ${normalizedName}`, '', '## Summary', ''];
  if (normalizedSummary) {
    lines.push(normalizedSummary, '');
  }
  lines.push('## Diagram');
  return lines.join('\n');
}

function stripMarkdownToPlainText(markdown: string) {
  return trimMultilineBlock(
    markdown
      .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, '').trim())
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_~#>`-]/g, '')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' '),
  );
}

function buildContentCardSummary(markdown: string) {
  const plain = stripMarkdownToPlainText(normalizeContentMarkdown(markdown));
  if (!plain) {
    return '暂无附加信息';
  }

  return plain.length > 30 ? `${plain.slice(0, 30)}…` : plain;
}

function measureContentCard(markdown: string, collapsed = false) {
  if (collapsed) {
    const summary = buildContentCardSummary(markdown);
    return {
      width: clamp(96 + summary.length * 2.15, 116, 152),
      height: 38,
    };
  }

  const normalizedMarkdown = normalizeContentMarkdown(markdown);
  const content = normalizedMarkdown.trim();
  if (!content) {
    return {
      width: 164,
      height: 80,
    };
  }

  const lines = normalizedMarkdown.replace(/\r\n/g, '\n').split('\n');
  const hasStructuredBlocks = lines.some((line) =>
    /^(#{1,3}\s|[-*+]\s|\d+\.\s|>\s|```)/.test(line.trim()),
  );
  const wrappedLines = lines.reduce((total, line) => {
    const plain = stripMarkdownToPlainText(line);
    return total + Math.max(1, Math.ceil((plain.length || 1) / 26));
  }, 0);
  const longestLine = lines.reduce((max, line) => {
    const plain = stripMarkdownToPlainText(line);
    return Math.max(max, plain.length);
  }, 0);
  const blockCount = normalizedMarkdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean).length;

  return {
    width: clamp(150 + longestLine * 2.2, 168, 248),
    height: Math.max(
      84,
      58 + wrappedLines * 15 + Math.max(0, blockCount - 1) * 8 + (hasStructuredBlocks ? 6 : 0),
    ),
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdownInline(value: string) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return html;
}

function renderMarkdownPreviewHtml(markdown: string) {
  const lines = normalizeContentMarkdown(markdown).replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  const paragraph: string[] = [];
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let codeLines: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    html.push(`<p>${renderMarkdownInline(paragraph.join('<br />'))}</p>`);
    paragraph.length = 0;
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      return;
    }
    html.push(`<${listType}>${listItems.join('')}</${listType}>`);
    listType = null;
    listItems = [];
  };

  const flushCode = () => {
    if (!inCode) {
      return;
    }
    html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    codeLines = [];
    inCode = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ');
    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushList();
      if (inCode) {
        flushCode();
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(3, heading[1].length);
      html.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (listType && listType !== 'ul') {
        flushList();
      }
      listType = 'ul';
      listItems.push(`<li>${renderMarkdownInline(unordered[1])}</li>`);
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== 'ol') {
        flushList();
      }
      listType = 'ol';
      listItems.push(`<li>${renderMarkdownInline(ordered[1])}</li>`);
      continue;
    }

    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${renderMarkdownInline(quote[1])}</blockquote>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushCode();

  if (html.length === 0) {
    return '<p class="content-card__empty">暂无附加信息。</p>';
  }

  return html.join('');
}

function getContentCardLayout(document: GraphDocument): ContentCardLayout {
  const raw = document.compat?.extras && typeof document.compat.extras === 'object'
    ? (document.compat.extras as Record<string, unknown>).contentBox
    : null;
  const rawSize = document.compat?.extras && typeof document.compat.extras === 'object'
    ? (document.compat.extras as Record<string, unknown>).contentBoxSize
    : null;
  const numericRaw = Array.isArray(raw) ? raw : null;
  const numericRawSize = Array.isArray(rawSize) ? rawSize : null;
  const collapsed = raw == null
    ? true
    : numericRaw != null && numericRaw.length >= 3 && (numericRaw[2] === 1 || numericRaw[2] === true);

  const resolvedSize = numericRawSize != null &&
    numericRawSize.length >= 2 &&
    typeof numericRawSize[0] === 'number' &&
    typeof numericRawSize[1] === 'number'
      ? {
          width: numericRawSize[0],
          height: numericRawSize[1],
        }
      : null;

  const looksLikeLegacySize =
    resolvedSize == null &&
    numericRaw != null &&
    numericRaw.length >= 2 &&
    typeof numericRaw[0] === 'number' &&
    typeof numericRaw[1] === 'number' &&
    numericRaw[0] >= CONTENT_CARD_MIN_WIDTH &&
    numericRaw[0] <= CONTENT_CARD_MAX_WIDTH &&
    numericRaw[1] >= CONTENT_CARD_MIN_HEIGHT &&
    numericRaw[1] <= CONTENT_CARD_MAX_HEIGHT;

  const width = resolvedSize?.width ?? (looksLikeLegacySize && numericRaw != null ? numericRaw[0] : undefined);
  const height = resolvedSize?.height ?? (looksLikeLegacySize && numericRaw != null ? numericRaw[1] : undefined);
  const x =
    numericRaw != null &&
    numericRaw.length >= 2 &&
    typeof numericRaw[0] === 'number' &&
    !looksLikeLegacySize
      ? numericRaw[0]
      : DEFAULT_CONTENT_CARD_X;
  const y =
    numericRaw != null &&
    numericRaw.length >= 2 &&
    typeof numericRaw[1] === 'number' &&
    !looksLikeLegacySize
      ? numericRaw[1]
      : DEFAULT_CONTENT_CARD_Y;

  return {
    x,
    y,
    collapsed,
    width,
    height,
  };
}

function sanitizeCompatExtras(
  extras: ProjectCompatExtras | undefined,
): ProjectCompatExtras | undefined {
  if (!extras) {
    return undefined;
  }

  const nextExtras: ProjectCompatExtras = {};

  if (Array.isArray(extras.contentBox)) {
    nextExtras.contentBox = extras.contentBox;
  }

  Object.entries(extras).forEach(([key, value]) => {
    if (key === 'contentBox' || key === 'nodeNotes') {
      return;
    }
    nextExtras[key] = value;
  });

  return Object.keys(nextExtras).length > 0 ? nextExtras : undefined;
}

function withContentCardLayout(document: GraphDocument, layout: ContentCardLayout): GraphDocument {
  const compat = document.compat ?? {
    version: 1,
    layout: document.layout,
    editor: {
      localFileActions: { enabled: true },
    },
  };

  return {
    ...document,
    compat: {
      ...compat,
      extras: {
        ...(compat.extras ?? {}),
        contentBox: layout.collapsed
          ? [Math.round(layout.x), Math.round(layout.y), 1] as [number, number, 1]
          : [Math.round(layout.x), Math.round(layout.y)] as [number, number],
        contentBoxSize:
          typeof layout.width === 'number' && typeof layout.height === 'number'
            ? [Math.round(layout.width), Math.round(layout.height)] as [number, number]
            : undefined,
      },
    },
  };
}

function buildGraphSemanticSnapshotFromDocument(
  document: GraphDocument,
  selection: SelectionState,
  revision: number,
): GraphSemanticSnapshot {
  return {
    revision,
    project: {
      name: document.projectName?.trim() || 'Untitled Project',
      summary: trimMultilineBlock(document.projectSummary ?? ''),
      content: normalizeContentMarkdown(document.contentMarkdown ?? extractContentMarkdown(document.suffixMarkdown)),
    },
    diagram: {
      direction: document.direction,
      nodes: document.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        title: splitEntityText(node.label).title,
        description: splitEntityText(node.label).description,
        subgraphId: node.subgraphId,
        x: Math.round(node.x),
        y: Math.round(node.y),
        width: Math.round(node.width),
        height: Math.round(node.height),
      })),
      edges: document.edges.map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        label: edge.label,
        type: edge.type,
      })),
      subgraphs: document.subgraphs.map((subgraph) => ({
        id: subgraph.id,
        title: subgraph.title,
        parentId: subgraph.parentId,
        collapsed: subgraph.collapsed,
      })),
    },
    selection: {
      kind: selection.kind,
      ids: [...selection.ids],
      ...(selection.subgraphIds?.length ? { subgraphIds: [...selection.subgraphIds] } : {}),
    },
  };
}

function normalizeOpenAiMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (item && typeof item === 'object') {
          if ('text' in item && typeof item.text === 'string') {
            return item.text;
          }

          if ('content' in item && typeof item.content === 'string') {
            return item.content;
          }
        }

        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
}

function buildAiHistoryContext(messages: AiMessage[]) {
  const visibleMessages = messages
    .filter((message) => message.id !== 'ai-welcome')
    .slice(-12);

  if (visibleMessages.length === 0) {
    return 'No earlier conversation.';
  }

  return visibleMessages
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
    .join('\n\n');
}

function buildAiLockRules(settings: AiSettingsDraft) {
  const lines = [
    settings.lockProjectMeta
      ? 'Do not modify Project Name or Summary.'
      : 'Project Name and Summary may be modified if needed.',
    settings.lockAdditionalInfo
      ? 'Do not modify Additional Information.'
      : 'Additional Information may be modified if needed.',
    settings.lockDiagram
      ? 'Do not modify the flowchart structure.'
      : 'The flowchart structure may be modified if needed.',
  ];

  return lines.join('\n');
}

function isDiagramOperation(operation: GraphOperation) {
  return (
    operation.type !== 'updateProjectMeta' &&
    operation.type !== 'updateContentMarkdown'
  );
}

function filterGraphOperationsByAiLocks(
  operations: GraphOperation[],
  settings: AiSettingsDraft,
) {
  const warnings: string[] = [];
  const nextOperations = operations.filter((operation) => {
    if (settings.lockProjectMeta && operation.type === 'updateProjectMeta') {
      warnings.push('Blocked project title/summary update because the Project Meta lock is enabled.');
      return false;
    }

    if (settings.lockAdditionalInfo && operation.type === 'updateContentMarkdown') {
      warnings.push('Blocked Additional Information update because the Additional Information lock is enabled.');
      return false;
    }

    if (settings.lockDiagram && isDiagramOperation(operation)) {
      warnings.push(`Blocked ${operation.type} because the Flowchart lock is enabled.`);
      return false;
    }

    return true;
  });

  return {
    operations: nextOperations,
    warnings,
  };
}

function applyAiLocksToMarkdown(
  parsed: GraphDocument,
  current: GraphDocument,
  settings: AiSettingsDraft,
) {
  const nextCandidate = structuredClone(parsed);

  if (settings.lockProjectMeta) {
    nextCandidate.projectName = current.projectName;
    nextCandidate.projectSummary = current.projectSummary;
    nextCandidate.prefixMarkdown = buildProjectPrefixMarkdown(
      current.projectName ?? 'Untitled Project',
      current.projectSummary ?? '',
    );
  }

  if (settings.lockAdditionalInfo) {
    nextCandidate.contentMarkdown = current.contentMarkdown;
  }
  if (settings.lockDiagram) {
    nextCandidate.direction = current.direction;
    nextCandidate.nodes = structuredClone(current.nodes);
    nextCandidate.edges = structuredClone(current.edges);
    nextCandidate.subgraphs = structuredClone(current.subgraphs);
    nextCandidate.warnings = structuredClone(current.warnings);
    nextCandidate.unsupportedLines = structuredClone(current.unsupportedLines);
    nextCandidate.layout = structuredClone(current.layout);
  }

  return nextCandidate;
}

function buildCompactLineDiff(previous: string, current: string) {
  const previousLines = previous.replace(/\r\n/g, '\n').split('\n');
  const currentLines = current.replace(/\r\n/g, '\n').split('\n');
  let prefix = 0;

  while (
    prefix < previousLines.length &&
    prefix < currentLines.length &&
    previousLines[prefix] === currentLines[prefix]
  ) {
    prefix += 1;
  }

  let previousSuffix = previousLines.length - 1;
  let currentSuffix = currentLines.length - 1;
  while (
    previousSuffix >= prefix &&
    currentSuffix >= prefix &&
    previousLines[previousSuffix] === currentLines[currentSuffix]
  ) {
    previousSuffix -= 1;
    currentSuffix -= 1;
  }

  const removed = previousLines.slice(prefix, previousSuffix + 1);
  const added = currentLines.slice(prefix, currentSuffix + 1);
  if (removed.length === 0 && added.length === 0) {
    return null;
  }

  const previousBlock = removed.join('\n').trim();
  const currentBlock = added.join('\n').trim();

  return [
    `Changed around line ${prefix + 1}.`,
    `Before:\n${previousBlock || '<empty>'}`,
    `After:\n${currentBlock || '<empty>'}`,
  ].join('\n\n');
}

function buildMarkdownDeltaContext(previousMarkdown: string, currentMarkdown: string) {
  if (!previousMarkdown || previousMarkdown === currentMarkdown) {
    return null;
  }

  try {
    const previousDiagram = extractMermaidFromProjectMarkdown(previousMarkdown).trim();
    const currentDiagram = extractMermaidFromProjectMarkdown(currentMarkdown).trim();
    if (previousDiagram !== currentDiagram) {
      const diagramDiff = buildCompactLineDiff(previousDiagram, currentDiagram);
      if (diagramDiff) {
        return `Diagram changed since the previous AI turn.\n\n${diagramDiff}`;
      }
    }
  } catch {
    // Fall back to full markdown diff.
  }

  const markdownDiff = buildCompactLineDiff(previousMarkdown, currentMarkdown);
  return markdownDiff ? `Markdown changed since the previous AI turn.\n\n${markdownDiff}` : null;
}

function buildSelectionContext(document: GraphDocument, selection: SelectionState) {
  if (selection.kind === 'none' || selection.ids.length === 0) {
    return 'No active selection.';
  }

  if (selection.kind === 'node') {
    const nodeContext = document.nodes
      .filter((node) => selection.ids.includes(node.id))
      .map((node) => {
        const parts = splitEntityText(node.label);
        return [
          `Node ${node.id}`,
          `title: ${parts.title || '（空）'}`,
          `description: ${parts.description || '（空）'}`,
          `subgraph: ${node.subgraphId ?? 'none'}`,
          `position: (${Math.round(node.x)}, ${Math.round(node.y)})`,
          `size: ${Math.round(node.width)} x ${Math.round(node.height)}`,
        ].join('\n');
      })
      .join('\n\n');
    const subgraphContext = document.subgraphs
      .filter((subgraph) => (selection.subgraphIds ?? []).includes(subgraph.id))
      .map((subgraph) => [
        `Subgraph ${subgraph.id}`,
        `title: ${subgraph.title || '（空）'}`,
        `parent: ${subgraph.parentId ?? 'none'}`,
        `collapsed: ${subgraph.collapsed ? 'true' : 'false'}`,
      ].join('\n'))
      .join('\n\n');
    return subgraphContext ? `${nodeContext}\n\n${subgraphContext}` : nodeContext;
  }

  if (selection.kind === 'edge') {
    return document.edges
      .filter((edge) => selection.ids.includes(edge.id))
      .map((edge) => [
        `Edge ${edge.id}`,
        `from: ${edge.from}`,
        `to: ${edge.to}`,
        `label: ${edge.label || '（空）'}`,
        `type: ${edge.type}`,
      ].join('\n'))
      .join('\n\n');
  }

  if (selection.kind === 'subgraph') {
    return document.subgraphs
      .filter((subgraph) => selection.ids.includes(subgraph.id))
      .map((subgraph) => [
        `Subgraph ${subgraph.id}`,
        `title: ${subgraph.title || '（空）'}`,
        `parent: ${subgraph.parentId ?? 'none'}`,
        `collapsed: ${subgraph.collapsed ? 'true' : 'false'}`,
        `children: ${document.nodes.filter((node) => node.subgraphId === subgraph.id).map((node) => node.id).join(', ') || 'none'}`,
      ].join('\n'))
      .join('\n\n');
  }

  return [
    `Additional Information ${CONTENT_CARD_ID}`,
    normalizeContentMarkdown(document.contentMarkdown ?? extractContentMarkdown(document.suffixMarkdown)) || '（空）',
  ].join('\n');
}

function buildSelectionContextSummary(document: GraphDocument, selection: SelectionState) {
  if (selection.kind === 'none' || selection.ids.length === 0) {
    return '';
  }

  if (selection.kind === 'node') {
    const nodeSummary = document.nodes
      .filter((node) => selection.ids.includes(node.id))
      .map((node) => {
        const parts = splitEntityText(node.label);
        return `${parts.title || node.id} [${node.id}]`;
      })
      .join('；');
    const subgraphSummary = document.subgraphs
      .filter((subgraph) => (selection.subgraphIds ?? []).includes(subgraph.id))
      .map((subgraph) => `${splitEntityText(subgraph.title).title || subgraph.id} [${subgraph.id}]`)
      .join('；');
    return subgraphSummary ? `${nodeSummary}；分组：${subgraphSummary}` : nodeSummary;
  }

  if (selection.kind === 'edge') {
    return document.edges
      .filter((edge) => selection.ids.includes(edge.id))
      .map((edge) => `${edge.from} -> ${edge.to}`)
      .join('；');
  }

  if (selection.kind === 'subgraph') {
    return document.subgraphs
      .filter((subgraph) => selection.ids.includes(subgraph.id))
      .map((subgraph) => `${subgraph.title || subgraph.id} [${subgraph.id}]`)
      .join('；');
  }

  return '附加信息';
}

function describeDocumentChangeTargets(
  previous: GraphDocument,
  next: GraphDocument,
): AiToolChangeTarget[] {
  const changes: AiToolChangeTarget[] = [];
  if ((previous.projectName ?? '') !== (next.projectName ?? '')) {
    changes.push({
      kind: 'project',
      label: 'Project Name',
      detail: `已更新标题为 ${next.projectName ?? '（空）'}`,
    });
  }
  if ((previous.projectSummary ?? '') !== (next.projectSummary ?? '')) {
    changes.push({
      kind: 'project',
      label: 'Summary',
      detail: '已更新简介内容。',
    });
  }
  if ((previous.contentMarkdown ?? '') !== (next.contentMarkdown ?? '')) {
    changes.push({
      kind: 'content',
      label: '附加信息',
      detail: '已更新附加信息内容。',
      targetId: CONTENT_CARD_ID,
    });
  }

  next.nodes.forEach((node) => {
    const previousNode = previous.nodes.find((item) => item.id === node.id);
    if (!previousNode) {
      changes.push({
        kind: 'node',
        label: splitEntityText(node.label).title || node.id,
        detail: '已创建节点。',
        targetId: node.id,
      });
      return;
    }
    if (previousNode.label !== node.label) {
      changes.push({
        kind: 'node',
        label: splitEntityText(node.label).title || node.id,
        detail: '已更新节点文本。',
        targetId: node.id,
      });
    }
  });

  next.subgraphs.forEach((subgraph) => {
    const previousSubgraph = previous.subgraphs.find((item) => item.id === subgraph.id);
    if (!previousSubgraph) {
      changes.push({
        kind: 'subgraph',
        label: splitEntityText(subgraph.title).title || subgraph.id,
        detail: '已创建分组。',
        targetId: subgraph.id,
      });
      return;
    }
    if (previousSubgraph.title !== subgraph.title || previousSubgraph.collapsed !== subgraph.collapsed) {
      changes.push({
        kind: 'subgraph',
        label: splitEntityText(subgraph.title).title || subgraph.id,
        detail: '已更新分组内容。',
        targetId: subgraph.id,
      });
    }
  });

  next.edges.forEach((edge) => {
    const previousEdge = previous.edges.find((item) => item.id === edge.id);
    if (!previousEdge) {
      changes.push({
        kind: 'edge',
        label: `${edge.from} -> ${edge.to}`,
        detail: '已创建连线。',
        targetId: edge.id,
      });
      return;
    }
    if (previousEdge.label !== edge.label || previousEdge.type !== edge.type) {
      changes.push({
        kind: 'edge',
        label: `${edge.from} -> ${edge.to}`,
        detail: '已更新连线。',
        targetId: edge.id,
      });
    }
  });

  return changes;
}

function describeOperationChangeTargets(
  operations: GraphOperation[],
  document: GraphDocument,
): AiToolChangeTarget[] {
  const changes: AiToolChangeTarget[] = [];

  operations.forEach((operation) => {
    if (operation.type === 'updateProjectMeta') {
      if (operation.projectName !== undefined) {
        changes.push({ kind: 'project', label: 'Project Name', detail: '已更新标题。' });
      }
      if (operation.projectSummary !== undefined) {
        changes.push({ kind: 'project', label: 'Summary', detail: '已更新简介。' });
      }
      return;
    }

    if (operation.type === 'updateContentMarkdown') {
      changes.push({
        kind: 'content',
        label: '附加信息',
        detail: '已更新附加信息内容。',
        targetId: CONTENT_CARD_ID,
      });
      return;
    }

    if (operation.type === 'updateNodeLabel' || operation.type === 'createNode' || operation.type === 'deleteNode') {
      const targetNodeId = 'nodeId' in operation ? operation.nodeId : operation.nodeId;
      const node = targetNodeId
        ? document.nodes.find((item) => item.id === targetNodeId)
        : undefined;
      const label =
        operation.type === 'createNode'
          ? splitEntityText(operation.label ?? '新建节点').title || '新建节点'
          : node
            ? splitEntityText(node.label).title || node.id
            : targetNodeId || '节点';
      changes.push({
        kind: 'node',
        label,
        detail:
          operation.type === 'createNode'
            ? '已创建节点。'
            : operation.type === 'deleteNode'
              ? '已删除节点。'
              : '已更新节点文本。',
        targetId: targetNodeId,
      });
      return;
    }

    if (operation.type === 'updateEdgeLabel' || operation.type === 'createEdge' || operation.type === 'deleteEdge') {
      const label =
        operation.type === 'createEdge'
          ? `${operation.from} -> ${operation.to}`
          : operation.type === 'updateEdgeLabel' || operation.type === 'deleteEdge'
            ? operation.edgeId
            : '连线';
      changes.push({
        kind: 'edge',
        label,
        detail:
          operation.type === 'createEdge'
            ? '已创建连线。'
            : operation.type === 'deleteEdge'
              ? '已删除连线。'
              : '已更新连线文本。',
        targetId: 'edgeId' in operation ? operation.edgeId : undefined,
      });
      return;
    }

    if (operation.type === 'createSubgraph' || operation.type === 'updateSubgraphTitle') {
      changes.push({
        kind: 'subgraph',
        label: operation.type === 'createSubgraph' ? (operation.title?.trim() || '新分组') : operation.subgraphId,
        detail: operation.type === 'createSubgraph' ? '已创建分组。' : '已更新分组标题。',
        targetId: operation.type === 'updateSubgraphTitle' ? operation.subgraphId : operation.subgraphId,
      });
      return;
    }

    if (operation.type === 'moveNodeToSubgraph') {
      changes.push({
        kind: 'node',
        label: operation.nodeId,
        detail: `已移动到 ${operation.subgraphId ?? '画布根层'}。`,
        targetId: operation.nodeId,
      });
    }
  });

  return changes;
}

function buildAiUserPrompt(prompt: string, selectionSummary: string) {
  const normalizedPrompt = prompt.trim();
  if (!selectionSummary.trim()) {
    return normalizedPrompt;
  }

  return `当前选中内容：${selectionSummary}\n用户要求：${normalizedPrompt}`;
}

function buildHostSourceSelectionPayload(document: GraphDocument, selection: SelectionState) {
  if (selection.kind === 'none' || selection.ids.length === 0) {
    return { kind: 'none' as const };
  }

  if (selection.kind === 'node') {
    return {
      kind: 'node' as const,
      nodeIds: document.nodes
        .filter((node) => selection.ids.includes(node.id))
        .map((node) => node.id),
      subgraphIds: document.subgraphs
        .filter((subgraph) => (selection.subgraphIds ?? []).includes(subgraph.id))
        .map((subgraph) => subgraph.id),
    };
  }

  if (selection.kind === 'edge') {
    return {
      kind: 'edge' as const,
      edges: document.edges
        .filter((edge) => selection.ids.includes(edge.id))
        .map((edge) => ({
          id: edge.id,
          from: edge.from,
          to: edge.to,
          label: edge.label,
          type: edge.type,
        })),
    };
  }

  if (selection.kind === 'subgraph') {
    return {
      kind: 'subgraph' as const,
      subgraphIds: document.subgraphs
        .filter((subgraph) => selection.ids.includes(subgraph.id))
        .map((subgraph) => subgraph.id),
    };
  }

  return { kind: 'content' as const };
}

function escapeSelectionPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mergeTextRanges(ranges: Array<{ start: number; end: number }>) {
  if (ranges.length === 0) {
    return null;
  }

  return ranges.reduce((merged, range) => ({
    start: Math.min(merged.start, range.start),
    end: Math.max(merged.end, range.end),
  }));
}

function buildLineStartOffsets(lines: string[]) {
  const offsets: number[] = [];
  let offset = 0;
  lines.forEach((line) => {
    offsets.push(offset);
    offset += line.length + 1;
  });
  return offsets;
}

function lineRangeToTextRange(
  lineStarts: number[],
  lines: string[],
  startLine: number,
  endLine: number,
) {
  const start = lineStarts[startLine] ?? 0;
  const end = (lineStarts[endLine] ?? 0) + (lines[endLine]?.length ?? 0);
  return { start, end };
}

function findMermaidBlockTextLines(source: string) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const lineStarts = buildLineStartOffsets(lines);
  const startLine = lines.findIndex((line) => /^```mermaid\s*$/.test(line.trim()));
  if (startLine < 0) {
    return null;
  }

  for (let index = startLine + 1; index < lines.length; index += 1) {
    if (/^```\s*$/.test(lines[index].trim())) {
      return {
        lines,
        lineStarts,
        startLine: startLine + 1,
        endLine: Math.max(startLine + 1, index - 1),
      };
    }
  }

  return null;
}

function findContentSectionTextRange(source: string) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const lineStarts = buildLineStartOffsets(lines);
  const startLine = lines.findIndex((line) => /^##\s+Content\s*$/.test(line));
  if (startLine < 0) {
    return null;
  }

  let endLine = lines.length - 1;
  for (let index = startLine + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      endLine = Math.max(startLine, index - 1);
      break;
    }
  }

  return lineRangeToTextRange(lineStarts, lines, startLine, endLine);
}

function findNodeTextRanges(source: string, nodeIds: string[]) {
  const block = findMermaidBlockTextLines(source);
  if (!block) {
    return [];
  }

  return nodeIds.flatMap((nodeId) => {
    const pattern = new RegExp(`^\\s*${escapeSelectionPattern(nodeId)}(?=\\s*[\\[\\(\\{])`);
    for (let index = block.startLine; index <= block.endLine; index += 1) {
      const line = block.lines[index] ?? '';
      if (!pattern.test(line)) {
        continue;
      }

      return [lineRangeToTextRange(block.lineStarts, block.lines, index, index)];
    }

    return [];
  });
}

function findSubgraphTextRanges(source: string, subgraphIds: string[]) {
  const block = findMermaidBlockTextLines(source);
  if (!block) {
    return [];
  }

  return subgraphIds.flatMap((subgraphId) => {
    const pattern = new RegExp(`^\\s*subgraph\\s+${escapeSelectionPattern(subgraphId)}(?=\\s|\\[|$)`);
    for (let index = block.startLine; index <= block.endLine; index += 1) {
      const line = block.lines[index] ?? '';
      if (!pattern.test(line)) {
        continue;
      }

      return [lineRangeToTextRange(block.lineStarts, block.lines, index, index)];
    }

    return [];
  });
}

function resolveLocalSourceSelectionRange(
  source: string,
  selection: ReturnType<typeof buildHostSourceSelectionPayload>,
) {
  if (selection.kind === 'none') {
    return null;
  }

  if (selection.kind === 'content') {
    return findContentSectionTextRange(source);
  }

  if (selection.kind === 'node') {
    return mergeTextRanges(findNodeTextRanges(source, selection.nodeIds));
  }

  if (selection.kind === 'subgraph') {
    return mergeTextRanges(findSubgraphTextRanges(source, selection.subgraphIds));
  }

  return null;
}

function getConnectedNodeCluster(document: GraphDocument, startNodeId: string) {
  const adjacency = new Map<string, Set<string>>();
  const link = (left: string, right: string) => {
    if (left === right) {
      return;
    }
    if (!adjacency.has(left)) {
      adjacency.set(left, new Set());
    }
    if (!adjacency.has(right)) {
      adjacency.set(right, new Set());
    }
    adjacency.get(left)?.add(right);
    adjacency.get(right)?.add(left);
  };

  const subgraphLookup = new Map(document.subgraphs.map((subgraph) => [subgraph.id, subgraph]));
  const expandEndpointToNodeIds = (endpointId: string) => {
    const directNode = document.nodes.find((node) => node.id === endpointId);
    if (directNode) {
      return [directNode.id];
    }

    if (subgraphLookup.has(endpointId)) {
      return collectNodeIdsForSubgraph(endpointId, document.nodes, subgraphLookup);
    }

    return [];
  };

  document.nodes.forEach((node) => {
    if (!adjacency.has(node.id)) {
      adjacency.set(node.id, new Set());
    }
  });

  for (const edge of document.edges) {
    const fromNodeIds = expandEndpointToNodeIds(edge.from);
    const toNodeIds = expandEndpointToNodeIds(edge.to);

    for (const fromNodeId of fromNodeIds) {
      for (const toNodeId of toNodeIds) {
        link(fromNodeId, toNodeId);
      }
    }
  }

  const visited = new Set<string>();
  const queue = [startNodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }

  return document.nodes
    .filter((node) => visited.has(node.id))
    .map((node) => node.id);
}

function parseAiToolArguments(raw: unknown) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    throw new Error('Invalid tool arguments JSON.');
  }

  return {};
}

function getOperationNodePlacement(document: GraphDocument, subgraphId: string | null) {
  const siblings = document.nodes.filter((node) => node.subgraphId === subgraphId);
  const last = siblings.at(-1);
  if (last) {
    return {
      x: last.x + last.width + 96,
      y: last.y + (siblings.length % 2 === 0 ? 0 : 84),
    };
  }

  const viewport = document.layout.viewport;
  return {
    x: Math.round((520 - viewport.x) / viewport.zoom),
    y: Math.round((240 - viewport.y) / viewport.zoom),
  };
}

function measureEdgeLabelBadge(label: string) {
  const lines = label.split(/\r?\n/).map((line) => line.trim());
  const lineHeights = 18;
  const longestLineWidth = lines.reduce((maxWidth, line) => {
    const estimatedWidth = Array.from(line).reduce((width, character) => {
      if (/[\u2e80-\u9fff\uac00-\ud7af]/.test(character)) {
        return width + 11.4;
      }

      if (/[A-Z0-9]/.test(character)) {
        return width + 7.4;
      }

      return width + 6.5;
    }, 0);

    return Math.max(maxWidth, estimatedWidth);
  }, 0);
  const visibleLineCount = Math.max(1, lines.length);

  return {
    width: Math.max(54, Math.ceil(longestLineWidth + 24)),
    height: Math.max(22, 10 + visibleLineCount * lineHeights),
  };
}

function getNodeRectAt(
  node: Pick<GraphNode, 'width' | 'height'>,
  point: Point,
): Rect {
  return {
    x: point.x,
    y: point.y,
    width: node.width,
    height: node.height,
  };
}

function getSubgraphAncestryIds(
  subgraphId: string | null | undefined,
  lookup: Map<string, GraphSubgraph>,
) {
  const ids = new Set<string>();
  let current = subgraphId ?? null;

  while (current) {
    ids.add(current);
    current = lookup.get(current)?.parentId ?? null;
  }

  return ids;
}

function buildEdgeEndpointOffsetMap(edges: GraphEdge[], endpoints: EdgeEndpointBox[]) {
  const endpointMap = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const groups = new Map<string, Array<{ edgeId: string; end: 'from' | 'to'; orderMetric: number }>>();
  const offsets = new Map<string, { from: number; to: number }>();
  const pairGroups = new Map<string, GraphEdge[]>();

  for (const edge of edges) {
    const fromEndpoint = endpointMap.get(edge.from);
    const toEndpoint = endpointMap.get(edge.to);
    if (!fromEndpoint || !toEndpoint) {
      continue;
    }

    const fromCenter = getNodeCenter(fromEndpoint);
    const toCenter = getNodeCenter(toEndpoint);
    const fromAnchor = getNodeAnchor(fromEndpoint, toCenter);
    const toAnchor = getNodeAnchor(toEndpoint, fromCenter);
    const fromKey = `${edge.from}:${sideFromAnchor(fromAnchor)}`;
    const toKey = `${edge.to}:${sideFromAnchor(toAnchor)}`;
    const fromAxis = tangentAxisFromAnchor(fromAnchor);
    const toAxis = tangentAxisFromAnchor(toAnchor);
    const fromOrderMetric = toCenter.x * fromAxis.x + toCenter.y * fromAxis.y;
    const toOrderMetric = fromCenter.x * toAxis.x + fromCenter.y * toAxis.y;
    const pairKey = [edge.from, edge.to].sort().join('::');

    groups.set(fromKey, [...(groups.get(fromKey) ?? []), { edgeId: edge.id, end: 'from', orderMetric: fromOrderMetric }]);
    groups.set(toKey, [...(groups.get(toKey) ?? []), { edgeId: edge.id, end: 'to', orderMetric: toOrderMetric }]);
    pairGroups.set(pairKey, [...(pairGroups.get(pairKey) ?? []), edge]);
    offsets.set(edge.id, { from: 0, to: 0 });
  }

  const reciprocalEdgeIds = new Set<string>();
  pairGroups.forEach((group) => {
    const directions = new Set(group.map((edge) => `${edge.from}->${edge.to}`));
    if (directions.size < 2) {
      return;
    }

    const [canonicalFrom, canonicalTo] = [group[0].from, group[0].to].sort((left, right) =>
      left.localeCompare(right),
    );
    const forward = group
      .filter((edge) => edge.from === canonicalFrom && edge.to === canonicalTo)
      .sort((left, right) => left.id.localeCompare(right.id));
    const reverse = group
      .filter((edge) => !(edge.from === canonicalFrom && edge.to === canonicalTo))
      .sort((left, right) => left.id.localeCompare(right.id));
    const canonicalFromEndpoint = endpointMap.get(canonicalFrom);
    const canonicalToEndpoint = endpointMap.get(canonicalTo);
    if (!canonicalFromEndpoint || !canonicalToEndpoint) {
      return;
    }

    const canonicalFromCenter = getNodeCenter(canonicalFromEndpoint);
    const canonicalToCenter = getNodeCenter(canonicalToEndpoint);
    const canonicalVector = normalizeVector({
      x: canonicalToCenter.x - canonicalFromCenter.x,
      y: canonicalToCenter.y - canonicalFromCenter.y,
    });
    const pairNormal = {
      x: -canonicalVector.y,
      y: canonicalVector.x,
    };

    assignReciprocalEndpointOffsets(
      forward,
      canonicalFromEndpoint,
      canonicalToEndpoint,
      pairNormal,
      -1,
      offsets,
    );
    assignReciprocalEndpointOffsets(
      reverse,
      canonicalToEndpoint,
      canonicalFromEndpoint,
      pairNormal,
      1,
      offsets,
    );

    group.forEach((edge) => reciprocalEdgeIds.add(edge.id));
  });

  groups.forEach((entries) => {
    const sorted = [...entries].sort((left, right) => left.orderMetric - right.orderMetric);
    sorted.forEach((entry, index) => {
      if (reciprocalEdgeIds.has(entry.edgeId)) {
        return;
      }
      const current = offsets.get(entry.edgeId);
      if (!current) {
        return;
      }

      const nextOffset = (index - (sorted.length - 1) / 2) * 28;
      current[entry.end] = nextOffset;
      offsets.set(entry.edgeId, current);
    });
  });

  return offsets;
}

function buildSelectionBounds(nodes: GraphNode[]) {
  if (nodes.length === 0) {
    return null;
  }

  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getNodeCenter(node: Pick<GraphNode, 'x' | 'y' | 'width' | 'height'>) {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  };
}

function getNodeAnchor(
  node: Pick<GraphNode, 'x' | 'y' | 'width' | 'height'>,
  target: Point,
) {
  const center = getNodeCenter(node);
  const dx = target.x - center.x;
  const dy = target.y - center.y;

  if (Math.abs(dx) > Math.abs(dy) * 1.15) {
    if (dx >= 0) {
      return { x: node.x + node.width, y: center.y, dirX: 1, dirY: 0 };
    }

    return { x: node.x, y: center.y, dirX: -1, dirY: 0 };
  }

  if (dy >= 0) {
    return { x: center.x, y: node.y + node.height, dirX: 0, dirY: 1 };
  }

  return { x: center.x, y: node.y, dirX: 0, dirY: -1 };
}

function tangentAxisFromAnchor(anchor: { dirX: number; dirY: number }) {
  return anchor.dirX !== 0 ? { x: 0, y: 1 } : { x: 1, y: 0 };
}

function snapRouteValue(value: number, grid = 16) {
  return Math.round(value / grid) * grid;
}

function simplifyPolylinePoints(points: Point[]) {
  const deduped: Point[] = [];
  points.forEach((point) => {
    const previous = deduped[deduped.length - 1];
    if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) >= 0.75) {
      deduped.push({ x: point.x, y: point.y });
    }
  });

  return deduped.filter((point, index) => {
    if (index === 0 || index === deduped.length - 1) {
      return true;
    }
    const previous = deduped[index - 1];
    const next = deduped[index + 1];
    const cross =
      (point.x - previous.x) * (next.y - point.y) -
      (point.y - previous.y) * (next.x - point.x);
    // Drop collinear middle points so routes stay minimal.
    return Math.abs(cross) > 0.75;
  });
}

/**
 * Clean Manhattan routing: fewest right-angle bends, no diagonal jogs.
 * Readable first; design language is carried by stroke/arrow styling.
 */
function buildTechnoPolylinePoints(
  start: Point,
  end: Point,
  fromAnchor: { dirX: number; dirY: number },
  toAnchor: { dirX: number; dirY: number },
  laneOffset: number,
) {
  const stub = 22;
  const s1 = {
    x: start.x + fromAnchor.dirX * stub,
    y: start.y + fromAnchor.dirY * stub,
  };
  const e1 = {
    x: end.x + toAnchor.dirX * stub,
    y: end.y + toAnchor.dirY * stub,
  };

  const fromH = fromAnchor.dirX !== 0;
  const toH = toAnchor.dirX !== 0;
  const lane = laneOffset;

  // Short hop: keep it almost direct with only stubs.
  if (Math.hypot(e1.x - s1.x, e1.y - s1.y) < 28) {
    return simplifyPolylinePoints([start, s1, e1, end]);
  }

  // Both leave/enter on horizontal faces → vertical mid corridor.
  if (fromH && toH) {
    const facing = fromAnchor.dirX === -toAnchor.dirX;
    let midX: number;
    if (facing) {
      midX = (s1.x + e1.x) / 2 + lane;
      // If stubs already crossed (nodes very close / overlapping axis), push corridor out.
      if (
        (fromAnchor.dirX > 0 && midX < s1.x) ||
        (fromAnchor.dirX < 0 && midX > s1.x)
      ) {
        midX = s1.x + fromAnchor.dirX * (28 + Math.abs(lane));
      }
    } else {
      // Same-side exits: loop outward then down/up.
      midX =
        fromAnchor.dirX > 0
          ? Math.max(s1.x, e1.x) + 28 + Math.abs(lane)
          : Math.min(s1.x, e1.x) - 28 - Math.abs(lane);
    }

    return simplifyPolylinePoints([
      start,
      s1,
      { x: midX, y: s1.y },
      { x: midX, y: e1.y },
      e1,
      end,
    ]);
  }

  // Both vertical faces → horizontal mid corridor.
  if (!fromH && !toH) {
    const facing = fromAnchor.dirY === -toAnchor.dirY;
    let midY: number;
    if (facing) {
      midY = (s1.y + e1.y) / 2 + lane;
      if (
        (fromAnchor.dirY > 0 && midY < s1.y) ||
        (fromAnchor.dirY < 0 && midY > s1.y)
      ) {
        midY = s1.y + fromAnchor.dirY * (28 + Math.abs(lane));
      }
    } else {
      midY =
        fromAnchor.dirY > 0
          ? Math.max(s1.y, e1.y) + 28 + Math.abs(lane)
          : Math.min(s1.y, e1.y) - 28 - Math.abs(lane);
    }

    return simplifyPolylinePoints([
      start,
      s1,
      { x: s1.x, y: midY },
      { x: e1.x, y: midY },
      e1,
      end,
    ]);
  }

  // Mixed faces → single L (or slight offset L when lanes stack).
  if (fromH) {
    const corner = { x: e1.x + lane * 0.15, y: s1.y };
    return simplifyPolylinePoints([start, s1, corner, e1, end]);
  }

  const corner = { x: s1.x, y: e1.y + lane * 0.15 };
  return simplifyPolylinePoints([start, s1, corner, e1, end]);
}

function getEdgeDashArray(type: EdgeType): string | undefined {
  if (type === 'dotted') {
    return '3 7';
  }
  return undefined;
}

/** Orthogonal path with soft corner radius — cleaner than raw miter jogs. */
function buildPolylinePath(points: Point[], cornerRadius = 10) {
  if (points.length === 0) {
    return '';
  }
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }
  if (points.length === 2 || cornerRadius <= 0) {
    return points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' ');
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1];
    const curr = points[index];
    const next = points[index + 1];
    const d1x = curr.x - prev.x;
    const d1y = curr.y - prev.y;
    const d2x = next.x - curr.x;
    const d2y = next.y - curr.y;
    const len1 = Math.hypot(d1x, d1y) || 1;
    const len2 = Math.hypot(d2x, d2y) || 1;
    const radius = Math.min(cornerRadius, len1 / 2, len2 / 2);
    const p1 = {
      x: curr.x - (d1x / len1) * radius,
      y: curr.y - (d1y / len1) * radius,
    };
    const p2 = {
      x: curr.x + (d2x / len2) * radius,
      y: curr.y + (d2y / len2) * radius,
    };
    path += ` L ${p1.x} ${p1.y} Q ${curr.x} ${curr.y} ${p2.x} ${p2.y}`;
  }
  const last = points[points.length - 1];
  path += ` L ${last.x} ${last.y}`;
  return path;
}

function pointAlongPolyline(points: Point[], ratio: number) {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  if (points.length === 1) {
    return points[0];
  }

  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    totalLength += distanceBetweenPoints(points[index - 1], points[index]);
  }

  const targetLength = totalLength * clamp(ratio, 0, 1);
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = distanceBetweenPoints(start, end);
    if (traversed + segmentLength >= targetLength) {
      const localRatio = segmentLength <= 0 ? 0 : (targetLength - traversed) / segmentLength;
      return {
        x: start.x + (end.x - start.x) * localRatio,
        y: start.y + (end.y - start.y) * localRatio,
      };
    }
    traversed += segmentLength;
  }

  return points[points.length - 1];
}

function buildEdgeGeometry(
  fromNode: Pick<GraphNode, 'x' | 'y' | 'width' | 'height'>,
  toNode: Pick<GraphNode, 'x' | 'y' | 'width' | 'height'>,
  laneOffset = 0,
  endpointOffsets: { from: number; to: number } = { from: 0, to: 0 },
) {
  // Anchor slightly outside the border so arrows don't clip the node face.
  const endInset = 2;
  const fromAnchor = getNodeAnchor(fromNode, getNodeCenter(toNode));
  const toAnchor = getNodeAnchor(toNode, getNodeCenter(fromNode));
  const fromNormal = normalFromAnchor(fromAnchor);
  const toNormal = normalFromAnchor(toAnchor);
  const start = {
    x: fromAnchor.x + fromAnchor.dirX * endInset + fromNormal.x * endpointOffsets.from,
    y: fromAnchor.y + fromAnchor.dirY * endInset + fromNormal.y * endpointOffsets.from,
  };
  const end = {
    x: toAnchor.x + toAnchor.dirX * endInset + toNormal.x * endpointOffsets.to,
    y: toAnchor.y + toAnchor.dirY * endInset + toNormal.y * endpointOffsets.to,
  };
  const points = buildTechnoPolylinePoints(start, end, fromAnchor, toAnchor, laneOffset);
  const mid = pointAlongPolyline(points, 0.5);
  const label = pointAlongPolyline(points, 0.5);
  const controlA = points[1] ?? start;
  const controlB = points[Math.max(0, points.length - 2)] ?? end;

  return {
    path: buildPolylinePath(points, 12),
    mid,
    label,
    start,
    controlA,
    controlB,
    end,
    points,
  };
}

function buildEdgeLaneMap(edges: GraphEdge[]) {
  const groups = new Map<string, GraphEdge[]>();

  edges.forEach((edge) => {
    const key = [edge.from, edge.to].sort().join('::');
    const current = groups.get(key) ?? [];
    current.push(edge);
    groups.set(key, current);
  });

  const laneMap = new Map<string, number>();
  groups.forEach((group) => {
    const sorted = [...group].sort((left, right) =>
      `${left.from}:${left.to}:${left.id}`.localeCompare(`${right.from}:${right.to}:${right.id}`),
    );
    const hasReciprocal = sorted.some((edge) =>
      sorted.some((candidate) =>
        candidate.id !== edge.id &&
        candidate.from === edge.to &&
        candidate.to === edge.from,
      ),
    );
    if (hasReciprocal) {
      const [canonicalFrom, canonicalTo] = [sorted[0].from, sorted[0].to].sort((left, right) => left.localeCompare(right));
      const forward = sorted.filter((edge) => edge.from === canonicalFrom && edge.to === canonicalTo);
      const reverse = sorted.filter((edge) => !(edge.from === canonicalFrom && edge.to === canonicalTo));
      const assignReciprocalOffsets = (directionEdges: GraphEdge[], baseSign: 1 | -1) => {
        const center = (directionEdges.length - 1) / 2;
        directionEdges.forEach((edge, index) => {
          laneMap.set(edge.id, baseSign * (18 + (index - center) * 16));
        });
      };

      assignReciprocalOffsets(forward, -1);
      assignReciprocalOffsets(reverse, 1);
      return;
    }

    const spacing = 22;
    sorted.forEach((edge, index) => {
      laneMap.set(edge.id, (index - (sorted.length - 1) / 2) * spacing);
    });
  });

  return laneMap;
}

function assignReciprocalEndpointOffsets(
  directionEdges: GraphEdge[],
  fromEndpoint: EdgeEndpointBox,
  toEndpoint: EdgeEndpointBox,
  pairNormal: Point,
  side: 1 | -1,
  offsets: Map<string, { from: number; to: number }>,
) {
  if (directionEdges.length === 0) {
    return;
  }

  const fromCenter = getNodeCenter(fromEndpoint);
  const toCenter = getNodeCenter(toEndpoint);
  const baseSpread = 46;
  const intraSpacing = 28;
  const center = (directionEdges.length - 1) / 2;

  directionEdges.forEach((edge, index) => {
    const current = offsets.get(edge.id);
    if (!current) {
      return;
    }

    const localSpread = baseSpread + Math.abs(index - center) * intraSpacing;
    const desiredWorldOffset = {
      x: pairNormal.x * side * localSpread,
      y: pairNormal.y * side * localSpread,
    };
    const edgeFromAnchor = getNodeAnchor(fromEndpoint, toCenter);
    const edgeToAnchor = getNodeAnchor(toEndpoint, fromCenter);
    const fromAxis = tangentAxisFromAnchor(edgeFromAnchor);
    const toAxis = tangentAxisFromAnchor(edgeToAnchor);

    current.from = desiredWorldOffset.x * fromAxis.x + desiredWorldOffset.y * fromAxis.y;
    current.to = desiredWorldOffset.x * toAxis.x + desiredWorldOffset.y * toAxis.y;
    offsets.set(edge.id, current);
  });
}

function sampleCubic(
  start: Point,
  controlA: Point,
  controlB: Point,
  end: Point,
  steps = 14,
) {
  const points: Point[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const mt = 1 - t;
    points.push({
      x:
        mt ** 3 * start.x +
        3 * mt ** 2 * t * controlA.x +
        3 * mt * t ** 2 * controlB.x +
        t ** 3 * end.x,
      y:
        mt ** 3 * start.y +
        3 * mt ** 2 * t * controlA.y +
        3 * mt * t ** 2 * controlB.y +
        t ** 3 * end.y,
    });
  }
  return points;
}

function pointInRect(point: Point, rect: { x: number; y: number; width: number; height: number }, padding = 0) {
  return (
    point.x >= rect.x - padding &&
    point.x <= rect.x + rect.width + padding &&
    point.y >= rect.y - padding &&
    point.y <= rect.y + rect.height + padding
  );
}

function edgeIntersectsRect(
  rect: { x: number; y: number; width: number; height: number },
  geometry: ReturnType<typeof buildEdgeGeometry>,
) {
  const samples = geometry.points.length >= 2
    ? geometry.points
    : [geometry.start, ...sampleCubic(geometry.start, geometry.controlA, geometry.controlB, geometry.end), geometry.end];
  return samples.some((point) => pointInRect(point, rect, 10));
}

function buildEdgeApproxBounds(
  fromEndpoint: Pick<EdgeEndpointBox, 'x' | 'y' | 'width' | 'height'>,
  toEndpoint: Pick<EdgeEndpointBox, 'x' | 'y' | 'width' | 'height'>,
  padding = 128,
): Rect {
  const minX = Math.min(fromEndpoint.x, toEndpoint.x) - padding;
  const minY = Math.min(fromEndpoint.y, toEndpoint.y) - padding;
  const maxX = Math.max(
    fromEndpoint.x + fromEndpoint.width,
    toEndpoint.x + toEndpoint.width,
  ) + padding;
  const maxY = Math.max(
    fromEndpoint.y + fromEndpoint.height,
    toEndpoint.y + toEndpoint.height,
  ) + padding;

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function appendRoundedRectPath(path: Path2D, rect: Rect, radius: number) {
  const safeRadius = Math.min(radius, rect.width / 2, rect.height / 2);
  path.moveTo(rect.x + safeRadius, rect.y);
  path.lineTo(rect.x + rect.width - safeRadius, rect.y);
  path.arcTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + safeRadius, safeRadius);
  path.lineTo(rect.x + rect.width, rect.y + rect.height - safeRadius);
  path.arcTo(
    rect.x + rect.width,
    rect.y + rect.height,
    rect.x + rect.width - safeRadius,
    rect.y + rect.height,
    safeRadius,
  );
  path.lineTo(rect.x + safeRadius, rect.y + rect.height);
  path.arcTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - safeRadius, safeRadius);
  path.lineTo(rect.x, rect.y + safeRadius);
  path.arcTo(rect.x, rect.y, rect.x + safeRadius, rect.y, safeRadius);
  path.closePath();
}

function buildCanvasNodePath(
  _shape: NodeShape,
  rect: Rect,
) {
  const path = new Path2D();
  path.rect(rect.x, rect.y, rect.width, rect.height);
  return path;
}

function drawCanvasTextBlock(
  context: CanvasRenderingContext2D,
  lines: string[],
  centerX: number,
  centerY: number,
  lineHeight: number,
  fontSize: number,
  fontWeight: number,
  fill: string,
) {
  if (lines.length === 0) {
    return;
  }

  const startY = centerY - ((lines.length - 1) * lineHeight) / 2;
  context.save();
  context.fillStyle = fill;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `${fontWeight} ${fontSize}px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  lines.forEach((line, index) => {
    sceneTextCache.drawCenteredLine(
      context,
      line || ' ',
      centerX,
      startY + index * lineHeight,
      context.font,
      fill,
    );
  });
  context.restore();
}

function drawCanvasEdgeArrow(
  context: CanvasRenderingContext2D,
  geometry: ReturnType<typeof buildEdgeGeometry>,
  color: string,
  scale: number,
) {
  const arrowSource = geometry.points.length >= 2
    ? geometry.points[geometry.points.length - 2]
    : geometry.controlB;
  const deltaX = geometry.end.x - arrowSource.x;
  const deltaY = geometry.end.y - arrowSource.y;
  const length = Math.hypot(deltaX, deltaY) || 1;
  const dirX = deltaX / length;
  const dirY = deltaY / length;
  const normalX = -dirY;
  const normalY = dirX;
  // Compact filled triangle, slightly pulled back from the node face
  const arrowLength = 9 * scale;
  const arrowWidth = 4.2 * scale;
  const tipX = geometry.end.x - dirX * 1.5;
  const tipY = geometry.end.y - dirY * 1.5;
  const baseX = tipX - dirX * arrowLength;
  const baseY = tipY - dirY * arrowLength;

  context.save();
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(tipX, tipY);
  context.lineTo(baseX + normalX * arrowWidth, baseY + normalY * arrowWidth);
  context.lineTo(baseX - normalX * arrowWidth, baseY - normalY * arrowWidth);
  context.closePath();
  context.fill();
  context.restore();
}

function drawCanvasNode(
  context: CanvasRenderingContext2D,
  node: GraphNode,
  zoom: number,
) {
  const path = buildCanvasNodePath(node.shape, node);
  const simplified = zoom <= HYBRID_SCENE_SIMPLIFIED_ZOOM_THRESHOLD;
  const titleFill = mixColors(node.stroke, node.fill, 0.84);
  const bodyFill = mixColors(node.fill, '#ffffff', 0.04);

  context.save();
  context.fillStyle = bodyFill;
  context.strokeStyle = node.stroke;
  context.lineWidth = simplified ? 1.4 : 2.4;
  context.fill(path);
  context.stroke(path);

  if (simplified) {
    context.restore();
    return;
  }

  const parts = splitEntityText(node.label);
  const titleLines = wrapSvgTextLines(parts.title, Math.max(8, Math.floor((node.width - 34) / 11)));
  const descriptionLines = wrapSvgTextLines(
    parts.description || '（空）',
    Math.max(8, Math.floor((node.width - 30) / 8.5)),
  );
  const titleHeight = Math.min(
    node.height - 22,
    Math.max(parts.description ? 54 : 66, 24 + titleLines.length * 24 + (parts.description ? 6 : 14)),
  );
  const descriptionHeight = Math.max(22, node.height - titleHeight);

  context.save();
  context.clip(path);
  context.fillStyle = titleFill;
  context.fillRect(node.x, node.y, node.width, titleHeight);
  context.fillStyle = bodyFill;
  context.fillRect(node.x, node.y + titleHeight, node.width, descriptionHeight);
  context.strokeStyle = withAlpha(node.stroke, 0.22);
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(node.x, node.y + titleHeight);
  context.lineTo(node.x + node.width, node.y + titleHeight);
  context.stroke();
  context.restore();

  if (zoom >= HYBRID_SCENE_TITLE_ZOOM_THRESHOLD) {
    drawCanvasTextBlock(
      context,
      titleLines,
      node.x + node.width / 2,
      node.y + titleHeight / 2,
      22,
      17,
      800,
      node.textColor,
    );
  }

  if (zoom >= HYBRID_SCENE_DESCRIPTION_ZOOM_THRESHOLD) {
    drawCanvasTextBlock(
      context,
      descriptionLines,
      node.x + node.width / 2,
      node.y + titleHeight + descriptionHeight / 2,
      18,
      parts.description ? 14 : 12,
      560,
      parts.description ? node.textColor : withAlpha(node.textColor, 0.44),
    );
  }

  context.restore();
}

function drawCanvasEdge(
  context: CanvasRenderingContext2D,
  edgeInfo: SceneRenderableEdge,
  zoom: number,
) {
  const normalizedEdge = normalizeEdgeStyle(edgeInfo.edge);
  const isGroupEdge = edgeInfo.fromEndpoint.kind === 'subgraph' || edgeInfo.toEndpoint.kind === 'subgraph';
  const inheritsSourceColor = shouldInheritSourceEdgeColor(normalizedEdge.strokeColor);
  const edgeBaseColor = inheritsSourceColor
    ? getEndpointAccentColor(edgeInfo.fromEndpoint)
    : normalizedEdge.strokeColor;
  const baseStrokeWidth = isGroupEdge ? normalizedEdge.strokeWidth * 1.35 : normalizedEdge.strokeWidth;
  const visualStrokeWidth = Math.max(baseStrokeWidth, isGroupEdge ? 2.4 : 1.75);
  const path = new Path2D(edgeInfo.geometry.path);
  const simplified = zoom <= HYBRID_SCENE_SIMPLIFIED_ZOOM_THRESHOLD;
  const dash = getEdgeDashArray(normalizedEdge.type);

  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';

  // Thin dark halo for contrast on black canvas — not a thick sticker plate
  if (!simplified) {
    context.strokeStyle = 'rgba(0, 0, 0, 0.72)';
    context.lineWidth = visualStrokeWidth + 1.6;
    if (dash) {
      context.setLineDash(dash.split(' ').map(Number));
    }
    context.stroke(path);
    context.setLineDash([]);
  }

  context.strokeStyle = withAlpha(edgeBaseColor, 1);
  context.lineWidth = simplified
    ? Math.max(1.2, visualStrokeWidth * 0.85)
    : normalizedEdge.type === 'thick'
      ? Math.max(visualStrokeWidth, 3.2)
      : visualStrokeWidth;
  if (dash) {
    context.setLineDash(dash.split(' ').map(Number));
  }
  context.stroke(path);
  context.setLineDash([]);

  if (normalizedEdge.type !== 'line' && zoom >= HYBRID_SCENE_ARROW_ZOOM_THRESHOLD) {
    drawCanvasEdgeArrow(context, edgeInfo.geometry, edgeBaseColor, isGroupEdge ? 1.05 : 1);
  }

  if (edgeInfo.edge.label && zoom >= HYBRID_SCENE_DESCRIPTION_ZOOM_THRESHOLD) {
    const metrics = measureEdgeLabelBadge(edgeInfo.edge.label);
    const labelBackground = mixColors(edgeBaseColor, '#0c0c0e', 0.82);
    const labelTextColor = getReadableLabelTextColor(labelBackground, '#ffffff');
    const labelX = edgeInfo.geometry.label.x - metrics.width / 2;
    const labelY = edgeInfo.geometry.label.y - metrics.height / 2;
    const lines = edgeInfo.edge.label.split(/\r?\n/);

    context.fillStyle = labelBackground;
    context.strokeStyle = withAlpha(edgeBaseColor, 0.85);
    context.lineWidth = 1;
    context.fillRect(labelX, labelY, metrics.width, metrics.height);
    context.strokeRect(labelX, labelY, metrics.width, metrics.height);
    drawCanvasTextBlock(
      context,
      lines,
      edgeInfo.geometry.label.x,
      edgeInfo.geometry.label.y,
      16,
      11,
      700,
      labelTextColor,
    );
  }

  context.restore();
}

function buildPreviewEdgePath(
  fromNode: Pick<EdgeEndpointBox, 'x' | 'y' | 'width' | 'height'>,
  currentPoint: Point,
  handleSide?: 'left' | 'right',
) {
  const center = getNodeCenter(fromNode);
  const startAnchor = handleSide
    ? {
      x: handleSide === 'left' ? fromNode.x : fromNode.x + fromNode.width,
      y: center.y,
      dirX: handleSide === 'left' ? -1 : 1,
      dirY: 0,
    }
    : getNodeAnchor(fromNode, currentPoint);
  const start = {
    x: startAnchor.x + startAnchor.dirX * 10,
    y: startAnchor.y + startAnchor.dirY * 10,
  };
  const deltaX = currentPoint.x - start.x;
  const deltaY = currentPoint.y - start.y;
  const endAnchor =
    Math.abs(deltaX) >= Math.abs(deltaY)
      ? { dirX: deltaX >= 0 ? -1 : 1, dirY: 0 }
      : { dirX: 0, dirY: deltaY >= 0 ? -1 : 1 };

  const points = buildTechnoPolylinePoints(
    start,
    currentPoint,
    startAnchor,
    endAnchor,
    0,
  );
  return buildPolylinePath(points);
}

function duplicateNodesWithEdges(document: GraphDocument, sourceIds: string[], offset: Point) {
  const ids = new Set(sourceIds);
  const nodeIdMap = new Map<string, string>();
  const duplicatedNodes = document.nodes
    .filter((node) => ids.has(node.id))
    .map((node) => {
      const title = splitEntityText(node.label).title || '未命名内容';
      const nextId = nextNodeId([
        ...document.nodes,
        ...Array.from(nodeIdMap.values()).map((id) =>
          buildNode(id, id, { x: 0, y: 0 }, null),
        ),
      ], title);
      nodeIdMap.set(node.id, nextId);
      return {
        ...resizeNodeToContent(node, node.label),
        id: nextId,
        x: node.x + offset.x,
        y: node.y + offset.y,
      };
    });

  const duplicatedEdges = document.edges
    .filter((edge) => ids.has(edge.from) || ids.has(edge.to))
    .map((edge) => ({
      ...edge,
      id: crypto.randomUUID(),
      from: nodeIdMap.get(edge.from) ?? edge.from,
      to: nodeIdMap.get(edge.to) ?? edge.to,
    }));

  return {
    duplicatedNodes,
    duplicatedEdges,
  };
}

function selectionContains(selection: SelectionState, id: string) {
  return selection.ids.includes(id);
}

function selectionContainsSubgraph(selection: SelectionState, id: string) {
  return (
    (selection.kind === 'subgraph' && selectionContains(selection, id)) ||
    (selection.kind === 'node' && (selection.subgraphIds ?? []).includes(id))
  );
}

function withNodeSelection(nodeIds: string[], subgraphIds: string[] = []): SelectionState {
  const nextNodeIds = [...new Set(nodeIds)];
  const nextSubgraphIds = [...new Set(subgraphIds)];

  if (nextNodeIds.length === 0) {
    return nextSubgraphIds.length > 0
      ? { kind: 'subgraph', ids: nextSubgraphIds }
      : { kind: 'none', ids: [] };
  }

  return nextSubgraphIds.length > 0
    ? { kind: 'node', ids: nextNodeIds, subgraphIds: nextSubgraphIds }
    : { kind: 'node', ids: nextNodeIds };
}

function toggleNodeSelectionWithSubgraphs(
  current: SelectionState,
  nodeIds: string[],
  subgraphIds: string[],
): SelectionState {
  const nextNodeSet = new Set(current.kind === 'node' ? current.ids : []);
  nodeIds.forEach((id) => {
    if (nextNodeSet.has(id)) {
      nextNodeSet.delete(id);
    } else {
      nextNodeSet.add(id);
    }
  });

  const nextSubgraphSet = new Set(
    current.kind === 'node'
      ? (current.subgraphIds ?? [])
      : current.kind === 'subgraph'
        ? current.ids
        : [],
  );
  subgraphIds.forEach((id) => {
    if (nextSubgraphSet.has(id)) {
      nextSubgraphSet.delete(id);
    } else {
      nextSubgraphSet.add(id);
    }
  });

  return withNodeSelection([...nextNodeSet], [...nextSubgraphSet]);
}

function toggleSelectionIds(
  current: SelectionState,
  kind: Exclude<SelectionState['kind'], 'none'>,
  ids: string[],
) {
  const nextSet = new Set(current.kind === kind ? current.ids : []);
  ids.forEach((id) => {
    if (nextSet.has(id)) {
      nextSet.delete(id);
    } else {
      nextSet.add(id);
    }
  });

  const nextIds = [...nextSet];
  return nextIds.length > 0 ? { kind, ids: nextIds } : { kind: 'none' as const, ids: [] };
}

function rectFromPoints(left: Point, right: Point) {
  return {
    x: Math.min(left.x, right.x),
    y: Math.min(left.y, right.y),
    width: Math.abs(left.x - right.x),
    height: Math.abs(left.y - right.y),
  };
}

function handleNativeSelectAllShortcut(
  event:
    | React.KeyboardEvent<HTMLTextAreaElement>
    | React.KeyboardEvent<HTMLInputElement>,
) {
  if (!((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a')) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget;
  window.requestAnimationFrame(() => {
    target.selectionStart = 0;
    target.selectionEnd = target.value.length;
  });
  return true;
}

function isCompositionConfirming(
  event:
    | React.KeyboardEvent<HTMLTextAreaElement>
    | React.KeyboardEvent<HTMLInputElement>,
) {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

function intersects(
  rect: { x: number; y: number; width: number; height: number },
  box: Pick<GraphNode, 'x' | 'y' | 'width' | 'height'>,
) {
  return !(
    box.x + box.width < rect.x ||
    box.x > rect.x + rect.width ||
    box.y + box.height < rect.y ||
    box.y > rect.y + rect.height
  );
}

function selectionBoxStyle(rect: { x: number; y: number; width: number; height: number }, viewport: ViewportState) {
  return {
    left: rect.x * viewport.zoom + viewport.x,
    top: rect.y * viewport.zoom + viewport.y,
    width: rect.width * viewport.zoom,
    height: rect.height * viewport.zoom,
  };
}

function buildMiniMapModel(
  shapes: Array<{
    id: string;
    kind: 'node' | 'subgraph' | 'content';
    rect: Rect;
    fill: string;
    stroke: string;
    selected?: boolean;
  }>,
  viewportRect: Rect | null,
  width = MINIMAP_WIDTH,
  height = MINIMAP_HEIGHT,
) {
  const shapeRects = shapes.map((shape) => shape.rect);
  const allRects = [
    ...shapeRects,
    ...(viewportRect ? [viewportRect] : []),
  ];

  if (allRects.length === 0) {
    return null;
  }

  const contentSourceRects = shapeRects.length > 0 ? shapeRects : (viewportRect ? [viewportRect] : []);
  const minX = Math.min(...contentSourceRects.map((rect) => rect.x));
  const minY = Math.min(...contentSourceRects.map((rect) => rect.y));
  const maxX = Math.max(...contentSourceRects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...contentSourceRects.map((rect) => rect.y + rect.height));
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const padding = clamp(Math.max(contentWidth, contentHeight) * 0.14, 72, 180);
  const navigationBounds = {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(160, contentWidth + padding * 2),
    height: Math.max(120, contentHeight + padding * 2),
  };
  const worldBounds = navigationBounds;
  const scale = Math.min(width / worldBounds.width, height / worldBounds.height);
  const offsetX = (width - worldBounds.width * scale) / 2;
  const offsetY = (height - worldBounds.height * scale) / 2;

  const projectRect = (rect: Rect) => ({
    x: offsetX + (rect.x - worldBounds.x) * scale,
    y: offsetY + (rect.y - worldBounds.y) * scale,
    width: Math.max(2, rect.width * scale),
    height: Math.max(2, rect.height * scale),
  });

  return {
    width,
    height,
    scale,
    offsetX,
    offsetY,
    worldBounds,
    navigationBounds,
    viewportWorldRect: viewportRect ? { ...viewportRect } : null,
    shapes: shapes.map((shape) => ({
      ...shape,
      projected: projectRect(shape.rect),
    })),
    viewport: viewportRect ? projectRect(viewportRect) : null,
  };
}

function downloadFile(filename: string, content: string, contentType: string) {
  const blob = new Blob([content], { type: contentType });
  downloadBlob(filename, blob);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function saveBlobWithPicker(
  filename: string,
  blob: Blob,
  suggestedType?: {
    description: string;
    mime: string;
    extensions: string[];
  },
) {
  const pickerWindow = window as Window & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      excludeAcceptAllOption?: boolean;
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<{
      createWritable?: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };

  if (pickerWindow.showSaveFilePicker) {
    try {
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: filename,
        excludeAcceptAllOption: !!suggestedType,
        types: suggestedType
          ? [{
              description: suggestedType.description,
              accept: {
                [suggestedType.mime]: suggestedType.extensions,
              },
            }]
          : undefined,
      });
      const writable = await handle.createWritable?.();
      if (writable) {
        await writable.write(blob);
        await writable.close();
        return;
      }
    } catch {
      downloadBlob(filename, blob);
      return;
    }
  }

  downloadBlob(filename, blob);
}

function sanitizeFilename(value: string, fallback = 'diagram') {
  const normalized = value
    .trim()
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      if (
        code <= 31 ||
        character === '<' ||
        character === '>' ||
        character === ':' ||
        character === '"' ||
        character === '/' ||
        character === '\\' ||
        character === '|' ||
        character === '?' ||
        character === '*'
      ) {
        return '-';
      }

      return character;
    })
    .join('')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

function loadImageFromUrl(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'sync';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image load failed'));
    image.src = url;
  });
}

async function renderSvgMarkupToCanvasImage(svgMarkup: string, svgBlob: Blob) {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(svgBlob);
      return {
        draw(context: CanvasRenderingContext2D, width: number, height: number) {
          context.drawImage(bitmap, 0, 0, width, height);
          bitmap.close?.();
        },
      };
    } catch {
      // fall through
    }
  }

  const blobUrl = URL.createObjectURL(svgBlob);
  try {
    const image = await loadImageFromUrl(blobUrl);
    return {
      draw(context: CanvasRenderingContext2D, width: number, height: number) {
        context.drawImage(image, 0, 0, width, height);
      },
    };
  } catch {
    URL.revokeObjectURL(blobUrl);
  }
  URL.revokeObjectURL(blobUrl);

  try {
    const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
    const image = await loadImageFromUrl(encoded);
    return {
      draw(context: CanvasRenderingContext2D, width: number, height: number) {
        context.drawImage(image, 0, 0, width, height);
      },
    };
  } catch {
    // fall through
  }

  const base64 = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgMarkup)))}`;
  const image = await loadImageFromUrl(base64);
  return {
    draw(context: CanvasRenderingContext2D, width: number, height: number) {
      context.drawImage(image, 0, 0, width, height);
    },
  };
}

function buildCanvasExportBounds(input: {
  nodes: GraphNode[];
  subgraphs: SubgraphFrame[];
  contentRect?: Rect | null;
  edges: GraphEdge[];
  endpointMap: Map<string, EdgeEndpointBox>;
  laneMap: Map<string, number>;
  endpointOffsets: Map<string, { from: number; to: number }>;
}) {
  const xs: number[] = [];
  const ys: number[] = [];

  const includeRect = (rect: Rect) => {
    xs.push(rect.x, rect.x + rect.width);
    ys.push(rect.y, rect.y + rect.height);
  };

  const includePoint = (point: Point) => {
    xs.push(point.x);
    ys.push(point.y);
  };

  input.nodes.forEach((node) => includeRect(node));
  input.subgraphs.forEach((frame) => includeRect(frame));
  if (input.contentRect) {
    includeRect(input.contentRect);
  }

  input.edges.forEach((edge) => {
    const fromNode = input.endpointMap.get(edge.from);
    const toNode = input.endpointMap.get(edge.to);
    if (!fromNode || !toNode) {
      return;
    }

    const geometry = buildEdgeGeometry(
      fromNode,
      toNode,
      input.laneMap.get(edge.id) ?? 0,
      input.endpointOffsets.get(edge.id),
    );
    includePoint(geometry.start);
    includePoint(geometry.controlA);
    includePoint(geometry.controlB);
    includePoint(geometry.end);

    if (edge.label) {
      const badge = measureEdgeLabelBadge(edge.label);
      includeRect({
        x: geometry.label.x - badge.width / 2,
        y: geometry.label.y - badge.height / 2,
        width: badge.width,
        height: badge.height,
      });
    }
  });

  if (xs.length === 0 || ys.length === 0) {
    return {
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    };
  }

  const padding = 72;
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  const maxX = Math.max(...xs) + padding;
  const maxY = Math.max(...ys) + padding;

  return {
    x: Math.floor(minX),
    y: Math.floor(minY),
    width: Math.ceil(maxX - minX),
    height: Math.ceil(maxY - minY),
  };
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapSvgTextLines(value: string, maxUnits: number) {
  const normalized = value.replace(/\r\n/g, '\n');
  const lines: string[] = [];

  normalized.split('\n').forEach((rawLine) => {
    if (!rawLine) {
      lines.push('');
      return;
    }

    let currentLine = '';
    let currentUnits = 0;

    Array.from(rawLine).forEach((character) => {
      const nextUnits =
        /[\u2e80-\u9fff\uac00-\ud7af]/.test(character)
          ? 1.82
          : /[A-Z0-9]/.test(character)
            ? 1.26
            : 1;

      if (currentLine && currentUnits + nextUnits > maxUnits) {
        lines.push(currentLine);
        currentLine = character;
        currentUnits = nextUnits;
        return;
      }

      currentLine += character;
      currentUnits += nextUnits;
    });

    if (currentLine) {
      lines.push(currentLine);
    }
  });

  return lines.length > 0 ? lines : [''];
}

function getVisibleSubgraphIds(subgraphs: GraphSubgraph[]) {
  return new Map(subgraphs.map((subgraph) => [subgraph.id, subgraph]));
}

function nextSubgraphId(subgraphs: GraphSubgraph[]) {
  let index = subgraphs.length + 1;
  while (subgraphs.some((subgraph) => subgraph.id === `Group_${index}`)) {
    index += 1;
  }

  return `Group_${index}`;
}

function collectDescendantSubgraphIds(
  rootIds: string[],
  subgraphs: GraphSubgraph[],
) {
  const collected = new Set(rootIds);
  let changed = true;

  while (changed) {
    changed = false;

    for (const subgraph of subgraphs) {
      if (!subgraph.parentId || collected.has(subgraph.id) || !collected.has(subgraph.parentId)) {
        continue;
      }

      collected.add(subgraph.id);
      changed = true;
    }
  }

  return collected;
}

function belongsToSubgraph(
  node: GraphNode,
  subgraphId: string,
  lookup: Map<string, GraphSubgraph>,
) {
  let current = node.subgraphId;

  while (current) {
    if (current === subgraphId) {
      return true;
    }

    current = lookup.get(current)?.parentId ?? null;
  }

  return false;
}

function countNodesInSubgraph(
  nodes: GraphNode[],
  subgraphId: string,
  lookup: Map<string, GraphSubgraph>,
) {
  return nodes.filter((node) => belongsToSubgraph(node, subgraphId, lookup)).length;
}

function getTopVisibleCollapsedAncestorId(
  subgraphId: string | null | undefined,
  lookup: Map<string, GraphSubgraph>,
) {
  let current = subgraphId ?? null;
  let visibleCollapsed: string | null = null;

  while (current) {
    const owner = lookup.get(current);
    if (!owner) {
      break;
    }

    if (owner.collapsed) {
      visibleCollapsed = owner.id;
    }

    current = owner.parentId;
  }

  return visibleCollapsed;
}

function isSubgraphHiddenByCollapsedAncestor(
  subgraph: GraphSubgraph,
  lookup: Map<string, GraphSubgraph>,
) {
  let current = subgraph.parentId;
  while (current) {
    const owner = lookup.get(current);
    if (!owner) {
      return false;
    }

    if (owner.collapsed) {
      return true;
    }

    current = owner.parentId;
  }

  return false;
}

function estimateCollapsedSummaryLayout(labels: string[]) {
  const maxWidth = 220;
  let rowWidth = 0;
  let maxRowWidth = 0;
  let rows = labels.length > 0 ? 1 : 0;

  labels.forEach((label) => {
    const normalized = label.trim().split(/\r?\n/)[0] ?? '';
    const units = Array.from(normalized).reduce((total, char) => total + (char.charCodeAt(0) > 255 ? 1.9 : 1), 0);
    const chipWidth = clamp(44 + units * 8, 74, 156);
    if (rowWidth > 0 && rowWidth + chipWidth + 8 > maxWidth) {
      rows += 1;
      maxRowWidth = Math.max(maxRowWidth, rowWidth);
      rowWidth = chipWidth;
    } else {
      rowWidth = rowWidth === 0 ? chipWidth : rowWidth + chipWidth + 8;
    }
  });

  maxRowWidth = Math.max(maxRowWidth, rowWidth, 164);

  return {
    rows,
    width: clamp(maxRowWidth + 28, SUBGRAPH_COLLAPSED_MIN_WIDTH, 276),
    height: SUBGRAPH_HEADER_HEIGHT + 18 + rows * 28 + (rows > 0 ? 18 : 8),
  };
}

function resolveVisibleEndpointIdFromMaps(
  endpointId: string,
  nodeMap: Map<string, GraphNode>,
  subgraphLookup: Map<string, GraphSubgraph>,
) {
  const node = nodeMap.get(endpointId);
  if (node) {
    return getTopVisibleCollapsedAncestorId(node.subgraphId, subgraphLookup) ?? node.id;
  }

  const subgraph = subgraphLookup.get(endpointId);
  if (subgraph) {
    return getTopVisibleCollapsedAncestorId(subgraph.id, subgraphLookup) ?? subgraph.id;
  }

  return endpointId;
}

function collectNodeIdsForSubgraph(
  subgraphId: string,
  nodes: GraphNode[],
  lookup: Map<string, GraphSubgraph>,
) {
  return nodes
    .filter((node) => belongsToSubgraph(node, subgraphId, lookup))
    .map((node) => node.id);
}

function collectLayoutScopeNodeIds(
  document: GraphDocument,
  selection: SelectionState,
) {
  if (selection.kind === 'none' || selection.kind === 'content' || selection.ids.length <= 1) {
    return null;
  }

  const nodeIds = new Set<string>();
  const visibleSubgraphs = getVisibleSubgraphIds(document.subgraphs);

  if (selection.kind === 'node') {
    selection.ids
      .filter((id) => document.nodes.some((node) => node.id === id))
      .forEach((id) => nodeIds.add(id));
  } else if (selection.kind === 'subgraph') {
    selection.ids.forEach((subgraphId) => {
      collectNodeIdsForSubgraph(subgraphId, document.nodes, visibleSubgraphs).forEach((nodeId) => {
        nodeIds.add(nodeId);
      });
    });
  } else if (selection.kind === 'edge') {
    const selectedEdges = document.edges.filter((edge) => selection.ids.includes(edge.id));
    selectedEdges.forEach((edge) => {
      if (document.nodes.some((node) => node.id === edge.from)) {
        nodeIds.add(edge.from);
      } else if (visibleSubgraphs.has(edge.from)) {
        collectNodeIdsForSubgraph(edge.from, document.nodes, visibleSubgraphs).forEach((nodeId) => {
          nodeIds.add(nodeId);
        });
      }

      if (document.nodes.some((node) => node.id === edge.to)) {
        nodeIds.add(edge.to);
      } else if (visibleSubgraphs.has(edge.to)) {
        collectNodeIdsForSubgraph(edge.to, document.nodes, visibleSubgraphs).forEach((nodeId) => {
          nodeIds.add(nodeId);
        });
      }
    });
  }

  return nodeIds.size > 1 ? nodeIds : null;
}

function buildLayoutScopeDocument(
  document: GraphDocument,
  scopedNodeIds: Set<string>,
  selection: SelectionState,
) {
  const subgraphLookup = new Map(document.subgraphs.map((subgraph) => [subgraph.id, subgraph]));
  const scopedSubgraphIds = new Set<string>(
    selection.kind === 'subgraph' ? selection.ids.filter((id) => subgraphLookup.has(id)) : [],
  );

  document.nodes.forEach((node) => {
    if (!scopedNodeIds.has(node.id)) {
      return;
    }

    let current = node.subgraphId;
    while (current) {
      scopedSubgraphIds.add(current);
      current = subgraphLookup.get(current)?.parentId ?? null;
    }
  });

  const scopedNodes = document.nodes
    .filter((node) => scopedNodeIds.has(node.id))
    .map((node) => ({ ...node }));
  const scopedSubgraphs = document.subgraphs
    .filter((subgraph) => scopedSubgraphIds.has(subgraph.id))
    .map((subgraph) => ({ ...subgraph }));
  const scopedSubgraphIdSet = new Set(scopedSubgraphs.map((subgraph) => subgraph.id));
  const scopedEdges = document.edges
    .filter((edge) => {
      const fromIncluded = scopedNodeIds.has(edge.from) || scopedSubgraphIdSet.has(edge.from);
      const toIncluded = scopedNodeIds.has(edge.to) || scopedSubgraphIdSet.has(edge.to);
      return fromIncluded && toIncluded;
    })
    .map((edge) => ({ ...edge }));

  return {
    ...document,
    nodes: scopedNodes,
    edges: scopedEdges,
    subgraphs: scopedSubgraphs,
  };
}

function mergeScopedLayoutNodes(
  document: GraphDocument,
  laidOutNodes: GraphNode[],
) {
  const laidOutNodeMap = new Map(laidOutNodes.map((node) => [node.id, node]));
  return document.nodes.map((node) => {
    const laidOutNode = laidOutNodeMap.get(node.id);
    if (!laidOutNode) {
      return node;
    }

    return {
      ...node,
      x: laidOutNode.x,
      y: laidOutNode.y,
      width: laidOutNode.width,
      height: laidOutNode.height,
    };
  });
}

function removeSubgraphs(current: GraphDocument, rootIds: string[]) {
  const deletedSubgraphIds = collectDescendantSubgraphIds(rootIds, current.subgraphs);

  return {
    ...current,
    subgraphs: current.subgraphs.filter((subgraph) => !deletedSubgraphIds.has(subgraph.id)),
    edges: current.edges.filter(
      (edge) => !deletedSubgraphIds.has(edge.from) && !deletedSubgraphIds.has(edge.to),
    ),
    nodes: current.nodes.map((node) =>
      deletedSubgraphIds.has(node.subgraphId ?? '')
        ? { ...node, subgraphId: null }
        : node,
    ),
  };
}

function isInsideCollapsedSubgraph(
  node: GraphNode,
  lookup: Map<string, GraphSubgraph>,
) {
  let current = node.subgraphId;
  while (current) {
    const owner = lookup.get(current);
    if (!owner) {
      return false;
    }

    if (owner.collapsed) {
      return true;
    }

    current = owner.parentId;
  }

  return false;
}

function getSubgraphDepth(subgraph: GraphSubgraph, lookup: Map<string, GraphSubgraph>) {
  let depth = 0;
  let current = subgraph.parentId;
  while (current) {
    depth += 1;
    current = lookup.get(current)?.parentId ?? null;
  }

  return depth;
}

function buildSubgraphFrames(document: GraphDocument, nodes: GraphNode[]) {
  const frames: SubgraphFrame[] = [];
  const lookup = getVisibleSubgraphIds(document.subgraphs);

  for (const subgraph of document.subgraphs) {
    if (isSubgraphHiddenByCollapsedAncestor(subgraph, lookup)) {
      continue;
    }

    const members = nodes.filter((node) => belongsToSubgraph(node, subgraph.id, lookup));
    const memberCount = members.length;
    const summaryLabels = members
      .map((node) => node.label.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (memberCount === 0) {
      const offset = getSubgraphDepth(subgraph, lookup) * 28;
      frames.push({
        id: subgraph.id,
        x: 160 + offset,
        y: 120 + offset,
        width: subgraph.collapsed ? SUBGRAPH_COLLAPSED_MIN_WIDTH : SUBGRAPH_MIN_WIDTH,
        height: subgraph.collapsed ? SUBGRAPH_COLLAPSED_HEIGHT : SUBGRAPH_MIN_HEIGHT,
        depth: getSubgraphDepth(subgraph, lookup),
        collapsed: subgraph.collapsed,
        headerHeight: SUBGRAPH_HEADER_HEIGHT,
        memberCount,
        summaryLabels,
      });
      continue;
    }

    const minX = Math.min(...members.map((node) => node.x)) - SUBGRAPH_HORIZONTAL_PADDING;
    const minY = Math.min(...members.map((node) => node.y)) - SUBGRAPH_TOP_PADDING - SUBGRAPH_HEADER_HEIGHT;
    const maxX = Math.max(...members.map((node) => node.x + node.width)) + SUBGRAPH_HORIZONTAL_PADDING;
    const maxY = Math.max(...members.map((node) => node.y + node.height)) + SUBGRAPH_BOTTOM_PADDING;
    const collapsedSummary = estimateCollapsedSummaryLayout(summaryLabels);

    frames.push({
      id: subgraph.id,
      x: minX,
      y: minY,
      width: subgraph.collapsed
        ? collapsedSummary.width
        : Math.max(SUBGRAPH_MIN_WIDTH, maxX - minX),
      height: subgraph.collapsed
        ? Math.max(SUBGRAPH_COLLAPSED_HEIGHT, collapsedSummary.height)
        : Math.max(SUBGRAPH_MIN_HEIGHT, maxY - minY),
      depth: getSubgraphDepth(subgraph, lookup),
      collapsed: subgraph.collapsed,
      headerHeight: SUBGRAPH_HEADER_HEIGHT,
      memberCount,
      summaryLabels,
    });
  }

  return frames;
}

function isSubgraphDescendantOf(
  candidateId: string,
  ancestorId: string,
  lookup: Map<string, GraphSubgraph>,
) {
  let current = lookup.get(candidateId)?.parentId ?? null;
  while (current) {
    if (current === ancestorId) {
      return true;
    }
    current = lookup.get(current)?.parentId ?? null;
  }

  return false;
}

function buildRoundedRectPath(rect: Rect, radius = 24) {
  const maxRadius = Math.min(rect.width, rect.height) / 2;
  const resolvedRadius = clamp(radius, 0, maxRadius);
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  return [
    `M ${rect.x + resolvedRadius} ${rect.y}`,
    `H ${right - resolvedRadius}`,
    `Q ${right} ${rect.y} ${right} ${rect.y + resolvedRadius}`,
    `V ${bottom - resolvedRadius}`,
    `Q ${right} ${bottom} ${right - resolvedRadius} ${bottom}`,
    `H ${rect.x + resolvedRadius}`,
    `Q ${rect.x} ${bottom} ${rect.x} ${bottom - resolvedRadius}`,
    `V ${rect.y + resolvedRadius}`,
    `Q ${rect.x} ${rect.y} ${rect.x + resolvedRadius} ${rect.y}`,
    'Z',
  ].join(' ');
}

function pointSortKey(point: Point) {
  return `${Math.round(point.x * 100) / 100}:${Math.round(point.y * 100) / 100}`;
}

function buildRectBounds(rects: Rect[]) {
  if (rects.length === 0) {
    return null;
  }

  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function distanceBetweenPoints(left: Point, right: Point) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function distanceToRoundedRectSurface(point: Point, rect: Rect, radius: number) {
  const resolvedRadius = clamp(radius, 0, Math.min(rect.width, rect.height) / 2);
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  const centerX = rect.x + halfWidth;
  const centerY = rect.y + halfHeight;
  const qx = Math.abs(point.x - centerX) - Math.max(halfWidth - resolvedRadius, 0);
  const qy = Math.abs(point.y - centerY) - Math.max(halfHeight - resolvedRadius, 0);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - resolvedRadius;
}

function primitiveBounds(primitive: BlobPrimitive): Rect {
  if (primitive.kind === 'rounded-rect') {
    return primitive.rect;
  }

  const minX = Math.min(primitive.start.x, primitive.end.x) - primitive.radius;
  const minY = Math.min(primitive.start.y, primitive.end.y) - primitive.radius;
  const maxX = Math.max(primitive.start.x, primitive.end.x) + primitive.radius;
  const maxY = Math.max(primitive.start.y, primitive.end.y) + primitive.radius;
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function buildBlobPrimitiveBounds(primitives: BlobPrimitive[]) {
  return buildRectBounds(primitives.map((primitive) => primitiveBounds(primitive)));
}

function primitiveCenter(primitive: BlobPrimitive) {
  const bounds = primitiveBounds(primitive);
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function primitiveSamplePoints(primitive: BlobPrimitive) {
  if (primitive.kind === 'rounded-rect') {
    const rect = primitive.rect;
    return [
      { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      { x: rect.x + rect.width * 0.18, y: rect.y + rect.height / 2 },
      { x: rect.x + rect.width * 0.82, y: rect.y + rect.height / 2 },
      { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.18 },
      { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.82 },
    ];
  }

  return [
    primitive.start,
    primitive.end,
    {
      x: (primitive.start.x + primitive.end.x) / 2,
      y: (primitive.start.y + primitive.end.y) / 2,
    },
  ];
}

function rectSamplePoints(rect: Rect) {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    { x: rect.x + rect.width / 2, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height / 2 },
    { x: rect.x + rect.width / 2, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height / 2 },
  ];
}

function subgraphShapeContainsPoint(shape: SubgraphBlobShape, point: Point) {
  if (!pointInRect(point, shape.bounds)) {
    return false;
  }

  return measureBlobField(point, shape.primitives) >= shape.fieldThreshold;
}

function intersectRects(left: Rect, right: Rect): Rect | null {
  const minX = Math.max(left.x, right.x);
  const minY = Math.max(left.y, right.y);
  const maxX = Math.min(left.x + left.width, right.x + right.width);
  const maxY = Math.min(left.y + left.height, right.y + right.height);

  if (maxX <= minX || maxY <= minY) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function sampleRectGrid(rect: Rect, step: number) {
  const resolvedStep = Math.max(step, 8);
  const columns = Math.max(2, Math.ceil(rect.width / resolvedStep) + 1);
  const rows = Math.max(2, Math.ceil(rect.height / resolvedStep) + 1);
  const samples: Point[] = [];

  for (let rowIndex = 0; rowIndex <= rows; rowIndex += 1) {
    const y = rect.y + (rect.height * rowIndex) / rows;
    for (let columnIndex = 0; columnIndex <= columns; columnIndex += 1) {
      const x = rect.x + (rect.width * columnIndex) / columns;
      samples.push({ x, y });
    }
  }

  return samples;
}

function subgraphShapeIntersectsRect(shape: SubgraphBlobShape, rect: Rect) {
  const overlap = intersectRects(shape.bounds, rect);
  if (!overlap) {
    return false;
  }

  const samples = [
    ...rectSamplePoints(overlap),
    ...sampleRectGrid(overlap, clamp(Math.min(overlap.width, overlap.height) / 3, 12, 26)),
    ...shape.primitives
      .flatMap((primitive) => primitiveSamplePoints(primitive))
      .filter((point) => pointInRect(point, overlap)),
  ];

  return samples.some((point) => measureBlobField(point, shape.primitives) >= shape.fieldThreshold);
}

function buildSubgraphBlobPrimitives(
  frame: SubgraphFrame,
  memberRects: Rect[],
  maxDepth: number,
): BlobPrimitive[] {
  const layerBoost = Math.max(maxDepth - frame.depth, 0);
  const nodePadding = clamp(58 + layerBoost * 18, 58, 132);

  return memberRects.map((rect) => ({
    kind: 'rounded-rect',
    rect: expandRect(rect, nodePadding),
    radius: 0,
    softness: 0,
    weight: 1,
  }));
}

function buildPixelBlobPrimitiveClusters(primitives: BlobPrimitive[]) {
  if (primitives.length <= 1) {
    return primitives.length === 0 ? [] : [primitives];
  }

  const bounds = primitives.map((primitive) => primitiveBounds(primitive));
  const visited = new Set<number>();
  const clusters: BlobPrimitive[][] = [];

  for (let index = 0; index < primitives.length; index += 1) {
    if (visited.has(index)) {
      continue;
    }

    const stack = [index];
    const clusterIndices: number[] = [];
    visited.add(index);

    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) {
        continue;
      }

      clusterIndices.push(current);
      for (let candidate = 0; candidate < primitives.length; candidate += 1) {
        if (visited.has(candidate) || candidate === current) {
          continue;
        }

        if (!rectsIntersect(bounds[current], bounds[candidate])) {
          continue;
        }

        visited.add(candidate);
        stack.push(candidate);
      }
    }

    clusters.push(clusterIndices.map((clusterIndex) => primitives[clusterIndex]));
  }

  return clusters;
}

function rectToPixelLoop(rect: Rect) {
  const snapped = {
    x: snapRouteValue(rect.x, 8),
    y: snapRouteValue(rect.y, 8),
    width: Math.max(32, snapRouteValue(rect.width, 8)),
    height: Math.max(32, snapRouteValue(rect.height, 8)),
  };

  return [
    { x: snapped.x, y: snapped.y },
    { x: snapped.x + snapped.width, y: snapped.y },
    { x: snapped.x + snapped.width, y: snapped.y + snapped.height },
    { x: snapped.x, y: snapped.y + snapped.height },
  ];
}

function buildBlobPrimitiveClusters(
  primitives: BlobPrimitive[],
  fieldThreshold: number,
) {
  if (primitives.length <= 1) {
    return primitives.length === 0 ? [] : [primitives];
  }

  const bounds = primitives.map((primitive) => primitiveBounds(primitive));
  const centers = primitives.map((primitive) => primitiveCenter(primitive));
  const influenceBounds = primitives.map((primitive, index) => expandRect(
    bounds[index],
    Math.max(20, primitive.softness * (1 - fieldThreshold * 0.42)),
  ));
  const visited = new Set<number>();
  const clusters: BlobPrimitive[][] = [];

  const shouldConnect = (leftIndex: number, rightIndex: number) => {
    if (rectsIntersect(bounds[leftIndex], bounds[rightIndex])) {
      return true;
    }

    if (!rectsIntersect(influenceBounds[leftIndex], influenceBounds[rightIndex])) {
      return false;
    }

    const midpoint = {
      x: (centers[leftIndex].x + centers[rightIndex].x) / 2,
      y: (centers[leftIndex].y + centers[rightIndex].y) / 2,
    };
    return measureBlobField(
      midpoint,
      [primitives[leftIndex], primitives[rightIndex]],
    ) >= fieldThreshold * 0.94;
  };

  for (let index = 0; index < primitives.length; index += 1) {
    if (visited.has(index)) {
      continue;
    }

    const stack = [index];
    const clusterIndices: number[] = [];
    visited.add(index);

    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) {
        continue;
      }

      clusterIndices.push(current);
      for (let candidate = 0; candidate < primitives.length; candidate += 1) {
        if (visited.has(candidate) || candidate === current) {
          continue;
        }

        if (!shouldConnect(current, candidate)) {
          continue;
        }

        visited.add(candidate);
        stack.push(candidate);
      }
    }

    clusters.push(clusterIndices.map((clusterIndex) => primitives[clusterIndex]));
  }

  return clusters;
}

function buildBlobContourLoopsForPrimitives(
  primitives: BlobPrimitive[],
  fieldThreshold: number,
  detail: BlobContourDetail,
) {
  const primitiveBounds = buildBlobPrimitiveBounds(primitives);
  const maxSoftness = Math.max(0, ...primitives.map((primitive) => primitive.softness));
  const fieldBounds = primitiveBounds
    ? expandRect(
      primitiveBounds,
      detail === 'interactive'
        ? Math.max(20, maxSoftness * 0.38)
        : Math.max(30, maxSoftness * 0.54),
    )
    : null;
  if (!fieldBounds) {
    return [] as Point[][];
  }

  const maxDimension = Math.max(fieldBounds.width, fieldBounds.height);
  const cellSize = detail === 'interactive'
    ? clamp(maxDimension / 16, 18, 30)
    : clamp(maxDimension / 30, 10, 16);
  const threshold = fieldThreshold;
  const cols = Math.max(4, Math.ceil(fieldBounds.width / cellSize) + 3);
  const rows = Math.max(4, Math.ceil(fieldBounds.height / cellSize) + 3);
  const origin = {
    x: fieldBounds.x - cellSize * 1.5,
    y: fieldBounds.y - cellSize * 1.5,
  };
  const values: number[][] = Array.from({ length: rows + 1 }, (_, rowIndex) =>
    Array.from({ length: cols + 1 }, (_, columnIndex) =>
      measureBlobField(
        {
          x: origin.x + columnIndex * cellSize,
          y: origin.y + rowIndex * cellSize,
        },
        primitives,
      )),
  );
  const segments: ContourSegment[] = [];

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < cols; columnIndex += 1) {
      const topLeftValue = values[rowIndex][columnIndex];
      const topRightValue = values[rowIndex][columnIndex + 1];
      const bottomRightValue = values[rowIndex + 1][columnIndex + 1];
      const bottomLeftValue = values[rowIndex + 1][columnIndex];
      const state =
        (topLeftValue >= threshold ? 8 : 0) |
        (topRightValue >= threshold ? 4 : 0) |
        (bottomRightValue >= threshold ? 2 : 0) |
        (bottomLeftValue >= threshold ? 1 : 0);

      if (state === 0 || state === 15) {
        continue;
      }

      const topLeft = {
        x: origin.x + columnIndex * cellSize,
        y: origin.y + rowIndex * cellSize,
      };
      const topRight = {
        x: topLeft.x + cellSize,
        y: topLeft.y,
      };
      const bottomLeft = {
        x: topLeft.x,
        y: topLeft.y + cellSize,
      };
      const bottomRight = {
        x: topLeft.x + cellSize,
        y: topLeft.y + cellSize,
      };
      const top = interpolateContourPoint(topLeft, topRight, topLeftValue, topRightValue, threshold);
      const right = interpolateContourPoint(topRight, bottomRight, topRightValue, bottomRightValue, threshold);
      const bottom = interpolateContourPoint(bottomLeft, bottomRight, bottomLeftValue, bottomRightValue, threshold);
      const left = interpolateContourPoint(topLeft, bottomLeft, topLeftValue, bottomLeftValue, threshold);
      const centerValue = state === 5 || state === 10
        ? measureBlobField(
          {
            x: topLeft.x + cellSize / 2,
            y: topLeft.y + cellSize / 2,
          },
          primitives,
        )
        : 0;
      const addSegment = (start: Point, end: Point) => {
        segments.push({ start, end });
      };

      switch (state) {
        case 1:
          addSegment(left, bottom);
          break;
        case 2:
          addSegment(bottom, right);
          break;
        case 3:
          addSegment(left, right);
          break;
        case 4:
          addSegment(top, right);
          break;
        case 5:
          if (centerValue >= threshold) {
            addSegment(top, left);
            addSegment(right, bottom);
          } else {
            addSegment(top, right);
            addSegment(left, bottom);
          }
          break;
        case 6:
          addSegment(top, bottom);
          break;
        case 7:
          addSegment(top, left);
          break;
        case 8:
          addSegment(top, left);
          break;
        case 9:
          addSegment(top, bottom);
          break;
        case 10:
          if (centerValue >= threshold) {
            addSegment(top, right);
            addSegment(left, bottom);
          } else {
            addSegment(top, left);
            addSegment(right, bottom);
          }
          break;
        case 11:
          addSegment(top, right);
          break;
        case 12:
          addSegment(left, right);
          break;
        case 13:
          addSegment(bottom, right);
          break;
        case 14:
          addSegment(left, bottom);
          break;
        default:
          break;
      }
    }
  }

  return buildContourLoops(segments)
    .map((loop) => simplifyClosedPolygon(loop))
    .filter((loop) => Math.abs(polygonArea(loop)) >= (detail === 'interactive' ? 220 : 140))
    .sort((left, right) => Math.abs(polygonArea(right)) - Math.abs(polygonArea(left)));
}

function measureBlobField(point: Point, primitives: BlobPrimitive[]) {
  return primitives.reduce((field, primitive) => {
    const signedDistance = primitive.kind === 'rounded-rect'
      ? distanceToRoundedRectSurface(point, primitive.rect, primitive.radius)
      : distancePointToSegment(point, primitive.start, primitive.end) - primitive.radius;
    const softness = Math.max(primitive.softness, 1);

    if (signedDistance <= 0) {
      return field + primitive.weight * (
        1 + clamp(-signedDistance / softness, 0, 0.28)
      );
    }

    const normalized = 1 - signedDistance / softness;
    if (normalized <= 0) {
      return field;
    }

    return field + primitive.weight * normalized * normalized;
  }, 0);
}

function smoothClosedPolygon(points: Point[], passes = 2) {
  let current = [...points];
  for (let index = 0; index < passes; index += 1) {
    if (current.length < 3) {
      break;
    }

    const next: Point[] = [];
    current.forEach((point, pointIndex) => {
      const target = current[(pointIndex + 1) % current.length];
      next.push(
        {
          x: point.x * 0.75 + target.x * 0.25,
          y: point.y * 0.75 + target.y * 0.25,
        },
        {
          x: point.x * 0.25 + target.x * 0.75,
          y: point.y * 0.25 + target.y * 0.75,
        },
      );
    });
    current = next;
  }

  return current;
}

function buildSmoothClosedPath(points: Point[]) {
  if (points.length === 0) {
    return '';
  }

  if (points.length < 3) {
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxY = Math.max(...points.map((point) => point.y));
    return buildRoundedRectPath({
      x: minX,
      y: minY,
      width: Math.max(32, maxX - minX),
      height: Math.max(32, maxY - minY),
    }, 0);
  }

  const commands = points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${snapRouteValue(point.x, 8)} ${snapRouteValue(point.y, 8)}`
  );
  commands.push('Z');
  return commands.join(' ');
}

function interpolateContourPoint(
  start: Point,
  end: Point,
  startValue: number,
  endValue: number,
  threshold: number,
) {
  const denominator = endValue - startValue;
  if (Math.abs(denominator) < 0.0001) {
    return {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
  }

  const t = clamp((threshold - startValue) / denominator, 0, 1);
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

function edgeKey(startKey: string, endKey: string) {
  return startKey < endKey ? `${startKey}::${endKey}` : `${endKey}::${startKey}`;
}

function polygonArea(points: Point[]) {
  if (points.length < 3) {
    return 0;
  }

  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }

  return area / 2;
}

function simplifyClosedPolygon(points: Point[]) {
  if (points.length <= 3) {
    return points;
  }

  return points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    if (
      distanceBetweenPoints(previous, point) < 0.8 ||
      distanceBetweenPoints(point, next) < 0.8
    ) {
      return false;
    }

    const cross =
      (point.x - previous.x) * (next.y - point.y) -
      (point.y - previous.y) * (next.x - point.x);
    return Math.abs(cross) > 0.6;
  });
}

function buildContourLoops(segments: ContourSegment[]) {
  const pointLookup = new Map<string, Point>();
  const adjacency = new Map<string, string[]>();
  const unusedEdges = new Set<string>();

  segments.forEach((segment) => {
    const startKey = pointSortKey(segment.start);
    const endKey = pointSortKey(segment.end);
    if (startKey === endKey) {
      return;
    }

    pointLookup.set(startKey, segment.start);
    pointLookup.set(endKey, segment.end);
    adjacency.set(startKey, [...(adjacency.get(startKey) ?? []), endKey]);
    adjacency.set(endKey, [...(adjacency.get(endKey) ?? []), startKey]);
    unusedEdges.add(edgeKey(startKey, endKey));
  });

  const loops: Point[][] = [];
  while (unusedEdges.size > 0) {
    const firstEdge = unusedEdges.values().next().value as string | undefined;
    if (!firstEdge) {
      break;
    }

    const [startKey, nextKey] = firstEdge.split('::');
    let previousKey: string | null = null;
    let currentKey = startKey;
    let candidateKey = nextKey;
    const loop: Point[] = [];

    while (candidateKey) {
      loop.push(pointLookup.get(currentKey) ?? { x: 0, y: 0 });
      unusedEdges.delete(edgeKey(currentKey, candidateKey));

      previousKey = currentKey;
      currentKey = candidateKey;
      if (currentKey === startKey) {
        break;
      }

      const neighbors = adjacency.get(currentKey) ?? [];
      const nextCandidate = neighbors.find((neighbor) =>
        neighbor !== previousKey && unusedEdges.has(edgeKey(currentKey, neighbor)),
      ) ?? neighbors.find((neighbor) => unusedEdges.has(edgeKey(currentKey, neighbor)));

      if (!nextCandidate) {
        break;
      }

      candidateKey = nextCandidate;
    }

    if (loop.length >= 3) {
      loops.push(loop);
    }
  }

  return loops;
}

function buildSubgraphBlobContours(
  frame: SubgraphFrame,
  memberRects: Rect[],
  maxDepth: number,
  _detail: BlobContourDetail = 'full',
) {
  const fieldThreshold = 0.5;
  const primitives = buildSubgraphBlobPrimitives(frame, memberRects, maxDepth);
  const loops = buildPixelBlobPrimitiveClusters(primitives)
    .flatMap((cluster) => {
      const bounds = buildBlobPrimitiveBounds(cluster);
      return bounds ? [rectToPixelLoop(bounds)] : [];
    });
  return {
    loops,
    primitives,
    fieldThreshold,
  };
}

function buildSubgraphBlobShapes(
  subgraphs: GraphSubgraph[],
  frames: SubgraphFrame[],
  visibleNodes: GraphNode[],
  detail: BlobContourDetail = 'full',
): SubgraphBlobShape[] {
  const lookup = getVisibleSubgraphIds(subgraphs);
  const maxDepth = frames.reduce((current, frame) => Math.max(current, frame.depth), 0);

  return frames.map((frame) => {
    const memberRects: Rect[] = visibleNodes
      .filter((node) => belongsToSubgraph(node, frame.id, lookup))
      .map((node) => ({
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      }));

    frames.forEach((candidate) => {
      if (
        candidate.id === frame.id ||
        !candidate.collapsed ||
        !isSubgraphDescendantOf(candidate.id, frame.id, lookup)
      ) {
        return;
      }

      memberRects.push({
        x: candidate.x + 12,
        y: candidate.y + 12,
        width: Math.max(candidate.width - 24, 32),
        height: Math.max(candidate.height - 24, 32),
      });
    });

    if (frame.collapsed) {
      const bounds = {
        x: frame.x + 6,
        y: frame.y + 6,
        width: Math.max(frame.width - 12, 24),
        height: Math.max(frame.height - 12, 24),
      };
      return {
        id: frame.id,
        bounds,
        defaultBadgeAnchor: {
          x: bounds.x + 18,
          y: bounds.y + 18,
        },
        fieldThreshold: 0.5,
        depth: frame.depth,
        collapsed: true,
        primitives: [{
          kind: 'rounded-rect',
          rect: bounds,
          radius: 0,
          softness: 0,
          weight: 1,
        }],
      regions: [{
        bounds,
        path: buildRoundedRectPath(bounds, 0),
      }],
      };
    }

    const { loops, primitives, fieldThreshold } = buildSubgraphBlobContours(frame, memberRects, maxDepth, detail);
    const fallbackBounds = buildBlobPrimitiveBounds(primitives) ?? (
      buildRectBounds(memberRects) ?? {
        x: frame.x + 18,
        y: frame.y + SUBGRAPH_HEADER_HEIGHT + 12,
        width: Math.max(frame.width - 36, 84),
        height: Math.max(frame.height - SUBGRAPH_HEADER_HEIGHT - 24, 72),
      }
    );
    const regions = loops.length > 0
      ? loops.map((loop) => {
          const bounds = buildRectBounds(loop.map((point) => ({
            x: point.x,
            y: point.y,
            width: 0,
            height: 0,
          }))) ?? fallbackBounds;
          return {
            bounds,
            path: buildSmoothClosedPath(loop),
          };
        })
      : [{
          bounds: fallbackBounds,
          path: buildRoundedRectPath(fallbackBounds, 0),
        }];
    const bounds = buildRectBounds(regions.map((region) => region.bounds)) ?? fallbackBounds;
    const largestRegion = regions[0] ?? {
      bounds,
      path: buildRoundedRectPath(bounds, 0),
    };

    return {
      id: frame.id,
      bounds,
      defaultBadgeAnchor: {
        x: largestRegion.bounds.x + Math.min(48, largestRegion.bounds.width * 0.18),
        y: largestRegion.bounds.y + 14,
      },
      fieldThreshold,
      depth: frame.depth,
      collapsed: frame.collapsed,
      primitives,
      regions,
    };
  });
}

function resolveSubgraphBadgePoint(
  shape: SubgraphBlobShape,
  storedAnchor: SubgraphBadgeAnchor | null | undefined,
) {
  const basePoint = storedAnchor
    ? {
        x: shape.bounds.x + storedAnchor.offsetX,
        y: shape.bounds.y + storedAnchor.offsetY,
      }
    : shape.defaultBadgeAnchor;

  return {
    x: clamp(basePoint.x, shape.bounds.x + 16, shape.bounds.x + shape.bounds.width - 16),
    y: clamp(basePoint.y, shape.bounds.y + 16, shape.bounds.y + shape.bounds.height - 16),
  };
}

function applyDragPreview(nodes: GraphNode[], dragState: DragState | null) {
  if (!dragState) {
    return nodes;
  }

  const deltaX = dragState.current.x - dragState.origin.x;
  const deltaY = dragState.current.y - dragState.origin.y;

  return nodes.map((node) => {
    const initial = dragState.initialPositions[node.id];
    if (!initial) {
      return node;
    }

    return {
      ...node,
      x: Math.round(initial.x + deltaX),
      y: Math.round(initial.y + deltaY),
    };
  });
}

function findSubgraphDropTarget(
  shapes: SubgraphBlobShape[],
  point: Point,
  excludedIds: string[] = [],
) {
  const excluded = new Set(excludedIds);

  return [...shapes]
    .filter((shape) => !excluded.has(shape.id))
    .filter((shape) => subgraphShapeContainsPoint(shape, point))
    .sort((left, right) => {
      if (left.depth !== right.depth) {
        return right.depth - left.depth;
      }

      return left.bounds.width * left.bounds.height - right.bounds.width * right.bounds.height;
    })[0]?.id ?? null;
}

function findNodeDropTarget(
  nodes: GraphNode[],
  point: Point,
  excludedIds: string[] = [],
) {
  const excluded = new Set(excludedIds);

  return [...nodes]
    .filter((node) => !excluded.has(node.id))
    .filter((node) => pointInRect(point, node, 8))
    .sort((left, right) => left.width * left.height - right.width * right.height)[0]?.id ?? null;
}

function distancePointToSegment(point: Point, start: Point, end: Point) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const ratio = clamp(
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared,
    0,
    1,
  );
  const projection = {
    x: start.x + deltaX * ratio,
    y: start.y + deltaY * ratio,
  };

  return Math.hypot(point.x - projection.x, point.y - projection.y);
}

function distancePointToEdgeGeometry(
  point: Point,
  geometry: ReturnType<typeof buildEdgeGeometry>,
) {
  const samples = geometry.points.length >= 2
    ? geometry.points
    : sampleCubic(
      geometry.start,
      geometry.controlA,
      geometry.controlB,
      geometry.end,
      20,
    );

  let minDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < samples.length; index += 1) {
    minDistance = Math.min(
      minDistance,
      distancePointToSegment(point, samples[index - 1], samples[index]),
    );
  }

  return minDistance;
}

function findEdgeDropTarget(
  point: Point,
  edges: GraphEdge[],
  endpointMap: Map<string, EdgeEndpointBox>,
  laneMap: Map<string, number>,
  endpointOffsets: Map<string, { from: number; to: number }>,
  excludedEndpointIds: string[] = [],
) {
  const excluded = new Set(excludedEndpointIds);
  let bestMatch: { edgeId: string; distance: number } | null = null;

  for (const edge of edges) {
    if (excluded.has(edge.from) || excluded.has(edge.to)) {
      continue;
    }

    const fromEndpoint = endpointMap.get(edge.from);
    const toEndpoint = endpointMap.get(edge.to);
    if (!fromEndpoint || !toEndpoint) {
      continue;
    }

    const geometry = buildEdgeGeometry(
      fromEndpoint,
      toEndpoint,
      laneMap.get(edge.id) ?? 0,
      endpointOffsets.get(edge.id),
    );
    const distance = distancePointToEdgeGeometry(point, geometry);
    if (distance > 18) {
      continue;
    }

    if (!bestMatch || distance < bestMatch.distance) {
      bestMatch = { edgeId: edge.id, distance };
    }
  }

  return bestMatch?.edgeId ?? null;
}

function findNodeDropTargetFromEntries(
  entries: SceneIndexEntry<GraphNode>[],
  point: Point,
  excludedIds: string[] = [],
) {
  const excluded = new Set(excludedIds);

  return entries
    .filter((entry) => !excluded.has(entry.item.id))
    .sort((left, right) => left.item.width * left.item.height - right.item.width * right.item.height)[0]?.item.id ?? null;
}

function findSubgraphDropTargetFromEntries(
  entries: SceneIndexEntry<SubgraphBlobShape>[],
  point: Point,
  excludedIds: string[] = [],
) {
  const excluded = new Set(excludedIds);

  return entries
    .map((entry) => entry.item)
    .filter((shape) => !excluded.has(shape.id))
    .filter((shape) => subgraphShapeContainsPoint(shape, point))
    .sort((left, right) => {
      if (left.depth !== right.depth) {
        return right.depth - left.depth;
      }

      return left.bounds.width * left.bounds.height - right.bounds.width * right.bounds.height;
    })[0]?.id ?? null;
}

function findEdgeDropTargetFromEntries(
  point: Point,
  entries: SceneIndexEntry<SceneRenderableEdge>[],
  excludedEndpointIds: string[] = [],
) {
  const excluded = new Set(excludedEndpointIds);
  let bestMatch: { edgeId: string; distance: number } | null = null;

  for (const entry of entries) {
    const { edge, geometry } = entry.item;
    if (excluded.has(edge.from) || excluded.has(edge.to)) {
      continue;
    }

    const distance = distancePointToEdgeGeometry(point, geometry);
    if (distance > 18) {
      continue;
    }

    if (!bestMatch || distance < bestMatch.distance) {
      bestMatch = { edgeId: edge.id, distance };
    }
  }

  return bestMatch?.edgeId ?? null;
}

function offsetMovedNodes(
  nodes: GraphNode[],
  movedIds: string[],
  offsetX: number,
  offsetY: number,
) {
  const movedSet = new Set(movedIds);
  return nodes.map((node) =>
    movedSet.has(node.id)
      ? {
          ...node,
          x: Math.round(node.x + offsetX),
          y: Math.round(node.y + offsetY),
        }
      : node,
  );
}

function centerMovedNodesOnPoint(
  nodes: GraphNode[],
  movedIds: string[],
  point: Point,
) {
  const movedSet = new Set(movedIds);
  const movedNodes = nodes.filter((node) => movedSet.has(node.id));
  const bounds = buildSelectionBounds(movedNodes);
  if (!bounds) {
    return nodes;
  }

  const offsetX = point.x - (bounds.x + bounds.width / 2);
  const offsetY = point.y - (bounds.y + bounds.height / 2);
  return offsetMovedNodes(nodes, movedIds, offsetX, offsetY);
}

function createSubgraphFromNode(node: GraphNode): GraphSubgraph {
  return {
    id: node.id,
    title: node.label,
    parentId: node.subgraphId,
    collapsed: false,
    fill: node.fill,
    stroke: node.stroke,
    textColor: node.textColor,
  };
}

function createNodeFromSubgraph(
  subgraph: GraphSubgraph,
  frame: Pick<SubgraphFrame, 'x' | 'y' | 'width' | 'height'>,
): GraphNode {
  const parts = splitEntityText(subgraph.title);
  const size = measureNodeContentSize(parts.title, parts.description);
  return {
    id: subgraph.id,
    label: subgraph.title,
    shape: 'rect',
    x: Math.round(frame.x + (frame.width - size.width) / 2),
    y: Math.round(frame.y + (frame.height - size.height) / 2),
    width: size.width,
    height: size.height,
    fill: subgraph.fill,
    stroke: subgraph.stroke,
    textColor: subgraph.textColor,
    subgraphId: subgraph.parentId,
  };
}

function maybeConvertSourceSubgraphsToNodes(
  previousDocument: GraphDocument,
  nextDocument: GraphDocument,
  movedNodeIds: string[],
) {
  const candidateIds = [...new Set(
    previousDocument.nodes
      .filter((node) => movedNodeIds.includes(node.id))
      .map((node) => node.subgraphId)
      .filter((value): value is string => Boolean(value)),
  )];

  if (candidateIds.length === 0) {
    return nextDocument;
  }

  const previousLookup = getVisibleSubgraphIds(previousDocument.subgraphs);
  const previousFrameMap = new Map(
    buildSubgraphFrames(previousDocument, previousDocument.nodes).map((frame) => [frame.id, frame]),
  );
  let workingDocument = nextDocument;

  candidateIds.forEach((subgraphId) => {
    const previousSubgraph = previousDocument.subgraphs.find((entry) => entry.id === subgraphId);
    if (!previousSubgraph) {
      return;
    }

    if (previousDocument.subgraphs.some((entry) => entry.parentId === subgraphId)) {
      return;
    }

    if (countNodesInSubgraph(previousDocument.nodes, subgraphId, previousLookup) !== 1) {
      return;
    }

    const workingLookup = getVisibleSubgraphIds(workingDocument.subgraphs);
    if (
      !workingDocument.subgraphs.some((entry) => entry.id === subgraphId) ||
      countNodesInSubgraph(workingDocument.nodes, subgraphId, workingLookup) !== 0
    ) {
      return;
    }

    const frame = previousFrameMap.get(subgraphId);
    if (!frame) {
      return;
    }

    workingDocument = {
      ...workingDocument,
      subgraphs: workingDocument.subgraphs.filter((entry) => entry.id !== subgraphId),
      nodes: [
        ...workingDocument.nodes,
        createNodeFromSubgraph(previousSubgraph, frame),
      ],
    };
  });

  return workingDocument;
}

function insertDraggedEndpointIntoEdge(
  document: GraphDocument,
  edgeId: string,
  insertedId: string,
) {
  const targetEdge = document.edges.find((edge) => edge.id === edgeId);
  if (!targetEdge || targetEdge.from === insertedId || targetEdge.to === insertedId) {
    return document;
  }

  const nextEdges = document.edges.flatMap((edge) => {
    if (edge.id !== edgeId) {
      return [edge];
    }

    return [
      {
        ...edge,
        to: insertedId,
      },
      {
        ...edge,
        id: crypto.randomUUID(),
        from: insertedId,
        to: edge.to,
        label: '',
      },
    ];
  });

  return {
    ...document,
    edges: nextEdges,
  };
}

function buildCollisionObstacles(
  document: GraphDocument,
  nodes: GraphNode[],
  ignoredNodeIds: Set<string>,
  excludedSubgraphIds: Set<string>,
  contentRect?: Rect | null,
) {
  const subgraphLookup = getVisibleSubgraphIds(document.subgraphs);
  const nodeRects = nodes
    .filter((node) => !ignoredNodeIds.has(node.id))
    .map((node) => expandRect({ x: node.x, y: node.y, width: node.width, height: node.height }, 20));
  const visibleNodes = nodes.filter((node) => !isInsideCollapsedSubgraph(node, subgraphLookup));
  const subgraphRects = buildSubgraphBlobShapes(
    document.subgraphs,
    buildSubgraphFrames(document, nodes),
    visibleNodes,
  )
    .filter((shape) => !excludedSubgraphIds.has(shape.id))
    .flatMap((shape) => (
      shape.collapsed
        ? [expandRect(shape.bounds, 10)]
        : shape.regions.map((region) => expandRect(region.bounds, 8))
    ));
  const contentRects = contentRect ? [expandRect(contentRect, 18)] : [];

  return [...nodeRects, ...subgraphRects, ...contentRects];
}

function searchFreeRect(
  desired: Rect,
  obstacles: Rect[],
  directionHint: Point,
  bounds?: Rect | null,
) {
  const direction = normalizeVector(directionHint);
  const perpendicular = { x: -direction.y, y: direction.x };

  const fits = (rect: Rect) => {
    if (bounds) {
      const withinBounds =
        rect.x >= bounds.x &&
        rect.y >= bounds.y &&
        rect.x + rect.width <= bounds.x + bounds.width &&
        rect.y + rect.height <= bounds.y + bounds.height;

      if (!withinBounds) {
        return false;
      }
    }

    return obstacles.every((obstacle) => !rectsIntersect(rect, obstacle));
  };

  if (fits(desired)) {
    return desired;
  }

  for (let step = 1; step <= 64; step += 1) {
    const travel = step * 18;
    const fan = Math.ceil(step / 2) * 12;
    const candidates = [
      { x: desired.x + direction.x * travel, y: desired.y + direction.y * travel },
      { x: desired.x + direction.x * travel + perpendicular.x * fan, y: desired.y + direction.y * travel + perpendicular.y * fan },
      { x: desired.x + direction.x * travel - perpendicular.x * fan, y: desired.y + direction.y * travel - perpendicular.y * fan },
      { x: desired.x + perpendicular.x * travel, y: desired.y + perpendicular.y * travel },
      { x: desired.x - perpendicular.x * travel, y: desired.y - perpendicular.y * travel },
    ];

    for (const candidate of candidates) {
      const rect = { ...desired, x: Math.round(candidate.x), y: Math.round(candidate.y) };
      if (fits(rect)) {
        return rect;
      }
    }
  }

  return desired;
}

function isPrimaryVertical(direction: Direction) {
  return direction === 'TD' || direction === 'BT';
}

function isPrimaryReversed(direction: Direction) {
  return direction === 'RL' || direction === 'BT';
}

function getNodePrimaryStart(node: GraphNode, direction: Direction) {
  return isPrimaryVertical(direction) ? node.y : node.x;
}

function getNodeMinorStart(node: GraphNode, direction: Direction) {
  return isPrimaryVertical(direction) ? node.x : node.y;
}

function getNodePrimarySize(node: GraphNode, direction: Direction) {
  return isPrimaryVertical(direction) ? node.height : node.width;
}

function getNodeMinorSize(node: GraphNode, direction: Direction) {
  return isPrimaryVertical(direction) ? node.width : node.height;
}

function withNodeAxisPosition(node: GraphNode, direction: Direction, primary: number, minor: number) {
  return isPrimaryVertical(direction)
    ? { ...node, x: Math.round(minor), y: Math.round(primary) }
    : { ...node, x: Math.round(primary), y: Math.round(minor) };
}

function buildSubgraphPathKey(
  subgraphId: string | null,
  lookup: Map<string, GraphSubgraph>,
) {
  const path: string[] = [];
  let current = subgraphId;

  while (current) {
    const subgraph = lookup.get(current);
    if (!subgraph) {
      break;
    }
    path.unshift(subgraph.title || subgraph.id);
    current = subgraph.parentId;
  }

  return path.join(' / ');
}

function buildNodeDegreeMap(document: GraphDocument) {
  const degrees = new Map(document.nodes.map((node) => [node.id, 0]));
  const nodeIdSet = new Set(document.nodes.map((node) => node.id));

  document.edges.forEach((edge) => {
    if (nodeIdSet.has(edge.from)) {
      degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1);
    }
    if (nodeIdSet.has(edge.to)) {
      degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1);
    }
  });

  return degrees;
}

function buildSemanticLayoutEdges(document: GraphDocument) {
  const nodeIdSet = new Set(document.nodes.map((node) => node.id));
  const subgraphLookup = getVisibleSubgraphIds(document.subgraphs);
  const degreeMap = buildNodeDegreeMap(document);
  const representativeCache = new Map<string, string | null>();
  const direction = document.direction;

  const resolveEndpointNode = (endpointId: string) => {
    if (nodeIdSet.has(endpointId)) {
      return endpointId;
    }

    if (representativeCache.has(endpointId)) {
      return representativeCache.get(endpointId) ?? null;
    }

    const candidates = document.nodes
      .filter((node) => belongsToSubgraph(node, endpointId, subgraphLookup))
      .sort((left, right) => {
        const degreeDelta = (degreeMap.get(right.id) ?? 0) - (degreeMap.get(left.id) ?? 0);
        if (degreeDelta !== 0) {
          return degreeDelta;
        }

        const primaryDelta = getNodePrimaryStart(left, direction) - getNodePrimaryStart(right, direction);
        if (primaryDelta !== 0) {
          return primaryDelta;
        }

        const minorDelta = getNodeMinorStart(left, direction) - getNodeMinorStart(right, direction);
        if (minorDelta !== 0) {
          return minorDelta;
        }

        return left.id.localeCompare(right.id);
      });

    const representative = candidates[0]?.id ?? null;
    representativeCache.set(endpointId, representative);
    return representative;
  };

  const deduped = new Map<string, { from: string; to: string }>();

  document.edges.forEach((edge) => {
    const from = resolveEndpointNode(edge.from);
    const to = resolveEndpointNode(edge.to);
    if (!from || !to || from === to) {
      return;
    }

    deduped.set(`${from}->${to}`, { from, to });
  });

  return [...deduped.values()];
}

function computeStronglyConnectedComponents(nodeIds: string[], edges: Array<{ from: string; to: string }>) {
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
  edges.forEach((edge) => {
    adjacency.get(edge.from)?.push(edge.to);
  });

  const indexMap = new Map<string, number>();
  const lowLinkMap = new Map<string, number>();
  const stack: string[] = [];
  const stackMembers = new Set<string>();
  const components: string[][] = [];
  let index = 0;

  const visit = (nodeId: string) => {
    indexMap.set(nodeId, index);
    lowLinkMap.set(nodeId, index);
    index += 1;
    stack.push(nodeId);
    stackMembers.add(nodeId);

    (adjacency.get(nodeId) ?? []).forEach((nextId) => {
      if (!indexMap.has(nextId)) {
        visit(nextId);
        lowLinkMap.set(
          nodeId,
          Math.min(lowLinkMap.get(nodeId) ?? Number.POSITIVE_INFINITY, lowLinkMap.get(nextId) ?? Number.POSITIVE_INFINITY),
        );
        return;
      }

      if (stackMembers.has(nextId)) {
        lowLinkMap.set(
          nodeId,
          Math.min(lowLinkMap.get(nodeId) ?? Number.POSITIVE_INFINITY, indexMap.get(nextId) ?? Number.POSITIVE_INFINITY),
        );
      }
    });

    if (lowLinkMap.get(nodeId) !== indexMap.get(nodeId)) {
      return;
    }

    const component: string[] = [];
    let current: string | undefined;
    do {
      current = stack.pop();
      if (!current) {
        break;
      }
      stackMembers.delete(current);
      component.push(current);
    } while (current !== nodeId);

    components.push(component);
  };

  nodeIds.forEach((nodeId) => {
    if (!indexMap.has(nodeId)) {
      visit(nodeId);
    }
  });

  const componentOf = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    component.forEach((nodeId) => componentOf.set(nodeId, componentIndex));
  });

  return { components, componentOf };
}

function buildTopologicalRankMap(document: GraphDocument, semanticEdges: Array<{ from: string; to: string }>) {
  const sortedNodes = [...document.nodes].sort((left, right) => {
    const primaryDelta = getNodePrimaryStart(left, document.direction) - getNodePrimaryStart(right, document.direction);
    if (primaryDelta !== 0) {
      return primaryDelta;
    }
    return getNodeMinorStart(left, document.direction) - getNodeMinorStart(right, document.direction);
  });
  const nodeIds = sortedNodes.map((node) => node.id);
  const { components, componentOf } = computeStronglyConnectedComponents(nodeIds, semanticEdges);
  const componentPrimaryAnchor = new Map<number, number>();

  components.forEach((component, componentIndex) => {
    const anchor = Math.min(
      ...component.map((nodeId) =>
        getNodePrimaryStart(document.nodes.find((node) => node.id === nodeId) ?? document.nodes[0], document.direction),
      ),
    );
    componentPrimaryAnchor.set(componentIndex, anchor);
  });

  const outgoing = new Map<number, Set<number>>();
  const incomingCount = new Map<number, number>();
  components.forEach((_, index) => {
    outgoing.set(index, new Set());
    incomingCount.set(index, 0);
  });

  semanticEdges.forEach((edge) => {
    const fromComponent = componentOf.get(edge.from);
    const toComponent = componentOf.get(edge.to);
    if (
      fromComponent === undefined ||
      toComponent === undefined ||
      fromComponent === toComponent ||
      outgoing.get(fromComponent)?.has(toComponent)
    ) {
      return;
    }

    outgoing.get(fromComponent)?.add(toComponent);
    incomingCount.set(toComponent, (incomingCount.get(toComponent) ?? 0) + 1);
  });

  const componentRank = new Map<number, number>();
  const ready = [...components.keys()]
    .filter((componentIndex) => (incomingCount.get(componentIndex) ?? 0) === 0)
    .sort((left, right) => (componentPrimaryAnchor.get(left) ?? 0) - (componentPrimaryAnchor.get(right) ?? 0));

  while (ready.length > 0) {
    const componentIndex = ready.shift();
    if (componentIndex === undefined) {
      break;
    }

    const nextRank = componentRank.get(componentIndex) ?? 0;
    (outgoing.get(componentIndex) ?? new Set()).forEach((nextComponent) => {
      componentRank.set(nextComponent, Math.max(componentRank.get(nextComponent) ?? 0, nextRank + 1));
      incomingCount.set(nextComponent, (incomingCount.get(nextComponent) ?? 1) - 1);
      if ((incomingCount.get(nextComponent) ?? 0) === 0) {
        ready.push(nextComponent);
        ready.sort((left, right) => (componentPrimaryAnchor.get(left) ?? 0) - (componentPrimaryAnchor.get(right) ?? 0));
      }
    });
  }

  const rankMap = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    component.forEach((nodeId) => {
      rankMap.set(nodeId, componentRank.get(componentIndex) ?? 0);
    });
  });

  const incidentNodeIds = new Set<string>();
  semanticEdges.forEach((edge) => {
    incidentNodeIds.add(edge.from);
    incidentNodeIds.add(edge.to);
  });
  const isolatedNodes = document.nodes
    .filter((node) => !incidentNodeIds.has(node.id))
    .sort((left, right) => getNodePrimaryStart(left, document.direction) - getNodePrimaryStart(right, document.direction));
  let isolatedRank = Math.max(0, ...rankMap.values()) + 1;
  isolatedNodes.forEach((node) => {
    rankMap.set(node.id, isolatedRank);
    isolatedRank += 1;
  });

  return rankMap;
}

function layoutDisconnectedNodes(document: GraphDocument) {
  const sortedNodes = [...document.nodes].sort((left, right) => {
    const primaryDelta = getNodePrimaryStart(left, document.direction) - getNodePrimaryStart(right, document.direction);
    if (primaryDelta !== 0) {
      return primaryDelta;
    }
    return getNodeMinorStart(left, document.direction) - getNodeMinorStart(right, document.direction);
  });
  const laneCount = Math.max(1, Math.ceil(Math.sqrt(sortedNodes.length || 1)));
  const primaryGap = isPrimaryVertical(document.direction) ? 104 : 124;
  const minorGap = isPrimaryVertical(document.direction) ? 88 : 82;
  const bounds = buildSelectionBounds(document.nodes);
  const center = bounds
    ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    : { x: 0, y: 0 };
  const nextPositions = new Map<string, Point>();
  const laneMinorOffsets = new Array(laneCount).fill(0);
  const lanePrimaryOffsets = new Array(laneCount).fill(0);

  sortedNodes.forEach((node, index) => {
    const laneIndex = index % laneCount;
    const laneStep = Math.floor(index / laneCount);
    const primary = laneStep * (getNodePrimarySize(node, document.direction) + primaryGap);
    const minor = laneIndex * (getNodeMinorSize(node, document.direction) + minorGap);
    laneMinorOffsets[laneIndex] = Math.max(laneMinorOffsets[laneIndex], minor);
    lanePrimaryOffsets[laneIndex] = Math.max(lanePrimaryOffsets[laneIndex], primary);
    nextPositions.set(
      node.id,
      isPrimaryVertical(document.direction)
        ? { x: minor, y: primary }
        : { x: primary, y: minor },
    );
  });

  const rawNodes = sortedNodes.map((node) => {
    const position = nextPositions.get(node.id) ?? { x: node.x, y: node.y };
    return { ...node, ...position };
  });
  const rawBounds = buildSelectionBounds(rawNodes);
  if (!rawBounds) {
    return document.nodes;
  }

  const offset = {
    x: Math.round(center.x - (rawBounds.x + rawBounds.width / 2)),
    y: Math.round(center.y - (rawBounds.y + rawBounds.height / 2)),
  };

  return document.nodes.map((node) => {
    const position = nextPositions.get(node.id);
    if (!position) {
      return node;
    }
    return {
      ...node,
      x: Math.round(position.x + offset.x),
      y: Math.round(position.y + offset.y),
    };
  });
}

function barycenterForNode(
  nodeId: string,
  neighbors: Map<string, string[]>,
  orderIndex: Map<string, number>,
) {
  const linked = neighbors.get(nodeId) ?? [];
  if (linked.length === 0) {
    return Number.NaN;
  }

  const values = linked
    .map((neighborId) => orderIndex.get(neighborId))
    .filter((value): value is number => typeof value === 'number');

  if (values.length === 0) {
    return Number.NaN;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function layoutDocumentNodes(document: GraphDocument) {
  const semanticEdges = buildSemanticLayoutEdges(document);
  if (semanticEdges.length === 0) {
    return layoutDisconnectedNodes(document);
  }

  const direction = document.direction;
  const rankMap = buildTopologicalRankMap(document, semanticEdges);
  const subgraphLookup = getVisibleSubgraphIds(document.subgraphs);
  const incomingNeighbors = new Map<string, string[]>();
  const outgoingNeighbors = new Map<string, string[]>();
  const allNeighbors = new Map<string, string[]>();

  document.nodes.forEach((node) => {
    incomingNeighbors.set(node.id, []);
    outgoingNeighbors.set(node.id, []);
    allNeighbors.set(node.id, []);
  });

  semanticEdges.forEach((edge) => {
    incomingNeighbors.get(edge.to)?.push(edge.from);
    outgoingNeighbors.get(edge.from)?.push(edge.to);
    allNeighbors.set(edge.from, [...(allNeighbors.get(edge.from) ?? []), edge.to]);
    allNeighbors.set(edge.to, [...(allNeighbors.get(edge.to) ?? []), edge.from]);
  });

  const groups = new Map<number, GraphNode[]>();
  document.nodes.forEach((node) => {
    const rank = rankMap.get(node.id) ?? 0;
    groups.set(rank, [...(groups.get(rank) ?? []), node]);
  });

  const sortedRanks = [...groups.keys()].sort((left, right) => left - right);
  const orderIndex = new Map<string, number>();

  sortedRanks.forEach((rank) => {
    const group = [...(groups.get(rank) ?? [])].sort((left, right) => {
      const leftSubgraph = buildSubgraphPathKey(left.subgraphId, subgraphLookup);
      const rightSubgraph = buildSubgraphPathKey(right.subgraphId, subgraphLookup);
      if (leftSubgraph !== rightSubgraph) {
        return leftSubgraph.localeCompare(rightSubgraph);
      }
      const minorDelta = getNodeMinorStart(left, direction) - getNodeMinorStart(right, direction);
      if (minorDelta !== 0) {
        return minorDelta;
      }
      return left.id.localeCompare(right.id);
    });
    groups.set(rank, group);
    group.forEach((node, index) => orderIndex.set(node.id, index));
  });

  for (let sweep = 0; sweep < 4; sweep += 1) {
    const ascending = sweep % 2 === 0;
    const ranks = ascending ? sortedRanks : [...sortedRanks].reverse();
    ranks.forEach((rank) => {
      const group = [...(groups.get(rank) ?? [])];
      group.sort((left, right) => {
        const leftBarycenter = barycenterForNode(
          left.id,
          ascending ? incomingNeighbors : outgoingNeighbors,
          orderIndex,
        );
        const rightBarycenter = barycenterForNode(
          right.id,
          ascending ? incomingNeighbors : outgoingNeighbors,
          orderIndex,
        );

        if (Number.isFinite(leftBarycenter) && Number.isFinite(rightBarycenter) && leftBarycenter !== rightBarycenter) {
          return leftBarycenter - rightBarycenter;
        }
        if (Number.isFinite(leftBarycenter) && !Number.isFinite(rightBarycenter)) {
          return -1;
        }
        if (!Number.isFinite(leftBarycenter) && Number.isFinite(rightBarycenter)) {
          return 1;
        }

        const leftSubgraph = buildSubgraphPathKey(left.subgraphId, subgraphLookup);
        const rightSubgraph = buildSubgraphPathKey(right.subgraphId, subgraphLookup);
        if (leftSubgraph !== rightSubgraph) {
          return leftSubgraph.localeCompare(rightSubgraph);
        }

        const currentMinorDelta = getNodeMinorStart(left, direction) - getNodeMinorStart(right, direction);
        if (currentMinorDelta !== 0) {
          return currentMinorDelta;
        }

        return left.id.localeCompare(right.id);
      });
      groups.set(rank, group);
      group.forEach((node, index) => orderIndex.set(node.id, index));
    });
  }

  const primaryGap = isPrimaryVertical(direction) ? 110 : 124;
  const minorGap = isPrimaryVertical(direction) ? 82 : 76;
  const physicalRanks = isPrimaryReversed(direction) ? [...sortedRanks].reverse() : sortedRanks;
  const rankPrimaryStart = new Map<number, number>();
  let primaryCursor = 0;
  physicalRanks.forEach((rank) => {
    rankPrimaryStart.set(rank, primaryCursor);
    const group = groups.get(rank) ?? [];
    const majorSize = group.length > 0
      ? Math.max(...group.map((node) => getNodePrimarySize(node, direction)))
      : 0;
    primaryCursor += majorSize + primaryGap;
  });

  const rawPositions = new Map<string, Point>();
  sortedRanks.forEach((rank) => {
    const group = groups.get(rank) ?? [];
    const totalMinorSpan = group.reduce((sum, node, index) => (
      sum + getNodeMinorSize(node, direction) + (index === group.length - 1 ? 0 : minorGap)
    ), 0);
    let minorCursor = -totalMinorSpan / 2;
    group.forEach((node) => {
      const primary = rankPrimaryStart.get(rank) ?? 0;
      const minor = minorCursor;
      rawPositions.set(
        node.id,
        isPrimaryVertical(direction)
          ? { x: minor, y: primary }
          : { x: primary, y: minor },
      );
      minorCursor += getNodeMinorSize(node, direction) + minorGap;
    });
  });

  const rawNodes = document.nodes.map((node) => ({
    ...node,
    ...(rawPositions.get(node.id) ?? { x: node.x, y: node.y }),
  }));
  const rawBounds = buildSelectionBounds(rawNodes);
  const currentBounds = buildSelectionBounds(document.nodes);
  if (!rawBounds || !currentBounds) {
    return rawNodes;
  }

  const offset = {
    x: Math.round(currentBounds.x + currentBounds.width / 2 - (rawBounds.x + rawBounds.width / 2)),
    y: Math.round(currentBounds.y + currentBounds.height / 2 - (rawBounds.y + rawBounds.height / 2)),
  };

  return document.nodes.map((node) => {
    const raw = rawPositions.get(node.id);
    if (!raw) {
      return node;
    }
    return {
      ...node,
      x: Math.round(raw.x + offset.x),
      y: Math.round(raw.y + offset.y),
    };
  });
}

function tidyDocumentNodes(document: GraphDocument) {
  const compactedNodes = compactDocumentNodes(document);
  const baseDocument = { ...document, nodes: compactedNodes };
  const semanticEdges = buildSemanticLayoutEdges(baseDocument);
  if (semanticEdges.length === 0) {
    return compactedNodes;
  }

  const direction = document.direction;
  const nodeMap = new Map(compactedNodes.map((node) => [node.id, node]));
  const incoming = new Map(compactedNodes.map((node) => [node.id, [] as string[]]));
  const outgoing = new Map(compactedNodes.map((node) => [node.id, [] as string[]]));
  const allNeighbors = new Map(compactedNodes.map((node) => [node.id, [] as string[]]));
  semanticEdges.forEach((edge) => {
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
    allNeighbors.set(edge.from, [...(allNeighbors.get(edge.from) ?? []), edge.to]);
    allNeighbors.set(edge.to, [...(allNeighbors.get(edge.to) ?? []), edge.from]);
  });

  const primaryGap = isPrimaryVertical(direction) ? 92 : 104;
  const primaryShiftLimit = isPrimaryVertical(direction) ? 44 : 52;
  const minorShiftLimit = isPrimaryVertical(direction) ? 34 : 28;
  const relaxedNodes = compactedNodes.map((node) => {
    const currentPrimary = getNodePrimaryStart(node, direction);
    const currentMinor = getNodeMinorStart(node, direction);
    const primaryTargets: number[] = [];
    const minorTargets: number[] = [];

    (incoming.get(node.id) ?? []).forEach((neighborId) => {
      const neighbor = nodeMap.get(neighborId);
      if (!neighbor) {
        return;
      }
      primaryTargets.push(getNodePrimaryStart(neighbor, direction) + getNodePrimarySize(neighbor, direction) + primaryGap);
      minorTargets.push(getNodeMinorStart(neighbor, direction));
    });
    (outgoing.get(node.id) ?? []).forEach((neighborId) => {
      const neighbor = nodeMap.get(neighborId);
      if (!neighbor) {
        return;
      }
      primaryTargets.push(getNodePrimaryStart(neighbor, direction) - getNodePrimarySize(node, direction) - primaryGap);
      minorTargets.push(getNodeMinorStart(neighbor, direction));
    });

    const nextPrimary = primaryTargets.length > 0
      ? currentPrimary + clamp(
        Math.round(primaryTargets.reduce((sum, value) => sum + value, 0) / primaryTargets.length - currentPrimary),
        -primaryShiftLimit,
        primaryShiftLimit,
      )
      : currentPrimary;
    const nextMinor = minorTargets.length > 0
      ? currentMinor + clamp(
        Math.round(minorTargets.reduce((sum, value) => sum + value, 0) / minorTargets.length - currentMinor),
        -minorShiftLimit,
        minorShiftLimit,
      )
      : currentMinor;

    return withNodeAxisPosition(node, direction, nextPrimary, nextMinor);
  });

  const orderedNodes = [...relaxedNodes].sort((left, right) => {
    const primaryDelta = getNodePrimaryStart(left, direction) - getNodePrimaryStart(right, direction);
    if (primaryDelta !== 0) {
      return primaryDelta;
    }

    const degreeDelta = (allNeighbors.get(right.id)?.length ?? 0) - (allNeighbors.get(left.id)?.length ?? 0);
    if (degreeDelta !== 0) {
      return degreeDelta;
    }

    return getNodeMinorStart(left, direction) - getNodeMinorStart(right, direction);
  });

  const placed = new Map<string, GraphNode>();
  const obstacles: Rect[] = [];
  orderedNodes.forEach((node) => {
    const original = nodeMap.get(node.id) ?? node;
    const resolvedRect = searchFreeRect(
      { x: node.x, y: node.y, width: node.width, height: node.height },
      obstacles,
      {
        x: node.x - original.x || (isPrimaryVertical(direction) ? 0 : 1),
        y: node.y - original.y || (isPrimaryVertical(direction) ? 1 : 0),
      },
    );
    const placedNode = { ...node, x: resolvedRect.x, y: resolvedRect.y };
    placed.set(node.id, placedNode);
    obstacles.push(expandRect(resolvedRect, 16));
  });

  return document.nodes.map((node) => placed.get(node.id) ?? node);
}

function compactDocumentNodes(document: GraphDocument) {
  const primaryIsVertical = document.direction === 'TD' || document.direction === 'BT';
  const clusterThreshold = primaryIsVertical ? 210 : 172;
  const maxTrackGap = primaryIsVertical ? 132 : 116;
  const minTrackGap = primaryIsVertical ? 80 : 72;
  const preferredTrackGap = primaryIsVertical ? 104 : 92;
  const maxPrimaryGap = primaryIsVertical ? 116 : 124;
  const minPrimaryGap = primaryIsVertical ? 56 : 62;
  const preferredPrimaryGap = primaryIsVertical ? 82 : 88;
  const maxTrackShift = primaryIsVertical ? 44 : 38;
  const maxNodeShift = primaryIsVertical ? 52 : 56;
  const orderedNodes = [...document.nodes].sort((left, right) => {
    const leftMinor = primaryIsVertical ? left.x : left.y;
    const rightMinor = primaryIsVertical ? right.x : right.y;
    if (leftMinor !== rightMinor) {
      return leftMinor - rightMinor;
    }

    const leftPrimary = primaryIsVertical ? left.y : left.x;
    const rightPrimary = primaryIsVertical ? right.y : right.x;
    return leftPrimary - rightPrimary;
  });
  const tracks: Array<{ axis: number; nodes: GraphNode[] }> = [];

  orderedNodes.forEach((node) => {
    const axis = primaryIsVertical ? node.x : node.y;
    const track = tracks.find((entry) => Math.abs(entry.axis - axis) <= clusterThreshold);
    if (track) {
      track.nodes.push(node);
      track.axis = (track.axis * (track.nodes.length - 1) + axis) / track.nodes.length;
      return;
    }

    tracks.push({ axis, nodes: [node] });
  });

  tracks.sort((left, right) => left.axis - right.axis);
  const nextPositions = new Map<string, Point>();
  let previousTrackEnd: number | null = null;
  let previousTrackAxis: number | null = null;

  tracks.forEach((track, trackIndex) => {
    const sortedTrackNodes = [...track.nodes].sort((left, right) => {
      const leftPrimary = primaryIsVertical ? left.y : left.x;
      const rightPrimary = primaryIsVertical ? right.y : right.x;
      return leftPrimary - rightPrimary;
    });
    const trackMin = Math.min(...sortedTrackNodes.map((node) => primaryIsVertical ? node.x : node.y));
    const trackMax = Math.max(...sortedTrackNodes.map((node) => primaryIsVertical ? node.x + node.width : node.y + node.height));
    let trackShift = 0;

    if (trackIndex > 0 && previousTrackEnd !== null && previousTrackAxis !== null) {
      const currentGap = trackMin - previousTrackEnd;
      if (currentGap > maxTrackGap) {
        trackShift = -Math.min(maxTrackShift, Math.round((currentGap - preferredTrackGap) * 0.42));
      } else if (currentGap < minTrackGap) {
        trackShift = Math.min(maxTrackShift, minTrackGap - currentGap);
      }

      const axisGap = track.axis + trackShift - previousTrackAxis;
      if (axisGap > maxTrackGap) {
        trackShift -= Math.min(maxTrackShift, Math.round((axisGap - preferredTrackGap) * 0.35));
      } else if (axisGap < minTrackGap) {
        trackShift += Math.min(maxTrackShift, Math.round((minTrackGap - axisGap) * 0.7));
      }
    }

    let previousPlacedEnd: number | null = null;

    sortedTrackNodes.forEach((node) => {
      const originalMinor = primaryIsVertical ? node.x : node.y;
      const originalPrimary = primaryIsVertical ? node.y : node.x;
      let nextPrimary = originalPrimary;

      if (previousPlacedEnd !== null) {
        const originalGap = nextPrimary - previousPlacedEnd;
        if (originalGap > maxPrimaryGap) {
          nextPrimary -= Math.min(maxNodeShift, Math.round((originalGap - preferredPrimaryGap) * 0.45));
        } else if (originalGap < minPrimaryGap) {
          nextPrimary += Math.min(maxNodeShift, Math.round((minPrimaryGap - originalGap) * 0.85));
        }
      }

      const nextMinor = originalMinor + trackShift;
      nextPositions.set(
        node.id,
        primaryIsVertical
          ? { x: Math.round(nextMinor), y: Math.round(nextPrimary) }
          : { x: Math.round(nextPrimary), y: Math.round(nextMinor) },
      );
      previousPlacedEnd = nextPrimary + (primaryIsVertical ? node.height : node.width);
    });

    previousTrackEnd = trackMax + trackShift;
    previousTrackAxis = track.axis + trackShift;
  });

  return document.nodes.map((node) => {
    const nextPosition = nextPositions.get(node.id);
    return nextPosition
      ? { ...node, x: Math.round(nextPosition.x), y: Math.round(nextPosition.y) }
      : node;
  });
}

function resolveDraggedNodeCollision(
  document: GraphDocument,
  movedNodeIds: string[],
  desiredNodes: GraphNode[],
  subgraphLookup: Map<string, GraphSubgraph>,
  targetSubgraphId: string | null,
  contentRect?: Rect | null,
) {
  if (movedNodeIds.length === 0 || desiredNodes.length === 0) {
    return desiredNodes;
  }

  const movedSet = new Set(movedNodeIds);
  const desiredSelectionNodes = desiredNodes.filter((node) => movedSet.has(node.id));
  const selectionBounds = buildSelectionBounds(desiredSelectionNodes);
  if (!selectionBounds) {
    return desiredNodes;
  }

  const excludedSubgraphIds = new Set<string>();
  desiredSelectionNodes.forEach((node) => {
    const ancestry = getSubgraphAncestryIds(node.subgraphId, subgraphLookup);
    ancestry.forEach((id) => excludedSubgraphIds.add(id));
  });

  if (targetSubgraphId) {
    const ancestry = getSubgraphAncestryIds(targetSubgraphId, subgraphLookup);
    ancestry.forEach((id) => excludedSubgraphIds.add(id));
  }

  const desiredDocument = {
    ...document,
    nodes: desiredNodes,
  };
  const obstacles = buildCollisionObstacles(
    desiredDocument,
    desiredNodes,
    movedSet,
    excludedSubgraphIds,
    contentRect,
  );
  const previousSelectionNodes = document.nodes.filter((node) => movedSet.has(node.id));
  const previousBounds = buildSelectionBounds(previousSelectionNodes) ?? selectionBounds;
  const directionHint = {
    x: selectionBounds.x - previousBounds.x,
    y: selectionBounds.y - previousBounds.y,
  };
  const targetFrame = targetSubgraphId
    ? buildSubgraphFrames(desiredDocument, desiredNodes).find((frame) => frame.id === targetSubgraphId) ?? null
    : null;
  const bounds = targetFrame
    ? {
        x: targetFrame.x + 18,
        y: targetFrame.y + targetFrame.headerHeight + 10,
        width: Math.max(80, targetFrame.width - 36),
        height: Math.max(80, targetFrame.height - targetFrame.headerHeight - 22),
      }
    : null;
  const resolvedRect = searchFreeRect(
    selectionBounds,
    obstacles,
    directionHint,
    bounds,
  );
  const offsetX = resolvedRect.x - selectionBounds.x;
  const offsetY = resolvedRect.y - selectionBounds.y;

  if (Math.abs(offsetX) < 0.5 && Math.abs(offsetY) < 0.5) {
    return desiredNodes;
  }

  return desiredNodes.map((node) =>
    movedSet.has(node.id)
      ? {
          ...node,
          x: Math.round(node.x + offsetX),
          y: Math.round(node.y + offsetY),
        }
      : node,
  );
}

function buildGraphTreeItems(
  subgraphs: GraphSubgraph[],
  nodes: GraphNode[],
  lookup: Map<string, GraphSubgraph>,
  frameMap: Map<string, SubgraphFrame>,
  searchQuery: string,
  parentId: string | null = null,
  depth = 0,
): GraphTreeItem[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const candidates = [
    ...subgraphs
      .filter((subgraph) => subgraph.parentId === parentId)
      .map((subgraph) => ({
        id: subgraph.id,
        type: 'subgraph' as const,
        order:
          frameMap.get(subgraph.id)?.y ??
          nodes
            .filter((node) => belongsToSubgraph(node, subgraph.id, lookup))
            .reduce((min, node) => Math.min(min, node.y), Number.MAX_SAFE_INTEGER),
        subgraph,
      })),
    ...nodes
      .filter((node) => node.subgraphId === parentId)
      .map((node) => ({
        id: node.id,
        type: 'node' as const,
        order: node.y,
        node,
      })),
  ].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }

    const leftLabel = left.type === 'subgraph' ? left.subgraph.title : left.node.label;
    const rightLabel = right.type === 'subgraph' ? right.subgraph.title : right.node.label;
    return leftLabel.localeCompare(rightLabel);
  });

  return candidates.flatMap((candidate) => {
    if (candidate.type === 'subgraph') {
      const descendants = buildGraphTreeItems(
        subgraphs,
        nodes,
        lookup,
        frameMap,
        searchQuery,
        candidate.subgraph.id,
        depth + 1,
      );
      const count = countNodesInSubgraph(nodes, candidate.subgraph.id, lookup);
      const meta = candidate.subgraph.collapsed ? `已折叠 · ${count} 项` : `${count} 项`;
      const matches =
        normalizedQuery.length === 0 ||
        candidate.subgraph.id.toLowerCase().includes(normalizedQuery) ||
        candidate.subgraph.title.toLowerCase().includes(normalizedQuery);

      if (!matches && descendants.length === 0) {
        return [];
      }

      return [
        {
          id: candidate.subgraph.id,
          depth,
          kind: 'subgraph' as const,
          label: candidate.subgraph.title,
          meta,
        },
        ...descendants,
      ];
    }

    const matches =
      normalizedQuery.length === 0 ||
      candidate.node.id.toLowerCase().includes(normalizedQuery) ||
      candidate.node.label.toLowerCase().includes(normalizedQuery);

    if (!matches) {
      return [];
    }

    return [
      {
        id: candidate.node.id,
        depth,
        kind: 'node' as const,
        label: candidate.node.label,
        meta: candidate.node.id,
      },
    ];
  });
}

function MermaidPreview({ source }: { source: string }) {
  const previewId = useId();
  const deferredSource = useDeferredValue(source);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function renderPreview() {
      try {
        setLoading(true);
        const mermaidModule = await import('mermaid');
        const mermaid = mermaidModule.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'neutral',
          fontFamily: 'IBM Plex Mono, monospace',
          flowchart: {
            useMaxWidth: false,
            htmlLabels: false,
          },
        });
        const result = await mermaid.render(`preview-${previewId}`, deferredSource);
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
          setLoading(false);
        }
      } catch (renderError) {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : '无法渲染预览。');
          setLoading(false);
        }
      }
    }

    renderPreview();

    return () => {
      cancelled = true;
    };
  }, [deferredSource, previewId]);

  if (loading) {
    return (
      <div className="preview-empty">
        <h3>正在加载预览</h3>
        <p>Mermaid 渲染引擎正在按需加载。</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="preview-empty">
        <h3>预览暂不可用</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div
      className="mermaid-preview"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default function App() {
  const hostConfigRef = useRef(readAppHostConfig());
  const hostConfig = hostConfigRef.current;
  const isVsCodeHost = hostConfig.platform === 'vscode';
  const vscodeApiRef = useRef<VsCodeWebviewApi | null>(null);
  const lastVsCodeSyncedMarkdownRef = useRef(hostConfig.initialMarkdown ?? '');
  if (
    isVsCodeHost &&
    !vscodeApiRef.current &&
    'acquireVsCodeApi' in window &&
    typeof (window as Window & { acquireVsCodeApi?: () => VsCodeWebviewApi }).acquireVsCodeApi === 'function'
  ) {
    vscodeApiRef.current = (window as Window & { acquireVsCodeApi: () => VsCodeWebviewApi }).acquireVsCodeApi();
  }

  const [initialWorkspace] = useState(() =>
    loadWorkspace(hostConfig.initialMarkdown, getProjectFallbackName(hostConfig.fileName), isVsCodeHost),
  );
  const [documentState, setDocumentState] = useState<GraphDocument>(initialWorkspace.document);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth <= 820);
  const [isConstrainedDevice, setIsConstrainedDevice] = useState(false);
  const [mode, setMode] = useState<EditorMode>('canvas');
  const [perfDebugEnabled, setPerfDebugEnabled] = useState(() => readPerfDebugEnabled(hostConfig));
  const [perfDebugSummary, setPerfDebugSummary] = useState<PerfDebugSummary>(() => createEmptyPerfDebugSummary());
  const [leftPanel, setLeftPanel] = useState<LeftPanel>(isVsCodeHost ? 'graph' : 'files');
  const [activeFileTab, setActiveFileTab] = useState<WorkspaceTabId>('diagram');
  const [activeWorkspaceSource, setActiveWorkspaceSource] = useState<'cloud' | 'local'>(
    isVsCodeHost ? 'local' : 'cloud',
  );
  const [localExplorerItems, setLocalExplorerItems] = useState<ExplorerItem[]>(defaultLocalProjectItems);
  const [activeLocalFileId, setActiveLocalFileId] = useState<string | null>(null);
  const [activeLocalDirectoryId, setActiveLocalDirectoryId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(!isVsCodeHost);
  const [inspectorOpen, setInspectorOpen] = useState(isVsCodeHost);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredNumber(storageKeys.sidebarWidth, DEFAULT_SIDEBAR_WIDTH),
  );
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    readStoredNumber(storageKeys.inspectorWidth, DEFAULT_INSPECTOR_WIDTH),
  );
  const [mobileSourcePreviewOpen, setMobileSourcePreviewOpen] = useState(false);
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const [aiPanelTab, setAiPanelTab] = useState<AiPanelTab>('chat');
  const [inspectorView, setInspectorView] = useState<InspectorView>('properties');
  const [aiRecordsExpanded, setAiRecordsExpanded] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiSettingsDraft>(() => ({
    ...defaultAiSettings,
    ...readStoredJson(storageKeys.aiSettings, defaultAiSettings),
  }));
  const [aiRecords, setAiRecords] = useState<AiConversationRecord[]>(() =>
    readInitialAiConversationRecords(),
  );
  const [activeAiRecordId, setActiveAiRecordId] = useState(() =>
    readStoredString(storageKeys.aiActiveSession, ''),
  );
  const activeAiRecord = useMemo(() => {
    if (aiRecords.length === 0) {
      return createAiConversationRecord();
    }

    return aiRecords.find((record) => record.id === activeAiRecordId) ?? aiRecords[0];
  }, [activeAiRecordId, aiRecords]);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>(() =>
    normalizeStoredAiMessages(readInitialAiConversationRecords()[0]?.messages ?? defaultAiMessages),
  );
  const [aiInput, setAiInput] = useState('');
  const [aiSending, setAiSending] = useState(false);
  const [aiLastMarkdown, setAiLastMarkdown] = useState(() =>
    localStorage.getItem(storageKeys.aiLastMarkdown) ?? '',
  );
  const [aiChangeBubbles, setAiChangeBubbles] = useState<AiChangeBubble[]>([]);
  const [selection, setSelection] = useState<SelectionState>({ kind: 'none', ids: [] });
  const selectionContextSummary = useMemo(
    () => buildSelectionContextSummary(documentState, selection),
    [documentState, selection],
  );
  const [canvasHovered, setCanvasHovered] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(initialWorkspace.history);
  const [documentRevision, setDocumentRevision] = useState(1);
  const [, setUndoStack] = useState<GraphDocument[]>([]);
  const [, setRedoStack] = useState<GraphDocument[]>([]);
  const [sourceDraft, setSourceDraft] = useState(
    initialWorkspace.document.markdown ?? initialWorkspace.document.source,
  );
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [searchQuery, setSearchQuery] = useState('');
  const [canvasSearchOpen, setCanvasSearchOpen] = useState(false);
  const [canvasSearchQuery, setCanvasSearchQuery] = useState('');
  const [canvasSearchFocusIndex, setCanvasSearchFocusIndex] = useState(0);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [subgraphBadgeAnchors, setSubgraphBadgeAnchors] = useState<Record<string, SubgraphBadgeAnchor>>({});
  const [activeLocalExplorerItemId, setActiveLocalExplorerItemId] = useState<string | null>(null);
  const [hasLocalProjectAccess, setHasLocalProjectAccess] = useState(false);
  const [nodeInspectorDraft, setNodeInspectorDraft] = useState<NodeInspectorDraft>({
    label: '',
    description: '',
    shape: 'rect',
    fill: '#121214',
    stroke: '#d6ff3a',
    textColor: '#f4f4f5',
  });
  const [edgeInspectorDraft, setEdgeInspectorDraft] = useState<EdgeInspectorDraft>({
    label: '',
    type: 'solid',
    strokeColor: defaultEdgeStyle.strokeColor,
    strokeWidthInput: String(defaultEdgeStyle.strokeWidth),
  });
  const [subgraphInspectorDraft, setSubgraphInspectorDraft] = useState<SubgraphInspectorDraft>({
    title: '',
    description: '',
    collapsed: false,
    fill: defaultSubgraphStyle.fill,
    stroke: defaultSubgraphStyle.stroke,
    textColor: defaultSubgraphStyle.textColor,
  });

  const activateAiConversation = useCallback((recordId: string) => {
    setActiveAiRecordId(recordId);
    setAiRecordsExpanded(false);
  }, []);

  const createAiConversation = useCallback(() => {
    const nextRecord = createAiConversationRecord();
    setAiRecords((current) => [nextRecord, ...current].slice(0, 24));
    setActiveAiRecordId(nextRecord.id);
    setAiMessages(nextRecord.messages);
    setAiPanelTab('chat');
    setAiRecordsExpanded(false);
  }, []);

  const clearActiveAiConversation = useCallback(() => {
    if (!activeAiRecord) {
      return;
    }

    const clearedMessages = [createAiMessage('assistant', defaultAiMessages[0].content)];
    setAiMessages(clearedMessages);
    setAiLastMarkdown(documentRef.current.markdown ?? documentRef.current.source);
    setAiChangeBubbles([]);
    setAiRecords((current) => current.map((record) => (
      record.id === activeAiRecord.id
        ? {
            ...record,
            title: '新对话',
            updatedAt: new Date().toISOString(),
            messages: clearedMessages,
          }
        : record
    )));
    setAiRecordsExpanded(false);
  }, [activeAiRecord]);

  const pushAiChangeBubbles = useCallback((changes: AiToolChangeTarget[]) => {
    if (changes.length === 0) {
      return;
    }

    const createdAt = Date.now();
    const nextBubbles = changes.slice(0, 6).map((change, index) => ({
      id: `${createdAt}-${index}-${change.kind}-${change.targetId ?? change.label}`,
      ...change,
    }));
    setAiChangeBubbles((current) => [...nextBubbles, ...current].slice(0, 8));
  }, []);

  const dismissAiChangeBubble = useCallback((bubbleId: string) => {
    setAiChangeBubbles((current) => current.filter((bubble) => bubble.id !== bubbleId));
  }, []);
  useEffect(() => {
    if (aiChangeBubbles.length === 0) {
      return undefined;
    }

    const timers = aiChangeBubbles.map((bubble) =>
      window.setTimeout(() => {
        dismissAiChangeBubble(bubble.id);
      }, 12000),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [aiChangeBubbles, dismissAiChangeBubble]);
  const [contentInspectorDraft, setContentInspectorDraft] = useState<ContentInspectorDraft>({
    markdown: '',
  });
  const [projectInspectorDraft, setProjectInspectorDraft] = useState<ProjectInspectorDraft>({
    projectName: initialWorkspace.document.projectName ?? 'Untitled Project',
    projectSummary: initialWorkspace.document.projectSummary ?? '',
    contentMarkdown: initialWorkspace.document.contentMarkdown ?? extractContentMarkdown(initialWorkspace.document.suffixMarkdown),
  });
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [editingNodeField, setEditingNodeField] = useState<InlineNodeField>('title');
  const [editingNodeSelectAll, setEditingNodeSelectAll] = useState(false);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [editingEdgeLabel, setEditingEdgeLabel] = useState('');
  const [editingSubgraphId, setEditingSubgraphId] = useState<string | null>(null);
  const [editingSubgraphTitle, setEditingSubgraphTitle] = useState('');
  const [editingSubgraphField, setEditingSubgraphField] = useState<InlineNodeField>('title');
  const [editingContent, setEditingContent] = useState(false);
  const [svgPreviewOpen, setSvgPreviewOpen] = useState(false);
  const [svgPreviewScale, setSvgPreviewScale] = useState(1);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragTargetSubgraphId, setDragTargetSubgraphId] = useState<string | null>(null);
  const [dragTargetNodeId, setDragTargetNodeId] = useState<string | null>(null);
  const [dragTargetEdgeId, setDragTargetEdgeId] = useState<string | null>(null);
  const [dragReparentMode, setDragReparentMode] = useState(false);
  const [boxState, setBoxState] = useState<BoxState | null>(null);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [miniMapDragState, setMiniMapDragState] = useState<MiniMapDragState | null>(null);
  const [connectingState, setConnectingState] = useState<ConnectingState | null>(null);
  const [panelResizeState, setPanelResizeState] = useState<PanelResizeState | null>(null);
  const [contentCardResizeState, setContentCardResizeState] = useState<ContentCardResizeState | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [pendingSourceSelection, setPendingSourceSelection] = useState<{ start: number; end: number } | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const workspaceMainRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasBoardRef = useRef<HTMLDivElement>(null);
  const canvasSearchInputRef = useRef<HTMLInputElement>(null);
  const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const nodeTitleEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const nodeDescriptionEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const nodeEditorShellRef = useRef<HTMLDivElement | null>(null);
  const pendingPlaceholderTitleSelectAllRef = useRef(false);
  const editingLabelRef = useRef(editingLabel);
  const subgraphEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const searchRestoreViewportRef = useRef<ViewportState | null>(null);
  const localHandleEntriesRef = useRef<Record<string, LocalHandleEntry>>({});
  const localRootDirectoryRef = useRef<LocalProjectDirectoryHandle | null>(null);
  const nodeClipboardRef = useRef<NodeClipboardState | null>(null);
  const documentRef = useRef(documentState);
  const documentRevisionRef = useRef(documentRevision);
  const aiLastMarkdownRef = useRef(aiLastMarkdown);
  const previousModeRef = useRef(mode);
  const editingSubgraphTitleRef = useRef(editingSubgraphTitle);
  const gestureStateRef = useRef<GestureState | null>(null);
  const perfMetricsRef = useRef<Map<string, PerfMetricAccumulator>>(new Map());
  /** Live viewport for pan/zoom frames — avoids setDocumentState per pointermove. */
  const liveViewportRef = useRef<ViewportState>(documentState.layout.viewport);
  const panCommitNeededRef = useRef(false);
  const baseNodeSceneCacheRef = useRef(new BaseSceneCache<GraphNode>());
  const topologyRevisionRef = useRef('');
  const viewportPaintFrameRef = useRef<number | null>(null);
  const viewportCommitTimerRef = useRef<number | null>(null);
  /** Full topology paint sources (NOT viewport-pre-culled) for live pan/zoom paint. */
  const hybridPaintTopologyRef = useRef<{
    nodes: GraphNode[];
    edges: Array<SceneRenderableEdge & {
      id: string;
      bounds: { x: number; y: number; width: number; height: number };
    }>;
  }>({ nodes: [], edges: [] });
  const perfCountersRef = useRef(createPerfCounterSnapshot());
  const perfWindowStartedAtRef = useRef(performance.now());
  const perfRenderCountRef = useRef(0);
  const perfRenderBaselineRef = useRef(0);
  const perfSnapshotRef = useRef<PerfDebugSnapshot>(createPerfDebugSnapshot());
  const pointerMoveFrameRef = useRef<number | null>(null);
  const pendingPointerMoveRef = useRef<{
    clientX: number;
    clientY: number;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  } | null>(null);
  const liveDragStateRef = useRef<DragState | null>(null);
  const dragPreviewFrameRef = useRef<number | null>(null);
  const dragPreviewIdsRef = useRef<Set<string>>(new Set());
  const dragDropTargetsRef = useRef<{
    nodeId: string | null;
    edgeId: string | null;
    subgraphId: string | null;
    reparentMode: boolean;
  }>({
    nodeId: null,
    edgeId: null,
    subgraphId: null,
    reparentMode: false,
  });
  const backgroundHoldRef = useRef<number | null>(null);
  const pendingBackgroundRef = useRef<{
    clientX: number;
    clientY: number;
    point: Point;
  } | null>(null);
  perfRenderCountRef.current += 1;

  const recordPerfMetric = useCallback((label: string, durationMs: number) => {
    if (!perfDebugEnabled) {
      return;
    }

    const bucket = perfMetricsRef.current.get(label) ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
      slowCount: 0,
    };
    bucket.count += 1;
    bucket.totalMs += durationMs;
    bucket.maxMs = Math.max(bucket.maxMs, durationMs);
    bucket.lastMs = durationMs;
    if (durationMs >= PERF_DEBUG_SLOW_SAMPLE_MS) {
      bucket.slowCount += 1;
    }
    perfMetricsRef.current.set(label, bucket);
  }, [perfDebugEnabled]);

  const measurePerf = useCallback(function measurePerf<T>(label: string, compute: () => T): T {
    if (!perfDebugEnabled) {
      return compute();
    }

    const startedAt = performance.now();
    const result = compute();
    recordPerfMetric(label, performance.now() - startedAt);
    return result;
  }, [perfDebugEnabled, recordPerfMetric]);

  const clearImperativeDragPreview = useCallback(() => {
    if (dragPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(dragPreviewFrameRef.current);
      dragPreviewFrameRef.current = null;
    }

    const board = canvasBoardRef.current;
    if (board) {
      board.querySelectorAll<HTMLElement>(`.graph-node.${NODE_DRAG_PREVIEW_CLASS}`).forEach((element) => {
        element.classList.remove(NODE_DRAG_PREVIEW_CLASS);
        element.style.removeProperty('--lmd-drag-x');
        element.style.removeProperty('--lmd-drag-y');
      });
    }

    dragPreviewIdsRef.current.clear();
  }, []);

  /**
   * Live drag: rAF-coalesce React dragState so node positions + edge geometry
   * update every frame while dragging (not only on pointerup).
   * Absolute positions come from applyDragPreview(previewNodes) — CSS translate
   * is intentionally not applied (would double-offset).
   */
  const scheduleImperativeDragPreview = useCallback((nextDragState: DragState | null) => {
    liveDragStateRef.current = nextDragState;

    if (dragPreviewFrameRef.current !== null) {
      return;
    }

    dragPreviewFrameRef.current = window.requestAnimationFrame(() => {
      dragPreviewFrameRef.current = null;
      const liveDragState = liveDragStateRef.current;
      if (!liveDragState) {
        return;
      }
      setDragState(liveDragState);
    });
  }, []);

  const beginLiveDrag = useCallback((nextDragState: DragState) => {
    liveDragStateRef.current = nextDragState;
    clearImperativeDragPreview();
    setDragState(nextDragState);
  }, [clearImperativeDragPreview]);

  const endLiveDrag = useCallback(() => {
    liveDragStateRef.current = null;
    if (dragPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(dragPreviewFrameRef.current);
      dragPreviewFrameRef.current = null;
    }
    clearImperativeDragPreview();
    dragDropTargetsRef.current = {
      nodeId: null,
      edgeId: null,
      subgraphId: null,
      reparentMode: false,
    };
    setDragState(null);
    setDragTargetNodeId(null);
    setDragTargetEdgeId(null);
    setDragTargetSubgraphId(null);
    setDragReparentMode(false);
  }, [clearImperativeDragPreview]);

  const deferredSource = useDeferredValue(sourceDraft);
  const sourceParseError = useMemo(() => {
    if (mode !== 'source') {
      return null;
    }

    return measurePerf('parseProjectMarkdown:deferredSource', () => {
      try {
        parseProjectMarkdown(
          deferredSource,
          documentState.projectName ?? 'Untitled Project',
          documentRef.current.layout,
        );
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : '无法解析工程 Markdown。';
      }
    });
  }, [deferredSource, documentState.projectName, measurePerf, mode]);

  const subgraphLookup = useMemo(
    () => getVisibleSubgraphIds(documentState.subgraphs),
    [documentState.subgraphs],
  );
  const fullSubgraphLookup = subgraphLookup;
  const previewNodes = useMemo(
    () => measurePerf('applyDragPreview', () => applyDragPreview(documentState.nodes, dragState)),
    [documentState.nodes, dragState, measurePerf],
  );
  const previewNodeMap = useMemo(
    () => new Map(previewNodes.map((node) => [node.id, node])),
    [previewNodes],
  );
  const subgraphPreviewNodes = useMemo(
    () => (dragReparentMode ? documentState.nodes : previewNodes),
    [documentState.nodes, dragReparentMode, previewNodes],
  );
  const subgraphFrames = useMemo(
    () => measurePerf('buildSubgraphFrames', () => buildSubgraphFrames(documentState, subgraphPreviewNodes)),
    [documentState, measurePerf, subgraphPreviewNodes],
  );
  const contentMarkdown = useMemo(
    () => documentState.contentMarkdown ?? extractContentMarkdown(documentState.suffixMarkdown),
    [documentState.contentMarkdown, documentState.suffixMarkdown],
  );
  const contentCardLayout = useMemo(
    () => getContentCardLayout(documentState),
    [documentState],
  );
  const contentCardCollapsed = contentCardLayout.collapsed && !editingContent;
  const contentCardSize = useMemo(
    () => measureContentCard(editingContent ? contentInspectorDraft.markdown : contentMarkdown, contentCardCollapsed),
    [contentCardCollapsed, contentInspectorDraft.markdown, contentMarkdown, editingContent],
  );
  const contentCardPreviewHtml = useMemo(
    () => renderMarkdownPreviewHtml(contentMarkdown),
    [contentMarkdown],
  );
  const contentCardSummary = useMemo(
    () => buildContentCardSummary(contentMarkdown),
    [contentMarkdown],
  );
  const contentCardBounds = useMemo(() => {
    const measuredWidth = clamp(contentCardSize.width, CONTENT_CARD_MIN_WIDTH, CONTENT_CARD_MAX_WIDTH);
    const measuredHeight = clamp(
      contentCardSize.height,
      contentCardCollapsed ? CONTENT_CARD_COLLAPSED_HEIGHT : CONTENT_CARD_MIN_HEIGHT,
      CONTENT_CARD_MAX_HEIGHT,
    );
    const persistedWidth = typeof contentCardLayout.width === 'number'
      ? clamp(contentCardLayout.width, CONTENT_CARD_MIN_WIDTH, CONTENT_CARD_MAX_WIDTH)
      : measuredWidth;
    const persistedHeight = typeof contentCardLayout.height === 'number'
      ? clamp(contentCardLayout.height, CONTENT_CARD_MIN_HEIGHT, CONTENT_CARD_MAX_HEIGHT)
      : measuredHeight;

    return {
      width: contentCardResizeState
        ? clamp(contentCardResizeState.width, CONTENT_CARD_MIN_WIDTH, CONTENT_CARD_MAX_WIDTH)
        : persistedWidth,
      height: contentCardCollapsed
        ? CONTENT_CARD_COLLAPSED_HEIGHT
        : (contentCardResizeState
            ? clamp(contentCardResizeState.height, CONTENT_CARD_MIN_HEIGHT, CONTENT_CARD_MAX_HEIGHT)
            : persistedHeight),
    };
  }, [
    contentCardCollapsed,
    contentCardLayout.height,
    contentCardLayout.width,
    contentCardResizeState,
    contentCardSize.height,
    contentCardSize.width,
  ]);
  const contentCardStyle = useMemo(() => {
    const minTop = isVsCodeHost ? 72 : 12;
    return {
      left: Math.max(12, contentCardLayout.x),
      top: Math.max(minTop, contentCardLayout.y),
      width: contentCardBounds.width,
      height: contentCardBounds.height,
    };
  }, [
    contentCardBounds.height,
    contentCardBounds.width,
    contentCardLayout.x,
    contentCardLayout.y,
    isVsCodeHost,
  ]);
  const contentCardRect: Rect | null = null;
  const sceneViewportRect = useMemo(() => {
    const canvasBounds = canvasRef.current?.getBoundingClientRect();
    const viewport = documentState.layout.viewport;
    if (!canvasBounds) {
      return null;
    }

    return {
      x: -viewport.x / viewport.zoom,
      y: -viewport.y / viewport.zoom,
      width: canvasBounds.width / viewport.zoom,
      height: canvasBounds.height / viewport.zoom,
    };
  }, [documentState.layout.viewport]);
  const sceneRenderRect = useMemo(() => {
    if (!sceneViewportRect) {
      return null;
    }

    const worldMargin = HYBRID_SCENE_VIEWPORT_MARGIN_PX / Math.max(documentState.layout.viewport.zoom, 0.08);
    return expandRect(sceneViewportRect, worldMargin);
  }, [documentState.layout.viewport.zoom, sceneViewportRect]);
  const miniMapModel = useMemo(() => {
    return measurePerf('buildMiniMapModel', () => {
      const canvasBounds = canvasRef.current?.getBoundingClientRect();
      const viewport = documentState.layout.viewport;
      const viewportRect = canvasBounds
        ? {
            x: -viewport.x / viewport.zoom,
            y: -viewport.y / viewport.zoom,
            width: canvasBounds.width / viewport.zoom,
            height: canvasBounds.height / viewport.zoom,
          }
        : null;

      return buildMiniMapModel(
        [
          ...previewNodes.map((node) => ({
            id: node.id,
            kind: 'node' as const,
            rect: { x: node.x, y: node.y, width: node.width, height: node.height },
            fill: node.fill,
            stroke: node.stroke,
            selected: selection.kind === 'node' && selectionContains(selection, node.id),
          })),
          ...subgraphFrames.map((frame) => {
            const style = getSubgraphStyle(documentState.subgraphs.find((entry) => entry.id === frame.id));
            return {
              id: frame.id,
              kind: 'subgraph' as const,
              rect: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
              fill: withAlpha(style.fill, 0.22),
              stroke: style.stroke,
              selected: selectionContainsSubgraph(selection, frame.id),
            };
          }),
        ],
        viewportRect,
      );
    });
  }, [
    documentState.subgraphs,
    documentState.layout.viewport,
    measurePerf,
    previewNodes,
    selection,
    subgraphFrames,
  ]);
  const visibleNodes = useMemo(
    () => previewNodes.filter((node) => !isInsideCollapsedSubgraph(node, subgraphLookup)),
    [previewNodes, subgraphLookup],
  );
  const visibleSubgraphNodes = useMemo(
    () => subgraphPreviewNodes.filter((node) => !isInsideCollapsedSubgraph(node, subgraphLookup)),
    [subgraphLookup, subgraphPreviewNodes],
  );
  const hybridSceneDensityHint = mode === 'canvas' && (
    visibleSubgraphNodes.length >= HYBRID_SCENE_NODE_THRESHOLD ||
    documentState.edges.length >= HYBRID_SCENE_EDGE_THRESHOLD
  );
  // Build blob geometry from full topology only — never rebuild shapes on pan/zoom.
  // Viewport culling is applied later when painting/DOM-listing shapes.
  const subgraphBlobDetail: BlobContourDetail = dragState ? 'interactive' : 'full';
  const subgraphBlobShapes = useMemo(
    () => measurePerf(
      `buildSubgraphBlobShapes:${subgraphBlobDetail}`,
      () => buildSubgraphBlobShapes(
        documentState.subgraphs,
        subgraphFrames,
        visibleSubgraphNodes,
        subgraphBlobDetail,
      ),
    ),
    [documentState.subgraphs, measurePerf, subgraphBlobDetail, subgraphFrames, visibleSubgraphNodes],
  );
  const blobVisibleSubgraphIds = useMemo(() => {
    if (!hybridSceneDensityHint || !sceneRenderRect) {
      return new Set(documentState.subgraphs.map((subgraph) => subgraph.id));
    }

    return new Set(
      subgraphBlobShapes
        .filter((shape) => intersects(sceneRenderRect, shape.bounds))
        .map((shape) => shape.id),
    );
  }, [documentState.subgraphs, hybridSceneDensityHint, sceneRenderRect, subgraphBlobShapes]);
  const viewportCulledBlobShapes = useMemo(
    () => (
      hybridSceneDensityHint
        ? subgraphBlobShapes.filter((shape) => blobVisibleSubgraphIds.has(shape.id))
        : subgraphBlobShapes
    ),
    [blobVisibleSubgraphIds, hybridSceneDensityHint, subgraphBlobShapes],
  );
  const subgraphBlobShapeMap = useMemo(
    () => new Map(subgraphBlobShapes.map((shape) => [shape.id, shape])),
    [subgraphBlobShapes],
  );
  const nodeTitleValidationMap = useMemo(
    () => buildNodeTitleValidationMap(documentState.nodes, editingNodeId, editingLabel),
    [documentState.nodes, editingLabel, editingNodeId],
  );
  const edgeEndpoints = useMemo<EdgeEndpointBox[]>(
    () => measurePerf('buildEdgeEndpoints', () => [
      ...visibleNodes.map((node) => ({
        id: node.id,
        kind: 'node' as const,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        fill: node.fill,
        stroke: node.stroke,
        textColor: node.textColor,
      })),
      ...subgraphFrames.map((frame) => {
        const style = getSubgraphStyle(documentState.subgraphs.find((entry) => entry.id === frame.id));
        return {
          id: frame.id,
          kind: 'subgraph' as const,
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
          fill: style.fill,
          stroke: style.stroke,
          textColor: style.textColor,
        };
      }),
    ]),
    [documentState.subgraphs, measurePerf, subgraphFrames, visibleNodes],
  );
  const edgeEndpointMap = useMemo(
    () => new Map(edgeEndpoints.map((endpoint) => [endpoint.id, endpoint])),
    [edgeEndpoints],
  );
  const visibleEdgeEndpointIds = useMemo(
    () => new Set(edgeEndpoints.map((endpoint) => endpoint.id)),
    [edgeEndpoints],
  );
  const visibleEdges = useMemo(
    () => measurePerf('resolveVisibleEdges', () => documentState.edges.flatMap((edge) => {
      const displayFrom = resolveVisibleEndpointIdFromMaps(edge.from, previewNodeMap, subgraphLookup);
      const displayTo = resolveVisibleEndpointIdFromMaps(edge.to, previewNodeMap, subgraphLookup);
      if (
        !visibleEdgeEndpointIds.has(displayFrom) ||
        !visibleEdgeEndpointIds.has(displayTo) ||
        displayFrom === displayTo
      ) {
        return [];
      }

      return [{
        ...edge,
        from: displayFrom,
        to: displayTo,
      }];
    })),
    [documentState.edges, measurePerf, previewNodeMap, subgraphLookup, visibleEdgeEndpointIds],
  );
  const edgeLaneMap = useMemo(
    () => measurePerf('buildEdgeLaneMap', () => buildEdgeLaneMap(visibleEdges)),
    [measurePerf, visibleEdges],
  );
  const edgeEndpointOffsetMap = useMemo(
    () => measurePerf(
      'buildEdgeEndpointOffsetMap',
      () => buildEdgeEndpointOffsetMap(visibleEdges, edgeEndpoints),
    ),
    [edgeEndpoints, measurePerf, visibleEdges],
  );
  const dragEntityEndpointId =
    dragState?.kind === 'subgraph'
      ? (dragState.entityId ?? null)
      : dragState?.kind === 'node' && dragState.ids.length === 1
        ? dragState.ids[0]
        : null;
  const dragInsertPreview = useMemo(() => {
    if (!dragState || !dragTargetEdgeId || !dragEntityEndpointId) {
      return null;
    }

    const previewEdge = visibleEdges.find((edge) => edge.id === dragTargetEdgeId) ?? null;
    const insertedEndpoint = edgeEndpointMap.get(dragEntityEndpointId);
    if (!previewEdge || !insertedEndpoint) {
      return null;
    }

    const fromEndpoint = edgeEndpointMap.get(previewEdge.from);
    const toEndpoint = edgeEndpointMap.get(previewEdge.to);
    if (!fromEndpoint || !toEndpoint) {
      return null;
    }

    return {
      first: buildEdgeGeometry(fromEndpoint, insertedEndpoint),
      second: buildEdgeGeometry(insertedEndpoint, toEndpoint),
      stroke: insertedEndpoint.stroke,
    };
  }, [dragEntityEndpointId, dragState, dragTargetEdgeId, edgeEndpointMap, visibleEdges]);
  const canvasExportBounds = useMemo(
    () => measurePerf('buildCanvasExportBounds', () => buildCanvasExportBounds({
      nodes: visibleNodes,
      subgraphs: subgraphFrames,
      contentRect: null,
      edges: visibleEdges,
      endpointMap: edgeEndpointMap,
      laneMap: edgeLaneMap,
      endpointOffsets: edgeEndpointOffsetMap,
    })),
    [
      edgeEndpointMap,
      edgeEndpointOffsetMap,
      edgeLaneMap,
      measurePerf,
      subgraphFrames,
      visibleEdges,
      visibleNodes,
    ],
  );
  const canvasBoardBounds = useMemo(() => {
    const canvasBounds = canvasRef.current?.getBoundingClientRect();
    const viewport = documentState.layout.viewport;
    const viewportRect = canvasBounds
      ? {
          x: -viewport.x / viewport.zoom,
          y: -viewport.y / viewport.zoom,
          width: canvasBounds.width / viewport.zoom,
          height: canvasBounds.height / viewport.zoom,
        }
      : null;

    const minX = Math.min(
      canvasExportBounds.x,
      viewportRect ? viewportRect.x - 240 : canvasExportBounds.x,
    );
    const minY = Math.min(
      canvasExportBounds.y,
      viewportRect ? viewportRect.y - 240 : canvasExportBounds.y,
    );
    const maxX = Math.max(
      canvasExportBounds.x + canvasExportBounds.width,
      viewportRect ? viewportRect.x + viewportRect.width + 240 : canvasExportBounds.x + canvasExportBounds.width,
    );
    const maxY = Math.max(
      canvasExportBounds.y + canvasExportBounds.height,
      viewportRect ? viewportRect.y + viewportRect.height + 240 : canvasExportBounds.y + canvasExportBounds.height,
    );

    return {
      x: Math.floor(minX),
      y: Math.floor(minY),
      width: Math.max(1280, Math.ceil(maxX - minX)),
      height: Math.max(720, Math.ceil(maxY - minY)),
    };
  }, [canvasExportBounds, documentState.layout.viewport]);
  const liveEdgeMarkerEntries = useMemo(() => {
    const markerMap = new Map<string, string>();
    let markerIndex = 0;

    visibleEdges.forEach((edge) => {
      if (edge.type === 'line') {
        return;
      }

      const normalizedEdge = normalizeEdgeStyle(edge);
      const fromNode = edgeEndpointMap.get(edge.from);
      if (!fromNode) {
        return;
      }

      const inheritsSourceColor = shouldInheritSourceEdgeColor(normalizedEdge.strokeColor);
      const edgeBaseColor = inheritsSourceColor ? getEndpointAccentColor(fromNode) : normalizedEdge.strokeColor;
      if (!markerMap.has(edgeBaseColor)) {
        markerMap.set(edgeBaseColor, `arrow-solid-${markerIndex}`);
        markerIndex += 1;
      }
    });

    return Array.from(markerMap.entries()).map(([color, id]) => ({ color, id }));
  }, [edgeEndpointMap, visibleEdges]);
  const liveEdgeMarkerIdMap = useMemo(
    () => new Map(liveEdgeMarkerEntries.map((entry) => [entry.color, entry.id])),
    [liveEdgeMarkerEntries],
  );
  const allSubgraphFrames = subgraphFrames;
  const allSubgraphFrameMap = useMemo(
    () => new Map(allSubgraphFrames.map((frame) => [frame.id, frame])),
    [allSubgraphFrames],
  );
  const allSubgraphBlobShapes = subgraphBlobShapes;
  const allSubgraphBlobShapeMap = useMemo(
    () => new Map(allSubgraphBlobShapes.map((shape) => [shape.id, shape])),
    [allSubgraphBlobShapes],
  );
  perfSnapshotRef.current = {
    visibleNodeCount: visibleNodes.length,
    visibleEdgeCount: visibleEdges.length,
    subgraphFrameCount: subgraphFrames.length,
    blobRegionCount: subgraphBlobShapes.reduce((total, shape) => total + shape.regions.length, 0),
    blobPrimitiveCount: subgraphBlobShapes.reduce((total, shape) => total + shape.primitives.length, 0),
    canvasNodeCount: 0,
    canvasEdgeCount: 0,
    overlayNodeCount: 0,
    overlayEdgeCount: 0,
  };
  const canvasSearchResults = useMemo<CanvasSearchResult[]>(() => {
    const query = canvasSearchQuery.trim().toLowerCase();
    if (!query) {
      return [];
    }

    const results: CanvasSearchResult[] = [
      ...documentState.subgraphs.flatMap((subgraph) => {
        const frame = allSubgraphFrameMap.get(subgraph.id);
        if (!frame) {
          return [];
        }
        const parts = splitEntityText(subgraph.title);
        const haystack = `${subgraph.id} ${parts.title} ${parts.description}`.toLowerCase();
        if (!haystack.includes(query)) {
          return [];
        }
        const exactBoost =
          parts.title.toLowerCase().startsWith(query) || subgraph.id.toLowerCase().startsWith(query)
            ? 0
            : 1;
        return [
          {
            id: subgraph.id,
            kind: 'subgraph' as const,
            label: parts.title,
            meta: parts.description || subgraph.id,
            rect: frame,
            score: exactBoost,
          },
        ];
      }),
      ...visibleNodes.flatMap((node) => {
        const parts = splitEntityText(node.label);
        const haystack = `${node.id} ${parts.title} ${parts.description}`.toLowerCase();
        if (!haystack.includes(query)) {
          return [];
        }
        const exactBoost =
          parts.title.toLowerCase().startsWith(query) || node.id.toLowerCase().startsWith(query)
            ? 0
            : 1;
        return [
          {
            id: node.id,
            kind: 'node' as const,
            label: parts.title,
            meta: parts.description || node.id,
            rect: node,
            score: 10 + exactBoost,
          },
        ];
      }),
    ];

    return results
      .sort((left, right) => {
        if (left.score !== right.score) {
          return left.score - right.score;
        }
        return left.label.localeCompare(right.label);
      })
      .slice(0, 10);
  }, [allSubgraphFrameMap, canvasSearchQuery, documentState.subgraphs, visibleNodes]);
  const canvasSearchNodeIds = useMemo(
    () => new Set(canvasSearchResults.filter((item) => item.kind === 'node').map((item) => item.id)),
    [canvasSearchResults],
  );
  const canvasSearchSubgraphIds = useMemo(
    () => new Set(canvasSearchResults.filter((item) => item.kind === 'subgraph').map((item) => item.id)),
    [canvasSearchResults],
  );
  const hybridSceneActive = hybridSceneDensityHint;
  // Full topology edge geometry — rebuilt only when endpoints/lanes change, NEVER on pan/zoom.
  const topologySceneEdges = useMemo<SceneRenderableEdge[]>(
    () => measurePerf('buildTopologySceneEdges', () => visibleEdges.flatMap((edge) => {
      const fromEndpoint = edgeEndpointMap.get(edge.from);
      const toEndpoint = edgeEndpointMap.get(edge.to);
      if (!fromEndpoint || !toEndpoint) {
        return [];
      }

      return [{
        edge,
        fromEndpoint,
        toEndpoint,
        geometry: buildEdgeGeometry(
          fromEndpoint,
          toEndpoint,
          edgeLaneMap.get(edge.id) ?? 0,
          edgeEndpointOffsetMap.get(edge.id),
        ),
      }];
    })),
    [edgeEndpointMap, edgeEndpointOffsetMap, edgeLaneMap, measurePerf, visibleEdges],
  );
  // Viewport cull is a derived view for React lists / hit-tests under current committed viewport.
  // Live pan/zoom paint must use topologySceneEdges + live worldRect instead.
  const sceneRenderableNodes = useMemo(
    () => (
      sceneRenderRect
        ? visibleNodes.filter((node) => intersects(sceneRenderRect, node))
        : visibleNodes
    ),
    [sceneRenderRect, visibleNodes],
  );
  const sceneRenderableEdges = useMemo<SceneRenderableEdge[]>(
    () => (
      sceneRenderRect
        ? topologySceneEdges.filter((entry) => intersects(
          sceneRenderRect,
          buildEdgeApproxBounds(entry.fromEndpoint, entry.toEndpoint),
        ))
        : topologySceneEdges
    ),
    [sceneRenderRect, topologySceneEdges],
  );
  const visibleNodeSpatialIndex = useMemo(
    () => new SceneSpatialIndex<GraphNode>(
      visibleNodes.map((node) => ({
        id: node.id,
        rect: node,
        item: node,
      })),
      SCENE_INDEX_BUCKET_SIZE,
    ),
    [visibleNodes],
  );
  const sceneNodeSpatialIndex = useMemo(
    () => new SceneSpatialIndex<GraphNode>(
      sceneRenderableNodes.map((node) => ({
        id: node.id,
        rect: node,
        item: node,
      })),
      SCENE_INDEX_BUCKET_SIZE,
    ),
    [sceneRenderableNodes],
  );
  const sceneEdgeSpatialIndex = useMemo(
    () => new SceneSpatialIndex<SceneRenderableEdge>(
      sceneRenderableEdges.map((entry) => ({
        id: entry.edge.id,
        rect: buildEdgeApproxBounds(entry.fromEndpoint, entry.toEndpoint, 72),
        item: entry,
      })),
      SCENE_EDGE_INDEX_BUCKET_SIZE,
    ),
    [sceneRenderableEdges],
  );
  const subgraphBlobSpatialIndex = useMemo(
    () => new SceneSpatialIndex<SubgraphBlobShape>(
      subgraphBlobShapes.map((shape) => ({
        id: shape.id,
        rect: shape.bounds,
        item: shape,
      })),
      SCENE_INDEX_BUCKET_SIZE,
    ),
    [subgraphBlobShapes],
  );
  // Topology revision: pan/zoom/selection must not change this string.
  const topologyRevision = useMemo(
    () => topologyRevisionFromGraph({
      nodes: documentState.nodes,
      edges: documentState.edges,
      subgraphs: documentState.subgraphs,
    }),
    [documentState.edges, documentState.nodes, documentState.subgraphs],
  );
  topologyRevisionRef.current = topologyRevision;
  // Rebuild spatial base only when topology (or committed node set) changes — not on pan.
  baseNodeSceneCacheRef.current.ensure(topologyRevision, visibleNodes);
  const sceneInteractiveNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (selection.kind === 'node') {
      selection.ids.forEach((id) => ids.add(id));
    }
    if (editingNodeId) {
      ids.add(editingNodeId);
    }
    if (hoveredNodeId) {
      ids.add(hoveredNodeId);
    }
    if (dragTargetNodeId) {
      ids.add(dragTargetNodeId);
    }
    if (dragState?.kind === 'node') {
      dragState.ids.forEach((id) => ids.add(id));
    }
    if (connectingState) {
      connectingState.fromIds.forEach((id) => ids.add(id));
      ids.add(connectingState.fromId);
    }
    canvasSearchNodeIds.forEach((id) => ids.add(id));
    return ids;
  }, [
    canvasSearchNodeIds,
    connectingState,
    dragState,
    dragTargetNodeId,
    editingNodeId,
    hoveredNodeId,
    selection,
  ]);
  const sceneInteractiveEdgeIds = useMemo(() => {
    const ids = new Set<string>();
    if (selection.kind === 'edge') {
      selection.ids.forEach((id) => ids.add(id));
    }
    if (editingEdgeId) {
      ids.add(editingEdgeId);
    }
    if (dragTargetEdgeId) {
      ids.add(dragTargetEdgeId);
    }
    // While dragging nodes/subgraphs, keep incident edges on the live overlay
    // so geometry tracks preview positions every frame (not only on pointerup).
    if (dragState && dragState.kind !== 'content') {
      const moving = new Set(dragState.ids);
      if (dragState.kind === 'subgraph' && dragState.entityId) {
        moving.add(dragState.entityId);
      }
      documentState.edges.forEach((edge) => {
        if (moving.has(edge.from) || moving.has(edge.to)) {
          ids.add(edge.id);
        }
      });
    }
    return ids;
  }, [documentState.edges, dragState, dragTargetEdgeId, editingEdgeId, selection]);
  // Full topology canvas sources (exclude only interactive overlay entities) — not viewport-pre-culled.
  const topologyCanvasNodes = useMemo(
    () => (
      hybridSceneActive
        ? visibleNodes.filter((node) => !sceneInteractiveNodeIds.has(node.id))
        : []
    ),
    [hybridSceneActive, sceneInteractiveNodeIds, visibleNodes],
  );
  const topologyCanvasEdges = useMemo(
    () => (
      hybridSceneActive
        ? topologySceneEdges
          .filter((entry) => !sceneInteractiveEdgeIds.has(entry.edge.id))
          .map((entry) => ({
            ...entry,
            id: entry.edge.id,
            bounds: buildEdgeApproxBounds(entry.fromEndpoint, entry.toEndpoint, 72),
          }))
        : []
    ),
    [hybridSceneActive, sceneInteractiveEdgeIds, topologySceneEdges],
  );
  hybridPaintTopologyRef.current = {
    nodes: topologyCanvasNodes,
    edges: topologyCanvasEdges,
  };
  // Viewport-culled lists for React overlay chrome under committed viewport (not live pan paint).
  const sceneCanvasNodes = useMemo(
    () => (
      hybridSceneActive
        ? sceneRenderableNodes.filter((node) => !sceneInteractiveNodeIds.has(node.id))
        : []
    ),
    [hybridSceneActive, sceneInteractiveNodeIds, sceneRenderableNodes],
  );
  const sceneOverlayNodes = useMemo(
    () => (
      hybridSceneActive
        ? sceneRenderableNodes.filter((node) => sceneInteractiveNodeIds.has(node.id))
        : sceneRenderableNodes
    ),
    [hybridSceneActive, sceneInteractiveNodeIds, sceneRenderableNodes],
  );
  const sceneCanvasEdges = useMemo(
    () => (
      hybridSceneActive
        ? sceneRenderableEdges.filter((entry) => !sceneInteractiveEdgeIds.has(entry.edge.id))
        : []
    ),
    [hybridSceneActive, sceneInteractiveEdgeIds, sceneRenderableEdges],
  );
  const sceneOverlayEdges = useMemo(
    () => (
      hybridSceneActive
        ? sceneRenderableEdges.filter((entry) => sceneInteractiveEdgeIds.has(entry.edge.id)).map((entry) => entry.edge)
        : sceneRenderableEdges.map((entry) => entry.edge)
    ),
    [hybridSceneActive, sceneInteractiveEdgeIds, sceneRenderableEdges],
  );
  perfSnapshotRef.current = {
    ...perfSnapshotRef.current,
    canvasNodeCount: sceneCanvasNodes.length,
    canvasEdgeCount: sceneCanvasEdges.length,
    overlayNodeCount: sceneOverlayNodes.length,
    overlayEdgeCount: sceneOverlayEdges.length,
  };

  useEffect(() => {
    const canvas = sceneCanvasRef.current;
    const surface = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    if (!surface || mode !== 'canvas' || !hybridSceneActive) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const surfaceBounds = surface.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetWidth = Math.max(1, Math.floor(surfaceBounds.width * dpr));
    const targetHeight = Math.max(1, Math.floor(surfaceBounds.height * dpr));

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    measurePerf('renderSceneCanvas', () => {
      hotPathCounters.fullCanvasClearPaint += 1;
      const viewport = liveViewportRef.current;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = true;
      context.translate(viewport.x, viewport.y);
      context.scale(viewport.zoom, viewport.zoom);

      const surfaceBounds = surface.getBoundingClientRect();
      const worldRect = viewportToWorldRect(
        viewport as HotPathViewport,
        surfaceBounds.width,
        surfaceBounds.height,
        HYBRID_SCENE_VIEWPORT_MARGIN_PX,
      );
      // Paint from full topology sources + live cull (same path as imperative pan).
      const paintSource = hybridPaintTopologyRef.current;
      const edgesToDraw = selectPaintEdgesFromTopology(paintSource.edges, worldRect);
      const nodesToDraw = selectPaintNodesFromTopology(paintSource.nodes, worldRect);

      edgesToDraw.forEach((entry) => {
        drawCanvasEdge(context, entry, viewport.zoom);
      });
      nodesToDraw.forEach((node) => {
        drawCanvasNode(context, node, viewport.zoom);
      });
    });
  }, [
    // Topology/overlay inputs — continuous pan/zoom paint via applyImperativeViewportTransform.
    topologyRevision,
    topologyCanvasNodes,
    topologyCanvasEdges,
    hybridSceneActive,
    measurePerf,
    mode,
  ]);

  const graphTreeItems = useMemo(
    () =>
      buildGraphTreeItems(
        documentState.subgraphs,
        documentState.nodes,
        fullSubgraphLookup,
        allSubgraphFrameMap,
        searchQuery,
      ),
    [allSubgraphFrameMap, documentState.nodes, documentState.subgraphs, fullSubgraphLookup, searchQuery],
  );
  const activeTab = workspaceTabs.find((tab) => tab.id === activeFileTab) ?? workspaceTabs[0];
  const localExplorerItemMap = useMemo(
    () => new Map(localExplorerItems.map((item) => [item.id, item])),
    [localExplorerItems],
  );
  const cloudExplorerItems = useMemo<ExplorerItem[]>(
    () => [
      {
        id: 'cloud-project',
        label: 'product-graph-platform',
        meta: '云端 Git 工程',
        depth: 0,
        kind: 'project',
        path: 'cloud://projects/product-graph-platform',
      },
      {
        id: 'cloud-docs',
        label: 'docs',
        meta: '云端路径 / 已跟踪',
        depth: 1,
        kind: 'folder',
        path: 'cloud://projects/product-graph-platform/docs',
      },
      {
        id: 'cloud-diagram',
        label: 'diagram.lmd',
        meta: `${documentState.nodes.length} 节点 / ${documentState.edges.length} 连线`,
        depth: 2,
        kind: 'file',
        path: 'cloud://projects/product-graph-platform/docs/diagram.lmd',
        tabId: 'diagram',
        mode: 'canvas',
      },
    ],
    [documentState.edges.length, documentState.nodes.length],
  );
  const activeCloudPath = useMemo(() => {
      const activeItem = cloudExplorerItems.find((item) => item.tabId === activeFileTab);
      return activeItem?.path ?? 'cloud://projects/product-graph-platform/docs/diagram.lmd';
  }, [activeFileTab, cloudExplorerItems]);
  const activeLocalPath = useMemo(() => {
    const activeItem = activeLocalExplorerItemId
      ? localExplorerItems.find((item) => item.id === activeLocalExplorerItemId)
      : localExplorerItems.find((item) => item.id === activeLocalFileId) ??
        localExplorerItems.find((item) => item.kind === 'project');
    return activeItem?.path ?? 'No local project opened';
  }, [activeLocalExplorerItemId, activeLocalFileId, localExplorerItems]);
  const activeProjectPath = activeWorkspaceSource === 'cloud' ? activeCloudPath : activeLocalPath;
  const activeLocalItem = useMemo(
    () => (activeLocalExplorerItemId ? localExplorerItemMap.get(activeLocalExplorerItemId) ?? null : null),
    [activeLocalExplorerItemId, localExplorerItemMap],
  );
  const localBreadcrumbItems = useMemo(() => {
    if (!activeLocalDirectoryId) {
      return [];
    }

    const chain: ExplorerItem[] = [];
    let currentId: string | null = activeLocalDirectoryId;
    while (currentId) {
      const item = localExplorerItemMap.get(currentId);
      if (!item) {
        break;
      }
      chain.unshift(item);
      currentId = item.parentId ?? null;
    }
    return chain;
  }, [activeLocalDirectoryId, localExplorerItemMap]);
  const localDirectoryEntries = useMemo(() => {
    if (!activeLocalDirectoryId) {
      return [];
    }

    return localExplorerItems
      .filter((item) => item.parentId === activeLocalDirectoryId)
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          if (left.kind === 'folder') {
            return -1;
          }
          if (right.kind === 'folder') {
            return 1;
          }
        }
        return left.label.localeCompare(right.label);
      });
  }, [activeLocalDirectoryId, localExplorerItems]);
  const applyCommittedDocument = useCallback((
    nextDocument: GraphDocument,
    title: string,
    detail: string,
    previousDocument: GraphDocument = documentRef.current,
    options?: {
      recordUndo?: boolean;
      recordHistory?: boolean;
    },
  ) => {
    const recordUndo = options?.recordUndo ?? true;
    const recordHistory = options?.recordHistory ?? true;
    const nextRevision = documentRevisionRef.current + 1;
    documentRevisionRef.current = nextRevision;
    documentRef.current = nextDocument;
    setDocumentRevision(nextRevision);
    if (recordUndo) {
      setUndoStack((current) => [...current.slice(-39), structuredClone(previousDocument)]);
    }
    setRedoStack([]);
    setSaveStatus('saving');
    setDocumentState(nextDocument);
    setSourceDraft(nextDocument.markdown ?? nextDocument.source);
    if (recordHistory) {
      setHistory((current) => [createHistoryEntry(title, detail), ...current].slice(0, 40));
    }
  }, []);

  const restoreDocumentSnapshot = useCallback((
    snapshot: GraphDocument,
    title: string,
    detail: string,
  ) => {
    const nextRevision = documentRevisionRef.current + 1;
    documentRevisionRef.current = nextRevision;
    documentRef.current = snapshot;
    setDocumentRevision(nextRevision);
    setSaveStatus('saving');
    setDocumentState(snapshot);
    setSourceDraft(snapshot.markdown ?? snapshot.source);
    setHistory((current) => [createHistoryEntry(title, detail), ...current].slice(0, 40));
  }, []);

  const commitDocument = useCallback((
    updater: (current: GraphDocument) => GraphDocument,
    title: string,
    detail: string,
  ) => {
    const currentDocument = structuredClone(documentRef.current);
    const nextDocument = materializeDocument(updater(structuredClone(currentDocument)));
    applyCommittedDocument(nextDocument, title, detail, currentDocument);
  }, [applyCommittedDocument]);

  const commitSourceDraft = useCallback(() => {
    const currentDocument = structuredClone(documentRef.current);
    if (sourceDraft === (currentDocument.markdown ?? currentDocument.source)) {
      return;
    }

    try {
      const parsed = parseProjectMarkdown(
        sourceDraft,
        currentDocument.projectName ?? 'Untitled Project',
        currentDocument.layout,
      );
      const nextDocument = materializeDocument(parsed);
      applyCommittedDocument(
        nextDocument,
        '已更新源码',
        '已在源码模式提交当前修改。',
        currentDocument,
      );
    } catch {
      setSaveStatus('error');
    }
  }, [applyCommittedDocument, sourceDraft]);

  const standardizeCurrentProject = useCallback(() => {
    const fallbackName = (
      activeLocalItem?.kind === 'file'
        ? activeLocalItem.label.replace(/\.(?:lmd|md)$/i, '')
        : documentRef.current.projectName
    ) ?? 'Untitled Project';
    const rawMarkdown = (sourceDraft || documentRef.current.markdown || '').trim();
    if (!rawMarkdown) {
      return;
    }

    try {
      const nextDocument = materializeDocument(
        standardizeProjectMarkdown(
          rawMarkdown,
          fallbackName,
          documentRef.current.layout,
        ),
      );
      applyCommittedDocument(
        nextDocument,
        '已标准化工程',
        '已将当前 Markdown 统一为单文件工程格式。',
        documentRef.current,
      );
    } catch {
      setSaveStatus('error');
    }
  }, [activeLocalItem, applyCommittedDocument, sourceDraft]);

  const loadStressTestProject = useCallback(() => {
    const confirmed = window.confirm(`加载压力测试工程（${defaultStressTestProjectLabel}）？这会替换当前工作区内容。`);
    if (!confirmed) {
      return;
    }

    try {
      const currentDocument = structuredClone(documentRef.current);
      const markdown = createStressTestProjectMarkdown();
      const nextDocument = materializeDocument(
        parseProjectMarkdown(markdown, 'LMD Stress Test Workspace', createDefaultLayout()),
      );

      applyCommittedDocument(
        nextDocument,
        '已加载压力测试工程',
        `已生成并载入 ${defaultStressTestProjectLabel} 的压力测试图。`,
        currentDocument,
      );

      setSelection({ kind: 'none', ids: [] });
      setSearchQuery('');
      setEditingNodeId(null);
      setEditingNodeField('title');
      setEditingLabel('');
      setMode('canvas');
    } catch {
      setSaveStatus('error');
    }
  }, [applyCommittedDocument]);

  const selectSingle = useCallback((
    kind: Exclude<SelectionState['kind'], 'none'>,
    id: string,
    toggle = false,
  ) => {
    setSelection((current) => (toggle ? toggleSelectionIds(current, kind, [id]) : { kind, ids: [id] }));
  }, []);

  const rememberSubgraphBadgeAnchor = useCallback((subgraphId: string, point: Point) => {
    const shape = allSubgraphBlobShapeMap.get(subgraphId) ?? subgraphBlobShapeMap.get(subgraphId);
    if (!shape) {
      return;
    }

    setSubgraphBadgeAnchors((current) => ({
      ...current,
      [subgraphId]: {
        offsetX: clamp(point.x - shape.bounds.x, 12, Math.max(shape.bounds.width - 12, 12)),
        offsetY: clamp(point.y - shape.bounds.y, 12, Math.max(shape.bounds.height - 12, 12)),
      },
    }));
  }, [allSubgraphBlobShapeMap, subgraphBlobShapeMap]);

  const selectSubgraphAtPoint = useCallback((
    subgraphId: string,
    point: Point,
    toggle = false,
  ) => {
    rememberSubgraphBadgeAnchor(subgraphId, point);
    setSelection((current) => (
      toggle
        ? toggleSelectionIds(current, 'subgraph', [subgraphId])
        : { kind: 'subgraph', ids: [subgraphId] }
    ));
  }, [rememberSubgraphBadgeAnchor]);

  const selectConnectedNodeComponent = useCallback((nodeId: string) => {
    const connectedIds = getConnectedNodeCluster(documentState, nodeId);
    setSelection({
      kind: 'node',
      ids: connectedIds.length > 0 ? connectedIds : [nodeId],
    });
  }, [documentState]);

  const clearSelection = useCallback(() => {
    setSelection({ kind: 'none', ids: [] });
  }, []);

  const startInlineEdit = useCallback((node: GraphNode, field: InlineNodeField = 'title') => {
    const currentParts = splitEntityText(node.label);
    const preferredField: InlineNodeField = isPlaceholderNodeTitle(currentParts.title) ? 'title' : field;
    const draftLabel = ensureInlineEntityFieldValue(node.label, preferredField);
    setEditingNodeId(node.id);
    setEditingNodeField(preferredField);
    setEditingLabel(draftLabel);
    setEditingNodeSelectAll(
      shouldSelectAllInlineNodeField(
        getInlineEntityFieldValue(draftLabel, preferredField),
        preferredField,
      ),
    );
    setSelection({ kind: 'node', ids: [node.id] });
  }, []);

  const updateEditingNodeFieldValue = useCallback((field: InlineNodeField, nextValue: string) => {
    setEditingLabel((current) => setInlineEntityFieldValue(current, field, nextValue));
  }, []);

  const persistInlineNodeDraft = useCallback((
    nodeId: string,
    options?: {
      closeEditor?: boolean;
      historyTitle?: string;
      historyDetail?: string;
      preserveIdentity?: boolean;
      recordUndo?: boolean;
      recordHistory?: boolean;
    },
  ) => {
    const closeEditor = options?.closeEditor ?? false;
    const historyTitle = options?.historyTitle ?? '已暂存节点';
    const historyDetail = options?.historyDetail ?? '已暂存当前节点编辑草稿。';
    const preserveIdentity = options?.preserveIdentity ?? !closeEditor;
    const recordUndo = options?.recordUndo ?? closeEditor;
    const recordHistory = options?.recordHistory ?? closeEditor;
    const currentDocument = structuredClone(documentRef.current);
    const currentNode = currentDocument.nodes.find((node) => node.id === nodeId);
    if (!currentNode) {
      if (closeEditor) {
        setEditingNodeId(null);
        setEditingNodeField('title');
        setEditingNodeSelectAll(false);
        setEditingLabel('');
      }
      return;
    }

    const { title, description } = splitEntityText(editingLabelRef.current);
    const nextLabel = composeEntityText(title, description);
    const nextId = preserveIdentity
      ? currentNode.id
      : nextNodeId(currentDocument.nodes, title || '未命名内容', nodeId);
    const changed = currentNode.label !== nextLabel || currentNode.id !== nextId;

    if (changed) {
      const nextDocument = materializeDocument(
        {
          ...currentDocument,
          nodes: currentDocument.nodes.map((node) =>
            node.id === nodeId
              ? {
                  ...resizeNodeToContent(node, title, description),
                  id: nextId,
                }
              : node,
          ),
          edges: currentDocument.edges.map((edge) => ({
            ...edge,
            from: edge.from === nodeId ? nextId : edge.from,
            to: edge.to === nodeId ? nextId : edge.to,
          })),
        },
        preserveIdentity ? { preserveNodeIds: [nodeId] } : undefined,
      );
      applyCommittedDocument(nextDocument, historyTitle, historyDetail, currentDocument, {
        recordUndo,
        recordHistory,
      });
      if (!preserveIdentity) {
        setSelection((current) => (
          current.kind === 'node'
            ? {
                kind: 'node',
                ids: current.ids.map((id) => (id === nodeId ? nextId : id)),
                ...(current.subgraphIds?.length
                  ? { subgraphIds: [...current.subgraphIds] }
                  : {}),
              }
            : current
        ));
      }
      if (!closeEditor && !preserveIdentity) {
        setEditingNodeId(nextId);
        setEditingLabel(nextLabel);
      }
    }

    if (closeEditor) {
      setEditingNodeId(null);
      setEditingNodeField('title');
      setEditingNodeSelectAll(false);
      setEditingLabel('');
      return;
    }

    setEditingNodeSelectAll(false);
  }, [applyCommittedDocument]);

  const commitInlineEdit = useCallback((nodeId: string) => {
    persistInlineNodeDraft(nodeId, {
      closeEditor: true,
      historyTitle: '已更新节点',
      historyDetail: `已更新 ${nodeId} 的节点内容。`,
    });
  }, [persistInlineNodeDraft]);

  const startEdgeInlineEdit = useCallback((edge: GraphEdge) => {
    setEditingEdgeId(edge.id);
    setEditingEdgeLabel(edge.label);
    setSelection({ kind: 'edge', ids: [edge.id] });
  }, []);

  const commitEdgeInlineEdit = useCallback((edgeId: string) => {
    commitDocument(
      (current) => ({
        ...current,
        edges: current.edges.map((edge) =>
          edge.id === edgeId
            ? { ...edge, label: editingEdgeLabel }
            : edge,
        ),
      }),
      '已更新连线',
      `已更新 ${edgeId} 的连线标签。`,
    );

    setEditingEdgeId(null);
    setEditingEdgeLabel('');
  }, [commitDocument, editingEdgeLabel]);

  const clearPendingBackgroundInteraction = useCallback(() => {
    if (backgroundHoldRef.current !== null) {
      window.clearTimeout(backgroundHoldRef.current);
      backgroundHoldRef.current = null;
    }
    pendingBackgroundRef.current = null;
  }, []);

  const toggleLeftPanel = useCallback((nextPanel: LeftPanel) => {
    setInspectorOpen(false);
    setMobileSourcePreviewOpen(false);
    setLeftPanel((current) => {
      const samePanel = current === nextPanel;
      setSidebarOpen((isOpen) => (samePanel ? !isOpen : true));
      return samePanel ? current : nextPanel;
    });
  }, []);

  const toggleInspector = useCallback(() => {
    setSidebarOpen(false);
    setMobileSourcePreviewOpen(false);
    setInspectorOpen((current) => !current);
  }, []);

  const openInspectorView = useCallback((nextView: InspectorView) => {
    setSidebarOpen(false);
    setMobileSourcePreviewOpen(false);
    setInspectorView(nextView);
    setInspectorOpen(true);
  }, []);

  const applyImperativeViewportTransform = useCallback((viewport: ViewportState) => {
    liveViewportRef.current = viewport;
    hotPathCounters.viewportLiveApplies += 1;
    // Keep document ref layout in sync for hit-tests / commits without React re-derive.
    if (documentRef.current.layout.viewport !== viewport) {
      documentRef.current = {
        ...documentRef.current,
        layout: {
          ...documentRef.current.layout,
          viewport,
        },
      };
    }

    const board = canvasBoardRef.current;
    if (board) {
      const bounds = canvasBoardBounds;
      board.style.transform =
        `translate(${viewport.x + bounds.x * viewport.zoom}px, ${viewport.y + bounds.y * viewport.zoom}px) scale(${viewport.zoom})`;
    }

    const canvas = sceneCanvasRef.current;
    const surface = canvasRef.current;
    if (!canvas || !surface || !hybridSceneActive || mode !== 'canvas') {
      return;
    }

    if (viewportPaintFrameRef.current !== null) {
      return;
    }

    viewportPaintFrameRef.current = window.requestAnimationFrame(() => {
      viewportPaintFrameRef.current = null;
      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }

      const liveViewport = liveViewportRef.current;
      const surfaceBounds = surface.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetWidth = Math.max(1, Math.floor(surfaceBounds.width * dpr));
      const targetHeight = Math.max(1, Math.floor(surfaceBounds.height * dpr));
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      hotPathCounters.incrementalPaint += 1;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = true;
      context.translate(liveViewport.x, liveViewport.y);
      context.scale(liveViewport.zoom, liveViewport.zoom);

      // CRITICAL: cull from FULL topology paint source + live world rect.
      // Never iterate a viewport-pre-culled React list (stale during pan).
      const worldRect = viewportToWorldRect(
        liveViewport as HotPathViewport,
        surfaceBounds.width,
        surfaceBounds.height,
        HYBRID_SCENE_VIEWPORT_MARGIN_PX,
      );
      const paintSource = hybridPaintTopologyRef.current;
      const nodesToDraw = selectPaintNodesFromTopology(paintSource.nodes, worldRect);
      const edgesToDraw = selectPaintEdgesFromTopology(paintSource.edges, worldRect);

      edgesToDraw.forEach((entry) => {
        drawCanvasEdge(context, entry, liveViewport.zoom);
      });
      nodesToDraw.forEach((node) => {
        drawCanvasNode(context, node, liveViewport.zoom);
      });
    });
  }, [
    canvasBoardBounds.x,
    canvasBoardBounds.y,
    canvasBoardBounds.width,
    canvasBoardBounds.height,
    hybridSceneActive,
    mode,
  ]);

  const commitLiveViewportToDocument = useCallback(() => {
    const next = liveViewportRef.current;
    panCommitNeededRef.current = false;
    if (viewportCommitTimerRef.current !== null) {
      window.clearTimeout(viewportCommitTimerRef.current);
      viewportCommitTimerRef.current = null;
    }
    setDocumentState((current) => {
      if (
        current.layout.viewport.x === next.x &&
        current.layout.viewport.y === next.y &&
        current.layout.viewport.zoom === next.zoom
      ) {
        return current;
      }
      hotPathCounters.viewportDocumentCommits += 1;
      return {
        ...current,
        layout: {
          ...current.layout,
          viewport: { ...next },
        },
      };
    });
  }, []);

  /** Continuous interaction (wheel/pan): live transform only; debounced document commit. */
  const applyLiveViewportUpdate = useCallback(
    (updater: (viewport: ViewportState) => ViewportState) => {
      const next = updater(liveViewportRef.current);
      panCommitNeededRef.current = true;
      applyImperativeViewportTransform(next);
      if (viewportCommitTimerRef.current !== null) {
        window.clearTimeout(viewportCommitTimerRef.current);
      }
      viewportCommitTimerRef.current = window.setTimeout(() => {
        viewportCommitTimerRef.current = null;
        commitLiveViewportToDocument();
      }, 140);
    },
    [applyImperativeViewportTransform, commitLiveViewportToDocument],
  );

  /** Discrete viewport changes (toolbar fit/zoom buttons): commit immediately. */
  const updateViewport = useCallback(
    (updater: (viewport: ViewportState) => ViewportState) => {
      const base = liveViewportRef.current;
      const next = updater(base);
      liveViewportRef.current = next;
      hotPathCounters.viewportDocumentCommits += 1;
      setDocumentState((current) => ({
        ...current,
        layout: {
          ...current.layout,
          viewport: next,
        },
      }));
    },
    [],
  );

  const resetWorkbenchScrollOffsets = useCallback(() => {
    const resetElementScroll = (element: HTMLElement | null) => {
      if (!element) {
        return;
      }

      if (element.scrollLeft !== 0 || element.scrollTop !== 0) {
        element.scrollLeft = 0;
        element.scrollTop = 0;
      }
    };

    resetElementScroll(workspaceRef.current);
    resetElementScroll(workspaceMainRef.current);
    resetElementScroll(canvasRef.current);
    resetElementScroll(document.scrollingElement as HTMLElement | null);
    resetElementScroll(document.documentElement);
    resetElementScroll(document.body);

    if (window.scrollX !== 0 || window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
  }, []);

  const pointFromClient = useCallback(
    (
      clientX: number,
      clientY: number,
      // Default MUST be live viewport — document lag after wheel/pan blanks hit-tests.
      viewport: ViewportState = resolveInteractionViewport(
        liveViewportRef.current as HotPathViewport,
      ),
    ) => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds) {
        return null;
      }

      return clientToWorldPoint(clientX, clientY, bounds, viewport as HotPathViewport);
    },
    [],
  );

  const keepNodeEditorVisibleInCanvas = useCallback((rect: Rect) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    const viewport = documentRef.current.layout.viewport;
    const marginX = 28;
    const marginY = 24;
    const left = viewport.x + rect.x * viewport.zoom;
    const top = viewport.y + rect.y * viewport.zoom;
    const width = rect.width * viewport.zoom;
    const height = rect.height * viewport.zoom;
    const right = left + width;
    const bottom = top + height;

    let nextX = viewport.x;
    let nextY = viewport.y;

    if (right > bounds.width - marginX) {
      nextX -= right - (bounds.width - marginX);
    }
    if (left < marginX) {
      nextX += marginX - left;
    }
    if (bottom > bounds.height - marginY) {
      nextY -= bottom - (bounds.height - marginY);
    }
    if (top < marginY) {
      nextY += marginY - top;
    }

    if (nextX !== viewport.x || nextY !== viewport.y) {
      updateViewport(() => ({
        ...viewport,
        x: nextX,
        y: nextY,
      }));
    }
  }, [updateViewport]);

  const zoomViewportAtPoint = useCallback(
    (clientX: number, clientY: number, zoomFactor: number, options?: { commit?: 'live' | 'document' }) => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      const mode = options?.commit ?? 'live';
      const apply = mode === 'document' ? updateViewport : applyLiveViewportUpdate;
      apply((viewport) => {
        const pointerX = clientX - bounds.left;
        const pointerY = clientY - bounds.top;
        return applyWheelZoomViewport(
          viewport as HotPathViewport,
          { x: pointerX, y: pointerY },
          zoomFactor,
          MIN_CANVAS_ZOOM,
          MAX_CANVAS_ZOOM,
        );
      });
    },
    [applyLiveViewportUpdate, updateViewport],
  );

  const focusViewportOnRect = useCallback(
    (
      rect: { x: number; y: number; width: number; height: number } | null,
      anchorY = 0.5,
    ) => {
      if (!rect) {
        return;
      }

      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      updateViewport((viewport) => {
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        const targetX = bounds.width / 2;
        const targetY = bounds.height * anchorY;

        return {
          ...viewport,
          x: targetX - centerX * viewport.zoom,
          y: targetY - centerY * viewport.zoom,
        };
      });
    },
    [updateViewport],
  );

  const centerViewportOnWorldPoint = useCallback((point: Point) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    updateViewport((viewport) => ({
      ...viewport,
      x: bounds.width / 2 - point.x * viewport.zoom,
      y: bounds.height / 2 - point.y * viewport.zoom,
    }));
  }, [updateViewport]);

  const focusCanvasSearchResult = useCallback((result: CanvasSearchResult | null) => {
    if (!result) {
      return;
    }

    setMode('canvas');
    setSelection({ kind: result.kind, ids: [result.id] });
    focusViewportOnRect(result.rect, isMobileViewport ? 0.3 : 0.48);
  }, [focusViewportOnRect, isMobileViewport]);

  const focusCanvasSearchMatches = useCallback((results: CanvasSearchResult[]) => {
    if (results.length === 0) {
      return;
    }

    const bounds = results.reduce((accumulator, item) => {
      const maxX = Math.max(accumulator.x + accumulator.width, item.rect.x + item.rect.width);
      const maxY = Math.max(accumulator.y + accumulator.height, item.rect.y + item.rect.height);
      const minX = Math.min(accumulator.x, item.rect.x);
      const minY = Math.min(accumulator.y, item.rect.y);
      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    }, {
      x: results[0].rect.x,
      y: results[0].rect.y,
      width: results[0].rect.width,
      height: results[0].rect.height,
    });

    focusViewportOnRect({
      x: bounds.x - 36,
      y: bounds.y - 28,
      width: bounds.width + 72,
      height: bounds.height + 56,
    }, isMobileViewport ? 0.3 : 0.46);
  }, [focusViewportOnRect, isMobileViewport]);

  const focusSelectionInViewport = useCallback(() => {
    if (mode !== 'canvas') {
      return;
    }

    const anchorY = isMobileViewport ? 0.28 : 0.5;

    if (selection.kind === 'node' && selection.ids.length === 1) {
      const node = documentState.nodes.find((entry) => entry.id === selection.ids[0]) ?? null;
      if (node) {
        focusViewportOnRect(node, anchorY);
      }
      return;
    }

    if (selection.kind === 'subgraph' && selection.ids.length === 1) {
      focusViewportOnRect(allSubgraphFrameMap.get(selection.ids[0]) ?? null, anchorY);
      return;
    }

    if (selection.kind === 'content') {
      return;
    }

    if (selection.kind === 'edge' && selection.ids.length === 1) {
      const edge = documentState.edges.find((entry) => entry.id === selection.ids[0]) ?? null;
      if (!edge) {
        return;
      }

      const liveFrames = buildSubgraphFrames(documentState, documentState.nodes);
      const liveEndpoints: EdgeEndpointBox[] = [
        ...documentState.nodes.map((node) => ({
          id: node.id,
          kind: 'node' as const,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          fill: node.fill,
          stroke: node.stroke,
          textColor: node.textColor,
        })),
        ...liveFrames.map((frame) => {
          const style = getSubgraphStyle(documentState.subgraphs.find((entry) => entry.id === frame.id));
          return {
            id: frame.id,
            kind: 'subgraph' as const,
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            fill: style.fill,
            stroke: style.stroke,
            textColor: style.textColor,
          };
        }),
      ];
      const liveEndpointMap = new Map<string, EdgeEndpointBox>(
        liveEndpoints.map((entry) => [entry.id, entry] as const),
      );
      const fromNode = liveEndpointMap.get(edge.from) ?? null;
      const toNode = liveEndpointMap.get(edge.to) ?? null;
      if (!fromNode || !toNode) {
        return;
      }

      const fromCenter = {
        x: fromNode.x + fromNode.width / 2,
        y: fromNode.y + fromNode.height / 2,
      };
      const toCenter = {
        x: toNode.x + toNode.width / 2,
        y: toNode.y + toNode.height / 2,
      };

      focusViewportOnRect(
        {
          x: Math.min(fromCenter.x, toCenter.x) - 56,
          y: Math.min(fromCenter.y, toCenter.y) - 44,
          width: Math.max(120, Math.abs(fromCenter.x - toCenter.x) + 112),
          height: Math.max(80, Math.abs(fromCenter.y - toCenter.y) + 88),
        },
        anchorY,
      );
    }
  }, [
    allSubgraphFrameMap,
    documentState,
    focusViewportOnRect,
    isMobileViewport,
    mode,
    selection,
  ]);

  const focusAiChangeTarget = useCallback((bubble: AiChangeBubble) => {
    setMode('canvas');
    setInspectorView('properties');
    if (!inspectorOpen) {
      setInspectorOpen(true);
    }

    if (bubble.kind === 'project') {
      setSelection({ kind: 'none', ids: [] });
      dismissAiChangeBubble(bubble.id);
      return;
    }

    if (bubble.kind === 'content') {
      setSelection({ kind: 'content', ids: [CONTENT_CARD_ID] });
      dismissAiChangeBubble(bubble.id);
      return;
    }

    if (bubble.kind === 'node' && bubble.targetId) {
      const target = documentRef.current.nodes.find((node) => node.id === bubble.targetId);
      if (target) {
        setSelection({ kind: 'node', ids: [target.id] });
        focusViewportOnRect(target, isMobileViewport ? 0.3 : 0.48);
      }
      dismissAiChangeBubble(bubble.id);
      return;
    }

    if (bubble.kind === 'subgraph' && bubble.targetId) {
      setSelection({ kind: 'subgraph', ids: [bubble.targetId] });
      focusViewportOnRect(allSubgraphFrameMap.get(bubble.targetId) ?? null, isMobileViewport ? 0.3 : 0.48);
      dismissAiChangeBubble(bubble.id);
      return;
    }

    if (bubble.kind === 'edge' && bubble.targetId) {
      setSelection({ kind: 'edge', ids: [bubble.targetId] });
      dismissAiChangeBubble(bubble.id);
      return;
    }

    dismissAiChangeBubble(bubble.id);
  }, [
    allSubgraphFrameMap,
    dismissAiChangeBubble,
    focusViewportOnRect,
    inspectorOpen,
    isMobileViewport,
  ]);

  const moveViewportFromMiniMapRect = useCallback((miniX: number, miniY: number) => {
    if (!miniMapModel?.viewport || !miniMapModel.viewportWorldRect) {
      return;
    }

    const unclampedMiniX = clamp(miniX, -miniMapModel.viewport.width, miniMapModel.width);
    const unclampedMiniY = clamp(miniY, -miniMapModel.viewport.height, miniMapModel.height);
    const proposedWorldLeft =
      (unclampedMiniX - miniMapModel.offsetX) / miniMapModel.scale + miniMapModel.worldBounds.x;
    const proposedWorldTop =
      (unclampedMiniY - miniMapModel.offsetY) / miniMapModel.scale + miniMapModel.worldBounds.y;
    const viewportWorld = miniMapModel.viewportWorldRect;
    const navigationBounds = miniMapModel.navigationBounds;
    const maxWorldLeft = navigationBounds.x + navigationBounds.width - viewportWorld.width;
    const maxWorldTop = navigationBounds.y + navigationBounds.height - viewportWorld.height;
    const worldLeft =
      maxWorldLeft >= navigationBounds.x
        ? clamp(proposedWorldLeft, navigationBounds.x, maxWorldLeft)
        : navigationBounds.x + navigationBounds.width / 2 - viewportWorld.width / 2;
    const worldTop =
      maxWorldTop >= navigationBounds.y
        ? clamp(proposedWorldTop, navigationBounds.y, maxWorldTop)
        : navigationBounds.y + navigationBounds.height / 2 - viewportWorld.height / 2;

    updateViewport((viewport) => ({
      ...viewport,
      x: -worldLeft * viewport.zoom,
      y: -worldTop * viewport.zoom,
    }));
  }, [miniMapModel, updateViewport]);

  const beginMiniMapInteraction = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (!miniMapModel) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setMode('canvas');

    const bounds = event.currentTarget.getBoundingClientRect();
    const localX = clamp(event.clientX - bounds.left, 0, miniMapModel.width);
    const localY = clamp(event.clientY - bounds.top, 0, miniMapModel.height);
    const viewportRect = miniMapModel.viewport;
    const viewportHit = viewportRect
      ? localX >= viewportRect.x &&
        localX <= viewportRect.x + viewportRect.width &&
        localY >= viewportRect.y &&
        localY <= viewportRect.y + viewportRect.height
      : false;

    if (viewportHit && viewportRect) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setMiniMapDragState({
        pointerId: event.pointerId,
        grabOffsetX: localX - viewportRect.x,
        grabOffsetY: localY - viewportRect.y,
      });
      return;
    }

    const worldX = (localX - miniMapModel.offsetX) / miniMapModel.scale + miniMapModel.worldBounds.x;
    const worldY = (localY - miniMapModel.offsetY) / miniMapModel.scale + miniMapModel.worldBounds.y;
    centerViewportOnWorldPoint({ x: worldX, y: worldY });
  }, [centerViewportOnWorldPoint, miniMapModel]);

  const updateMiniMapInteraction = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (!miniMapModel || !miniMapDragState || miniMapDragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const localX = clamp(event.clientX - bounds.left, 0, miniMapModel.width);
    const localY = clamp(event.clientY - bounds.top, 0, miniMapModel.height);
    moveViewportFromMiniMapRect(
      localX - miniMapDragState.grabOffsetX,
      localY - miniMapDragState.grabOffsetY,
    );
  }, [miniMapDragState, miniMapModel, moveViewportFromMiniMapRect]);

  const endMiniMapInteraction = useCallback((event?: ReactPointerEvent<SVGSVGElement>) => {
    if (event && miniMapDragState && event.currentTarget.hasPointerCapture(miniMapDragState.pointerId)) {
      event.currentTarget.releasePointerCapture(miniMapDragState.pointerId);
    }
    setMiniMapDragState(null);
  }, [miniMapDragState]);

  const handleMobileInspectorToggle = useCallback(() => {
    if (mode === 'source') {
      setMobileSourcePreviewOpen((current) => !current);
      return;
    }

    if (!inspectorOpen) {
      focusSelectionInViewport();
    }

    toggleInspector();
  }, [focusSelectionInViewport, inspectorOpen, mode, toggleInspector]);

  const applyNodeInspectorDraft = useCallback((
    draft: NodeInspectorDraft = nodeInspectorDraft,
    targetIds: string[] = selection.kind === 'node' ? selection.ids : [],
  ) => {
    if (targetIds.length === 0) {
      return;
    }

    const ids = new Set(targetIds);
    const applyTextContent = targetIds.length === 1;
    commitDocument(
      (current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          ids.has(node.id)
            ? resizeNodeToContent(
              {
                ...node,
                shape: draft.shape,
                fill: draft.fill,
                stroke: draft.stroke,
                textColor: draft.textColor,
              },
              applyTextContent ? draft.label : splitEntityText(node.label).title,
              applyTextContent ? draft.description : splitEntityText(node.label).description,
            )
            : node,
        ),
      }),
      '已更新节点',
      `已更新 ${targetIds.length} 个节点属性。`,
    );
  }, [commitDocument, nodeInspectorDraft, selection.ids, selection.kind]);

  function applyNodeStylePreset(preset: (typeof nodeStylePresets)[number]) {
    if (selection.kind !== 'node' || selection.ids.length === 0) {
      return;
    }

    const ids = new Set(selection.ids);
    commitDocument(
      (current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          ids.has(node.id)
            ? {
                ...node,
                fill: preset.fill,
                stroke: preset.stroke,
                textColor: preset.textColor,
              }
            : node,
        ),
      }),
      '已更新节点',
      `已套用 ${preset.label} 样式到 ${selection.ids.length} 个节点。`,
    );
  }

  const applyEdgeInspectorDraft = useCallback((
    draft: EdgeInspectorDraft = edgeInspectorDraft,
    targetIds: string[] = selection.kind === 'edge' ? selection.ids : [],
  ) => {
    if (targetIds.length === 0) {
      return;
    }

    const strokeWidth = Number.parseFloat(draft.strokeWidthInput);
    const ids = new Set(targetIds);
    commitDocument(
      (current) => ({
        ...current,
        edges: current.edges.map((edge) =>
          ids.has(edge.id)
            ? {
                ...normalizeEdgeStyle(edge),
                label: draft.label,
                type: draft.type,
                strokeColor: draft.strokeColor,
                strokeWidth: Number.isFinite(strokeWidth) ? strokeWidth : defaultEdgeStyle.strokeWidth,
              }
            : edge,
        ),
      }),
      '已更新连线',
      `已更新 ${targetIds.length} 条连线属性。`,
    );
  }, [commitDocument, edgeInspectorDraft, selection.ids, selection.kind]);

  const applySubgraphInspectorDraft = useCallback((
    draft: SubgraphInspectorDraft = subgraphInspectorDraft,
    targetIds: string[] = selection.kind === 'subgraph' ? selection.ids : [],
  ) => {
    if (targetIds.length === 0) {
      return;
    }

    const ids = new Set(targetIds);
    commitDocument(
      (current) => ({
        ...current,
        subgraphs: current.subgraphs.map((subgraph) =>
          ids.has(subgraph.id)
            ? {
                ...subgraph,
                title: composeEntityText(draft.title, draft.description),
                collapsed: draft.collapsed,
                fill: draft.fill,
                stroke: draft.stroke,
                textColor: draft.textColor,
              }
            : subgraph,
        ),
      }),
      '已更新分组',
      `已更新 ${targetIds.length} 个分组设置。`,
    );
  }, [commitDocument, selection.ids, selection.kind, subgraphInspectorDraft]);

  const startContentInlineEdit = useCallback(() => {
    const current = documentRef.current;
    setEditingContent(true);
    setContentInspectorDraft({
      markdown: normalizeContentMarkdown(current.contentMarkdown ?? extractContentMarkdown(current.suffixMarkdown)),
    });
    setSelection({ kind: 'content', ids: [CONTENT_CARD_ID] });
    if (contentCardLayout.collapsed) {
      commitDocument(
        (document) => withContentCardLayout(document, { ...contentCardLayout, collapsed: false }),
        '已展开附加信息',
        '已展开附加信息框。',
      );
    }
  }, [commitDocument, contentCardLayout]);

  const toggleContentCollapsed = useCallback((nextCollapsed?: boolean) => {
    const collapsed = nextCollapsed ?? !contentCardLayout.collapsed;
    if (collapsed && editingContent) {
      setEditingContent(false);
    }

    commitDocument(
      (current) => withContentCardLayout(current, { ...contentCardLayout, collapsed }),
      collapsed ? '已折叠附加信息' : '已展开附加信息',
      collapsed ? '已折叠附加信息框。' : '已展开附加信息框。',
    );
  }, [commitDocument, contentCardLayout, editingContent]);

  const beginContentCardResize = useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    edge: ContentCardResizeState['edge'],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelection({ kind: 'content', ids: [CONTENT_CARD_ID] });
    setContentCardResizeState({
      edge,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: contentCardBounds.width,
      startHeight: Math.max(contentCardBounds.height, CONTENT_CARD_MIN_HEIGHT),
      width: contentCardBounds.width,
      height: Math.max(contentCardBounds.height, CONTENT_CARD_MIN_HEIGHT),
    });
  }, [contentCardBounds.height, contentCardBounds.width]);

  const applyContentInspectorDraft = useCallback((draft: ContentInspectorDraft = contentInspectorDraft) => {
    commitDocument(
      (current) => ({
        ...current,
        contentMarkdown: trimMultilineBlock(draft.markdown),
      }),
      '已更新附加信息',
      '已更新工程 Markdown 的附加信息层。',
    );
  }, [commitDocument, contentInspectorDraft]);

  const commitContentInlineEdit = useCallback(() => {
    applyContentInspectorDraft();
    setEditingContent(false);
  }, [applyContentInspectorDraft]);

  const applyProjectInspectorDraft = useCallback((draft: ProjectInspectorDraft = projectInspectorDraft) => {
    const normalizedName = draft.projectName.trim() || 'Untitled Project';
    const normalizedSummary = trimMultilineBlock(draft.projectSummary);
    const normalizedContent = trimMultilineBlock(draft.contentMarkdown);
    const current = documentRef.current;
    const currentName = current.projectName?.trim() || 'Untitled Project';
    const currentSummary = trimMultilineBlock(current.projectSummary ?? '');
    const currentContent = trimMultilineBlock(current.contentMarkdown ?? extractContentMarkdown(current.suffixMarkdown));

    if (
      normalizedName === currentName &&
      normalizedSummary === currentSummary &&
      normalizedContent === currentContent
    ) {
      return;
    }

    commitDocument(
      (document) => ({
        ...document,
        projectName: normalizedName,
        projectSummary: normalizedSummary,
        prefixMarkdown: buildProjectPrefixMarkdown(normalizedName, normalizedSummary),
        contentMarkdown: normalizedContent,
      }),
      '已更新工程信息',
      '已更新 Project Name、Summary 与附加信息。',
    );
  }, [commitDocument, projectInspectorDraft]);

  const commitSubgraphTitleEdit = useCallback((subgraphId: string, nextTitle = editingSubgraphTitle) => {
    const { title, description } = splitEntityText(nextTitle);
    const normalizedTitle = composeEntityText(title || '未命名分组', description);

    commitDocument(
      (current) => ({
        ...current,
        subgraphs: current.subgraphs.map((subgraph) =>
          subgraph.id === subgraphId
            ? { ...subgraph, title: normalizedTitle }
            : subgraph,
        ),
      }),
      '已更新分组',
      `已更新 ${subgraphId} 的分组标题。`,
    );

    setEditingSubgraphId(null);
    setEditingSubgraphField('title');
    setEditingSubgraphTitle('');
  }, [commitDocument, editingSubgraphTitle]);

  const startSubgraphTitleEdit = useCallback((subgraph: GraphSubgraph, field: InlineNodeField = 'title') => {
    setEditingSubgraphId(subgraph.id);
    setEditingSubgraphField(field);
    setEditingSubgraphTitle(normalizeInlineEntityText(subgraph.title));
    setSelection({ kind: 'subgraph', ids: [subgraph.id] });
  }, []);

  const toggleSubgraphCollapsed = useCallback((subgraphId: string) => {
    commitDocument(
      (current) => ({
        ...current,
        subgraphs: current.subgraphs.map((subgraph) =>
          subgraph.id === subgraphId
            ? { ...subgraph, collapsed: !subgraph.collapsed }
            : subgraph,
        ),
      }),
      '已更新分组',
      `已切换 ${subgraphId} 的折叠状态。`,
    );
  }, [commitDocument]);

  const deleteSubgraphById = useCallback((subgraphId: string) => {
    commitDocument(
      (current) => removeSubgraphs(current, [subgraphId]),
      '已删除选中内容',
      `已删除 ${subgraphId} 分组，并释放其内部节点。`,
    );

    setEditingSubgraphId((current) => (current === subgraphId ? null : current));
    setEditingSubgraphTitle('');
    setSelection((current) =>
      current.kind === 'subgraph' && current.ids.includes(subgraphId)
        ? { kind: 'none', ids: [] }
        : current,
      );
  }, [commitDocument]);

  const resolveSubgraphAtPoint = useCallback((point: Point) => (
    findSubgraphDropTarget(allSubgraphBlobShapes, point)
  ), [allSubgraphBlobShapes]);

  const compactLayout = useCallback(() => {
    commitDocument(
      (current) => {
        const scopedNodeIds = collectLayoutScopeNodeIds(current, selection);
        if (!scopedNodeIds) {
          return {
            ...current,
            nodes: tidyDocumentNodes(current),
          };
        }

        const scopedDocument = buildLayoutScopeDocument(current, scopedNodeIds, selection);
        return {
          ...current,
          nodes: mergeScopedLayoutNodes(current, tidyDocumentNodes(scopedDocument)),
        };
      },
      '已整理布局',
      '已根据当前排布做理线、压缩间距和局部避让。',
    );
  }, [commitDocument, selection]);

  const autoLayout = useCallback(() => {
    commitDocument(
      (current) => {
        const scopedNodeIds = collectLayoutScopeNodeIds(current, selection);
        if (!scopedNodeIds) {
          return {
            ...current,
            nodes: layoutDocumentNodes(current),
          };
        }

        const scopedDocument = buildLayoutScopeDocument(current, scopedNodeIds, selection);
        return {
          ...current,
          nodes: mergeScopedLayoutNodes(current, layoutDocumentNodes(scopedDocument)),
        };
      },
      '已重排布局',
      '已按拓扑结构重新布局，优先减少打结、遮挡和无效留白。',
    );
  }, [commitDocument, selection]);

  const createNodeAtForSources = useCallback((
    point: Point,
    sourceIds: string[],
    edgeType: GraphEdge['type'] = 'solid',
    forcedSubgraphId?: string | null,
  ) => {
    const id = nextNodeId(documentState.nodes, '新建节点');
    const selectionSubgraph =
      selection.kind === 'subgraph' && selection.ids.length === 1 ? selection.ids[0] : null;
    const targetSubgraphId = forcedSubgraphId === undefined ? selectionSubgraph : forcedSubgraphId;
    const draftNode = buildNode(id, '新建节点', point, targetSubgraphId);
    const subgraphExclusions = getSubgraphAncestryIds(targetSubgraphId, fullSubgraphLookup);
    const targetFrame = targetSubgraphId
      ? allSubgraphFrameMap.get(targetSubgraphId) ?? null
      : null;
    const safeRect = searchFreeRect(
      getNodeRectAt(draftNode, point),
        buildCollisionObstacles(
          documentState,
          documentState.nodes,
          new Set<string>(),
          subgraphExclusions,
          null,
        ),
      sourceIds[0]
        ? (() => {
            const sourceEndpoint = edgeEndpointMap.get(sourceIds[0]);
            const sourceCenter = sourceEndpoint
              ? getNodeCenter(sourceEndpoint)
              : null;
            return {
              x: point.x - (sourceCenter?.x ?? point.x),
              y: point.y - (sourceCenter?.y ?? point.y),
            };
          })()
        : { x: 1, y: 0 },
      targetFrame
        ? {
            x: targetFrame.x + 18,
            y: targetFrame.y + targetFrame.headerHeight + 10,
            width: targetFrame.width - 36,
            height: targetFrame.height - targetFrame.headerHeight - 22,
          }
        : null,
    );
    const newNode = {
      ...draftNode,
      x: safeRect.x,
      y: safeRect.y,
    };

    commitDocument(
      (current) => ({
        ...current,
        nodes: [...current.nodes, newNode],
        edges: sourceIds.length > 0
          ? [
              ...current.edges,
              ...sourceIds.map((sourceId) => ({
                id: crypto.randomUUID(),
                from: sourceId,
                to: id,
                label: '',
                type: edgeType,
                strokeColor: defaultEdgeStyle.strokeColor,
                strokeWidth: defaultEdgeStyle.strokeWidth,
              })),
            ]
          : current.edges,
      }),
      '已创建节点',
      sourceIds.length > 1
        ? `已创建 ${id}，并汇集 ${sourceIds.length} 个来源建立连接。`
        : sourceIds.length === 1
          ? `已创建 ${id}，并从 ${sourceIds[0]} 建立连接。`
        : targetSubgraphId
          ? `已在 ${targetSubgraphId} 中创建 ${id}。`
          : `已在画布中创建 ${id}。`,
    );

    setSelection({ kind: 'node', ids: [id] });
    setEditingNodeId(id);
    setEditingNodeField('title');
    setEditingNodeSelectAll(true);
    setEditingLabel(newNode.label);
  }, [
    allSubgraphFrameMap,
    commitDocument,
    documentState,
    edgeEndpointMap,
    fullSubgraphLookup,
    selection,
  ]);

  const createNodeAt = useCallback((
    point: Point,
    sourceNodeId?: string,
    edgeType: GraphEdge['type'] = 'solid',
    forcedSubgraphId?: string | null,
  ) => {
    createNodeAtForSources(
      point,
      sourceNodeId ? [sourceNodeId] : [],
      edgeType,
      forcedSubgraphId,
    );
  }, [createNodeAtForSources]);

  const createNodesFromShortcut = useCallback((
    sourceNodes: GraphNode[],
    relation: 'linked' | 'sibling' | 'mirrored',
  ) => {
    if (sourceNodes.length === 0) {
      return;
    }

    const workingNodes = [...documentState.nodes];
    const newNodes: GraphNode[] = [];
    const newEdges: GraphEdge[] = [];

    sourceNodes.forEach((sourceNode) => {
      const id = nextNodeId(workingNodes, '新建节点');
      const desiredPoint = getShortcutNodePlacement(sourceNode, documentState.direction, relation);
      const draftNode = buildNode(id, '新建节点', desiredPoint, sourceNode.subgraphId);
      const subgraphExclusions = getSubgraphAncestryIds(sourceNode.subgraphId, fullSubgraphLookup);
      const targetFrame = sourceNode.subgraphId
        ? allSubgraphFrameMap.get(sourceNode.subgraphId) ?? null
        : null;
      const collisionNodes = workingNodes;
      const safeRect = searchFreeRect(
        getNodeRectAt(draftNode, desiredPoint),
        buildCollisionObstacles(
          { ...documentState, nodes: collisionNodes },
          collisionNodes,
          new Set<string>(),
          subgraphExclusions,
          null,
        ),
        {
          x: desiredPoint.x - sourceNode.x,
          y: desiredPoint.y - sourceNode.y,
        },
        targetFrame
          ? {
              x: targetFrame.x + 18,
              y: targetFrame.y + targetFrame.headerHeight + 10,
              width: targetFrame.width - 36,
              height: targetFrame.height - targetFrame.headerHeight - 22,
            }
          : null,
      );
      const newNode = {
        ...draftNode,
        x: safeRect.x,
        y: safeRect.y,
      };

      newNodes.push(newNode);
      workingNodes.push(newNode);

      if (relation === 'linked') {
        newEdges.push({
          id: crypto.randomUUID(),
          from: sourceNode.id,
          to: id,
          label: '',
          type: 'solid',
          strokeColor: defaultEdgeStyle.strokeColor,
          strokeWidth: defaultEdgeStyle.strokeWidth,
        });
      } else if (relation === 'mirrored') {
        documentState.edges
          .filter((edge) => edge.to === sourceNode.id)
          .forEach((edge) => {
            newEdges.push({
              id: crypto.randomUUID(),
              from: edge.from,
              to: id,
              label: edge.label,
              type: edge.type,
              strokeColor: edge.strokeColor,
              strokeWidth: edge.strokeWidth,
            });
          });
      }
    });

    commitDocument(
      (current) => ({
        ...current,
        nodes: [...current.nodes, ...newNodes],
        edges: relation === 'sibling' ? current.edges : [...current.edges, ...newEdges],
      }),
      relation === 'linked' ? '已创建节点' : relation === 'mirrored' ? '已镜像创建节点' : '已创建同级节点',
      sourceNodes.length > 1
        ? relation === 'linked'
          ? `已为 ${sourceNodes.length} 个选中节点分别创建并连接新节点。`
          : relation === 'mirrored'
            ? `已为 ${sourceNodes.length} 个选中节点分别创建同级镜像节点。`
          : `已为 ${sourceNodes.length} 个选中节点分别创建同级节点。`
        : relation === 'linked'
          ? `已创建 ${newNodes[0]?.id ?? '新节点'}，并从 ${sourceNodes[0]?.id ?? '当前节点'} 建立连接。`
          : relation === 'mirrored'
            ? `已在 ${sourceNodes[0]?.id ?? '当前节点'} 同层级创建 ${newNodes[0]?.id ?? '新节点'}，并复制其入线关系。`
          : `已在 ${sourceNodes[0]?.id ?? '当前节点'} 同层级创建 ${newNodes[0]?.id ?? '新节点'}。`,
    );

    setSelection({ kind: 'node', ids: newNodes.map((node) => node.id) });
    if (newNodes.length === 1) {
      setEditingNodeId(newNodes[0].id);
      setEditingNodeField('title');
      setEditingNodeSelectAll(true);
      setEditingLabel(newNodes[0].label);
    }
  }, [allSubgraphFrameMap, commitDocument, documentState, fullSubgraphLookup]);

  const deleteSelection = useCallback(() => {
    if (selection.kind === 'none' || selection.kind === 'content' || selection.ids.length === 0) {
      return;
    }

    const ids = new Set(selection.ids);
    commitDocument(
      (current) => {
        if (selection.kind === 'node') {
          return {
            ...current,
            nodes: current.nodes.filter((node) => !ids.has(node.id)),
            edges: current.edges.filter(
              (edge) => !ids.has(edge.from) && !ids.has(edge.to),
            ),
          };
        }

        if (selection.kind === 'edge') {
          return {
            ...current,
            edges: current.edges.filter((edge) => !ids.has(edge.id)),
          };
        }

        return removeSubgraphs(current, selection.ids);
      },
      '已删除选中内容',
      '已从图中移除当前选中的项目。',
    );

    clearSelection();
  }, [clearSelection, commitDocument, selection]);

  const duplicateSelection = useCallback(() => {
    if (selection.kind !== 'node' || selection.ids.length === 0) {
      return;
    }

    const ids = new Set(selection.ids);
    const nodeIdMap = new Map<string, string>();
    const duplicatedNodes = documentState.nodes
      .filter((node) => ids.has(node.id))
      .map((node) => {
        const nextId = nextNodeId([
          ...documentState.nodes,
          ...Array.from(nodeIdMap.values()).map((id) =>
            buildNode(id, id, { x: 0, y: 0 }, null),
          ),
        ], splitEntityText(node.label).title || '未命名内容');
        nodeIdMap.set(node.id, nextId);
        return {
          ...resizeNodeToContent(node, node.label),
          id: nextId,
          x: node.x + 40,
          y: node.y + 40,
        };
      });

    const duplicatedEdges = documentState.edges
      .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
      .map((edge) => ({
        ...edge,
        id: crypto.randomUUID(),
        from: nodeIdMap.get(edge.from) ?? edge.from,
        to: nodeIdMap.get(edge.to) ?? edge.to,
      }));

    commitDocument(
      (current) => ({
        ...current,
        nodes: [...current.nodes, ...duplicatedNodes],
        edges: [...current.edges, ...duplicatedEdges],
      }),
      '已复制选中节点',
      `已复制 ${duplicatedNodes.length} 个节点。`,
    );

    setSelection({
      kind: 'node',
      ids: duplicatedNodes.map((node) => node.id),
    });
  }, [commitDocument, documentState.edges, documentState.nodes, selection]);

  const copySelection = useCallback(() => {
    if (selection.kind !== 'node' || selection.ids.length === 0) {
      return;
    }

    const ids = new Set(selection.ids);
    nodeClipboardRef.current = {
      nodes: documentState.nodes
        .filter((node) => ids.has(node.id))
        .map((node) => structuredClone(node)),
      edges: documentState.edges
        .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
        .map((edge) => structuredClone(edge)),
    };
  }, [documentState.edges, documentState.nodes, selection]);

  const pasteSelection = useCallback(() => {
    const clipboard = nodeClipboardRef.current;
    if (!clipboard || clipboard.nodes.length === 0) {
      return;
    }

    const idMap = new Map<string, string>();
    const workingNodes = [...documentState.nodes];
    const pastedNodes = clipboard.nodes.map((node) => {
      const nextId = nextNodeId(workingNodes, splitEntityText(node.label).title || '未命名内容');
      idMap.set(node.id, nextId);
      const nextNode = {
        ...resizeNodeToContent(node, node.label),
        id: nextId,
        x: node.x + 40,
        y: node.y + 40,
      };
      workingNodes.push(nextNode);
      return nextNode;
    });

    const pastedEdges = clipboard.edges
      .filter((edge) => idMap.has(edge.from) && idMap.has(edge.to))
      .map((edge) => ({
        ...edge,
        id: crypto.randomUUID(),
        from: idMap.get(edge.from) ?? edge.from,
        to: idMap.get(edge.to) ?? edge.to,
      }));

    commitDocument(
      (current) => ({
        ...current,
        nodes: [...current.nodes, ...pastedNodes],
        edges: [...current.edges, ...pastedEdges],
      }),
      '已粘贴节点',
      `已粘贴 ${pastedNodes.length} 个节点。`,
    );

    setSelection({
      kind: 'node',
      ids: pastedNodes.map((node) => node.id),
    });
  }, [commitDocument, documentState.nodes]);

  const wrapSelectionInSubgraph = useCallback(() => {
    if (selection.kind !== 'node' || selection.ids.length < 2) {
      return;
    }

    const selectedNodes = documentState.nodes.filter((node) => selection.ids.includes(node.id));
    const parentCandidates = new Set(selectedNodes.map((node) => node.subgraphId ?? '__root__'));
    const parentId =
      parentCandidates.size === 1
        ? (selectedNodes[0]?.subgraphId ?? null)
        : null;
    const subgraphId = nextSubgraphId(documentState.subgraphs);

    commitDocument(
      (current) => ({
        ...current,
        subgraphs: [
          ...current.subgraphs,
          {
            id: subgraphId,
            title: `分组 ${current.subgraphs.length + 1}`,
            parentId,
            collapsed: false,
            fill: defaultSubgraphStyle.fill,
            stroke: defaultSubgraphStyle.stroke,
            textColor: defaultSubgraphStyle.textColor,
          },
        ],
        nodes: current.nodes.map((node) =>
          selection.ids.includes(node.id)
            ? {
                ...node,
                subgraphId,
              }
            : node,
        ),
      }),
      '已创建分组',
      `已将 ${selection.ids.length} 个节点归入 ${subgraphId}。`,
    );

    setSelection({ kind: 'subgraph', ids: [subgraphId] });
  }, [commitDocument, documentState.nodes, documentState.subgraphs, selection]);

  const exportMarkdown = useCallback(() => {
    downloadFile(
      `${(documentState.projectName ?? 'diagram').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'diagram'}.lmd`,
      documentState.markdown ?? '',
      'text/markdown;charset=utf-8',
    );
  }, [documentState.markdown, documentState.projectName]);

  const buildCanvasSvgMarkup = useCallback(() => {
    const bounds = canvasExportBounds;
    if (!bounds.width || !bounds.height) {
      return null;
    }

    const subgraphLookup = new Map(documentState.subgraphs.map((subgraph) => [subgraph.id, subgraph]));
    const gridOffsetX = ((-bounds.x % 24) + 24) % 24;
    const gridOffsetY = ((-bounds.y % 24) + 24) % 24;
    const markerIds = new Map<string, string>();
    const markerDefs: string[] = [];

    const sceneX = -bounds.x;
    const sceneY = -bounds.y;

    const ensureMarkerId = (color: string) => {
      const existing = markerIds.get(color);
      if (existing) {
        return existing;
      }

      const id = `edge-arrow-${markerIds.size}`;
      markerIds.set(color, id);
      markerDefs.push(`
        <marker id="${id}" markerWidth="10" markerHeight="8" refX="8.5" refY="4" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0.6 L9,4 L0,7.4 Z" fill="${escapeSvgText(color)}" />
        </marker>
      `);
      return id;
    };

    const buildShapeMarkup = (
      shape: NodeShape,
      rect: Rect,
      attrs: Record<string, string | number>,
    ) => {
      const attrText = Object.entries(attrs)
        .map(([key, value]) => ` ${key}="${escapeSvgText(String(value))}"`)
        .join('');

      switch (shape) {
        case 'diamond': {
          const points = [
            `${rect.x + rect.width * 0.12},${rect.y + rect.height * 0.5}`,
            `${rect.x + rect.width * 0.5},${rect.y + rect.height * 0.06}`,
            `${rect.x + rect.width * 0.88},${rect.y + rect.height * 0.5}`,
            `${rect.x + rect.width * 0.5},${rect.y + rect.height * 0.94}`,
          ].join(' ');
          return `<polygon points="${points}"${attrText} />`;
        }
        case 'hexagon': {
          const points = [
            `${rect.x + rect.width * 0.15},${rect.y}`,
            `${rect.x + rect.width * 0.85},${rect.y}`,
            `${rect.x + rect.width},${rect.y + rect.height * 0.5}`,
            `${rect.x + rect.width * 0.85},${rect.y + rect.height}`,
            `${rect.x + rect.width * 0.15},${rect.y + rect.height}`,
            `${rect.x},${rect.y + rect.height * 0.5}`,
          ].join(' ');
          return `<polygon points="${points}"${attrText} />`;
        }
        case 'circle': {
          return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="${Math.min(rect.width, rect.height) / 2}" ry="${Math.min(rect.width, rect.height) / 2}"${attrText} />`;
        }
        case 'round': {
          return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="${Math.min(rect.height / 2, 999)}" ry="${Math.min(rect.height / 2, 999)}"${attrText} />`;
        }
        case 'database':
        case 'subroutine':
        case 'rect':
        default:
          return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="18" ry="18"${attrText} />`;
      }
    };

    const buildTextBlock = (
      lines: string[],
      centerX: number,
      centerY: number,
      lineHeight: number,
      fontSize: number,
      fontWeight: number,
      fill: string,
    ) => {
      const startY = centerY - ((lines.length - 1) * lineHeight) / 2;
      return `
        <text x="${centerX}" fill="${escapeSvgText(fill)}" font-size="${fontSize}" font-weight="${fontWeight}" text-anchor="middle" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
          ${lines
            .map(
              (line, index) =>
                `<tspan x="${centerX}" y="${startY + index * lineHeight}" dominant-baseline="middle">${escapeSvgText(line || ' ')}</tspan>`,
            )
            .join('')}
        </text>
      `;
    };

    const subgraphMarkup = [...subgraphFrames]
      .sort((left, right) => left.depth - right.depth)
      .map((frame) => {
        const subgraph = subgraphLookup.get(frame.id);
        if (!subgraph) {
          return '';
        }

        const style = getSubgraphStyle(subgraph);
        const parts = splitEntityText(subgraph.title);
        const titleLines = wrapSvgTextLines(parts.title, Math.max(9, Math.floor((frame.width - 80) / 10)));
        const descriptionLines = parts.description
          ? wrapSvgTextLines(parts.description, Math.max(9, Math.floor((frame.width - 80) / 8)))
          : [];
        const headerFill = mixColors(style.stroke, style.fill, 0.82);
        const titleText = buildTextBlock(
          titleLines,
          frame.x + frame.width / 2,
          frame.y + 20 + (descriptionLines.length > 0 ? 0 : 1),
          20,
          15,
          780,
          style.textColor,
        );
        const descriptionText = descriptionLines.length > 0
          ? buildTextBlock(
              descriptionLines,
              frame.x + frame.width / 2,
              frame.y + 42,
              15,
              11,
              540,
              withAlpha(style.textColor, 0.78),
            )
          : '';

        const summaryChips = subgraph.collapsed
          ? frame.summaryLabels.slice(0, 4).map((label, index) => {
              const chipX = frame.x + 24;
              const chipY = frame.y + frame.headerHeight + 20 + index * 24;
              return `
                <rect x="${chipX}" y="${chipY}" width="${Math.min(frame.width - 48, 168)}" height="18" rx="9" fill="${escapeSvgText(withAlpha(style.fill, 0.5))}" stroke="${escapeSvgText(withAlpha(style.stroke, 0.16))}" stroke-width="0.8" />
                <text x="${chipX + 10}" y="${chipY + 9}" dominant-baseline="middle" fill="${escapeSvgText(withAlpha(style.textColor, 0.82))}" font-size="10.5" font-weight="600" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">${escapeSvgText(label.split(/\r?\n/)[0])}</text>
              `;
            }).join('')
          : '';

        return `
          <g>
            <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="20" ry="20" fill="${escapeSvgText(withAlpha(style.fill, 0.16))}" stroke="${escapeSvgText(style.stroke)}" stroke-width="2.2" />
            <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.headerHeight}" rx="20" ry="20" fill="${escapeSvgText(headerFill)}" />
            <rect x="${frame.x}" y="${frame.y + frame.headerHeight - 20}" width="${frame.width}" height="20" fill="${escapeSvgText(headerFill)}" />
            ${titleText}
            ${descriptionText}
            ${summaryChips}
          </g>
        `;
      })
      .join('');

    const nodeMarkup = visibleNodes.map((node) => {
      const parts = splitEntityText(node.label);
      const titleLines = wrapSvgTextLines(parts.title, Math.max(8, Math.floor((node.width - 34) / 11)));
      const descriptionLines = wrapSvgTextLines(
        parts.description || '（空）',
        Math.max(8, Math.floor((node.width - 30) / 8.5)),
      );
      const titleHeight = Math.min(
        node.height - 22,
        Math.max(parts.description ? 54 : 66, 24 + titleLines.length * 24 + (parts.description ? 6 : 14)),
      );
      const descriptionHeight = Math.max(22, node.height - titleHeight);
      const clipId = `clip-node-${node.id.replace(/[^a-z0-9_-]+/gi, '-')}`;
      const titleFill = mixColors(node.stroke, node.fill, 0.84);
      const bodyFill = mixColors(node.fill, '#ffffff', 0.04);
      const emptyDescription = !parts.description;
      const titleBlock = buildTextBlock(
        titleLines,
        node.x + node.width / 2,
        node.y + titleHeight / 2,
        22,
        17,
        800,
        node.textColor,
      );
      const descriptionBlock = buildTextBlock(
        descriptionLines,
        node.x + node.width / 2,
        node.y + titleHeight + descriptionHeight / 2,
        18,
        emptyDescription ? 12 : 14,
        emptyDescription ? 560 : 560,
        emptyDescription ? withAlpha(node.textColor, 0.44) : node.textColor,
      );

      return `
        <g>
          <defs>
            <clipPath id="${clipId}">
              ${buildShapeMarkup(node.shape, node, {})}
            </clipPath>
          </defs>
          ${buildShapeMarkup(node.shape, node, {
            fill: bodyFill,
            stroke: node.stroke,
            'stroke-width': 2.8,
          })}
          <g clip-path="url(#${clipId})">
            <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${titleHeight}" fill="${escapeSvgText(titleFill)}" />
            <rect x="${node.x}" y="${node.y + titleHeight}" width="${node.width}" height="${descriptionHeight}" fill="${escapeSvgText(bodyFill)}" />
            <line x1="${node.x}" y1="${node.y + titleHeight}" x2="${node.x + node.width}" y2="${node.y + titleHeight}" stroke="${escapeSvgText(withAlpha(node.stroke, 0.22))}" stroke-width="1" />
          </g>
          ${titleBlock}
          ${descriptionBlock}
        </g>
      `;
    }).join('');

    const edgeMarkup = visibleEdges.map((edge) => {
      const normalizedEdge = normalizeEdgeStyle(edge);
      const fromNode = edgeEndpointMap.get(edge.from);
      const toNode = edgeEndpointMap.get(edge.to);
      if (!fromNode || !toNode) {
        return '';
      }

      const isGroupEdge = fromNode.kind === 'subgraph' || toNode.kind === 'subgraph';
      const geometry = buildEdgeGeometry(
        fromNode,
        toNode,
        edgeLaneMap.get(edge.id) ?? 0,
        edgeEndpointOffsetMap.get(edge.id),
      );
      const inheritsSourceColor = shouldInheritSourceEdgeColor(normalizedEdge.strokeColor);
      const edgeBaseColor = inheritsSourceColor ? getEndpointAccentColor(fromNode) : normalizedEdge.strokeColor;
      const baseStrokeWidth = isGroupEdge ? normalizedEdge.strokeWidth * 1.35 : normalizedEdge.strokeWidth;
      const visualStrokeWidth = Math.max(baseStrokeWidth, isGroupEdge ? 2.4 : 1.75);
      const dashArray = getEdgeDashArray(normalizedEdge.type);
      const dashAttr = dashArray ? ` stroke-dasharray="${dashArray}"` : '';
      const markerId = edge.type === 'line' ? null : ensureMarkerId(edgeBaseColor);
      const labelMetrics = edge.label ? measureEdgeLabelBadge(edge.label) : null;
      const labelBackground = mixColors(edgeBaseColor, '#0c0c0e', 0.82);
      const labelBorder = withAlpha(edgeBaseColor, 0.8);
      const labelTextColor = getReadableLabelTextColor(labelBackground, '#ffffff');
      const edgeLabelLines = edge.label ? edge.label.split(/\r?\n/) : [];
      const labelW = labelMetrics?.width ?? 54;
      const labelH = labelMetrics?.height ?? 22;

      return `
        <g>
          <path d="${geometry.path}" fill="none" stroke="rgba(0,0,0,0.72)" stroke-width="${visualStrokeWidth + 1.6}" stroke-linecap="round" stroke-linejoin="round"${dashAttr} />
          <path d="${geometry.path}" fill="none" stroke="${escapeSvgText(edgeBaseColor)}" stroke-width="${normalizedEdge.type === 'thick' ? Math.max(visualStrokeWidth, 3.2) : visualStrokeWidth}" stroke-linecap="round" stroke-linejoin="round"${dashAttr}${markerId ? ` marker-end="url(#${markerId})"` : ''} />
          ${
            edge.label
              ? `
                <rect x="${geometry.label.x - labelW / 2}" y="${geometry.label.y - labelH / 2}" width="${labelW}" height="${labelH}" rx="2" fill="${escapeSvgText(labelBackground)}" stroke="${escapeSvgText(labelBorder)}" stroke-width="1" />
                <text x="${geometry.label.x}" fill="${escapeSvgText(labelTextColor)}" font-size="11" font-weight="650" text-anchor="middle" font-family="ui-monospace, 'SFMono-Regular', Consolas, monospace">
                  ${edgeLabelLines
                    .map(
                      (line, index) =>
                        `<tspan x="${geometry.label.x}" y="${geometry.label.y + ((index - (edgeLabelLines.length - 1) / 2) * 16)}" dominant-baseline="middle">${escapeSvgText(line || ' ')}</tspan>`,
                    )
                    .join('')}
                </text>
              `
              : ''
          }
        </g>
      `;
    }).join('');

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="0 0 ${bounds.width} ${bounds.height}">
        <defs>
          <linearGradient id="canvas-export-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#111317" />
            <stop offset="100%" stop-color="#14171d" />
          </linearGradient>
          <pattern id="canvas-export-grid" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="translate(${gridOffsetX} ${gridOffsetY})">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1" />
          </pattern>
          ${markerDefs.join('')}
        </defs>
        <rect width="${bounds.width}" height="${bounds.height}" fill="url(#canvas-export-bg)" />
        <rect width="${bounds.width}" height="${bounds.height}" fill="url(#canvas-export-grid)" />
        <g transform="translate(${sceneX} ${sceneY})">
          ${subgraphMarkup}
          ${edgeMarkup}
          ${nodeMarkup}
        </g>
      </svg>
    `;

    return svg;
  }, [
    canvasExportBounds,
    documentState.subgraphs,
    edgeEndpointMap,
    edgeEndpointOffsetMap,
    edgeLaneMap,
    subgraphFrames,
    visibleEdges,
    visibleNodes,
  ]);

  const exportCanvasImage = useCallback(async () => {
    const svgMarkup = buildCanvasSvgMarkup();
    if (!svgMarkup) {
      return;
    }

    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    setSaveStatus('saving');

    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(2, window.devicePixelRatio || 1.5);
      canvas.width = Math.ceil(canvasExportBounds.width * scale);
      canvas.height = Math.ceil(canvasExportBounds.height * scale);
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas context unavailable');
      }

      context.scale(scale, scale);
      const renderedImage = await renderSvgMarkupToCanvasImage(svgMarkup, svgBlob);
      renderedImage.draw(context, canvasExportBounds.width, canvasExportBounds.height);

      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
            return;
          }
          try {
            const dataUrl = canvas.toDataURL('image/png');
            const [header, body] = dataUrl.split(',');
            if (!header.includes('image/png') || !body) {
              reject(new Error('PNG export failed'));
              return;
            }
            const binary = atob(body);
            const buffer = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) {
              buffer[index] = binary.charCodeAt(index);
            }
            resolve(new Blob([buffer], { type: 'image/png' }));
          } catch {
            reject(new Error('PNG export failed'));
          }
        }, 'image/png');
      });

      await saveBlobWithPicker(
        `${sanitizeFilename(documentState.projectName ?? activeTab.label, 'diagram')}.png`,
        pngBlob,
        {
          description: 'PNG image',
          mime: 'image/png',
          extensions: ['.png'],
        },
      );
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }, [
    activeTab.label,
    buildCanvasSvgMarkup,
    canvasExportBounds.height,
    canvasExportBounds.width,
    documentState.projectName,
  ]);

  const svgPreviewMarkup = useMemo(
    () => (svgPreviewOpen ? buildCanvasSvgMarkup() ?? '' : ''),
    [buildCanvasSvgMarkup, svgPreviewOpen],
  );

  const goToMode = useCallback((nextMode: EditorMode) => {
    if (nextMode === 'source') {
      const sourceSelection = buildHostSourceSelectionPayload(documentRef.current, selection);
      if (isVsCodeHost) {
        vscodeApiRef.current?.postMessage({
          type: 'lmd/openSource',
          selection: sourceSelection,
        });
        return;
      }

      const sourceText = sourceDraft || documentRef.current.markdown || documentRef.current.source;
      setPendingSourceSelection(resolveLocalSourceSelectionRange(sourceText, sourceSelection));
    }

    if (isVsCodeHost) {
      if (nextMode === 'history') {
        return;
      }
    }

    if (mode === 'source' && nextMode !== 'source' && sourceParseError) {
      return;
    }

    setMode(nextMode);
  }, [isVsCodeHost, mode, selection, sourceDraft, sourceParseError]);

  const openLocalProjectFile = useCallback(async (item: ExplorerItem) => {
    const localEntry = localHandleEntriesRef.current[item.id];
    if (!localEntry || localEntry.handle.kind !== 'file') {
      return;
    }

    try {
      const file = await localEntry.handle.getFile();
      const content = await file.text();
      const parsed = materializeDocument(
        parseProjectMarkdown(
          content,
          file.name.replace(/\.lmd$/i, ''),
          documentRef.current.layout,
        ),
      );
      setActiveWorkspaceSource('local');
      setActiveLocalFileId(item.id);
      setActiveLocalExplorerItemId(item.id);
      setActiveLocalDirectoryId(item.parentId ?? 'local-project');
      setActiveFileTab(item.tabId ?? 'diagram');
      if (item.mode) {
        goToMode(item.mode);
      }
      setDocumentState(parsed);
      setSourceDraft(parsed.markdown ?? parsed.source);
      setSaveStatus('saved');
      if (isMobileViewport) {
        setSidebarOpen(false);
      }
    } catch {
      try {
        const file = await localEntry.handle.getFile();
        const content = await file.text();
        setActiveWorkspaceSource('local');
        setActiveLocalFileId(item.id);
        setActiveLocalExplorerItemId(item.id);
        setActiveLocalDirectoryId(item.parentId ?? 'local-project');
        setActiveFileTab(item.tabId ?? 'diagram');
        setMode('source');
        setSourceDraft(content);
        setSaveStatus('error');
        if (isMobileViewport) {
          setSidebarOpen(false);
        }
      } catch {
        setSaveStatus('error');
      }
    }
  }, [goToMode, isMobileViewport]);

  const openLocalProjectDirectory = useCallback(async () => {
    const pickerWindow = window as Window & {
      showDirectoryPicker?: () => Promise<LocalProjectDirectoryHandle>;
    };

    if (!pickerWindow.showDirectoryPicker) {
      return;
    }

    try {
      const root = await pickerWindow.showDirectoryPicker();
      const scanned = await scanLocalProjectDirectory(root);
      setLocalExplorerItems(scanned.items);
      localHandleEntriesRef.current = scanned.handles;
      localRootDirectoryRef.current = root;
      setHasLocalProjectAccess(true);
      setActiveWorkspaceSource('local');
      setActiveLocalExplorerItemId('local-project');
      setActiveLocalDirectoryId('local-project');
      setLeftPanel('files');
      setSidebarOpen(true);

      const firstFile = scanned.items.find((item) => item.kind === 'file');
      if (firstFile) {
        await openLocalProjectFile(firstFile);
      }
    } catch {
      setSaveStatus('error');
    }
  }, [openLocalProjectFile]);

  const refreshLocalProjectDirectory = useCallback(async (preferredPath?: string) => {
    const root = localRootDirectoryRef.current;
    if (!root) {
      return null;
    }

    const currentDirectoryPath = activeLocalDirectoryId
      ? localExplorerItems.find((item) => item.id === activeLocalDirectoryId)?.path ?? null
      : null;
    const scanned = await scanLocalProjectDirectory(root);
    setLocalExplorerItems(scanned.items);
    localHandleEntriesRef.current = scanned.handles;
    setHasLocalProjectAccess(true);

    if (preferredPath) {
      const preferredItem = scanned.items.find((item) => item.path === preferredPath);
      if (preferredItem) {
        setActiveLocalExplorerItemId(preferredItem.id);
        setActiveLocalDirectoryId(
          preferredItem.kind === 'file'
            ? (preferredItem.parentId ?? 'local-project')
            : preferredItem.id,
        );
        if (preferredItem.kind === 'file') {
          setActiveLocalFileId(preferredItem.id);
        }
        return preferredItem;
      }
    }

    if (currentDirectoryPath) {
      const preferredDirectory = scanned.items.find((item) => item.path === currentDirectoryPath);
      if (preferredDirectory && preferredDirectory.kind !== 'file') {
        setActiveLocalDirectoryId(preferredDirectory.id);
      } else {
        setActiveLocalDirectoryId(scanned.items.find((item) => item.kind === 'project')?.id ?? null);
      }
    }

    return null;
  }, [activeLocalDirectoryId, localExplorerItems]);

  const openLocalMarkdownFile = useCallback(async () => {
    const pickerWindow = window as Window & {
      showOpenFilePicker?: (options?: {
        excludeAcceptAllOption?: boolean;
        multiple?: boolean;
        types?: Array<{ description?: string; accept: Record<string, string[]> }>;
      }) => Promise<LocalProjectFileHandle[]>;
    };

    if (!pickerWindow.showOpenFilePicker) {
      await openLocalProjectDirectory();
      return;
    }

    try {
      const [fileHandle] = await pickerWindow.showOpenFilePicker({
        multiple: false,
        excludeAcceptAllOption: true,
        types: [
          {
            description: 'LMD',
            accept: {
              'text/markdown': ['.lmd'],
              'text/plain': ['.lmd'],
            },
          },
        ],
      });

      if (!fileHandle) {
        return;
      }

      const file = await fileHandle.getFile();
      const item: ExplorerItem = {
        id: 'local-file-standalone',
        label: file.name,
        meta: 'LMD 工程',
        depth: 1,
        kind: 'file',
        path: `local-file://${file.name}`,
        parentId: 'local-project',
        tabId: 'diagram',
        mode: 'canvas',
      };

      const rootItem: ExplorerItem = {
        id: 'local-project',
        label: file.name.replace(/\.lmd$/i, '') || 'local-file',
        meta: '本地 Markdown 文件',
        depth: 0,
        kind: 'project',
        path: `local-file://${file.name.replace(/\.lmd$/i, '') || 'local-file'}`,
        parentId: null,
      };

      setLocalExplorerItems([rootItem, item]);
      localHandleEntriesRef.current = {
        'local-file-standalone': {
          handle: fileHandle,
          parentId: 'local-project',
          parentHandle: null,
        },
      };
      localRootDirectoryRef.current = null;
      setHasLocalProjectAccess(true);
      setActiveWorkspaceSource('local');
      setActiveLocalExplorerItemId(item.id);
      setActiveLocalDirectoryId('local-project');
      setLeftPanel('files');
      setSidebarOpen(true);
      await openLocalProjectFile(item);
    } catch {
      setSaveStatus('error');
    }
  }, [openLocalProjectDirectory, openLocalProjectFile]);

  const createLocalProjectFile = useCallback(async () => {
    if (!localRootDirectoryRef.current) {
      await openLocalProjectDirectory();
    }

    const selectedItem = activeLocalExplorerItemId
      ? localExplorerItems.find((item) => item.id === activeLocalExplorerItemId)
      : null;
    const parentItem = selectedItem?.kind === 'file'
      ? localExplorerItems.find((item) => item.id === selectedItem.parentId)
      : selectedItem;
    const parentEntry = parentItem
      ? localHandleEntriesRef.current[parentItem.id]
      : localHandleEntriesRef.current['local-project'];

    if (!parentEntry || parentEntry.handle.kind !== 'directory' || !parentEntry.handle.getFileHandle) {
      return;
    }

    const existingNames = new Set<string>();
    for await (const [name] of parentEntry.handle.entries()) {
      existingNames.add(name.toLowerCase());
    }

    let filename = 'untitled.lmd';
    let index = 2;
    while (existingNames.has(filename.toLowerCase())) {
      filename = `untitled-${index}.lmd`;
      index += 1;
    }

    const fileHandle = await parentEntry.handle.getFileHandle(filename, { create: true });
    if (fileHandle.createWritable) {
      const writable = await fileHandle.createWritable();
      await writable.write(
        createProjectMarkdownTemplate(
          filename.replace(/\.lmd$/i, ''),
          'flowchart LR\n  Start[Start]',
        ),
      );
      await writable.close();
    }

    const rootName = localRootDirectoryRef.current?.name ?? 'project';
    const nextPath = `${parentItem?.path ?? `local://${rootName}`}/${filename}`;
    const nextItem = await refreshLocalProjectDirectory(nextPath);
    if (nextItem) {
      await openLocalProjectFile(nextItem);
    }
  }, [activeLocalExplorerItemId, localExplorerItems, openLocalProjectDirectory, openLocalProjectFile, refreshLocalProjectDirectory]);

  const renameLocalProjectItem = useCallback(async () => {
    if (!activeLocalExplorerItemId) {
      return;
    }

    const item = localExplorerItems.find((entry) => entry.id === activeLocalExplorerItemId);
    if (!item || item.kind !== 'file') {
      return;
    }

    const handleEntry = localHandleEntriesRef.current[item.id];
    if (!handleEntry || handleEntry.handle.kind !== 'file' || !handleEntry.parentHandle?.getFileHandle || !handleEntry.parentHandle.removeEntry) {
      return;
    }

    const nextNameInput = window.prompt('Rename LMD file', item.label)?.trim();
    if (!nextNameInput) {
      return;
    }

    const nextFilename = /\.lmd$/i.test(nextNameInput) ? nextNameInput : `${nextNameInput}.lmd`;
    if (nextFilename === item.label) {
      return;
    }

    const content = await handleEntry.handle.getFile().then((file) => file.text());
    const nextHandle = await handleEntry.parentHandle.getFileHandle(nextFilename, { create: true });
    if (nextHandle.createWritable) {
      const writable = await nextHandle.createWritable();
      await writable.write(content);
      await writable.close();
    }
    await handleEntry.parentHandle.removeEntry(item.label);

    const nextPath = `${item.path.slice(0, item.path.lastIndexOf('/'))}/${nextFilename}`;
    const nextItem = await refreshLocalProjectDirectory(nextPath);
    if (nextItem) {
      await openLocalProjectFile(nextItem);
    }
  }, [activeLocalExplorerItemId, localExplorerItems, openLocalProjectFile, refreshLocalProjectDirectory]);

  const deleteLocalProjectItem = useCallback(async () => {
    if (!activeLocalExplorerItemId) {
      return;
    }

    const item = localExplorerItems.find((entry) => entry.id === activeLocalExplorerItemId);
    if (!item || item.kind !== 'file') {
      return;
    }

    const handleEntry = localHandleEntriesRef.current[item.id];
    if (!handleEntry?.parentHandle?.removeEntry) {
      return;
    }

    const confirmed = window.confirm(`Delete ${item.label}?`);
    if (!confirmed) {
      return;
    }

    await handleEntry.parentHandle.removeEntry(item.label);
    const nextItem = await refreshLocalProjectDirectory();
    setActiveLocalExplorerItemId(null);

    if (activeLocalFileId === item.id) {
      const fallbackFile = localExplorerItems.find((entry) => entry.kind === 'file' && entry.id !== item.id);
      if (fallbackFile) {
        await openLocalProjectFile(fallbackFile);
      } else {
        setActiveLocalFileId(null);
      }
    }

    return nextItem;
  }, [activeLocalExplorerItemId, activeLocalFileId, localExplorerItems, openLocalProjectFile, refreshLocalProjectDirectory]);

  const openExplorerItem = useCallback((item: ExplorerItem) => {
    if (item.id.startsWith('local-file-') && localHandleEntriesRef.current[item.id]) {
      void openLocalProjectFile(item);
      return;
    }

    setActiveWorkspaceSource(item.id.startsWith('local') ? 'local' : 'cloud');
    setActiveLocalFileId(item.id.startsWith('local') && item.kind === 'file' ? item.id : null);
    setActiveLocalExplorerItemId(item.id.startsWith('local') ? item.id : null);
    if (item.id.startsWith('local')) {
      setActiveLocalDirectoryId(item.kind === 'file' ? (item.parentId ?? 'local-project') : item.id);
    }

    if (item.tabId) {
      setActiveFileTab(item.tabId);
    }

    if (item.mode) {
      goToMode(item.mode);
    }

    if (isMobileViewport && item.kind === 'file') {
      setSidebarOpen(false);
    }
  }, [goToMode, isMobileViewport, openLocalProjectFile]);

  const createNodeInViewportCenter = useCallback(() => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    const viewport = resolveInteractionViewport(liveViewportRef.current as HotPathViewport);
    const point = bounds
      ? {
          x: (bounds.width / 2 - viewport.x) / viewport.zoom - 72,
          y: (bounds.height / 2 - viewport.y) / viewport.zoom - 30,
        }
      : { x: 220, y: 160 };

    goToMode('canvas');
    createNodeAt(point);
  }, [createNodeAt, goToMode]);

  const undoDocument = useCallback(() => {
    setUndoStack((current) => {
      const previous = current[current.length - 1];
      if (!previous) {
        return current;
      }

      const currentDocument = structuredClone(documentRef.current);
      setRedoStack((redoCurrent) => [...redoCurrent.slice(-39), currentDocument]);
      restoreDocumentSnapshot(previous, '已撤回', '已撤回上一笔图形修改。');
      return current.slice(0, -1);
    });
  }, [restoreDocumentSnapshot]);

  const redoDocument = useCallback(() => {
    setRedoStack((current) => {
      const next = current[current.length - 1];
      if (!next) {
        return current;
      }

      const currentDocument = structuredClone(documentRef.current);
      setUndoStack((undoCurrent) => [...undoCurrent.slice(-39), currentDocument]);
      restoreDocumentSnapshot(next, '已重做', '已恢复刚才撤回的图形修改。');
      return current.slice(0, -1);
    });
  }, [restoreDocumentSnapshot]);

  useEffect(() => {
    documentRef.current = documentState;
    // External document updates (load/undo/commit) resync live viewport when not mid-pan.
    if (!panState && !panCommitNeededRef.current) {
      liveViewportRef.current = documentState.layout.viewport;
    }
  }, [documentState, panState]);

  useEffect(() => {
    if (!isVsCodeHost && documentState.diagramType !== 'flowchart' && mode === 'canvas') {
      setMode('source');
    }
  }, [documentState.diagramType, isVsCodeHost, mode]);

  useEffect(() => {
    editingLabelRef.current = editingLabel;
  }, [editingLabel]);

  useEffect(() => {
    editingSubgraphTitleRef.current = editingSubgraphTitle;
  }, [editingSubgraphTitle]);

  useEffect(() => {
    documentRevisionRef.current = documentRevision;
  }, [documentRevision]);

  useEffect(() => {
    function syncViewportMode() {
      if (isVsCodeHost) {
        setIsMobileViewport(false);
        return;
      }
      setIsMobileViewport(window.innerWidth <= 820);
    }

    syncViewportMode();
    window.addEventListener('resize', syncViewportMode);
    return () => {
      window.removeEventListener('resize', syncViewportMode);
    };
  }, [isVsCodeHost]);

  useEffect(() => {
    const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
    const hardwareConcurrency = navigator.hardwareConcurrency ?? 8;
    const deviceMemory = navigatorWithMemory.deviceMemory ?? 8;
    setIsConstrainedDevice(hardwareConcurrency <= 4 || deviceMemory <= 4);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) {
      setMobileSourcePreviewOpen(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    if (mode !== 'source') {
      setMobileSourcePreviewOpen(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!isVsCodeHost) {
      return;
    }

    if (leftPanel !== 'graph') {
      setLeftPanel('graph');
    }

    if (inspectorView !== 'properties') {
      setInspectorView('properties');
    }

    if (mode !== 'canvas') {
      setMode('canvas');
    }
  }, [isVsCodeHost]);

  useEffect(() => {
    if (previousModeRef.current === 'source' && mode !== 'source') {
      commitSourceDraft();
    }
    previousModeRef.current = mode;
  }, [commitSourceDraft, mode]);

  useEffect(() => {
    if (!isVsCodeHost) {
      return;
    }

    const applyIncomingMarkdown = (markdown: string, nextFileName?: string) => {
      const currentMarkdown = documentRef.current.markdown ?? documentRef.current.source;
      if (markdown === currentMarkdown) {
        lastVsCodeSyncedMarkdownRef.current = markdown;
        return;
      }

      const fallbackName = getProjectFallbackName(nextFileName ?? hostConfig.fileName);

      try {
        const parsed = materializeDocument(
          parseProjectMarkdown(markdown, fallbackName, documentRef.current.layout),
        );
        lastVsCodeSyncedMarkdownRef.current = markdown;
        setDocumentState(parsed);
        setSourceDraft(parsed.markdown ?? parsed.source);
        setSaveStatus('saved');
        return;
      } catch {
        try {
          const standardized = materializeDocument(
            standardizeProjectMarkdown(markdown, fallbackName, documentRef.current.layout),
          );
          lastVsCodeSyncedMarkdownRef.current = standardized.markdown ?? markdown;
          setDocumentState(standardized);
          setSourceDraft(standardized.markdown ?? standardized.source);
          setSaveStatus('saved');
          return;
        } catch {
          setSaveStatus('error');
        }
      }
    };

    const handleHostMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || typeof payload !== 'object') {
        return;
      }

      if (
        'type' in payload &&
        payload.type === 'lmd/document' &&
        'markdown' in payload &&
        typeof payload.markdown === 'string'
      ) {
        applyIncomingMarkdown(
          payload.markdown,
          'fileName' in payload && typeof payload.fileName === 'string'
            ? payload.fileName
            : undefined,
        );
      }
    };

    window.addEventListener('message', handleHostMessage);
    vscodeApiRef.current?.postMessage({ type: 'lmd/ready' });
    return () => {
      window.removeEventListener('message', handleHostMessage);
    };
  }, [hostConfig.fileName, isVsCodeHost]);

  useEffect(() => {
    if (
      sourceParseError ||
      sourceDraft !== (documentState.markdown ?? documentState.source)
    ) {
      return undefined;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          if (isVsCodeHost) {
            const markdown = documentState.markdown ?? '';
            if (markdown !== lastVsCodeSyncedMarkdownRef.current) {
              vscodeApiRef.current?.postMessage({
                type: 'lmd/updateDocument',
                markdown,
              });
              lastVsCodeSyncedMarkdownRef.current = markdown;
            }

            if (!cancelled) {
              setSaveStatus('saved');
            }
            return;
          }

          localStorage.setItem(storageKeys.project, documentState.markdown ?? '');
          localStorage.setItem(storageKeys.history, JSON.stringify(history));

          if (activeWorkspaceSource === 'local' && activeLocalFileId) {
            const handle = localHandleEntriesRef.current[activeLocalFileId]?.handle;
            if (handle?.kind === 'file' && handle.createWritable) {
              const writable = await handle.createWritable();
              await writable.write(documentState.markdown ?? '');
              await writable.close();
            }
          }

          if (!cancelled) {
            setSaveStatus('saved');
          }
        } catch {
          if (!cancelled) {
            setSaveStatus('error');
          }
        }
      })();
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    activeLocalFileId,
    activeWorkspaceSource,
    documentState.markdown,
    documentState.source,
    history,
    isVsCodeHost,
    sourceDraft,
    sourceParseError,
    vscodeApiRef,
  ]);

  useEffect(() => {
    if (!isVsCodeHost) {
      return;
    }

    vscodeApiRef.current?.postMessage({
      type: 'lmd/revealSelection',
      selection: buildHostSourceSelectionPayload(documentRef.current, selection),
    });
  }, [documentState.markdown, isVsCodeHost, selection]);

  useEffect(() => {
    if (mode !== 'source' || !pendingSourceSelection || !sourceEditorRef.current) {
      return;
    }

    const editor = sourceEditorRef.current;
    const selectionStart = clamp(pendingSourceSelection.start, 0, sourceDraft.length);
    const selectionEnd = clamp(pendingSourceSelection.end, selectionStart, sourceDraft.length);

    const frameId = window.requestAnimationFrame(() => {
      focusControlWithoutScroll(editor);
      editor.selectionStart = selectionStart;
      editor.selectionEnd = selectionEnd;
    });

    setPendingSourceSelection(null);
    return () => window.cancelAnimationFrame(frameId);
  }, [mode, pendingSourceSelection, sourceDraft]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKeys.perfDebug, perfDebugEnabled ? '1' : '0');
    } catch {
      // Ignore localStorage failures in sandboxed contexts.
    }
  }, [perfDebugEnabled]);

  useEffect(() => {
    if (!perfDebugEnabled) {
      perfMetricsRef.current.clear();
      perfCountersRef.current = createPerfCounterSnapshot();
      perfWindowStartedAtRef.current = performance.now();
      perfRenderBaselineRef.current = perfRenderCountRef.current;
      setPerfDebugSummary(createEmptyPerfDebugSummary());
      return undefined;
    }

    const flushPerfSummary = () => {
      const now = performance.now();
      const elapsedMs = Math.max(1, now - perfWindowStartedAtRef.current);
      const entries = [...perfMetricsRef.current.entries()]
        .map(([label, stats]) => ({
          label,
          ...stats,
          avgMs: stats.totalMs / Math.max(stats.count, 1),
        }))
        .sort((left, right) => {
          if (right.totalMs !== left.totalMs) {
            return right.totalMs - left.totalMs;
          }
          if (right.maxMs !== left.maxMs) {
            return right.maxMs - left.maxMs;
          }
          return right.avgMs - left.avgMs;
        })
        .slice(0, 8);
      const counters = perfCountersRef.current;
      const renderCount = perfRenderCountRef.current - perfRenderBaselineRef.current;
      const nextSummary: PerfDebugSummary = {
        windowMs: elapsedMs,
        renderCount,
        pointerMoves: counters.pointerMoves,
        dragPointerMoves: counters.dragPointerMoves,
        boxPointerMoves: counters.boxPointerMoves,
        panPointerMoves: counters.panPointerMoves,
        connectPointerMoves: counters.connectPointerMoves,
        hotLabel: entries[0]?.label ?? null,
        snapshot: perfSnapshotRef.current,
        entries,
      };

      if (
        nextSummary.pointerMoves > 0 ||
        nextSummary.renderCount > 0 ||
        nextSummary.entries.length > 0
      ) {
        const logger = entries[0] && (
          entries[0].avgMs >= PERF_DEBUG_LOG_THRESHOLD_MS ||
          entries[0].maxMs >= PERF_DEBUG_LOG_THRESHOLD_MS * 1.5
        )
          ? console.warn
          : console.debug;
        logger('[LMD perf]', {
          hot: nextSummary.hotLabel,
          windowMs: Math.round(nextSummary.windowMs),
          renders: nextSummary.renderCount,
          pointerMoves: nextSummary.pointerMoves,
          snapshot: nextSummary.snapshot,
          entries: nextSummary.entries,
        });
      }

      perfMetricsRef.current.clear();
      perfCountersRef.current = createPerfCounterSnapshot();
      perfWindowStartedAtRef.current = now;
      perfRenderBaselineRef.current = perfRenderCountRef.current;
      setPerfDebugSummary(nextSummary);
    };

    flushPerfSummary();
    const timer = window.setInterval(flushPerfSummary, PERF_DEBUG_SUMMARY_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [perfDebugEnabled]);

  useEffect(() => {
    if (mode !== 'canvas') {
      setSidebarOpen(!isMobileViewport);
      setInspectorOpen(!isMobileViewport);
      return;
    }

    if (!isMobileViewport && selection.kind !== 'none') {
      setInspectorOpen(true);
      setInspectorView((current) => (current === 'ai' && !isMobileViewport ? 'ai' : 'properties'));
    }
  }, [isMobileViewport, mode, selection.kind]);

  useEffect(() => () => {
    clearPendingBackgroundInteraction();
  }, [clearPendingBackgroundInteraction]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== 'canvas') {
      return;
    }

    function preventNativeWheel(event: WheelEvent) {
      event.preventDefault();
    }

    function handleGestureStart(event: Event) {
      event.preventDefault();
      const gestureEvent = event as Event & { scale?: number };
      gestureStateRef.current = { scale: gestureEvent.scale ?? 1 };
    }

    function handleGestureChange(event: Event) {
      event.preventDefault();
      const gestureEvent = event as Event & {
        scale?: number;
        clientX?: number;
        clientY?: number;
        pageX?: number;
        pageY?: number;
      };

      const nextScale = gestureEvent.scale ?? 1;
      const previousScale = gestureStateRef.current?.scale ?? 1;
      if (nextScale === previousScale) {
        return;
      }

      gestureStateRef.current = { scale: nextScale };
      const clientX = gestureEvent.clientX ?? gestureEvent.pageX ?? window.innerWidth / 2;
      const clientY = gestureEvent.clientY ?? gestureEvent.pageY ?? window.innerHeight / 2;
      zoomViewportAtPoint(
        clientX,
        clientY,
        Math.pow(nextScale / previousScale, PINCH_RESPONSE),
      );
    }

    function handleGestureEnd(event: Event) {
      event.preventDefault();
      gestureStateRef.current = null;
    }

    canvas.addEventListener('wheel', preventNativeWheel, { passive: false });
    canvas.addEventListener('gesturestart', handleGestureStart as EventListener, { passive: false });
    canvas.addEventListener('gesturechange', handleGestureChange as EventListener, { passive: false });
    canvas.addEventListener('gestureend', handleGestureEnd as EventListener, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', preventNativeWheel);
      canvas.removeEventListener('gesturestart', handleGestureStart as EventListener);
      canvas.removeEventListener('gesturechange', handleGestureChange as EventListener);
      canvas.removeEventListener('gestureend', handleGestureEnd as EventListener);
    };
  }, [mode, zoomViewportAtPoint]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.shiftKey && event.altKey && !event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setPerfDebugEnabled((current) => !current);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        if (!canvasSearchOpen) {
          searchRestoreViewportRef.current = { ...documentRef.current.layout.viewport };
        }
        setCanvasSearchOpen(true);
        setCanvasSearchQuery('');
        setCanvasSearchFocusIndex(0);
        return;
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      if (helpDialogOpen && event.key !== 'Escape') {
        return;
      }

      const canvasHasFocus =
        mode === 'canvas' &&
        (canvasHovered ||
          (canvasRef.current !== null &&
            document.activeElement instanceof Node &&
            canvasRef.current.contains(document.activeElement)));
      const hasModifier = event.metaKey || event.ctrlKey;
      const lowerKey = event.key.toLowerCase();
      const isRedoChord =
        lowerKey === 'z' &&
        ((event.metaKey && event.ctrlKey) || event.shiftKey);
      const isUndoChord =
        lowerKey === 'z' &&
        !event.shiftKey &&
        !(event.metaKey && event.ctrlKey);

      if (hasModifier && isUndoChord) {
        event.preventDefault();
        undoDocument();
        return;
      }

      if (hasModifier && (isRedoChord || lowerKey === 'y')) {
        event.preventDefault();
        redoDocument();
        return;
      }

      const selectedNodeForShortcut =
        selection.kind === 'node' && selection.ids.length === 1
          ? documentState.nodes.find((node) => node.id === selection.ids[0]) ?? null
          : null;
      const selectedNodesForShortcut =
        selection.kind === 'node' && selection.ids.length > 0
          ? selection.ids
              .map((id) => documentState.nodes.find((node) => node.id === id) ?? null)
              .filter((node): node is GraphNode => node !== null)
          : [];

      if (
        canvasHasFocus &&
        selectedNodesForShortcut.length > 0 &&
        !editingNodeId &&
        !editingEdgeId &&
        event.key === 'Tab'
      ) {
        event.preventDefault();
        createNodesFromShortcut(selectedNodesForShortcut, event.shiftKey ? 'mirrored' : 'linked');
        return;
      }

      if (
        canvasHasFocus &&
        selectedNodeForShortcut &&
        !editingNodeId &&
        !editingEdgeId &&
        event.code === 'Space'
      ) {
        event.preventDefault();
        createNodesFromShortcut([selectedNodeForShortcut], 'sibling');
        return;
      }

      if (event.code === 'Space' && !isTypingTarget(event.target)) {
        setSpacePressed(true);
      }

      if (hasModifier && canvasHasFocus) {
        if (lowerKey === 'a') {
          event.preventDefault();
          setSelection(withNodeSelection(
            visibleNodes.map((node) => node.id),
            subgraphFrames.map((frame) => frame.id),
          ));
          return;
        }

        if (lowerKey === 'c' && selection.kind === 'node' && selection.ids.length > 0) {
          event.preventDefault();
          copySelection();
          return;
        }

        if (lowerKey === 'v') {
          event.preventDefault();
          pasteSelection();
          return;
        }

        if (event.key === '=' || event.key === '+') {
          event.preventDefault();
          zoomViewportAtPoint(window.innerWidth / 2, window.innerHeight / 2, 1.12);
          return;
        }

        if (event.key === '-' || event.key === '_') {
          event.preventDefault();
          zoomViewportAtPoint(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.12);
          return;
        }

        if (event.key === '0') {
          event.preventDefault();
          updateViewport(() => ({ x: 120, y: 90, zoom: 1 }));
          return;
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        wrapSelectionInSubgraph();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelection();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === '1') {
        event.preventDefault();
        goToMode('canvas');
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === '2') {
        event.preventDefault();
        goToMode('source');
        return;
      }

      if (
        event.shiftKey &&
        !hasModifier &&
        lowerKey === 'e' &&
        (selection.kind === 'node' || selection.kind === 'subgraph') &&
        selection.ids.length > 0
      ) {
        event.preventDefault();
        goToMode('source');
        return;
      }

      if ((event.metaKey || event.ctrlKey) && lowerKey === 'e' && selection.kind !== 'none') {
        event.preventDefault();
        goToMode('source');
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === '3') {
        if (isVsCodeHost) {
          return;
        }
        event.preventDefault();
        goToMode('history');
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        if (canvasSearchOpen) {
          if (searchRestoreViewportRef.current) {
            const restoreViewport = searchRestoreViewportRef.current;
            updateViewport(() => restoreViewport);
          }
          searchRestoreViewportRef.current = null;
          setCanvasSearchOpen(false);
          setCanvasSearchQuery('');
          setCanvasSearchFocusIndex(0);
          return;
        }
        setHelpDialogOpen(false);
        setEditingNodeId(null);
        setEditingNodeField('title');
        setEditingNodeSelectAll(false);
        setEditingLabel('');
        setEditingEdgeId(null);
        setEditingEdgeLabel('');
        setEditingSubgraphField('title');
        setEditingContent(false);
        clearSelection();
        setConnectingState(null);
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.kind === 'content') {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        deleteSelection();
        return;
      }

      if (
        event.key === 'Enter' &&
        selection.kind === 'node' &&
        selection.ids.length === 1 &&
        !editingNodeId
      ) {
        const targetNode = documentState.nodes.find((node) => node.id === selection.ids[0]);
        if (targetNode) {
          event.preventDefault();
          startInlineEdit(targetNode, 'description');
        }
        return;
      }

      if (
        event.key === 'Enter' &&
        selection.kind === 'edge' &&
        selection.ids.length === 1 &&
        !editingEdgeId
      ) {
        const targetEdge = documentState.edges.find((edge) => edge.id === selection.ids[0]);
        if (targetEdge) {
          event.preventDefault();
          startEdgeInlineEdit(targetEdge);
        }
        return;
      }

      if (
        event.key === 'Enter' &&
        selection.kind === 'subgraph' &&
        selection.ids.length === 1 &&
        !editingSubgraphId
      ) {
        const targetSubgraph = documentState.subgraphs.find((subgraph) => subgraph.id === selection.ids[0]);
        if (targetSubgraph) {
          event.preventDefault();
          startSubgraphTitleEdit(targetSubgraph, 'description');
        }
        return;
      }

      if (
        event.key === 'Enter' &&
        selection.kind === 'content' &&
        !editingContent
      ) {
        event.preventDefault();
        startContentInlineEdit();
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code === 'Space') {
        setSpacePressed(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    canvasHovered,
    clearSelection,
    copySelection,
    createNodesFromShortcut,
    canvasSearchOpen,
    documentState.nodes,
    documentState.subgraphs,
    deleteSelection,
    duplicateSelection,
    documentState.edges,
    editingEdgeId,
    editingNodeId,
    helpDialogOpen,
    isVsCodeHost,
    goToMode,
    mode,
    redoDocument,
    selection.ids,
    selection.kind,
    pasteSelection,
    startEdgeInlineEdit,
    startContentInlineEdit,
    startInlineEdit,
    startSubgraphTitleEdit,
    subgraphFrames,
    updateViewport,
    undoDocument,
    visibleNodes,
    wrapSelectionInSubgraph,
    zoomViewportAtPoint,
    editingContent,
    editingSubgraphId,
  ]);

  useEffect(() => {
    if (!dragState && !boxState && !panState && !connectingState) {
      return;
    }

    const resolveHierarchyTargets = (pointer: Point, activeDragState: DragState) => measurePerf(
      'drag.resolveHierarchyTargets',
      () => {
        const excludedNodeIds = activeDragState.ids;
        const excludedSubgraphIds = activeDragState.kind === 'subgraph' && activeDragState.entityId
          ? [activeDragState.entityId]
          : [];
        const nextNodeTargetId = findNodeDropTargetFromEntries(
          visibleNodeSpatialIndex.queryPoint(pointer, 8),
          pointer,
          excludedNodeIds,
        );
        const insertableEndpointId = activeDragState.kind === 'subgraph'
          ? activeDragState.entityId ?? null
          : activeDragState.ids.length === 1
            ? activeDragState.ids[0]
            : null;
        const nextEdgeTargetId = nextNodeTargetId || !insertableEndpointId
          ? null
          : findEdgeDropTargetFromEntries(
            pointer,
            sceneEdgeSpatialIndex.queryPoint(pointer, 36),
            [insertableEndpointId],
          );
        const nextSubgraphTargetId =
          nextNodeTargetId || nextEdgeTargetId
            ? null
            : findSubgraphDropTargetFromEntries(
              subgraphBlobSpatialIndex.queryPoint(pointer, 8),
              pointer,
              excludedSubgraphIds,
            );

        return {
          nodeId: nextNodeTargetId,
          edgeId: nextEdgeTargetId,
          subgraphId: nextSubgraphTargetId,
        };
      },
    );

    const applyPointerMove = (
      clientX: number,
      clientY: number,
      ctrlKey: boolean,
      metaKey: boolean,
      shiftKey: boolean,
    ) => {
      const startedAt = perfDebugEnabled ? performance.now() : 0;
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const pendingBackground = pendingBackgroundRef.current;
      if (pendingBackground) {
        const delta = Math.hypot(
          clientX - pendingBackground.clientX,
          clientY - pendingBackground.clientY,
        );
        if (delta > 8) {
          clearPendingBackgroundInteraction();
          setPanState({
            origin: { x: clientX, y: clientY },
            initialViewport: seedPanInitialViewport(liveViewportRef.current as HotPathViewport),
          });
        }
      }

      const bounds = canvas.getBoundingClientRect();
      // Prefer live viewport during pan so hit-tests stay correct without React state.
      const viewport = liveViewportRef.current;
      const x = (clientX - bounds.left - viewport.x) / viewport.zoom;
      const y = (clientY - bounds.top - viewport.y) / viewport.zoom;

      if (perfDebugEnabled) {
        perfCountersRef.current.pointerMoves += 1;
      }

      if (dragState) {
        if (perfDebugEnabled) {
          perfCountersRef.current.dragPointerMoves += 1;
        }
        const nextDragState = {
          ...dragState,
          current: { x, y },
        };
        scheduleImperativeDragPreview(nextDragState);

        if (dragState.kind !== 'content' && (ctrlKey || metaKey)) {
          const targets = resolveHierarchyTargets({ x, y }, nextDragState);
          const currentTargets = dragDropTargetsRef.current;
          if (!currentTargets.reparentMode) {
            dragDropTargetsRef.current = { ...currentTargets, reparentMode: true };
            setDragReparentMode(true);
          }
          if (
            currentTargets.nodeId !== targets.nodeId ||
            currentTargets.edgeId !== targets.edgeId ||
            currentTargets.subgraphId !== targets.subgraphId
          ) {
            dragDropTargetsRef.current = {
              nodeId: targets.nodeId,
              edgeId: targets.edgeId,
              subgraphId: targets.subgraphId,
              reparentMode: true,
            };
            setDragTargetNodeId(targets.nodeId);
            setDragTargetEdgeId(targets.edgeId);
            setDragTargetSubgraphId(targets.subgraphId);
          }
        } else {
          const currentTargets = dragDropTargetsRef.current;
          if (
            currentTargets.reparentMode ||
            currentTargets.nodeId ||
            currentTargets.edgeId ||
            currentTargets.subgraphId
          ) {
            dragDropTargetsRef.current = {
              nodeId: null,
              edgeId: null,
              subgraphId: null,
              reparentMode: false,
            };
            setDragReparentMode(false);
            setDragTargetNodeId(null);
            setDragTargetEdgeId(null);
            setDragTargetSubgraphId(null);
          }
        }
      }

      if (boxState) {
        if (perfDebugEnabled) {
          perfCountersRef.current.boxPointerMoves += 1;
        }
        setBoxState((current) =>
          current
            ? {
                ...current,
                current: { x, y },
                toggle: shiftKey,
              }
            : null,
        );
      }

      if (panState) {
        if (perfDebugEnabled) {
          perfCountersRef.current.panPointerMoves += 1;
        }
        const nextViewport = {
          ...panState.initialViewport,
          x: panState.initialViewport.x + (clientX - panState.origin.x),
          y: panState.initialViewport.y + (clientY - panState.origin.y),
        };
        // Hot path: do NOT setDocumentState per frame (avoids full scene re-derive).
        panCommitNeededRef.current = true;
        applyImperativeViewportTransform(nextViewport);
      }

      if (connectingState) {
        if (perfDebugEnabled) {
          perfCountersRef.current.connectPointerMoves += 1;
        }
        setConnectingState((current) =>
          current
            ? {
                ...current,
                current: { x, y },
                edgeType: ctrlKey || metaKey ? 'line' : 'solid',
              }
            : null,
        );
      }

      if (perfDebugEnabled) {
        recordPerfMetric('pointermove.handler', performance.now() - startedAt);
      }
    };

    const flushPendingPointerMove = (fallbackEvent?: PointerEvent) => {
      if (pointerMoveFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerMoveFrameRef.current);
        pointerMoveFrameRef.current = null;
      }

      const pendingMove = pendingPointerMoveRef.current;
      pendingPointerMoveRef.current = null;

      if (pendingMove) {
        applyPointerMove(
          pendingMove.clientX,
          pendingMove.clientY,
          pendingMove.ctrlKey,
          pendingMove.metaKey,
          pendingMove.shiftKey,
        );
        return;
      }

      if (fallbackEvent) {
        applyPointerMove(
          fallbackEvent.clientX,
          fallbackEvent.clientY,
          fallbackEvent.ctrlKey,
          fallbackEvent.metaKey,
          fallbackEvent.shiftKey,
        );
      }
    };

    function onPointerMove(event: PointerEvent) {
      pendingPointerMoveRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      };

      if (pointerMoveFrameRef.current !== null) {
        return;
      }

      pointerMoveFrameRef.current = window.requestAnimationFrame(() => {
        pointerMoveFrameRef.current = null;
        const pendingMove = pendingPointerMoveRef.current;
        pendingPointerMoveRef.current = null;
        if (!pendingMove) {
          return;
        }

        applyPointerMove(
          pendingMove.clientX,
          pendingMove.clientY,
          pendingMove.ctrlKey,
          pendingMove.metaKey,
          pendingMove.shiftKey,
        );
      });
    }

    function onPointerUp(event: PointerEvent) {
      flushPendingPointerMove(event);
      clearPendingBackgroundInteraction();

      const liveDragState = liveDragStateRef.current ?? dragState;
      if (liveDragState) {
        const dragState = liveDragState;
        const deltaX = dragState.current.x - dragState.origin.x;
        const deltaY = dragState.current.y - dragState.origin.y;
        const movedDistance = Math.hypot(deltaX, deltaY);
        const shouldReparent = dragState.kind !== 'content' && (dragReparentMode || event.ctrlKey || event.metaKey);
        const liveTargets = shouldReparent
          ? resolveHierarchyTargets(dragState.current, dragState)
          : null;
        const resolvedTargetNodeId = liveTargets?.nodeId ?? null;
        const resolvedTargetEdgeId = liveTargets?.edgeId ?? null;
        const ambientSubgraphId = shouldReparent
          ? findSubgraphDropTargetFromEntries(
            subgraphBlobSpatialIndex.queryPoint(dragState.current, 8),
            dragState.current,
            dragState.kind === 'subgraph' && dragState.entityId ? [dragState.entityId] : [],
          )
          : null;
        const dropTargetSubgraphId = shouldReparent
          ? (resolvedTargetNodeId || resolvedTargetEdgeId
            ? ambientSubgraphId
            : (liveTargets?.subgraphId ?? dragTargetSubgraphId))
          : null;

        if (dragState.kind === 'content') {
          if (movedDistance > 3) {
            commitDocument(
              (current) =>
                withContentCardLayout(current, {
                  x: (dragState.initialPositions[CONTENT_CARD_ID]?.x ?? contentCardLayout.x) + deltaX,
                  y: (dragState.initialPositions[CONTENT_CARD_ID]?.y ?? contentCardLayout.y) + deltaY,
                  collapsed: contentCardLayout.collapsed,
                }),
              '已移动附加信息',
              '已调整附加信息框位置。',
            );
          }
          endLiveDrag();
          return;
        }

        if (movedDistance > 3 || shouldReparent) {
          commitDocument(
            (current) => {
              const movedSet = new Set(dragState.ids);
              let desiredNodes = current.nodes.map((node) => {
                const initial = dragState.initialPositions[node.id];
                if (!initial) {
                  return node;
                }

                return {
                  ...node,
                  x: Math.round(initial.x + deltaX),
                  y: Math.round(initial.y + deltaY),
                };
              });
              let workingDocument: GraphDocument = {
                ...current,
                nodes: desiredNodes,
              };
              let collisionTargetSubgraphId: string | null = null;

              if (shouldReparent && dragState.kind === 'node') {
                if (resolvedTargetNodeId && !movedSet.has(resolvedTargetNodeId)) {
                  const hostNode = current.nodes.find((node) => node.id === resolvedTargetNodeId) ?? null;
                  if (hostNode) {
                    desiredNodes = centerMovedNodesOnPoint(
                      desiredNodes,
                      dragState.ids,
                      getNodeCenter(hostNode),
                    );
                    workingDocument = {
                      ...current,
                      nodes: desiredNodes
                        .filter((node) => node.id !== hostNode.id)
                        .map((node) =>
                          movedSet.has(node.id)
                            ? { ...node, subgraphId: hostNode.id }
                            : node,
                        ),
                      subgraphs: [
                        ...current.subgraphs.filter((subgraph) => subgraph.id !== hostNode.id),
                        createSubgraphFromNode(hostNode),
                      ],
                    };
                    collisionTargetSubgraphId = hostNode.id;
                  }
                } else {
                  workingDocument = {
                    ...current,
                    nodes: desiredNodes.map((node) =>
                      movedSet.has(node.id)
                        ? { ...node, subgraphId: dropTargetSubgraphId ?? null }
                        : node,
                    ),
                  };
                  collisionTargetSubgraphId = dropTargetSubgraphId;
                }

                if (resolvedTargetEdgeId && dragState.ids.length === 1) {
                  const previewEdge = visibleEdges.find((edge) => edge.id === resolvedTargetEdgeId) ?? null;
                  const previewFrom = previewEdge ? edgeEndpointMap.get(previewEdge.from) ?? null : null;
                  const previewTo = previewEdge ? edgeEndpointMap.get(previewEdge.to) ?? null : null;
                  if (previewEdge && previewFrom && previewTo) {
                    const previewGeometry = buildEdgeGeometry(
                      previewFrom,
                      previewTo,
                      edgeLaneMap.get(previewEdge.id) ?? 0,
                      edgeEndpointOffsetMap.get(previewEdge.id),
                    );
                    workingDocument = {
                      ...workingDocument,
                      nodes: centerMovedNodesOnPoint(
                        workingDocument.nodes,
                        dragState.ids,
                        previewGeometry.mid,
                      ).map((node) =>
                        movedSet.has(node.id)
                          ? { ...node, subgraphId: dropTargetSubgraphId ?? null }
                          : node,
                      ),
                    };
                    collisionTargetSubgraphId = dropTargetSubgraphId;
                  }
                }

                const workingLookup = getVisibleSubgraphIds(workingDocument.subgraphs);
                    workingDocument = {
                      ...workingDocument,
                      nodes: resolveDraggedNodeCollision(
                        workingDocument,
                        dragState.ids,
                        workingDocument.nodes,
                        workingLookup,
                        collisionTargetSubgraphId,
                        null,
                      ),
                    };

                if (resolvedTargetEdgeId && dragState.ids.length === 1) {
                  workingDocument = insertDraggedEndpointIntoEdge(
                    workingDocument,
                    resolvedTargetEdgeId,
                    dragState.ids[0],
                  );
                }

                return maybeConvertSourceSubgraphsToNodes(current, workingDocument, dragState.ids);
              }

              if (shouldReparent && dragState.kind === 'subgraph' && dragState.entityId) {
                if (resolvedTargetNodeId) {
                  const hostNode = current.nodes.find((node) => node.id === resolvedTargetNodeId) ?? null;
                  if (hostNode) {
                    desiredNodes = centerMovedNodesOnPoint(
                      desiredNodes,
                      dragState.ids,
                      getNodeCenter(hostNode),
                    );
                    workingDocument = {
                      ...current,
                      nodes: desiredNodes.filter((node) => node.id !== hostNode.id),
                      subgraphs: [
                        ...current.subgraphs
                          .filter((subgraph) => subgraph.id !== hostNode.id)
                          .map((subgraph) =>
                            subgraph.id === dragState.entityId
                              ? { ...subgraph, parentId: hostNode.id }
                              : subgraph,
                          ),
                        createSubgraphFromNode(hostNode),
                      ],
                    };
                    collisionTargetSubgraphId = hostNode.id;
                  }
                } else {
                  workingDocument = {
                    ...current,
                    nodes: desiredNodes,
                    subgraphs: current.subgraphs.map((subgraph) =>
                      subgraph.id === dragState.entityId
                        ? { ...subgraph, parentId: dropTargetSubgraphId ?? null }
                        : subgraph,
                    ),
                  };
                  collisionTargetSubgraphId = dropTargetSubgraphId;
                }

                if (resolvedTargetEdgeId) {
                  const previewEdge = visibleEdges.find((edge) => edge.id === resolvedTargetEdgeId) ?? null;
                  const previewFrom = previewEdge ? edgeEndpointMap.get(previewEdge.from) ?? null : null;
                  const previewTo = previewEdge ? edgeEndpointMap.get(previewEdge.to) ?? null : null;
                  if (previewEdge && previewFrom && previewTo) {
                    const previewGeometry = buildEdgeGeometry(
                      previewFrom,
                      previewTo,
                      edgeLaneMap.get(previewEdge.id) ?? 0,
                      edgeEndpointOffsetMap.get(previewEdge.id),
                    );
                    workingDocument = {
                      ...workingDocument,
                      nodes: centerMovedNodesOnPoint(
                        workingDocument.nodes,
                        dragState.ids,
                        previewGeometry.mid,
                      ),
                      subgraphs: workingDocument.subgraphs.map((subgraph) =>
                        subgraph.id === dragState.entityId
                          ? { ...subgraph, parentId: dropTargetSubgraphId ?? null }
                          : subgraph,
                      ),
                    };
                    collisionTargetSubgraphId = dropTargetSubgraphId;
                  }
                }

                const workingLookup = getVisibleSubgraphIds(workingDocument.subgraphs);
                workingDocument = {
                  ...workingDocument,
                  nodes: resolveDraggedNodeCollision(
                    workingDocument,
                    dragState.ids,
                    workingDocument.nodes,
                    workingLookup,
                    collisionTargetSubgraphId,
                    null,
                  ),
                };

                if (resolvedTargetEdgeId) {
                  workingDocument = insertDraggedEndpointIntoEdge(
                    workingDocument,
                    resolvedTargetEdgeId,
                    dragState.entityId,
                  );
                }

                return workingDocument;
              }

              const resolvedNodes = resolveDraggedNodeCollision(
                current,
                dragState.ids,
                desiredNodes,
                fullSubgraphLookup,
                null,
                null,
              );

              return {
                ...current,
                nodes: resolvedNodes,
              };
            },
            dragState.kind === 'subgraph' ? '已移动分组' : '已移动节点',
            dragState.kind === 'subgraph'
              ? '已整体移动当前分组及其内部元素。'
              : resolvedTargetEdgeId
                ? `已将 ${dragState.ids[0]} 插入到连线中间，并保留原有连接方向。`
                : resolvedTargetNodeId
                  ? `已将 ${dragState.ids.length} 个节点放入 ${resolvedTargetNodeId}，并将其转换为分组。`
                  : shouldReparent
                ? dropTargetSubgraphId
                  ? `已将 ${dragState.ids.length} 个节点放入 ${dropTargetSubgraphId}。`
                  : `已将 ${dragState.ids.length} 个节点移回外层画布。`
                : `已在画布中移动 ${dragState.ids.length} 个节点。`,
          );
        }
        endLiveDrag();
      }

      if (boxState) {
        const rect = rectFromPoints(boxState.origin, boxState.current);
        const nextNodeIds = visibleNodeSpatialIndex
          .queryRect(rect)
          .map((entry) => entry.item)
          .filter((node) => intersects(rect, node))
          .map((node) => node.id);
        const nextSubgraphIds = subgraphBlobSpatialIndex
          .queryRect(rect)
          .map((entry) => entry.item)
          .filter((shape) => subgraphShapeIntersectsRect(shape, rect))
          .map((shape) => shape.id);

        if (nextNodeIds.length > 0) {
          setSelection((current) =>
            boxState.toggle
              ? toggleNodeSelectionWithSubgraphs(current, nextNodeIds, nextSubgraphIds)
              : withNodeSelection(nextNodeIds, nextSubgraphIds),
          );
        } else {
          if (nextSubgraphIds.length > 0) {
            setSelection((current) =>
              boxState.toggle
                ? toggleSelectionIds(current, 'subgraph', nextSubgraphIds)
                : { kind: 'subgraph', ids: nextSubgraphIds },
            );
          } else {
            const nextEdgeIds = sceneEdgeSpatialIndex
              .queryRect(rect)
              .filter((entry) => edgeIntersectsRect(rect, entry.item.geometry))
              .map((entry) => entry.item.edge.id);

            setSelection((current) =>
              nextEdgeIds.length > 0
                ? (
                  boxState.toggle
                    ? toggleSelectionIds(current, 'edge', nextEdgeIds)
                    : { kind: 'edge', ids: nextEdgeIds }
                )
                : (boxState.toggle ? current : { kind: 'none', ids: [] }),
            );
          }
        }
        setBoxState(null);
      }

      if (panState) {
        const delta = Math.hypot(
          event.clientX - panState.origin.x,
          event.clientY - panState.origin.y,
        );
        if (delta > 4) {
          setHistory((current) => [
            createHistoryEntry('视口已移动', '已调整画布视口位置。'),
            ...current,
          ].slice(0, 40));
        }
        if (panCommitNeededRef.current) {
          commitLiveViewportToDocument();
        }
        setPanState(null);
      }

      if (connectingState) {
        const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-edge-endpoint-id]');
        const targetId = target?.dataset.edgeEndpointId;
        const isSubgraphTarget = !!targetId && documentState.subgraphs.some((subgraph) => subgraph.id === targetId);
        const targetIsExplicitGroupEndpoint = !!(event.target as HTMLElement | null)?.closest(
          '.subgraph-frame__connector, .subgraph-frame__header, .subgraph-frame__title-input, .subgraph-frame__action',
        );
        const treatGroupBodyAsBlankDrop = isSubgraphTarget && !targetIsExplicitGroupEndpoint;
        const dragDistance = Math.hypot(
          connectingState.current.x - connectingState.origin.x,
          connectingState.current.y - connectingState.origin.y,
        );
        const sourceIds = connectingState.fromIds.length > 0
          ? connectingState.fromIds
          : [connectingState.fromId];

        if (targetId && !treatGroupBodyAsBlankDrop && sourceIds.some((sourceId) => sourceId !== targetId)) {
          const nextEdges = sourceIds
            .filter((sourceId) => sourceId !== targetId)
            .map((sourceId) => ({
              id: crypto.randomUUID(),
              from: sourceId,
              to: targetId,
              label: '',
              type: connectingState.edgeType,
              strokeColor: defaultEdgeStyle.strokeColor,
              strokeWidth: defaultEdgeStyle.strokeWidth,
            }));
          commitDocument(
            (current) => ({
              ...current,
              edges: [...current.edges, ...nextEdges],
            }),
            '已创建连线',
            sourceIds.length > 1
              ? `已将 ${sourceIds.length} 个来源汇聚连接到 ${targetId}。`
              : `已将 ${connectingState.fromId} 连接到 ${targetId}。`,
          );
          setSelection({ kind: 'edge', ids: nextEdges.map((edge) => edge.id) });
        } else if (dragDistance > 6) {
          const point = pointFromClient(event.clientX, event.clientY);
          if (!point) {
            setConnectingState(null);
            return;
          }
          createNodeAtForSources(
            point,
            sourceIds,
            connectingState.edgeType,
            resolveSubgraphAtPoint(point),
          );
        }

        setConnectingState(null);
      }
    }

    function onPointerCancel() {
      flushPendingPointerMove();
      clearPendingBackgroundInteraction();
      endLiveDrag();
      setBoxState(null);
      if (panCommitNeededRef.current) {
        commitLiveViewportToDocument();
      }
      setPanState(null);
      setConnectingState(null);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    return () => {
      if (pointerMoveFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerMoveFrameRef.current);
        pointerMoveFrameRef.current = null;
      }
      pendingPointerMoveRef.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [
    boxState,
    clearPendingBackgroundInteraction,
    commitDocument,
    contentCardLayout.collapsed,
    contentCardLayout.x,
    contentCardLayout.y,
    contentCardRect,
    connectingState,
    createNodeAtForSources,
    documentState.layout.viewport,
    documentState.nodes,
    documentState.subgraphs,
    dragState,
    dragReparentMode,
    dragTargetEdgeId,
    dragTargetNodeId,
    dragTargetSubgraphId,
    endLiveDrag,
    edgeEndpointMap,
    edgeLaneMap,
    edgeEndpointOffsetMap,
    allSubgraphBlobShapes,
    allSubgraphFrames,
    applyImperativeViewportTransform,
    commitLiveViewportToDocument,
    measurePerf,
    perfDebugEnabled,
    recordPerfMetric,
    subgraphFrames,
    fullSubgraphLookup,
    panState,
    pointFromClient,
    resolveSubgraphAtPoint,
    scheduleImperativeDragPreview,
    sceneEdgeSpatialIndex,
    subgraphBlobShapes,
    subgraphBlobSpatialIndex,
    visibleNodeSpatialIndex,
    visibleEdges,
    visibleNodes,
  ]);

  function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!canvasRef.current) {
      return;
    }

    event.preventDefault();

    const deltaScale = event.deltaMode === 1 ? 16 : 1;

    if (event.ctrlKey || event.metaKey) {
      // Continuous pinch/wheel zoom: live path only (no setDocumentState per event).
      zoomViewportAtPoint(
        event.clientX,
        event.clientY,
        Math.exp((-event.deltaY * deltaScale) / WHEEL_PINCH_DIVISOR),
        { commit: 'live' },
      );
      return;
    }

    const deltaX = event.deltaX * deltaScale;
    const deltaY = event.deltaY * deltaScale;

    // Trackpad pan: live viewport — document commit is debounced.
    applyLiveViewportUpdate((viewport) => applyWheelPanViewport(
      viewport as HotPathViewport,
      deltaX,
      deltaY,
    ));
  }

  const handleNodePointerInteraction = useCallback((
    pointer: {
      clientX: number;
      clientY: number;
      button: number;
      altKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    },
    node: GraphNode,
  ) => {
    if (editingNodeId) {
      return true;
    }

    if (pointer.button === 1) {
      setPanState({
        origin: { x: pointer.clientX, y: pointer.clientY },
        initialViewport: seedPanInitialViewport(liveViewportRef.current as HotPathViewport),
      });
      return true;
    }

    const point = pointFromClient(pointer.clientX, pointer.clientY);
    if (!point) {
      return true;
    }

    const activeIds = selection.kind === 'node' && selectionContains(selection, node.id)
      ? selection.ids
      : [node.id];

    if (pointer.button === 2) {
      setSelection({ kind: 'node', ids: activeIds });
      setConnectingState({
        fromId: activeIds[0],
        fromIds: activeIds,
        origin: point,
        current: point,
        edgeType: pointer.ctrlKey || pointer.metaKey ? 'line' : 'solid',
        handleSide: pointer.clientX < node.x + node.width / 2 ? 'left' : 'right',
      });
      return true;
    }

    if (pointer.button !== 0) {
      return false;
    }

    if (pointer.altKey) {
      const currentDocument = structuredClone(documentRef.current);
      const duplicateSourceIds = activeIds;
      const { duplicatedNodes, duplicatedEdges } = duplicateNodesWithEdges(currentDocument, duplicateSourceIds, { x: 0, y: 0 });
      const nextDocument = materializeDocument({
        ...currentDocument,
        nodes: [...currentDocument.nodes, ...duplicatedNodes],
        edges: [...currentDocument.edges, ...duplicatedEdges],
      });

      applyCommittedDocument(
        nextDocument,
        '已复制选中节点',
        `已复制 ${duplicatedNodes.length} 个节点。`,
        currentDocument,
      );

      const duplicatedIds = duplicatedNodes.map((entry) => entry.id);
      setSelection({ kind: 'node', ids: duplicatedIds });
      beginLiveDrag({
        kind: 'node',
        origin: point,
        current: point,
        ids: duplicatedIds,
        initialPositions: Object.fromEntries(
          duplicatedNodes.map((entry) => [entry.id, { x: entry.x, y: entry.y }]),
        ),
      });
      return true;
    }

    if (pointer.shiftKey) {
      const nextSelection = toggleSelectionIds(selection, 'node', [node.id]);
      setSelection(nextSelection);
      return true;
    }

    setSelection({ kind: 'node', ids: activeIds });

    const initialPositions = Object.fromEntries(
      documentState.nodes
        .filter((entry) => activeIds.includes(entry.id))
        .map((entry) => [entry.id, { x: entry.x, y: entry.y }]),
    );

    beginLiveDrag({
      kind: 'node',
      origin: point,
      current: point,
      ids: activeIds,
      initialPositions,
      entityId: activeIds.length === 1 ? activeIds[0] : null,
    });
    return true;
  }, [applyCommittedDocument, beginLiveDrag, documentState.layout.viewport, documentState.nodes, editingNodeId, pointFromClient, selection]);

  const findSceneHitAtPoint = useCallback((point: Point) => {
    const nodeId = findNodeDropTargetFromEntries(
      visibleNodeSpatialIndex.queryPoint(point, 8),
      point,
    );
    if (nodeId) {
      return { kind: 'node' as const, id: nodeId };
    }

    const edgeId = findEdgeDropTargetFromEntries(
      point,
      sceneEdgeSpatialIndex.queryPoint(point, 36),
    );
    if (edgeId) {
      return { kind: 'edge' as const, id: edgeId };
    }

    const subgraphId = findSubgraphDropTargetFromEntries(
      subgraphBlobSpatialIndex.queryPoint(point, 8),
      point,
    );
    if (subgraphId) {
      return { kind: 'subgraph' as const, id: subgraphId };
    }

    return null;
  }, [sceneEdgeSpatialIndex, subgraphBlobSpatialIndex, visibleNodeSpatialIndex]);

  function startBackgroundInteraction(event: ReactPointerEvent<HTMLDivElement>) {
    if (canvasSearchOpen) {
      setCanvasSearchOpen(false);
    }

    if (event.button === 1) {
      event.preventDefault();
      setPanState({
        origin: { x: event.clientX, y: event.clientY },
        initialViewport: seedPanInitialViewport(liveViewportRef.current as HotPathViewport),
      });
      return;
    }

    if (event.button !== 0 && !(hybridSceneActive && event.button === 2)) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest('.graph-node, .subgraph-frame, .content-card')) {
      return;
    }

    const point = pointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    if (hybridSceneActive) {
      const sceneHit = findSceneHitAtPoint(point);
      if (sceneHit?.kind === 'node') {
        const node = documentState.nodes.find((entry) => entry.id === sceneHit.id);
        if (node) {
          event.preventDefault();
          handleNodePointerInteraction({
            clientX: event.clientX,
            clientY: event.clientY,
            button: event.button,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          }, node);
          return;
        }
      }

      if (sceneHit?.kind === 'edge') {
        event.preventDefault();
        if (event.shiftKey) {
          setSelection((current) => toggleSelectionIds(current, 'edge', [sceneHit.id]));
        } else {
          setSelection({ kind: 'edge', ids: [sceneHit.id] });
        }
        return;
      }

      if (sceneHit?.kind === 'subgraph') {
        event.preventDefault();
        selectSubgraphAtPoint(sceneHit.id, point, event.shiftKey);
        return;
      }
    }

    if (spacePressed) {
      setPanState({
        origin: { x: event.clientX, y: event.clientY },
        initialViewport: seedPanInitialViewport(liveViewportRef.current as HotPathViewport),
      });
      return;
    }

    if (!event.shiftKey) {
      clearSelection();
    }
    if (isMobileViewport || event.pointerType === 'touch') {
      clearPendingBackgroundInteraction();
      pendingBackgroundRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        point,
      };
      backgroundHoldRef.current = window.setTimeout(() => {
        setBoxState({
          origin: point,
          current: point,
          toggle: event.shiftKey,
        });
        clearPendingBackgroundInteraction();
      }, 220);
      return;
    }

    setBoxState({
      origin: point,
      current: point,
      toggle: event.shiftKey,
    });
  }

  function startNodeDrag(event: ReactPointerEvent<HTMLDivElement>, node: GraphNode) {
    event.stopPropagation();
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
    }
    handleNodePointerInteraction({
      clientX: event.clientX,
      clientY: event.clientY,
      button: event.button,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    }, node);
  }

  function startSubgraphDrag(
    event: ReactPointerEvent<Element>,
    subgraphId: string,
  ) {
    if (editingSubgraphId) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button, input, textarea')) {
      return;
    }

    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      setPanState({
        origin: { x: event.clientX, y: event.clientY },
        initialViewport: seedPanInitialViewport(liveViewportRef.current as HotPathViewport),
      });
      return;
    }

    event.stopPropagation();
    const point = pointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    if (event.button === 2) {
      event.preventDefault();
      const frame = allSubgraphFrameMap.get(subgraphId);
      setSelection({ kind: 'subgraph', ids: [subgraphId] });
      setConnectingState({
        fromId: subgraphId,
        fromIds: [subgraphId],
        origin: point,
        current: point,
        edgeType: event.ctrlKey || event.metaKey ? 'line' : 'solid',
        handleSide: event.clientX < ((frame?.x ?? 0) + (frame?.width ?? 0) / 2) ? 'left' : 'right',
      });
      return;
    }

    if (event.button !== 0) {
      return;
    }

    if (event.shiftKey) {
      setSelection((current) => toggleSelectionIds(current, 'subgraph', [subgraphId]));
      return;
    }

    const memberIds = collectNodeIdsForSubgraph(subgraphId, documentState.nodes, fullSubgraphLookup);
    if (memberIds.length === 0) {
      setSelection({ kind: 'subgraph', ids: [subgraphId] });
      return;
    }

    setSelection({ kind: 'subgraph', ids: [subgraphId] });
    beginLiveDrag({
      kind: 'subgraph',
      origin: point,
      current: point,
      ids: memberIds,
      initialPositions: Object.fromEntries(
        documentState.nodes
          .filter((node) => memberIds.includes(node.id))
          .map((node) => [node.id, { x: node.x, y: node.y }]),
      ),
      entityId: subgraphId,
    });
  }

  function beginConnection(
    event: ReactPointerEvent<HTMLElement>,
    endpoint: Pick<EdgeEndpointBox, 'id' | 'x' | 'y' | 'width' | 'height'>,
    handleSide: 'left' | 'right',
  ) {
    event.stopPropagation();
    event.preventDefault();
    if (!canvasRef.current) {
      return;
    }

    const current = pointFromClient(event.clientX, event.clientY);
    if (!current) {
      return;
    }
    setConnectingState({
      fromId: endpoint.id,
      fromIds: [endpoint.id],
      origin: current,
      current,
      edgeType: event.ctrlKey || event.metaKey ? 'line' : 'solid',
      handleSide,
    });
  }

  const selectedNode =
    selection.kind === 'node' && selection.ids.length === 1
      ? documentState.nodes.find((node) => node.id === selection.ids[0]) ?? null
      : null;
  const selectedNodes = useMemo(
    () => (
      selection.kind === 'node'
        ? documentState.nodes.filter((node) => selection.ids.includes(node.id))
        : []
    ),
    [documentState.nodes, selection.ids, selection.kind],
  );
  const selectedEdge =
    selection.kind === 'edge' && selection.ids.length === 1
      ? (() => {
        const edge = documentState.edges.find((entry) => entry.id === selection.ids[0]) ?? null;
        return edge ? normalizeEdgeStyle(edge) : null;
      })()
      : null;
  const selectedSubgraph =
    selection.kind === 'subgraph' && selection.ids.length === 1
      ? documentState.subgraphs.find((subgraph) => subgraph.id === selection.ids[0]) ?? null
      : null;
  const selectedContent =
    selection.kind === 'content' && selection.ids[0] === CONTENT_CARD_ID;
  const nodeStyleSelectionSource =
    selectedNodes.length === 1
      ? selectedNodes[0]
      : selectedNodes.length > 1 &&
          selectedNodes.every((node) =>
            node.fill === selectedNodes[0]?.fill &&
            node.stroke === selectedNodes[0]?.stroke &&
            node.textColor === selectedNodes[0]?.textColor,
          )
        ? selectedNodes[0]
        : null;
  const selectedNodePresetId = nodeStyleSelectionSource
    ? nodeStylePresets.find((preset) =>
      preset.fill === nodeStyleSelectionSource.fill &&
      preset.stroke === nodeStyleSelectionSource.stroke &&
      preset.textColor === nodeStyleSelectionSource.textColor,
    )?.id ?? null
    : null;
  const selectedCompanionSubgraphCount =
    selection.kind === 'node' ? (selection.subgraphIds ?? []).length : 0;
  const selectionLabel =
    selection.kind === 'none'
      ? '未选中任何内容'
      : selection.kind === 'node' && selectedCompanionSubgraphCount > 0
        ? `已选中 ${selection.ids.length} 个节点 / ${selectedCompanionSubgraphCount} 个分组`
        : `已选中 ${selection.ids.length} 个${selectionKindLabel(selection.kind)}`;
  const activeModeLabel =
    mode === 'canvas' ? '画布模式' : mode === 'source' ? '源码模式' : '历史模式';
  const canGroupSelection = selection.kind === 'node' && selection.ids.length >= 2;
  const visibleLeftPanels = isVsCodeHost
    ? leftPanelMeta.filter((item) => item.id === 'graph')
    : leftPanelMeta;
  const visibleModeMeta = isVsCodeHost ? [] : modeMeta;
  const vscodeFileLabel = hostConfig.fileName ?? 'untitled.lmd';
  const supportsLocalProjectPicker =
    typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
  const supportsLocalMarkdownPicker =
    typeof (window as Window & { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function';
  const showSidebar = mode === 'canvas' ? sidebarOpen : isMobileViewport ? sidebarOpen : true;
  const showInspector = mode === 'canvas' ? inspectorOpen : isMobileViewport ? inspectorOpen : true;
  const clampPanelWidth = useCallback((
    side: 'left' | 'right',
    requestedWidth: number,
    overrides?: { sidebar?: number; inspector?: number },
  ) => {
    const fallback = side === 'left' ? DEFAULT_SIDEBAR_WIDTH : DEFAULT_INSPECTOR_WIDTH;
    if (isMobileViewport) {
      return fallback;
    }

    const min = side === 'left' ? MIN_SIDEBAR_WIDTH : MIN_INSPECTOR_WIDTH;
    const max = side === 'left' ? MAX_SIDEBAR_WIDTH : MAX_INSPECTOR_WIDTH;
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const resolvedSidebarWidth = overrides?.sidebar ?? sidebarWidth;
    const resolvedInspectorWidth = overrides?.inspector ?? inspectorWidth;
    const oppositeWidth = side === 'left'
      ? (showInspector ? resolvedInspectorWidth : 0)
      : (showSidebar ? resolvedSidebarWidth : 0);
    const available = workspaceWidth - NAV_RAIL_WIDTH - oppositeWidth - MIN_WORKSPACE_CENTER_WIDTH;

    return clamp(requestedWidth, min, Math.max(min, Math.min(max, available)));
  }, [inspectorWidth, isMobileViewport, showInspector, showSidebar, sidebarWidth]);
  const workspaceClassName = `workspace workspace--${mode}${isMobileViewport ? ' workspace--mobile' : ''}${showSidebar ? ' workspace--sidebar-open' : ''}${showInspector ? ' workspace--inspector-open' : ''}${panelResizeState ? ' workspace--resizing' : ''}`;
  const appShellClassName = `app-shell${isMobileViewport ? ' app-shell--mobile' : ''}${isConstrainedDevice ? ' app-shell--constrained' : ''}${isVsCodeHost ? ' app-shell--vscode' : ''}`;
  const mobileOverlayOpen = isMobileViewport && (showSidebar || mobileSourcePreviewOpen);
  const workspaceStyle = useMemo(() => ({
    '--nav-width': `${isVsCodeHost ? 0 : NAV_RAIL_WIDTH}px`,
    '--sidebar-width': showSidebar ? `${clampPanelWidth('left', sidebarWidth)}px` : '0px',
    '--inspector-width': showInspector ? `${clampPanelWidth('right', inspectorWidth)}px` : '0px',
  }) as CSSProperties, [clampPanelWidth, inspectorWidth, isVsCodeHost, showInspector, showSidebar, sidebarWidth]);
  const startPanelResize = useCallback((side: 'left' | 'right', event: ReactPointerEvent<HTMLDivElement>) => {
    if (isMobileViewport) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setPanelResizeState({
      side,
      startX: event.clientX,
      startWidth: side === 'left' ? sidebarWidth : inspectorWidth,
    });
  }, [inspectorWidth, isMobileViewport, sidebarWidth]);

  useEffect(() => {
    if (selectedNodes.length === 0) {
      return;
    }
    const primaryNode = selectedNodes[0];
    const parts = splitEntityText(primaryNode.label);

    setNodeInspectorDraft({
      label: parts.title,
      description: parts.description,
      shape: primaryNode.shape,
      fill: primaryNode.fill,
      stroke: primaryNode.stroke,
      textColor: primaryNode.textColor,
    });
  }, [selectedNodes]);

  useEffect(() => {
    if (!selectedEdge) {
      return;
    }

    setEdgeInspectorDraft({
      label: selectedEdge.label,
      type: selectedEdge.type,
      strokeColor: selectedEdge.strokeColor,
      strokeWidthInput: String(selectedEdge.strokeWidth),
    });
  }, [selectedEdge]);

  useEffect(() => {
    if (!selectedSubgraph) {
      return;
    }
    const parts = splitEntityText(selectedSubgraph.title);

    setSubgraphInspectorDraft({
      title: parts.title,
      description: parts.description,
      collapsed: selectedSubgraph.collapsed,
      fill: selectedSubgraph.fill,
      stroke: selectedSubgraph.stroke,
      textColor: selectedSubgraph.textColor,
    });
  }, [selectedSubgraph]);

  useEffect(() => {
    if (!selectedContent) {
      return;
    }

    setContentInspectorDraft({
      markdown: contentMarkdown,
    });
  }, [contentMarkdown, selectedContent]);

  useEffect(() => {
    if (selectedNode || selectedEdge || selectedSubgraph || selectedContent) {
      return;
    }

    setProjectInspectorDraft({
      projectName: documentState.projectName ?? 'Untitled Project',
      projectSummary: documentState.projectSummary ?? '',
      contentMarkdown: contentMarkdown,
    });
  }, [
    contentMarkdown,
    documentState.projectName,
    documentState.projectSummary,
    selectedContent,
    selectedEdge,
    selectedNode,
    selectedSubgraph,
  ]);

  useEffect(() => {
    if (selection.kind === 'subgraph') {
      return;
    }

    setEditingSubgraphId(null);
    setEditingSubgraphTitle('');
    setEditingSubgraphField('title');
  }, [selection.kind]);

  useEffect(() => {
    if (!editingNodeId) {
      return;
    }

    const editor = editingNodeField === 'title'
      ? nodeTitleEditorRef.current
      : nodeDescriptionEditorRef.current;
    if (!editor) {
      return;
    }

    const value = getInlineEntityFieldValue(editingLabelRef.current, editingNodeField);
    window.requestAnimationFrame(() => {
      focusControlWithoutScroll(editor);
      const caretPosition = value.length;
      const shouldAutoSelectPlaceholderTitle =
        editingNodeField === 'title' && shouldSelectAllInlineNodeField(value, 'title');
      pendingPlaceholderTitleSelectAllRef.current =
        editingNodeField === 'title' && (editingNodeSelectAll || shouldAutoSelectPlaceholderTitle);
      if (editingNodeSelectAll || shouldAutoSelectPlaceholderTitle) {
        editor.select();
        editor.selectionStart = 0;
        editor.selectionEnd = value.length;
      } else {
        editor.selectionStart = caretPosition;
        editor.selectionEnd = caretPosition;
      }
      if (editingNodeSelectAll) {
        setEditingNodeSelectAll(false);
      }
    });
  }, [editingNodeField, editingNodeId, editingNodeSelectAll]);

  useEffect(() => {
    if (!editingNodeId) {
      return;
    }

    const timer = window.setTimeout(() => {
      persistInlineNodeDraft(editingNodeId, {
        historyTitle: '已暂存节点',
        historyDetail: '已根据输入停顿自动暂存节点草稿。',
      });
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [editingLabel, editingNodeId, persistInlineNodeDraft]);

  useEffect(() => {
    if (!editingSubgraphId || !subgraphEditorRef.current) {
      return;
    }

    const editor = subgraphEditorRef.current;
    const range = getEntitySelectionRange(editingSubgraphTitleRef.current, editingSubgraphField);
    window.requestAnimationFrame(() => {
      focusControlWithoutScroll(editor);
      editor.selectionStart = range.start;
      editor.selectionEnd = range.end;
    });
  }, [editingSubgraphField, editingSubgraphId]);

  useLayoutEffect(() => {
    if (!editingNodeId && !editingSubgraphId && !editingContent) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      resetWorkbenchScrollOffsets();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [
    contentInspectorDraft.markdown,
    editingContent,
    editingLabel,
    editingNodeId,
    editingSubgraphId,
    editingSubgraphTitle,
    resetWorkbenchScrollOffsets,
  ]);

  useLayoutEffect(() => {
    if (!editingNodeId) {
      return;
    }

    const editingNode = documentState.nodes.find((node) => node.id === editingNodeId) ?? null;
    if (!editingNode) {
      return;
    }

    const { title, description } = splitEntityText(editingLabel || ' ');
    const nextSize = measureNodeContentSize(title, description);
    keepNodeEditorVisibleInCanvas({
      x: editingNode.x,
      y: editingNode.y,
      width: nextSize.width,
      height: nextSize.height,
    });
  }, [
    documentState.nodes,
    editingLabel,
    editingNodeId,
    keepNodeEditorVisibleInCanvas,
  ]);

  useEffect(() => {
    if (!editingNodeId && !editingSubgraphId && !editingContent) {
      return;
    }

    const handleScroll = () => {
      resetWorkbenchScrollOffsets();
    };

    const scrollTargets = [workspaceRef.current, workspaceMainRef.current, canvasRef.current]
      .filter((target): target is HTMLElement => target instanceof HTMLElement);

    scrollTargets.forEach((target) => {
      target.addEventListener('scroll', handleScroll, { passive: true });
    });
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.visualViewport?.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      scrollTargets.forEach((target) => {
        target.removeEventListener('scroll', handleScroll);
      });
      window.removeEventListener('scroll', handleScroll);
      window.visualViewport?.removeEventListener('scroll', handleScroll);
    };
  }, [editingContent, editingNodeId, editingSubgraphId, resetWorkbenchScrollOffsets]);

  useEffect(() => {
    localStorage.setItem(storageKeys.aiSettings, JSON.stringify(aiSettings));
  }, [aiSettings]);

  useEffect(() => {
    if (aiRecords.length === 0) {
      const initialRecord = createAiConversationRecord();
      setAiRecords([initialRecord]);
      setActiveAiRecordId(initialRecord.id);
      setAiMessages(initialRecord.messages);
      return;
    }

    if (!aiRecords.some((record) => record.id === activeAiRecordId)) {
      setActiveAiRecordId(aiRecords[0].id);
    }
  }, [activeAiRecordId, aiRecords]);

  useEffect(() => {
    if (!activeAiRecord) {
      return;
    }

    const nextMessages = normalizeStoredAiMessages(activeAiRecord.messages);
    setAiMessages((current) => (sameAiMessages(current, nextMessages) ? current : nextMessages));
  }, [activeAiRecord]);

  useEffect(() => {
    localStorage.setItem(storageKeys.sidebarWidth, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem(storageKeys.inspectorWidth, String(Math.round(inspectorWidth)));
  }, [inspectorWidth]);

  useEffect(() => {
    if (!activeAiRecord) {
      return;
    }

    const nextTitle = deriveAiConversationTitle(aiMessages);
    const nextMessages = aiMessages.slice(-32);
    setAiRecords((current) => {
      let changed = false;
      const nextRecords = current.map((record) => {
        if (record.id !== activeAiRecord.id) {
          return record;
        }

        if (record.title === nextTitle && sameAiMessages(record.messages, nextMessages)) {
          return record;
        }

        changed = true;
        return {
          ...record,
          title: nextTitle,
          updatedAt: new Date().toISOString(),
          messages: nextMessages,
        };
      });
      return changed ? nextRecords : current;
    });
    localStorage.setItem(storageKeys.aiChat, JSON.stringify(aiMessages.slice(-24)));
    localStorage.setItem(storageKeys.aiActiveSession, activeAiRecord.id);
  }, [activeAiRecord, aiMessages]);

  useEffect(() => {
    localStorage.setItem(storageKeys.aiSessions, JSON.stringify(aiRecords));
  }, [aiRecords]);

  useEffect(() => {
    aiLastMarkdownRef.current = aiLastMarkdown;
    if (aiLastMarkdown) {
      localStorage.setItem(storageKeys.aiLastMarkdown, aiLastMarkdown);
    } else {
      localStorage.removeItem(storageKeys.aiLastMarkdown);
    }
  }, [aiLastMarkdown]);

  useEffect(() => {
    if (!canvasSearchOpen) {
      return;
    }

    window.requestAnimationFrame(() => {
      canvasSearchInputRef.current?.focus();
      canvasSearchInputRef.current?.select();
    });
  }, [canvasSearchOpen]);

  useEffect(() => {
    if (!canvasSearchOpen) {
      return;
    }

    if (!searchRestoreViewportRef.current) {
      searchRestoreViewportRef.current = { ...documentState.layout.viewport };
    }

    setCanvasSearchFocusIndex(0);
    if (canvasSearchQuery.trim()) {
      focusCanvasSearchMatches(canvasSearchResults);
    }
  }, [
    canvasSearchOpen,
    canvasSearchQuery,
    canvasSearchResults,
    documentState.layout.viewport,
    focusCanvasSearchMatches,
  ]);

  useEffect(() => {
    if (!panelResizeState || isMobileViewport) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (event: PointerEvent) => {
      const deltaX = event.clientX - panelResizeState.startX;
      if (panelResizeState.side === 'left') {
        setSidebarWidth(clampPanelWidth('left', panelResizeState.startWidth + deltaX));
        return;
      }

      setInspectorWidth(clampPanelWidth('right', panelResizeState.startWidth - deltaX));
    };

    const stopResize = () => {
      setPanelResizeState(null);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [clampPanelWidth, isMobileViewport, panelResizeState]);

  useEffect(() => {
    if (!contentCardResizeState) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor =
      contentCardResizeState.edge === 'right'
        ? 'ew-resize'
        : contentCardResizeState.edge === 'bottom'
          ? 'ns-resize'
          : 'nwse-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (event: PointerEvent) => {
      const deltaX = event.clientX - contentCardResizeState.startX;
      const deltaY = event.clientY - contentCardResizeState.startY;
      const nextWidth = clamp(
        contentCardResizeState.startWidth +
          (contentCardResizeState.edge === 'bottom' ? 0 : deltaX),
        CONTENT_CARD_MIN_WIDTH,
        CONTENT_CARD_MAX_WIDTH,
      );
      const nextHeight = clamp(
        contentCardResizeState.startHeight +
          (contentCardResizeState.edge === 'right' ? 0 : deltaY),
        CONTENT_CARD_MIN_HEIGHT,
        CONTENT_CARD_MAX_HEIGHT,
      );

      setContentCardResizeState((current) => (
        current
          ? {
              ...current,
              width: nextWidth,
              height: nextHeight,
            }
          : current
      ));
    };

    const stopResize = () => {
      setContentCardResizeState((current) => {
        if (!current) {
          return current;
        }

        const finalWidth = clamp(current.width, CONTENT_CARD_MIN_WIDTH, CONTENT_CARD_MAX_WIDTH);
        const finalHeight = clamp(current.height, CONTENT_CARD_MIN_HEIGHT, CONTENT_CARD_MAX_HEIGHT);
        commitDocument(
          (document) => withContentCardLayout(document, {
            ...contentCardLayout,
            width: finalWidth,
            height: finalHeight,
          }),
          '已调整附加信息',
          '已更新附加信息窗口尺寸。',
        );

        return null;
      });
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [commitDocument, contentCardLayout, contentCardResizeState]);

  useEffect(() => {
    if (isMobileViewport) {
      return;
    }

    const syncPanelWidths = () => {
      setSidebarWidth((current) => clampPanelWidth('left', current));
      setInspectorWidth((current) => clampPanelWidth('right', current));
    };

    syncPanelWidths();
    window.addEventListener('resize', syncPanelWidths);

    return () => {
      window.removeEventListener('resize', syncPanelWidths);
    };
  }, [clampPanelWidth, isMobileViewport]);

  const getProjectMarkdown = useCallback(() => (
    documentRef.current.markdown ?? documentRef.current.source
  ), []);

  const setProjectMarkdown = useCallback((markdown: string) => {
    const currentDocument = structuredClone(documentRef.current);
    const parsed = parseProjectMarkdown(
      markdown,
      currentDocument.projectName ?? 'Untitled Project',
      currentDocument.layout,
    );
    const nextDocument = materializeDocument(parsed);
    applyCommittedDocument(
      nextDocument,
      '已通过接口更新 Markdown',
      '已通过 Tool API 写入完整工程 Markdown。',
      currentDocument,
    );
    return nextDocument.markdown ?? nextDocument.source;
  }, [applyCommittedDocument]);

  const getGraphSemanticSnapshot = useCallback(() => (
    buildGraphSemanticSnapshotFromDocument(documentRef.current, selection, documentRevisionRef.current)
  ), [selection]);

  const applyGraphOperationBatch = useCallback((
    operations: GraphOperation[],
    options?: {
      expectedRevision?: number;
      title?: string;
      detail?: string;
    },
  ): GraphOperationBatchResult => {
    const currentRevision = documentRevisionRef.current;
    const warnings: string[] = [];

    if (typeof options?.expectedRevision === 'number' && options.expectedRevision !== currentRevision) {
      return {
        applied: 0,
        warnings: ['Revision mismatch.'],
        revision: currentRevision,
      };
    }

    const current = structuredClone(documentRef.current);
    let next = structuredClone(current);
    let applied = 0;

    const endpointExists = (endpointId: string) =>
      next.nodes.some((node) => node.id === endpointId) ||
      next.subgraphs.some((subgraph) => subgraph.id === endpointId);

    for (const operation of operations) {
      switch (operation.type) {
        case 'updateProjectMeta': {
          const nextName = operation.projectName?.trim() || next.projectName || 'Untitled Project';
          const nextSummary = operation.projectSummary !== undefined
            ? trimMultilineBlock(operation.projectSummary)
            : trimMultilineBlock(next.projectSummary ?? '');
          next = {
            ...next,
            projectName: nextName,
            projectSummary: nextSummary,
            prefixMarkdown: buildProjectPrefixMarkdown(nextName, nextSummary),
          };
          applied += 1;
          break;
        }
        case 'updateContentMarkdown': {
          next = {
            ...next,
            contentMarkdown: trimMultilineBlock(operation.markdown),
          };
          applied += 1;
          break;
        }
        case 'createNode': {
          const nextLabel = operation.label?.trim() || '新建节点';
          const nextParts = splitEntityText(nextLabel);
          const nodeId = operation.nodeId && !next.nodes.some((node) => node.id === operation.nodeId)
            ? operation.nodeId
            : nextNodeId(next.nodes, nextParts.title || '新建节点');
          const subgraphId = operation.subgraphId ?? null;
          if (subgraphId && !next.subgraphs.some((subgraph) => subgraph.id === subgraphId)) {
            warnings.push(`Missing subgraph: ${subgraphId}`);
            break;
          }
          next = {
            ...next,
            nodes: [
              ...next.nodes,
              buildNode(nodeId, nextLabel, getOperationNodePlacement(next, subgraphId), subgraphId),
            ],
          };
          applied += 1;
          break;
        }
        case 'updateNodeLabel': {
          if (!next.nodes.some((node) => node.id === operation.nodeId)) {
            warnings.push(`Missing node: ${operation.nodeId}`);
            break;
          }
          next = {
            ...next,
            nodes: next.nodes.map((node) =>
              node.id === operation.nodeId ? resizeNodeToContent(node, operation.label) : node,
            ),
          };
          applied += 1;
          break;
        }
        case 'deleteNode': {
          if (!next.nodes.some((node) => node.id === operation.nodeId)) {
            warnings.push(`Missing node: ${operation.nodeId}`);
            break;
          }
          next = {
            ...next,
            nodes: next.nodes.filter((node) => node.id !== operation.nodeId),
            edges: next.edges.filter((edge) => edge.from !== operation.nodeId && edge.to !== operation.nodeId),
          };
          applied += 1;
          break;
        }
        case 'createEdge': {
          if (!endpointExists(operation.from) || !endpointExists(operation.to)) {
            warnings.push(`Missing edge endpoint: ${operation.from} -> ${operation.to}`);
            break;
          }
          next = {
            ...next,
            edges: [
              ...next.edges,
              {
                id: operation.edgeId ?? crypto.randomUUID(),
                from: operation.from,
                to: operation.to,
                label: operation.label ?? '',
                type: operation.edgeType ?? 'solid',
                strokeColor: defaultEdgeStyle.strokeColor,
                strokeWidth: defaultEdgeStyle.strokeWidth,
              },
            ],
          };
          applied += 1;
          break;
        }
        case 'updateEdgeLabel': {
          if (!next.edges.some((edge) => edge.id === operation.edgeId)) {
            warnings.push(`Missing edge: ${operation.edgeId}`);
            break;
          }
          next = {
            ...next,
            edges: next.edges.map((edge) =>
              edge.id === operation.edgeId ? { ...edge, label: operation.label } : edge,
            ),
          };
          applied += 1;
          break;
        }
        case 'deleteEdge': {
          if (!next.edges.some((edge) => edge.id === operation.edgeId)) {
            warnings.push(`Missing edge: ${operation.edgeId}`);
            break;
          }
          next = {
            ...next,
            edges: next.edges.filter((edge) => edge.id !== operation.edgeId),
          };
          applied += 1;
          break;
        }
        case 'createSubgraph': {
          const subgraphId = operation.subgraphId && !next.subgraphs.some((subgraph) => subgraph.id === operation.subgraphId)
            ? operation.subgraphId
            : nextSubgraphId(next.subgraphs);
          next = {
            ...next,
            subgraphs: [
              ...next.subgraphs,
              {
                id: subgraphId,
                title: operation.title?.trim() || `分组 ${next.subgraphs.length + 1}`,
                parentId: operation.parentId ?? null,
                collapsed: false,
                fill: defaultSubgraphStyle.fill,
                stroke: defaultSubgraphStyle.stroke,
                textColor: defaultSubgraphStyle.textColor,
              },
            ],
            nodes: next.nodes.map((node) =>
              operation.nodeIds?.includes(node.id)
                ? { ...node, subgraphId }
                : node,
            ),
          };
          applied += 1;
          break;
        }
        case 'updateSubgraphTitle': {
          if (!next.subgraphs.some((subgraph) => subgraph.id === operation.subgraphId)) {
            warnings.push(`Missing subgraph: ${operation.subgraphId}`);
            break;
          }
          next = {
            ...next,
            subgraphs: next.subgraphs.map((subgraph) =>
              subgraph.id === operation.subgraphId ? { ...subgraph, title: operation.title } : subgraph,
            ),
          };
          applied += 1;
          break;
        }
        case 'moveNodeToSubgraph': {
          if (!next.nodes.some((node) => node.id === operation.nodeId)) {
            warnings.push(`Missing node: ${operation.nodeId}`);
            break;
          }
          if (operation.subgraphId && !next.subgraphs.some((subgraph) => subgraph.id === operation.subgraphId)) {
            warnings.push(`Missing subgraph: ${operation.subgraphId}`);
            break;
          }
          next = {
            ...next,
            nodes: next.nodes.map((node) =>
              node.id === operation.nodeId
                ? { ...node, subgraphId: operation.subgraphId }
                : node,
            ),
          };
          applied += 1;
          break;
        }
        default:
          warnings.push('Unsupported operation.');
      }
    }

    if (applied === 0) {
      return {
        applied,
        warnings,
        revision: currentRevision,
      };
    }

    const nextDocument = materializeDocument(next);
    applyCommittedDocument(
      nextDocument,
      options?.title ?? '已应用结构操作',
      options?.detail ?? `已通过 Tool API 应用 ${applied} 个结构操作。`,
      current,
    );

    return {
      applied,
      warnings,
      revision: currentRevision + 1,
    };
  }, [applyCommittedDocument]);

  const executeAiToolCall = useCallback(async (name: string, rawArguments: unknown) => {
    const argumentsObject = parseAiToolArguments(rawArguments);

    switch (name) {
      case 'get_graph_semantic_snapshot':
        return {
          ok: true,
          snapshot: getGraphSemanticSnapshot(),
        };
      case 'update_lmd_sections': {
        const currentDocument = structuredClone(documentRef.current);
        const nextName =
          typeof argumentsObject.projectName === 'string'
            ? argumentsObject.projectName.trim()
            : undefined;
        const nextSummary =
          typeof argumentsObject.projectSummary === 'string'
            ? trimMultilineBlock(argumentsObject.projectSummary)
            : undefined;
        const nextContent =
          typeof argumentsObject.contentMarkdown === 'string'
            ? trimMultilineBlock(argumentsObject.contentMarkdown)
            : undefined;
        const warnings: string[] = [];

        const canEditMeta = !aiSettings.lockProjectMeta;
        const canEditContent = !aiSettings.lockAdditionalInfo;

        if ((nextName !== undefined || nextSummary !== undefined) && !canEditMeta) {
          warnings.push('Blocked Project Name / Summary update because the Project Meta lock is enabled.');
        }
        if (nextContent !== undefined && !canEditContent) {
          warnings.push('Blocked Additional Information update because the Additional Information lock is enabled.');
        }

        const currentName = (currentDocument.projectName ?? 'Untitled Project').trim() || 'Untitled Project';
        const currentSummary = trimMultilineBlock(currentDocument.projectSummary ?? '');
        const currentContent = trimMultilineBlock(
          currentDocument.contentMarkdown ?? extractContentMarkdown(currentDocument.suffixMarkdown),
        );

        const resolvedName = canEditMeta && nextName !== undefined ? (nextName || 'Untitled Project') : currentName;
        const resolvedSummary = canEditMeta && nextSummary !== undefined ? nextSummary : currentSummary;
        const resolvedContent = canEditContent && nextContent !== undefined ? nextContent : currentContent;

        if (
          resolvedName === currentName &&
          resolvedSummary === currentSummary &&
          resolvedContent === currentContent
        ) {
          return {
            ok: true,
            revision: documentRevisionRef.current,
            markdown: getProjectMarkdown(),
            warnings,
            changes: [],
          } satisfies AiToolExecutionResult;
        }

        const nextDocument = materializeDocument({
          ...currentDocument,
          projectName: resolvedName,
          projectSummary: resolvedSummary,
          prefixMarkdown: buildProjectPrefixMarkdown(resolvedName, resolvedSummary),
          contentMarkdown: resolvedContent,
        });
        applyCommittedDocument(
          nextDocument,
          typeof argumentsObject.detail === 'string' ? argumentsObject.detail : '已通过 AI 更新工程信息',
          'AI 已通过局部 LMD 区块工具更新标题、简介或附加信息。',
          currentDocument,
        );
        return {
          ok: true,
          revision: documentRevisionRef.current,
          markdown: nextDocument.markdown ?? nextDocument.source,
          warnings,
          changes: describeDocumentChangeTargets(currentDocument, nextDocument),
        } satisfies AiToolExecutionResult;
      }
      case 'update_lmd_entities': {
        const currentDocument = structuredClone(documentRef.current);
        if (aiSettings.lockDiagram) {
          return {
            ok: true,
            revision: documentRevisionRef.current,
            markdown: getProjectMarkdown(),
            warnings: ['Blocked entity update because the Flowchart lock is enabled.'],
            changes: [],
          } satisfies AiToolExecutionResult;
        }

        const nodeUpdates = Array.isArray(argumentsObject.nodes)
          ? argumentsObject.nodes.filter((item): item is { id: string; title?: string; description?: string } => (
            !!item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
          ))
          : [];
        const edgeUpdates = Array.isArray(argumentsObject.edges)
          ? argumentsObject.edges.filter((item): item is { id: string; label?: string; type?: string } => (
            !!item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
          ))
          : [];
        const subgraphUpdates = Array.isArray(argumentsObject.subgraphs)
          ? argumentsObject.subgraphs.filter((item): item is { id: string; title?: string; description?: string; collapsed?: boolean } => (
            !!item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
          ))
          : [];

        const warnings: string[] = [];
        let next = structuredClone(currentDocument);

        nodeUpdates.forEach((update) => {
          const existing = next.nodes.find((node) => node.id === update.id);
          if (!existing) {
            warnings.push(`Missing node: ${update.id}`);
            return;
          }
          const parts = splitEntityText(existing.label);
          const title = typeof update.title === 'string' ? update.title : parts.title;
          const description = typeof update.description === 'string' ? update.description : parts.description;
          const nextLabel = composeEntityText(title, description);
          next = {
            ...next,
            nodes: next.nodes.map((node) => (
              node.id === update.id ? resizeNodeToContent(node, nextLabel) : node
            )),
          };
        });

        edgeUpdates.forEach((update) => {
          const existing = next.edges.find((edge) => edge.id === update.id);
          if (!existing) {
            warnings.push(`Missing edge: ${update.id}`);
            return;
          }
          next = {
            ...next,
            edges: next.edges.map((edge) => (
              edge.id === update.id
                ? {
                    ...edge,
                    label: typeof update.label === 'string' ? update.label : edge.label,
                    type: isEdgeType(update.type) ? update.type : edge.type,
                  }
                : edge
            )),
          };
        });

        subgraphUpdates.forEach((update) => {
          const existing = next.subgraphs.find((subgraph) => subgraph.id === update.id);
          if (!existing) {
            warnings.push(`Missing subgraph: ${update.id}`);
            return;
          }
          const parts = splitEntityText(existing.title);
          const title = typeof update.title === 'string' ? update.title : parts.title;
          const description = typeof update.description === 'string' ? update.description : parts.description;
          next = {
            ...next,
            subgraphs: next.subgraphs.map((subgraph) => (
              subgraph.id === update.id
                ? {
                    ...subgraph,
                    title: composeEntityText(title, description),
                    collapsed: typeof update.collapsed === 'boolean' ? update.collapsed : subgraph.collapsed,
                  }
                : subgraph
            )),
          };
        });

        if (
          nodeUpdates.length === 0 &&
          edgeUpdates.length === 0 &&
          subgraphUpdates.length === 0
        ) {
          return {
            ok: true,
            revision: documentRevisionRef.current,
            markdown: getProjectMarkdown(),
            warnings: [...warnings, 'No valid entity updates were provided.'],
            changes: [],
          } satisfies AiToolExecutionResult;
        }

        const nextDocument = materializeDocument(next);
        if ((nextDocument.markdown ?? nextDocument.source) === (currentDocument.markdown ?? currentDocument.source)) {
          return {
            ok: true,
            revision: documentRevisionRef.current,
            markdown: getProjectMarkdown(),
            warnings,
            changes: [],
          } satisfies AiToolExecutionResult;
        }

        applyCommittedDocument(
          nextDocument,
          typeof argumentsObject.detail === 'string' ? argumentsObject.detail : '已通过 AI 更新局部实体',
          'AI 已通过局部实体工具更新节点、连线或分组内容。',
          currentDocument,
        );
        return {
          ok: true,
          revision: documentRevisionRef.current,
          markdown: nextDocument.markdown ?? nextDocument.source,
          warnings,
          changes: describeDocumentChangeTargets(currentDocument, nextDocument),
        } satisfies AiToolExecutionResult;
      }
      case 'get_project_markdown':
        return {
          ok: true,
          markdown: getProjectMarkdown(),
        };
      case 'set_project_markdown': {
        const markdown = typeof argumentsObject.markdown === 'string' ? argumentsObject.markdown : '';
        if (!markdown) {
          throw new Error('markdown is required.');
        }

        const currentDocument = structuredClone(documentRef.current);
        const parsed = parseProjectMarkdown(
          markdown,
          currentDocument.projectName ?? 'Untitled Project',
          currentDocument.layout,
        );
        const lockedCandidate = applyAiLocksToMarkdown(parsed, currentDocument, aiSettings);
        const nextDocument = materializeDocument(lockedCandidate);
        applyCommittedDocument(
          nextDocument,
          '已通过 AI 更新 Markdown',
          'AI 已通过 Tool API 写入完整工程 Markdown。',
          currentDocument,
        );
        return {
          ok: true,
          markdown: nextDocument.markdown ?? nextDocument.source,
          revision: documentRevisionRef.current,
          changes: describeDocumentChangeTargets(currentDocument, nextDocument),
        } satisfies AiToolExecutionResult;
      }
      case 'apply_graph_operation_batch': {
        const incomingOperations = Array.isArray(argumentsObject.operations)
          ? argumentsObject.operations as GraphOperation[]
          : [];
        if (incomingOperations.length === 0) {
          throw new Error('operations is required.');
        }
        const filtered = filterGraphOperationsByAiLocks(incomingOperations, aiSettings);
        if (filtered.operations.length === 0) {
          return {
            ok: true,
            applied: 0,
            warnings: filtered.warnings,
            revision: documentRevisionRef.current,
            markdown: getProjectMarkdown(),
            changes: [],
          } satisfies AiToolExecutionResult;
        }

        const result = applyGraphOperationBatch(
          filtered.operations,
          {
            expectedRevision:
              typeof argumentsObject.expectedRevision === 'number'
                ? argumentsObject.expectedRevision
                : undefined,
            title:
              typeof argumentsObject.title === 'string'
                ? argumentsObject.title
                : '已通过 AI 应用结构操作',
            detail:
              typeof argumentsObject.detail === 'string'
                ? argumentsObject.detail
                : `AI 已应用 ${filtered.operations.length} 个结构操作。`,
          },
        );

        return {
          ok: true,
          ...result,
          warnings: [...filtered.warnings, ...result.warnings],
          markdown: getProjectMarkdown(),
          changes: describeOperationChangeTargets(filtered.operations, documentRef.current),
        } satisfies AiToolExecutionResult;
      }
      default:
        throw new Error(`Unsupported tool: ${name}`);
    }
  }, [aiSettings, applyCommittedDocument, applyGraphOperationBatch, getGraphSemanticSnapshot, getProjectMarkdown]);

  const sendAiMessage = useCallback(async () => {
    const prompt = aiInput.trim();
    if (!prompt || aiSending) {
      return;
    }

    const selectionContext = buildSelectionContext(documentRef.current, selection);
    const selectionSummary = buildSelectionContextSummary(documentRef.current, selection);
    const userPrompt = buildAiUserPrompt(prompt, selectionSummary);
    const userMessage = createAiMessage('user', prompt);
    const conversation = [...aiMessages, userMessage];
    const markdown = getProjectMarkdown();
    const markdownDelta = buildMarkdownDeltaContext(aiLastMarkdownRef.current, markdown);
    const historyContext = buildAiHistoryContext(aiMessages);

    setAiMessages(conversation);
    setAiInput('');
    setAiSending(true);

    try {
      const messages: Array<Record<string, unknown>> = [
        {
          role: 'system',
          content: `AI rules:\n${aiSettings.systemPrompt}\n\n${aiProjectFormatGuide}`,
        },
        {
          role: 'system',
          content: `Tool rules:\n${aiToolRules}\n\nLock rules:\n${buildAiLockRules(aiSettings)}`,
        },
        {
          role: 'system',
          content: `Conversation history:\n${historyContext}`,
        },
        {
          role: 'system',
          content: `Full Markdown:\n${markdown}`,
        },
      ];

      if (markdownDelta) {
        messages.push({
          role: 'system',
          content: `Markdown diff since previous AI turn:\n${markdownDelta}`,
        });
      }

      if (selectionContext !== 'No active selection.') {
        messages.push({
          role: 'system',
          content: `Current selection:\n${selectionContext}`,
        });
      }

      messages.push({
        role: 'user',
        content: userPrompt,
      });

      let finalAssistantContent = '';
      const aggregatedChanges: AiToolChangeTarget[] = [];
      const aggregatedWarnings: string[] = [];

      for (let step = 0; step < 6; step += 1) {
        const response = await fetch(aiSettings.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aiSettings.apiKey}`,
          },
          body: JSON.stringify({
            model: aiSettings.model,
            messages,
            tools: aiToolDefinitions,
            tool_choice: 'auto',
          }),
        });
        const data = await response.json();
        const message = data?.choices?.[0]?.message;
        const assistantContent = normalizeOpenAiMessageContent(message?.content);
        const toolCalls = Array.isArray(message?.tool_calls)
          ? message.tool_calls
          : [];

        if (!response.ok || !message) {
          throw new Error(data?.error?.message ?? 'AI 请求失败。');
        }

        if (toolCalls.length === 0) {
          finalAssistantContent = assistantContent || '已完成当前请求。';
          break;
        }

        messages.push({
          role: 'assistant',
          content: assistantContent,
          tool_calls: toolCalls,
        });

        for (const toolCall of toolCalls) {
          const toolName =
            toolCall &&
            typeof toolCall === 'object' &&
            'function' in toolCall &&
            toolCall.function &&
            typeof toolCall.function === 'object' &&
            'name' in toolCall.function &&
            typeof toolCall.function.name === 'string'
              ? toolCall.function.name
              : '';
          const rawArguments =
            toolCall &&
            typeof toolCall === 'object' &&
            'function' in toolCall &&
            toolCall.function &&
            typeof toolCall.function === 'object' &&
            'arguments' in toolCall.function
              ? toolCall.function.arguments
              : '';
          const toolCallId =
            toolCall &&
            typeof toolCall === 'object' &&
            'id' in toolCall &&
            typeof toolCall.id === 'string'
              ? toolCall.id
              : crypto.randomUUID();

          let toolResult: Record<string, unknown>;
          try {
            toolResult = await executeAiToolCall(toolName, rawArguments);
          } catch (toolError) {
            toolResult = {
              ok: false,
              error: toolError instanceof Error ? toolError.message : 'Tool execution failed.',
            };
          }

          const typedToolResult = toolResult as AiToolExecutionResult;
          if (Array.isArray(typedToolResult.changes)) {
            aggregatedChanges.push(...typedToolResult.changes);
          }
          if (Array.isArray(typedToolResult.warnings)) {
            aggregatedWarnings.push(...typedToolResult.warnings);
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify(toolResult),
          });
        }
      }

      const assistantBody = finalAssistantContent || '已完成当前请求。';
      const warningSuffix = aggregatedWarnings.length > 0
        ? `\n\n限制说明：\n- ${Array.from(new Set(aggregatedWarnings)).join('\n- ')}`
        : '';

      setAiMessages((current) => [
        ...current,
        createAiMessage('assistant', `${assistantBody}${warningSuffix}`),
      ]);
      pushAiChangeBubbles(aggregatedChanges);
      setAiLastMarkdown(getProjectMarkdown());
    } catch (error) {
      setAiMessages((current) => [
        ...current,
        createAiMessage('assistant', error instanceof Error ? error.message : 'AI 请求失败。', 'error'),
      ]);
    } finally {
      setAiSending(false);
    }
  }, [
    aiInput,
    aiMessages,
    aiSending,
    aiSettings,
    executeAiToolCall,
    getProjectMarkdown,
    pushAiChangeBubbles,
    selection,
  ]);

  // External Control API - allows external tools to control the editor
  useEffect(() => {
    const api = {
      setSource: (code: string) => {
        setSourceDraft(code);
      },
      getSource: () => sourceDraft,
      getGraphSemanticSnapshot,
      applyGraphOperationBatch,
      getProjectMarkdown,
      setProjectMarkdown,
      render: async () => {
        // trigger re-render by updating source draft
        setSourceDraft((s) => s);
      },
      getSvg: () => {
        const preview = document.querySelector('.mermaid-preview svg');
        return preview instanceof SVGSVGElement ? preview.outerHTML : null;
      },
    };

    // Expose as global
    (window as unknown as Record<string, unknown>).MermaidEditor = api;

    // postMessage interface
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || event.data.type !== 'mermaid-editor') return;
      const { action, payload } = event.data;
      let responsePayload: unknown = null;
      let responseError: string | null = null;
      try {
        if (action === 'setSource' && typeof payload === 'string') {
          api.setSource(payload);
        } else if (action === 'getSource') {
          responsePayload = api.getSource();
        } else if (action === 'getGraphSemanticSnapshot') {
          responsePayload = api.getGraphSemanticSnapshot();
        } else if (action === 'applyGraphOperationBatch' && Array.isArray(payload)) {
          responsePayload = api.applyGraphOperationBatch(payload);
        } else if (action === 'getProjectMarkdown') {
          responsePayload = api.getProjectMarkdown();
        } else if (action === 'setProjectMarkdown' && typeof payload === 'string') {
          responsePayload = api.setProjectMarkdown(payload);
        } else if (action === 'render') {
          void api.render();
        } else if (action === 'getSvg') {
          responsePayload = api.getSvg();
        }
      } catch (error) {
        responseError = error instanceof Error ? error.message : 'Tool API request failed.';
      }
      event.source?.postMessage(
        { type: 'mermaid-editor-response', action, payload: responsePayload, error: responseError },
        { targetOrigin: event.origin }
      );
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      delete (window as unknown as Record<string, unknown>).MermaidEditor;
    };
  }, [applyGraphOperationBatch, getGraphSemanticSnapshot, getProjectMarkdown, setProjectMarkdown, sourceDraft]);

  return (
    <div className={appShellClassName}>
      <header className="workbench-bar">
        <div className="workbench-brand">
          {isMobileViewport ? (
            <button
              aria-label={isVsCodeHost ? '打开图谱面板' : '打开资源面板'}
              className="icon-button workbench-mobile-trigger"
              onClick={() => toggleLeftPanel(isVsCodeHost ? 'graph' : 'files')}
              type="button"
            >
              <WorkbenchIcon name="menu" />
            </button>
          ) : null}
          <button
            aria-label="查看操作说明"
            className="topbar__mark"
            onClick={() => setHelpDialogOpen(true)}
            type="button"
          >
            LMD
          </button>
        </div>

        <div className="workbench-tabs" aria-label="已打开文件">
          {isVsCodeHost && !isMobileViewport ? (
            <div className="vscode-commandbar" role="toolbar" aria-label="LMD_EDITER 工具栏">
              <div className="vscode-commandbar__title" title={vscodeFileLabel}>
                <strong>{vscodeFileLabel}</strong>
              </div>
              <div className="vscode-commandbar__tools">
                <button
                  aria-label="新建节点"
                  className="icon-button has-tooltip"
                  data-tooltip="新建节点"
                  onClick={createNodeInViewportCenter}
                  type="button"
                >
                  <WorkbenchIcon name="node" />
                </button>
                <button
                  aria-label="分组"
                  className={canGroupSelection ? 'icon-button has-tooltip' : 'icon-button has-tooltip is-disabled'}
                  data-tooltip="分组"
                  disabled={!canGroupSelection}
                  onClick={wrapSelectionInSubgraph}
                  type="button"
                >
                  <WorkbenchIcon name="group" />
                </button>
                <button
                  aria-label="复制"
                  className={selection.kind === 'node' && selection.ids.length > 0 ? 'icon-button has-tooltip' : 'icon-button has-tooltip is-disabled'}
                  data-tooltip="复制"
                  disabled={!(selection.kind === 'node' && selection.ids.length > 0)}
                  onClick={duplicateSelection}
                  type="button"
                >
                  <WorkbenchIcon name="copy" />
                </button>
                <button
                  aria-label="删除"
                  className={selection.kind !== 'none' ? 'icon-button has-tooltip' : 'icon-button has-tooltip is-disabled'}
                  data-tooltip="删除"
                  disabled={selection.kind === 'none'}
                  onClick={deleteSelection}
                  type="button"
                >
                  <WorkbenchIcon name="trash" />
                </button>
                <button
                  aria-label="整理"
                  className="icon-button has-tooltip"
                  data-tooltip="整理"
                  onClick={compactLayout}
                  type="button"
                >
                  <WorkbenchIcon name="tidy" />
                </button>
                <button
                  aria-label="布局"
                  className="icon-button has-tooltip"
                  data-tooltip="布局"
                  onClick={autoLayout}
                  type="button"
                >
                  <WorkbenchIcon name="layout" />
                </button>
                <button
                  aria-label="标准化"
                  className="icon-button has-tooltip"
                  data-tooltip="标准化"
                  onClick={standardizeCurrentProject}
                  type="button"
                >
                  <WorkbenchIcon name="standardize" />
                </button>
                <button
                  aria-label="源码"
                  className="icon-button has-tooltip"
                  data-tooltip="源码"
                  onClick={() => goToMode('source')}
                  type="button"
                >
                  <WorkbenchIcon name="source" />
                </button>
                <button
                  aria-label={showInspector ? '隐藏属性栏' : '显示属性栏'}
                  className={showInspector ? 'icon-button has-tooltip is-active' : 'icon-button has-tooltip'}
                  data-tooltip="属性"
                  onClick={() => openInspectorView('properties')}
                  type="button"
                >
                  <WorkbenchIcon name="inspect" />
                </button>
                <button
                  aria-label="查看 SVG 预览"
                  className="icon-button has-tooltip"
                  data-tooltip="SVG 预览"
                  onClick={() => {
                    setSvgPreviewScale(1);
                    setSvgPreviewOpen(true);
                  }}
                  type="button"
                >
                  <WorkbenchIcon name="preview" />
                </button>
                <button
                  aria-label={`加载 ${defaultStressTestProjectLabel} 压力测试图`}
                  className="desktop-command-button has-tooltip"
                  data-tooltip={`压力测试 · ${defaultStressTestProjectLabel}`}
                  onClick={loadStressTestProject}
                  type="button"
                >
                  压力测试
                </button>
              </div>
            </div>
          ) : isMobileViewport ? (
            workspaceTabs.map((tab) => (
              <button
                key={tab.id}
                className={tab.id === activeFileTab ? 'workbench-tab is-active' : 'workbench-tab'}
                onClick={() => {
                  setActiveFileTab(tab.id);
                  setMode(tab.id === 'diagram' ? 'canvas' : 'source');
                }}
                type="button"
              >
                <strong>{tab.label}</strong>
                <span>{tab.detail}</span>
              </button>
            ))
          ) : (
            <div className="desktop-commandbar" role="toolbar" aria-label="顶部命令栏">
              <div className="desktop-command-group">
                <button
                  aria-label="文件面板"
                  className={showSidebar && leftPanel === 'files' ? 'desktop-command-button desktop-command-button--icon has-tooltip is-active' : 'desktop-command-button desktop-command-button--icon has-tooltip'}
                  data-tooltip="文件面板"
                  onClick={() => toggleLeftPanel('files')}
                  type="button"
                >
                  <WorkbenchIcon name="files" />
                </button>
                <button
                  aria-label="图谱面板"
                  className={showSidebar && leftPanel === 'graph' ? 'desktop-command-button desktop-command-button--icon has-tooltip is-active' : 'desktop-command-button desktop-command-button--icon has-tooltip'}
                  data-tooltip="图谱面板"
                  onClick={() => toggleLeftPanel('graph')}
                  type="button"
                >
                  <WorkbenchIcon name="graph" />
                </button>
                <button
                  aria-label="打开 LMD"
                  className={
                    supportsLocalMarkdownPicker || supportsLocalProjectPicker
                      ? 'desktop-command-button desktop-command-button--icon has-tooltip'
                      : 'desktop-command-button desktop-command-button--icon has-tooltip is-disabled'
                  }
                  data-tooltip="打开 LMD"
                  onClick={() => {
                    void openLocalMarkdownFile();
                  }}
                  type="button"
                >
                  <WorkbenchIcon name="files" />
                </button>
                <button
                  aria-label="导出 LMD"
                  className="desktop-command-button desktop-command-button--icon has-tooltip"
                  data-tooltip="导出 LMD"
                  onClick={exportMarkdown}
                  type="button"
                >
                  <WorkbenchIcon name="share" />
                </button>
                <button
                  aria-label="导出 PNG"
                  className="desktop-command-button desktop-command-button--icon has-tooltip"
                  data-tooltip="导出 PNG"
                  onClick={exportCanvasImage}
                  type="button"
                >
                  <WorkbenchIcon name="preview" />
                </button>
                <button
                  aria-label={`加载 ${defaultStressTestProjectLabel} 压力测试图`}
                  className="desktop-command-button has-tooltip"
                  data-tooltip={`压力测试 · ${defaultStressTestProjectLabel}`}
                  onClick={loadStressTestProject}
                  type="button"
                >
                  压力测试
                </button>
              </div>

              <div className="desktop-command-group">
                <button
                  aria-label="新建节点"
                  className="desktop-command-button desktop-command-button--icon has-tooltip"
                  data-tooltip="新建节点"
                  onClick={createNodeInViewportCenter}
                  type="button"
                >
                  <WorkbenchIcon name="node" />
                </button>
                <button
                  aria-label="复制"
                  className={selection.kind === 'node' && selection.ids.length > 0 ? 'desktop-command-button desktop-command-button--icon has-tooltip' : 'desktop-command-button desktop-command-button--icon has-tooltip is-disabled'}
                  data-tooltip="复制"
                  onClick={duplicateSelection}
                  type="button"
                >
                  <WorkbenchIcon name="copy" />
                </button>
                <button
                  aria-label="分组"
                  className={canGroupSelection ? 'desktop-command-button desktop-command-button--icon has-tooltip' : 'desktop-command-button desktop-command-button--icon has-tooltip is-disabled'}
                  data-tooltip="分组"
                  onClick={wrapSelectionInSubgraph}
                  type="button"
                >
                  <WorkbenchIcon name="group" />
                </button>
                <button
                  aria-label="删除"
                  className={selection.kind !== 'none' ? 'desktop-command-button desktop-command-button--icon has-tooltip' : 'desktop-command-button desktop-command-button--icon has-tooltip is-disabled'}
                  data-tooltip="删除"
                  onClick={deleteSelection}
                  type="button"
                >
                  <WorkbenchIcon name="trash" />
                </button>
                <button
                  aria-label="整理"
                  className="desktop-command-button desktop-command-button--icon has-tooltip"
                  data-tooltip="整理"
                  onClick={compactLayout}
                  type="button"
                >
                  <WorkbenchIcon name="tidy" />
                </button>
                <button
                  aria-label="布局"
                  className="desktop-command-button desktop-command-button--icon has-tooltip"
                  data-tooltip="布局"
                  onClick={autoLayout}
                  type="button"
                >
                  <WorkbenchIcon name="layout" />
                </button>
                <button
                  aria-label="标准化"
                  className="desktop-command-button desktop-command-button--icon has-tooltip"
                  data-tooltip="标准化"
                  onClick={standardizeCurrentProject}
                  type="button"
                >
                  <WorkbenchIcon name="standardize" />
                </button>
              </div>

              <div className="desktop-command-group">
                <button
                  aria-label="画布模式"
                  className={mode === 'canvas' ? 'desktop-command-button desktop-command-button--icon has-tooltip is-active' : 'desktop-command-button desktop-command-button--icon has-tooltip'}
                  data-tooltip="画布模式"
                  onClick={() => goToMode('canvas')}
                  type="button"
                >
                  <WorkbenchIcon name="canvas" />
                </button>
                <button
                  aria-label="源码模式"
                  className={mode === 'source' ? 'desktop-command-button desktop-command-button--icon has-tooltip is-active' : 'desktop-command-button desktop-command-button--icon has-tooltip'}
                  data-tooltip="源码模式"
                  onClick={() => goToMode('source')}
                  type="button"
                >
                  <WorkbenchIcon name="source" />
                </button>
                <button
                  aria-label="属性面板"
                  className={showInspector && inspectorView === 'properties' ? 'desktop-command-button desktop-command-button--icon has-tooltip is-active' : 'desktop-command-button desktop-command-button--icon has-tooltip'}
                  data-tooltip="属性面板"
                  onClick={() => openInspectorView('properties')}
                  type="button"
                >
                  <WorkbenchIcon name="inspect" />
                </button>
                <button
                  aria-label="AI 面板"
                  className={showInspector && inspectorView === 'ai' ? 'desktop-command-button desktop-command-button--icon has-tooltip is-active' : 'desktop-command-button desktop-command-button--icon has-tooltip'}
                  data-tooltip="AI 面板"
                  onClick={() => openInspectorView('ai')}
                  type="button"
                >
                  <WorkbenchIcon name="chat" />
                </button>
                <button
                  aria-label="聚焦选中"
                  className={selection.kind !== 'none' ? 'desktop-command-button desktop-command-button--icon has-tooltip' : 'desktop-command-button desktop-command-button--icon has-tooltip is-disabled'}
                  data-tooltip="聚焦选中"
                  onClick={focusSelectionInViewport}
                  type="button"
                >
                  <WorkbenchIcon name="search" />
                </button>
                <button
                  aria-label="SVG 预览"
                  className="desktop-command-button desktop-command-button--icon has-tooltip"
                  data-tooltip="SVG 预览"
                  onClick={() => {
                    setSvgPreviewScale(1);
                    setSvgPreviewOpen(true);
                  }}
                  type="button"
                >
                  <WorkbenchIcon name="preview" />
                </button>
              </div>

              <div className="desktop-path-chip">
                <strong>{activeWorkspaceSource === 'cloud' ? '云端路径' : '本地路径'}</strong>
                <span>{activeProjectPath}</span>
              </div>
            </div>
          )}
        </div>

        {!isVsCodeHost || isMobileViewport ? (
          <div className="workbench-bar__actions">
            <>
              <div className="presence-strip" aria-label="在线协作者">
                {collaboratorPresets.map((collaborator) => (
                  <button
                    aria-label={`${collaborator.name}，当前${collaborator.role}`}
                    className="presence-avatar has-tooltip"
                    data-tooltip={`${collaborator.name} · ${collaborator.role}`}
                    key={collaborator.id}
                    onClick={() => {
                      setSidebarOpen(false);
                      setInspectorOpen(true);
                    }}
                    type="button"
                  >
                    <span
                      className="presence-avatar__dot"
                      style={{ background: collaborator.color }}
                    />
                    <span className="presence-avatar__label">{collaborator.name.slice(0, 1)}</span>
                  </button>
                ))}
              </div>

              <div
                aria-label={
                  saveStatus === 'saving'
                    ? activeWorkspaceSource === 'cloud'
                      ? '正在同步云端'
                      : '正在写入本地'
                    : saveStatus === 'error'
                      ? '保存异常'
                      : activeWorkspaceSource === 'cloud'
                        ? '云端同步就绪'
                        : '本地项目已连接'
                }
                className={`status-pill status-pill--${saveStatus}`}
                data-tooltip={
                  saveStatus === 'saving'
                    ? activeWorkspaceSource === 'cloud'
                      ? '正在同步云端'
                      : '正在写入本地'
                    : saveStatus === 'error'
                      ? '保存异常'
                      : activeWorkspaceSource === 'cloud'
                        ? '云端同步就绪'
                        : '本地项目已连接'
                }
              >
                <span className="status-pill__dot" />
                {saveStatus === 'saving'
                  ? activeWorkspaceSource === 'cloud'
                    ? '正在同步云端'
                    : '正在写入本地'
                  : saveStatus === 'error'
                    ? '保存异常'
                    : activeWorkspaceSource === 'cloud'
                      ? '云端同步就绪'
                      : '本地项目已连接'}
              </div>

              <div className="workbench-icon-row" role="toolbar" aria-label="工作台控制">
                {isMobileViewport ? (
              <div className="mode-switch" role="tablist" aria-label="工作区模式">
                {visibleModeMeta.map((entry) => (
                  <button
                    aria-label={entry.label}
                    className={entry.id === mode ? 'mode-pill has-tooltip is-active' : 'mode-pill has-tooltip'}
                    data-tooltip={entry.label}
                    key={entry.id}
                    onClick={() => goToMode(entry.id)}
                    type="button"
                  >
                    <WorkbenchIcon name={entry.icon} />
                  </button>
                ))}
              </div>
                ) : null}
              </div>
            </>
          </div>
        ) : null}
      </header>

      <main className={workspaceClassName} ref={workspaceRef} style={workspaceStyle}>
        {mobileOverlayOpen ? (
          <button
            aria-label="关闭当前面板"
            className="mobile-overlay-backdrop"
            onClick={() => {
              setSidebarOpen(false);
              setInspectorOpen(false);
              setMobileSourcePreviewOpen(false);
            }}
            type="button"
          />
        ) : null}

        {!isVsCodeHost ? (
          <nav className="nav-rail" aria-label="工作台导航">
            {visibleLeftPanels.map((item) => (
              <button
                aria-label={item.label}
                className={leftPanel === item.id ? 'nav-rail__button has-tooltip is-active' : 'nav-rail__button has-tooltip'}
                data-tooltip={item.label}
                key={item.id}
                onClick={() => toggleLeftPanel(item.id)}
                type="button"
              >
                <WorkbenchIcon name={item.icon} />
                <span className="nav-rail__label">{item.label}</span>
              </button>
            ))}
          </nav>
        ) : null}

        {!isMobileViewport ? (
          <button
            aria-label={showSidebar ? '收起左侧侧栏' : '展开左侧侧栏'}
            className="edge-toggle edge-toggle--left"
            onClick={() => setSidebarOpen((current) => !current)}
            type="button"
          >
            <WorkbenchIcon name={showSidebar ? 'chevron-left' : 'chevron-right'} />
          </button>
        ) : null}

        {!isMobileViewport && showSidebar ? (
          <div
            aria-label="拖拽调整左侧栏宽度"
            aria-orientation="vertical"
            className="panel-resizer panel-resizer--left"
            onPointerDown={(event) => startPanelResize('left', event)}
            role="separator"
          />
        ) : null}

        <aside className={`sidebar${showSidebar ? ' is-open' : ''}`}>
          {isMobileViewport ? (
            <div className="mobile-sheet-handle" aria-hidden="true" />
          ) : null}
          {isMobileViewport ? (
            <div className="mobile-panel-tabs" role="tablist" aria-label="移动资源面板">
              {visibleLeftPanels.map((item) => (
                <button
                  aria-label={item.label}
                  className={leftPanel === item.id ? 'mobile-panel-tab is-active' : 'mobile-panel-tab'}
                  key={item.id}
                  onClick={() => setLeftPanel(item.id)}
                  type="button"
                >
                  <WorkbenchIcon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ) : null}
          {!isMobileViewport ? (
            <section className="sidebar-card sidebar-card--search">
              <label className="field">
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={
                    isVsCodeHost
                      ? '查找节点、分组'
                      : leftPanel === 'files'
                        ? '查找文件、节点、源码'
                        : '查找图层、节点、分组'
                  }
                />
              </label>
            </section>
          ) : null}

          {!isVsCodeHost && leftPanel === 'files' ? (
            <>
              <section className="sidebar-card">
                <div className="sidebar-card__header">
                  <h2>云端</h2>
                  <span>Git 主线</span>
                </div>
                <p className="sidebar-copy">{activeCloudPath}</p>
                <div className="explorer-list">
                  {cloudExplorerItems.map((item) => (
                    <button
                      key={item.id}
                      className={item.tabId === activeFileTab && activeWorkspaceSource === 'cloud' ? 'explorer-item is-active' : 'explorer-item'}
                      onClick={() => openExplorerItem(item)}
                      style={{ paddingLeft: `${16 + item.depth * 18}px` }}
                      type="button"
                    >
                      <span className={`explorer-item__marker explorer-item__marker--${item.kind}`} />
                      <span className="explorer-item__body">
                        <strong>{item.label}</strong>
                        <small>{item.meta}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="sidebar-card">
                <div className="sidebar-card__header">
                  <h2>本地</h2>
                </div>
                <div className="file-manager-toolbar">
                  <button
                    className={supportsLocalMarkdownPicker ? 'ghost-button' : 'ghost-button is-disabled'}
                    disabled={!supportsLocalMarkdownPicker}
                    onClick={() => {
                      void openLocalMarkdownFile();
                    }}
                    type="button"
                  >
                    打开 LMD
                  </button>
                  <button
                    className={supportsLocalProjectPicker ? 'ghost-button' : 'ghost-button is-disabled'}
                    disabled={!supportsLocalProjectPicker}
                    onClick={() => {
                      void openLocalProjectDirectory();
                    }}
                    type="button"
                  >
                    打开目录
                  </button>
                  <button
                    className={localRootDirectoryRef.current ? 'ghost-button' : 'ghost-button is-disabled'}
                    disabled={!localRootDirectoryRef.current}
                    onClick={() => {
                      void createLocalProjectFile();
                    }}
                    type="button"
                  >
                    新建
                  </button>
                  <button
                    className={activeLocalItem?.kind === 'file' ? 'ghost-button' : 'ghost-button is-disabled'}
                    disabled={activeLocalItem?.kind !== 'file'}
                    onClick={() => {
                      void renameLocalProjectItem();
                    }}
                    type="button"
                  >
                    重命名
                  </button>
                  <button
                    className={activeLocalItem?.kind === 'file' ? 'ghost-button ghost-button--danger' : 'ghost-button is-disabled'}
                    disabled={activeLocalItem?.kind !== 'file'}
                    onClick={() => {
                      void deleteLocalProjectItem();
                    }}
                    type="button"
                  >
                    删除
                  </button>
                  <button
                    className="ghost-button"
                    onClick={standardizeCurrentProject}
                    type="button"
                  >
                    标准化
                  </button>
                </div>

                {hasLocalProjectAccess ? (
                  <>
                    <div className="path-strip">
                      <button
                        aria-label="返回上一级"
                        className={localBreadcrumbItems.length > 1 ? 'path-strip__up' : 'path-strip__up is-disabled'}
                        disabled={localBreadcrumbItems.length <= 1}
                        onClick={() => {
                          const parent = localBreadcrumbItems[localBreadcrumbItems.length - 2];
                          if (parent) {
                            openExplorerItem(parent);
                          }
                        }}
                        type="button"
                      >
                        <WorkbenchIcon name="chevron-left" />
                      </button>
                      <div className="path-strip__crumbs">
                        {localBreadcrumbItems.map((item) => (
                          <button
                            className={item.id === activeLocalDirectoryId ? 'path-crumb is-active' : 'path-crumb'}
                            key={item.id}
                            onClick={() => openExplorerItem(item)}
                            type="button"
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="explorer-list explorer-list--manager">
                      {localDirectoryEntries.map((item) => (
                        <button
                          className={
                            item.id === activeLocalExplorerItemId || (
                              item.kind !== 'file' &&
                              item.id === activeLocalDirectoryId
                            )
                              ? 'explorer-item is-active'
                              : 'explorer-item'
                          }
                          key={item.id}
                          onClick={() => openExplorerItem(item)}
                          type="button"
                        >
                          <span className={`explorer-item__marker explorer-item__marker--${item.kind}`} />
                          <span className="explorer-item__body">
                            <strong>{item.label}</strong>
                            <small>{item.meta}</small>
                          </span>
                        </button>
                      ))}
                      {localDirectoryEntries.length === 0 ? (
                        <div className="explorer-empty">
                          当前目录为空
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="explorer-empty">
                    打开一个本地目录后，这里会以文件管理器方式显示 LMD 工程。
                  </div>
                )}
              </section>
            </>
          ) : null}

          {leftPanel === 'graph' ? (
            <>
              <section className="sidebar-card">
                <div className="sidebar-card__header">
                  <h2>导航图</h2>
                  <span>{Math.round(documentState.layout.viewport.zoom * 100)}%</span>
                </div>
                {miniMapModel ? (
                  <div className="graph-minimap">
                    <svg
                      className="graph-minimap__canvas"
                      onPointerCancel={endMiniMapInteraction}
                      onPointerDown={beginMiniMapInteraction}
                      onPointerMove={updateMiniMapInteraction}
                      onPointerUp={endMiniMapInteraction}
                      viewBox={`0 0 ${miniMapModel.width} ${miniMapModel.height}`}
                    >
                      <rect
                        className="graph-minimap__surface"
                        height={miniMapModel.height}
                        rx={10}
                        width={miniMapModel.width}
                      />
                      {miniMapModel.shapes.map((shape) => (
                        <rect
                          key={`minimap-${shape.kind}-${shape.id}`}
                          className={`graph-minimap__shape graph-minimap__shape--${shape.kind}${shape.selected ? ' is-selected' : ''}`}
                          fill={shape.fill}
                          height={shape.projected.height}
                          rx={shape.kind === 'subgraph' ? 6 : 4}
                          stroke={shape.stroke}
                          strokeWidth={shape.selected ? 1.8 : 1}
                          width={shape.projected.width}
                          x={shape.projected.x}
                          y={shape.projected.y}
                        />
                      ))}
                      {miniMapModel.viewport ? (
                        <rect
                          className="graph-minimap__viewport"
                          height={miniMapModel.viewport.height}
                          rx={8}
                          width={miniMapModel.viewport.width}
                          x={miniMapModel.viewport.x}
                          y={miniMapModel.viewport.y}
                        />
                      ) : null}
                    </svg>
                  </div>
                ) : (
                  <div className="graph-minimap graph-minimap--empty">暂无可导航内容</div>
                )}
              </section>

              <section className="sidebar-card">
                <div className="sidebar-card__header">
                  <h2>图层树</h2>
                  <span>{graphTreeItems.length}</span>
                </div>
                <div className="graph-tree">
                  {graphTreeItems.map((item) => {
                    const isSelected =
                      (item.kind === 'subgraph' &&
                        selectionContainsSubgraph(selection, item.id)) ||
                      (item.kind === 'node' &&
                        selection.kind === 'node' &&
                        selectionContains(selection, item.id));

                    return (
                      <button
                        key={`${item.kind}-${item.id}`}
                        className={isSelected ? 'graph-tree__item is-active' : 'graph-tree__item'}
                        onClick={() => {
                          setSelection({ kind: item.kind, ids: [item.id] });
                          setMode('canvas');
                          setSidebarOpen(false);
                        }}
                        style={{ paddingLeft: `${10 + item.depth * 16}px` }}
                        type="button"
                      >
                        <span className={`graph-tree__marker graph-tree__marker--${item.kind}`} />
                        <span className="graph-tree__body">
                          <strong>{item.label}</strong>
                          <small>{item.meta}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          ) : null}

        </aside>

        <section className={`workspace-main workspace-main--${mode}`} ref={workspaceMainRef}>
          {!isMobileViewport && !isVsCodeHost ? (
            <div className="desktop-mode-strip" role="tablist" aria-label="桌面模式切换">
              {modeMeta.map((entry) => (
                <button
                  aria-label={entry.label}
                  className={entry.id === mode ? 'desktop-mode-pill is-active' : 'desktop-mode-pill'}
                  key={entry.id}
                  onClick={() => goToMode(entry.id)}
                  type="button"
                >
                  {entry.label}
                </button>
              ))}
            </div>
          ) : null}

          {mode === 'canvas' ? (
            <div className="canvas-mode">
              <div className="canvas-status-strip" aria-label="画布状态">
                <span className="canvas-status-pill">{activeModeLabel}</span>
                <span className="canvas-status-pill">{selectionLabel}</span>
                <span className="canvas-status-pill">{documentState.nodes.length} 个节点</span>
              </div>

              <div className={`canvas-search${canvasSearchOpen ? ' is-open' : ''}`}>
                <label className="canvas-search__field">
                  <WorkbenchIcon name="search" />
                  <input
                    ref={canvasSearchInputRef}
                    onBlur={() => {
                      if (!canvasSearchQuery.trim()) {
                        searchRestoreViewportRef.current = null;
                        setCanvasSearchOpen(false);
                      }
                    }}
                    onChange={(event) => {
                      setCanvasSearchOpen(true);
                      setCanvasSearchQuery(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (handleNativeSelectAllShortcut(event)) {
                        return;
                      }

                      if (event.key === 'Escape') {
                        event.preventDefault();
                        if (searchRestoreViewportRef.current) {
                          const restoreViewport = searchRestoreViewportRef.current;
                          updateViewport(() => restoreViewport);
                        }
                        searchRestoreViewportRef.current = null;
                        setCanvasSearchOpen(false);
                        setCanvasSearchQuery('');
                        setCanvasSearchFocusIndex(0);
                        canvasRef.current?.focus();
                        return;
                      }

                      if (event.key === 'Enter') {
                        event.preventDefault();
                        focusCanvasSearchResult(canvasSearchResults[canvasSearchFocusIndex] ?? canvasSearchResults[0] ?? null);
                        return;
                      }

                      if (event.key === 'Tab' && canvasSearchResults.length > 0) {
                        event.preventDefault();
                        setCanvasSearchFocusIndex((current) => {
                          const nextIndex = event.shiftKey
                            ? (current - 1 + canvasSearchResults.length) % canvasSearchResults.length
                            : (current + 1) % canvasSearchResults.length;
                          focusCanvasSearchResult(canvasSearchResults[nextIndex] ?? null);
                          return nextIndex;
                        });
                      }
                    }}
                    placeholder="查找节点 / 分组"
                    type="text"
                    value={canvasSearchQuery}
                  />
                </label>
                {canvasSearchOpen && canvasSearchResults.length > 0 ? (
                  <div className="canvas-search__results">
                    {canvasSearchResults.map((result, index) => (
                      <button
                        className={index === canvasSearchFocusIndex ? 'canvas-search__result is-active' : 'canvas-search__result'}
                        key={`${result.kind}-${result.id}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setCanvasSearchFocusIndex(index);
                          focusCanvasSearchResult(result);
                        }}
                        type="button"
                      >
                        <span className={`canvas-search__result-marker canvas-search__result-marker--${result.kind}`} />
                        <span className="canvas-search__result-copy">
                          <strong>{result.label}</strong>
                          <small>{result.meta}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {perfDebugEnabled ? (
                <aside className="perf-debug-panel" aria-live="polite">
                  <div className="perf-debug-panel__header">
                    <strong>Perf Debug</strong>
                    <button
                      className="perf-debug-panel__close"
                      onClick={() => setPerfDebugEnabled(false)}
                      type="button"
                    >
                      关闭
                    </button>
                  </div>
                  <p className="perf-debug-panel__summary">
                    热点: {perfDebugSummary.hotLabel ?? '采样中'}
                  </p>
                  <p className="perf-debug-panel__summary">
                    {Math.round(perfDebugSummary.windowMs)}ms 窗口 / {perfDebugSummary.renderCount} 次渲染 / {perfDebugSummary.pointerMoves} 次移动
                  </p>
                  <p className="perf-debug-panel__summary">
                    节点 {perfDebugSummary.snapshot.visibleNodeCount} / 连线 {perfDebugSummary.snapshot.visibleEdgeCount} / 组 {perfDebugSummary.snapshot.subgraphFrameCount}
                  </p>
                  <p className="perf-debug-panel__summary">
                    blob 区域 {perfDebugSummary.snapshot.blobRegionCount} / 原语 {perfDebugSummary.snapshot.blobPrimitiveCount}
                  </p>
                  <p className="perf-debug-panel__summary">
                    Canvas {perfDebugSummary.snapshot.canvasNodeCount} 节点 / {perfDebugSummary.snapshot.canvasEdgeCount} 线 · Overlay {perfDebugSummary.snapshot.overlayNodeCount}/{perfDebugSummary.snapshot.overlayEdgeCount}
                  </p>
                  <p className="perf-debug-panel__summary perf-debug-panel__hint">
                    Shift + Alt + D 切换
                  </p>
                  <div className="perf-debug-panel__list">
                    {perfDebugSummary.entries.length > 0 ? perfDebugSummary.entries.map((entry) => (
                      <div className="perf-debug-panel__entry" key={entry.label}>
                        <span className="perf-debug-panel__label">{entry.label}</span>
                        <span className="perf-debug-panel__value">
                          avg {entry.avgMs.toFixed(1)}ms / max {entry.maxMs.toFixed(1)} / x{entry.count}
                        </span>
                      </div>
                    )) : (
                      <div className="perf-debug-panel__entry">
                        <span className="perf-debug-panel__label">等待交互采样…</span>
                      </div>
                    )}
                  </div>
                </aside>
              ) : null}

              {aiChangeBubbles.length > 0 ? (
                <aside className="ai-change-bubbles" aria-label="AI 修改提示">
                  {aiChangeBubbles.map((bubble) => (
                    <article className="ai-change-bubble" key={bubble.id}>
                      <button
                        className="ai-change-bubble__body"
                        onClick={() => focusAiChangeTarget(bubble)}
                        type="button"
                      >
                        <strong>{bubble.label}</strong>
                        <span>{bubble.detail}</span>
                      </button>
                      <button
                        aria-label="关闭提示"
                        className="ai-change-bubble__dismiss"
                        onClick={() => dismissAiChangeBubble(bubble.id)}
                        type="button"
                      >
                        ×
                      </button>
                    </article>
                  ))}
                </aside>
              ) : null}

              <div
                className={`canvas-surface${spacePressed ? ' is-panning' : ''}`}
                onContextMenu={(event) => event.preventDefault()}
                onMouseEnter={() => setCanvasHovered(true)}
                onMouseLeave={() => setCanvasHovered(false)}
                onDoubleClick={(event) => {
                  if (isMobileViewport) {
                    return;
                  }
                  const target = event.target as HTMLElement;
                  if (target.closest('.graph-node, .content-card, .edge-path, .edge-hitbox, .edge-label, .edge-label-editor')) {
                    return;
                  }

                  if (target.closest('.subgraph-frame__header, .subgraph-frame__action, .subgraph-frame__title-input')) {
                    return;
                  }

                  const point = pointFromClient(event.clientX, event.clientY);
                  if (!point) {
                    return;
                  }

                  if (hybridSceneActive) {
                    const sceneHit = findSceneHitAtPoint(point);
                    if (sceneHit?.kind === 'node') {
                      const node = documentState.nodes.find((entry) => entry.id === sceneHit.id);
                      if (!node) {
                        return;
                      }

                      event.stopPropagation();
                      if (event.metaKey || event.ctrlKey) {
                        selectConnectedNodeComponent(node.id);
                        return;
                      }
                      startInlineEdit(node, 'title');
                      return;
                    }

                    if (sceneHit?.kind === 'edge') {
                      const edge = visibleEdges.find((entry) => entry.id === sceneHit.id);
                      if (edge) {
                        event.stopPropagation();
                        startEdgeInlineEdit(edge);
                        return;
                      }
                    }
                  }

                  createNodeAt(point, undefined, 'solid', resolveSubgraphAtPoint(point));
                }}
                onPointerDown={startBackgroundInteraction}
                onWheel={handleCanvasWheel}
                ref={canvasRef}
              >
                <canvas
                  aria-hidden="true"
                  className={`scene-render-canvas${hybridSceneActive ? ' is-active' : ''}`}
                  ref={sceneCanvasRef}
                />
                <div
                  className="canvas-board"
                  ref={canvasBoardRef}
                  style={{
                    width: canvasBoardBounds.width,
                    height: canvasBoardBounds.height,
                    transform: `translate(${documentState.layout.viewport.x + canvasBoardBounds.x * documentState.layout.viewport.zoom}px, ${documentState.layout.viewport.y + canvasBoardBounds.y * documentState.layout.viewport.zoom}px) scale(${documentState.layout.viewport.zoom})`,
                  }}
                >
                  <svg
                    className="subgraph-blob-layer"
                    aria-hidden="true"
                    style={hybridSceneActive ? { pointerEvents: 'none' } : undefined}
                  >
                    <g transform={`translate(${-canvasBoardBounds.x} ${-canvasBoardBounds.y})`}>
                      {[...(hybridSceneActive ? viewportCulledBlobShapes : subgraphBlobShapes)]
                        .sort((left, right) => left.depth - right.depth)
                        .map((shape) => {
                        const subgraph = documentState.subgraphs.find((entry) => entry.id === shape.id);
                        if (!subgraph) {
                          return null;
                        }

                        const style = getSubgraphStyle(subgraph);
                        const isSelected = selectionContainsSubgraph(selection, shape.id);
                        const isDropTarget = dragTargetSubgraphId === shape.id;
                        const isSearchMatch = canvasSearchSubgraphIds.has(shape.id);
                        const fillOpacity = shape.collapsed
                          ? 0.2
                          : clamp(0.16 - shape.depth * 0.018, 0.08, 0.16);
                        const outlineStroke = isDropTarget
                          ? '#7dd3fc'
                          : isSelected
                            ? mixColors(style.stroke, '#ffffff', 0.14)
                            : style.stroke;
                        const outlineOpacity = isDropTarget
                          ? 0.96
                          : isSelected
                            ? 0.82
                            : isSearchMatch
                              ? 0.68
                              : shape.collapsed
                                ? 0.66
                                : 0.38;
                        const outlineWidth = isSelected || isDropTarget ? 2.8 : shape.collapsed ? 2.3 : 1.9;
                        const glowOpacity = isDropTarget
                          ? 0.24
                          : isSelected
                            ? 0.16
                            : isSearchMatch
                              ? 0.1
                              : 0.05;

                        return (
                          <g className="subgraph-blob" key={`subgraph-blob-${shape.id}`}>
                            {shape.regions.map((region, regionIndex) => (
                              <g key={`${shape.id}-region-${regionIndex}`}>
                                <path
                                  className="subgraph-blob__glow"
                                  d={region.path}
                                  stroke={withAlpha(outlineStroke, glowOpacity)}
                                  strokeWidth={outlineWidth + 16}
                                />
                                <path
                                  className="subgraph-blob__fill"
                                  d={region.path}
                                  fill={withAlpha(style.fill, fillOpacity)}
                                />
                                <path
                                  className="subgraph-blob__outline"
                                  d={region.path}
                                  stroke={withAlpha(outlineStroke, outlineOpacity)}
                                  strokeWidth={outlineWidth}
                                />
                                {!shape.collapsed && !hybridSceneActive ? (
                                  <path
                                    className="subgraph-blob__hit"
                                    d={region.path}
                                    fill="transparent"
                                    onDoubleClick={(event) => {
                                      if (isMobileViewport) {
                                        return;
                                      }

                                      const point = pointFromClient(event.clientX, event.clientY);
                                      if (!point) {
                                        return;
                                      }

                                      event.stopPropagation();
                                      rememberSubgraphBadgeAnchor(shape.id, point);
                                      createNodeAt(point, undefined, 'solid', shape.id);
                                    }}
                                    onPointerDown={(event) => {
                                      const point = pointFromClient(event.clientX, event.clientY);
                                      if (!point) {
                                        return;
                                      }

                                      if (event.button === 1) {
                                        return;
                                      }

                                      if (event.button === 2) {
                                        startSubgraphDrag(event, shape.id);
                                        return;
                                      }

                                      event.stopPropagation();
                                      selectSubgraphAtPoint(shape.id, point, event.shiftKey);
                                    }}
                                  />
                                ) : null}
                              </g>
                            ))}
                          </g>
                        );
                      })}
                    </g>
                  </svg>

                  {[...subgraphFrames].sort((left, right) => left.depth - right.depth).map((frame) => {
                    const subgraph = documentState.subgraphs.find((entry) => entry.id === frame.id);
                    if (!subgraph) {
                      return null;
                    }
                    const subgraphStyle = getSubgraphStyle(subgraph);
                    const subgraphParts = splitEntityText(subgraph.title);
                    const shape = subgraphBlobShapeMap.get(frame.id) ?? allSubgraphBlobShapeMap.get(frame.id) ?? null;
                    const isExplicitSelection =
                      selection.kind === 'subgraph' && selectionContains(selection, frame.id);
                    const isDropTarget = dragTargetSubgraphId === frame.id;
                    const isSearchMatch = canvasSearchSubgraphIds.has(frame.id);
                    const badgePoint = shape
                      ? resolveSubgraphBadgePoint(
                          shape,
                          subgraphBadgeAnchors[frame.id],
                        )
                      : {
                          x: frame.x + 18,
                          y: frame.y + 18,
                        };
                    const header = (
                      <div
                        className="subgraph-frame__header"
                        data-edge-endpoint-id={frame.id}
                        onPointerDown={(event) => {
                          const point = pointFromClient(event.clientX, event.clientY);
                          if (point) {
                            rememberSubgraphBadgeAnchor(frame.id, point);
                          }
                          startSubgraphDrag(event, frame.id);
                        }}
                      >
                        <div className="subgraph-frame__header-copy">
                          {editingSubgraphId === frame.id ? (
                            <textarea
                              className="subgraph-frame__title-input"
                              ref={subgraphEditorRef}
                              onBlur={() => commitSubgraphTitleEdit(frame.id)}
                              onChange={(event) => setEditingSubgraphTitle(event.target.value)}
                              onKeyDown={(event) => {
                                if (handleNativeSelectAllShortcut(event)) {
                                  return;
                                }

                                if (isCompositionConfirming(event)) {
                                  return;
                                }

                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  commitSubgraphTitleEdit(frame.id);
                                  return;
                                }

                                if (event.key === 'Tab') {
                                  event.preventDefault();
                                  setEditingSubgraphField((current) => (current === 'title' ? 'description' : 'title'));
                                  return;
                                }

                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  setEditingSubgraphId(null);
                                  setEditingSubgraphField('title');
                                  setEditingSubgraphTitle('');
                                }
                              }}
                              onPointerDown={(event) => event.stopPropagation()}
                              rows={Math.max(2, editingSubgraphTitle.split(/\r?\n/).length)}
                              value={editingSubgraphTitle}
                            />
                          ) : (
                            <span
                              className="subgraph-frame__title-button"
                              onDoubleClick={(event) => {
                                event.stopPropagation();
                                const target = event.target as HTMLElement;
                                startSubgraphTitleEdit(
                                  subgraph,
                                  target.closest('.subgraph-frame__description') ? 'description' : 'title',
                                );
                              }}
                            >
                              <strong>{subgraphParts.title}</strong>
                              {subgraphParts.description ? (
                                <small className="subgraph-frame__description">{subgraphParts.description}</small>
                              ) : null}
                            </span>
                          )}
                        </div>

                        <div className="subgraph-frame__actions">
                          <button
                            aria-label="从分组左侧拖出连线"
                            className="subgraph-frame__connector subgraph-frame__connector--start"
                            onPointerDown={(event) => beginConnection(event, frame, 'left')}
                            type="button"
                          >
                            <WorkbenchIcon name="link-start" />
                          </button>
                          <button
                            aria-label="从分组右侧拖出连线"
                            className="subgraph-frame__connector subgraph-frame__connector--end"
                            onPointerDown={(event) => beginConnection(event, frame, 'right')}
                            type="button"
                          >
                            <WorkbenchIcon name="link-end" />
                          </button>
                          <button
                            aria-label={subgraph.collapsed ? '展开分组' : '折叠分组'}
                            className="subgraph-frame__action"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleSubgraphCollapsed(frame.id);
                            }}
                            type="button"
                          >
                            <WorkbenchIcon name={subgraph.collapsed ? 'plus' : 'minus'} />
                          </button>
                          <button
                            aria-label="删除分组"
                            className="subgraph-frame__action is-danger"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteSubgraphById(frame.id);
                            }}
                            type="button"
                          >
                            <WorkbenchIcon name="trash" />
                          </button>
                        </div>
                      </div>
                    );

                    if (!subgraph.collapsed) {
                      const showFloatingBadge =
                        editingSubgraphId === frame.id ||
                        isExplicitSelection ||
                        isDropTarget ||
                        isSearchMatch;

                      if (!showFloatingBadge) {
                        return null;
                      }

                      return (
                        <div
                          key={frame.id}
                          className={`subgraph-badge${isExplicitSelection ? ' is-selected' : ''}${isDropTarget ? ' is-drop-target' : ''}${isSearchMatch ? ' is-search-match' : ''}`}
                          style={{
                            left: badgePoint.x - canvasBoardBounds.x,
                            top: badgePoint.y - canvasBoardBounds.y,
                            '--subgraph-fill': subgraphStyle.fill,
                            '--subgraph-stroke': subgraphStyle.stroke,
                            '--subgraph-text': subgraphStyle.textColor,
                          } as CSSProperties}
                        >
                          {header}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={frame.id}
                        className={`subgraph-frame${selectionContainsSubgraph(selection, frame.id) ? ' is-selected' : ''}${isDropTarget ? ' is-drop-target' : ''} is-collapsed${isSearchMatch ? ' is-search-match' : ''}`}
                        data-edge-endpoint-id={frame.id}
                        onPointerDown={(event) => {
                          const point = pointFromClient(event.clientX, event.clientY);
                          if (!point) {
                            return;
                          }

                          if (event.button === 1) {
                            startSubgraphDrag(event, frame.id);
                            return;
                          }

                          if (event.button === 2) {
                            startSubgraphDrag(event, frame.id);
                            return;
                          }

                          event.stopPropagation();
                          selectSubgraphAtPoint(frame.id, point, event.shiftKey);
                        }}
                        style={{
                          left: frame.x - canvasBoardBounds.x,
                          top: frame.y - canvasBoardBounds.y,
                          width: frame.width,
                          height: frame.height,
                          pointerEvents: hybridSceneActive ? 'none' : undefined,
                          '--depth': String(frame.depth),
                          '--subgraph-fill': subgraphStyle.fill,
                          '--subgraph-fill-soft': withAlpha(subgraphStyle.fill, 0.16),
                          '--subgraph-fill-faint': withAlpha(subgraphStyle.fill, 0.08),
                          '--subgraph-stroke': subgraphStyle.stroke,
                          '--subgraph-text': subgraphStyle.textColor,
                        } as CSSProperties}
                      >
                        {header}

                        <div className="subgraph-frame__summary">
                          <div className="subgraph-frame__summary-meta">
                            <span>{frame.memberCount} 项</span>
                          </div>
                          {frame.summaryLabels.length > 0 ? (
                            <div className="subgraph-frame__summary-chips">
                              {frame.summaryLabels.map((label, index) => (
                                <span className="subgraph-frame__summary-chip" key={`${frame.id}-summary-${index}`}>
                                  {label.split(/\r?\n/)[0]}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="subgraph-frame__summary-empty">暂无节点</div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <svg className="edge-layer" aria-hidden="true">
                    <defs>
                      {liveEdgeMarkerEntries.map((entry) => (
                        <marker
                          id={entry.id}
                          key={entry.id}
                          markerWidth="10"
                          markerHeight="8"
                          refX="8.5"
                          refY="4"
                          orient="auto"
                          markerUnits="userSpaceOnUse"
                        >
                          <path
                            d="M0,0.6 L9,4 L0,7.4 Z"
                            fill={entry.color}
                          />
                        </marker>
                      ))}
                    </defs>
                    <g transform={`translate(${-canvasBoardBounds.x} ${-canvasBoardBounds.y})`}>
                      {sceneOverlayEdges.map((edge) => {
                        const normalizedEdge = normalizeEdgeStyle(edge);
                        const fromNode = edgeEndpointMap.get(edge.from);
                        const toNode = edgeEndpointMap.get(edge.to);
                        if (!fromNode || !toNode) {
                          return null;
                        }

                        const isGroupEdge = fromNode.kind === 'subgraph' || toNode.kind === 'subgraph';
                        const isEdgeSelected =
                          selection.kind === 'edge' && selectionContains(selection, edge.id);
                        const inheritsSourceColor =
                          shouldInheritSourceEdgeColor(normalizedEdge.strokeColor);

                        const geometry = buildEdgeGeometry(
                          fromNode,
                          toNode,
                          edgeLaneMap.get(edge.id) ?? 0,
                          edgeEndpointOffsetMap.get(edge.id),
                        );
                        const edgeBaseColor = inheritsSourceColor
                          ? getEndpointAccentColor(fromNode)
                          : normalizedEdge.strokeColor;
                        const baseStrokeWidth = isGroupEdge
                          ? normalizedEdge.strokeWidth * 1.35
                          : normalizedEdge.strokeWidth;
                        const visualStrokeWidth = Math.max(
                          baseStrokeWidth,
                          isGroupEdge ? 2.4 : 1.75,
                        );
                        const selectedEdgeStrokeWidth = isEdgeSelected
                          ? visualStrokeWidth + 0.55
                          : visualStrokeWidth;
                        const displayStroke = withAlpha(edgeBaseColor, 1);
                        const dashArray = getEdgeDashArray(normalizedEdge.type);
                        const labelBackground = mixColors(edgeBaseColor, '#0c0c0e', 0.82);
                        const labelTextColor = getReadableLabelTextColor(
                          labelBackground,
                          '#ffffff',
                        );
                        const labelBorder = withAlpha(edgeBaseColor, isEdgeSelected ? 0.95 : 0.75);
                        const labelMetrics = edge.label ? measureEdgeLabelBadge(edge.label) : null;
                        const liveEdgeLabel = editingEdgeId === edge.id ? editingEdgeLabel || ' ' : edge.label;
                        const liveEdgeLabelMetrics = measureEdgeLabelBadge(liveEdgeLabel);
                        const edgeLabelLines = edge.label.split(/\r?\n/);
                        const arrowMarkerId = edge.type === 'line'
                          ? undefined
                          : liveEdgeMarkerIdMap.get(edgeBaseColor);
                        const isDropTarget = dragTargetEdgeId === edge.id;

                        return (
                          <g
                            key={edge.id}
                            className={`edge-group${isGroupEdge ? ' is-group-edge' : ''}${isEdgeSelected ? ' is-selected' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
                          >
                          {isEdgeSelected ? (
                            <path
                              className="edge-path edge-path--selection"
                              d={geometry.path}
                              pointerEvents="none"
                              stroke={withAlpha(edgeBaseColor, 0.28)}
                              strokeWidth={selectedEdgeStrokeWidth + 5}
                            />
                          ) : null}
                          {/* subtle dark halo */}
                          <path
                            className={`edge-path edge-path--underlay edge-path--${edge.type}`}
                            d={geometry.path}
                            pointerEvents="none"
                            stroke="rgba(0,0,0,0.72)"
                            strokeDasharray={dashArray}
                            strokeWidth={selectedEdgeStrokeWidth + 1.6}
                          />
                          <path
                            className={`edge-path edge-path--main edge-path--${edge.type}${isEdgeSelected ? ' is-selected' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
                            d={geometry.path}
                            markerEnd={arrowMarkerId ? `url(#${arrowMarkerId})` : undefined}
                            pointerEvents="none"
                            stroke={displayStroke}
                            strokeDasharray={dashArray}
                            strokeWidth={
                              normalizedEdge.type === 'thick'
                                ? Math.max(selectedEdgeStrokeWidth, 3.2)
                                : selectedEdgeStrokeWidth
                            }
                          />
                          {isDropTarget ? (
                            <path
                              className="edge-path edge-path--drop-target"
                              d={geometry.path}
                              pointerEvents="none"
                              stroke={withAlpha('#ff2a6d', 0.55)}
                              strokeWidth={selectedEdgeStrokeWidth + 4}
                            />
                          ) : null}
                          <path
                            className="edge-hitbox"
                            d={geometry.path}
                            onClick={(event) => {
                              event.stopPropagation();
                              selectSingle('edge', edge.id, event.shiftKey);
                            }}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              startEdgeInlineEdit(edge);
                            }}
                            strokeWidth={Math.max(normalizedEdge.strokeWidth + 14, 18)}
                          />
                          {editingEdgeId === edge.id ? (
                            <foreignObject
                              className="edge-label-editor-fo"
                              height={Math.max(52, liveEdgeLabelMetrics.height + 22)}
                              width={Math.max(164, liveEdgeLabelMetrics.width + 26)}
                              x={geometry.label.x - Math.max(164, liveEdgeLabelMetrics.width + 26) / 2}
                              y={geometry.label.y - Math.max(52, liveEdgeLabelMetrics.height + 22) / 2}
                            >
                              <textarea
                                autoFocus
                                className="edge-label-editor"
                                onBlur={() => commitEdgeInlineEdit(edge.id)}
                                onChange={(event) => setEditingEdgeLabel(event.target.value)}
                                onDoubleClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => {
                                  if (handleNativeSelectAllShortcut(event)) {
                                    return;
                                  }

                                  if (
                                    event.key === 'Enter' &&
                                    (event.shiftKey || event.ctrlKey || event.altKey)
                                  ) {
                                    event.preventDefault();
                                    const textarea = event.currentTarget;
                                    const start = textarea.selectionStart;
                                    const end = textarea.selectionEnd;
                                    const nextValue = `${editingEdgeLabel.slice(0, start)}\n${editingEdgeLabel.slice(end)}`;
                                    setEditingEdgeLabel(nextValue);
                                    window.requestAnimationFrame(() => {
                                      textarea.selectionStart = start + 1;
                                      textarea.selectionEnd = start + 1;
                                    });
                                    return;
                                  }

                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    commitEdgeInlineEdit(edge.id);
                                    return;
                                  }

                                  if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setEditingEdgeId(null);
                                    setEditingEdgeLabel('');
                                  }
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                                rows={1}
                                spellCheck={false}
                                style={{ minHeight: Math.max(liveEdgeLabelMetrics.height + 10, 38) }}
                                value={editingEdgeLabel}
                              />
                            </foreignObject>
                          ) : edge.label ? (
                            <g
                              className={`edge-label-group${isGroupEdge ? ' is-group-edge' : ''}${isEdgeSelected ? ' is-selected' : ''}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                selectSingle('edge', edge.id, event.shiftKey);
                              }}
                              onDoubleClick={(event) => {
                                event.stopPropagation();
                                startEdgeInlineEdit(edge);
                              }}
                              onPointerDown={(event) => event.stopPropagation()}
                              transform={`translate(${geometry.label.x}, ${geometry.label.y})`}
                            >
                              <rect
                                className={`edge-label-badge${isGroupEdge ? ' is-group-edge' : ''}${isEdgeSelected ? ' is-selected' : ''}`}
                                fill={labelBackground}
                                height={labelMetrics?.height ?? 22}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  selectSingle('edge', edge.id, event.shiftKey);
                                }}
                                rx={2}
                                stroke={labelBorder}
                                strokeWidth={isEdgeSelected ? 1.4 : 1}
                                width={labelMetrics?.width ?? 54}
                                x={-((labelMetrics?.width ?? 54) / 2)}
                                y={-((labelMetrics?.height ?? 22) / 2)}
                              />
                              <text
                                className={`edge-label${isGroupEdge ? ' is-group-edge' : ''}${isEdgeSelected ? ' is-selected' : ''}`}
                                fill={labelTextColor}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  selectSingle('edge', edge.id, event.shiftKey);
                                }}
                                x={0}
                              >
                                {edgeLabelLines.map((line, index) => (
                                  <tspan
                                    key={`${edge.id}-label-${index}`}
                                    dominantBaseline="middle"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      selectSingle('edge', edge.id, event.shiftKey);
                                    }}
                                    onDoubleClick={(event) => {
                                      event.stopPropagation();
                                      startEdgeInlineEdit(edge);
                                    }}
                                    x={0}
                                    y={((index - (edgeLabelLines.length - 1) / 2) * 16)}
                                  >
                                    {line || ' '}
                                  </tspan>
                                ))}
                              </text>
                            </g>
                          ) : null}
                          </g>
                        );
                      })}

                      {dragInsertPreview ? (
                        <>
                          <path
                            className="edge-path edge-path--preview edge-path--insert-preview"
                            d={dragInsertPreview.first.path}
                            markerEnd={(() => {
                              const marker = liveEdgeMarkerEntries.find((entry) => entry.color === dragInsertPreview.stroke);
                              return marker ? `url(#${marker.id})` : undefined;
                            })()}
                            stroke={withAlpha(dragInsertPreview.stroke, 0.9)}
                            strokeWidth={1.8}
                          />
                          <path
                            className="edge-path edge-path--preview edge-path--insert-preview"
                            d={dragInsertPreview.second.path}
                            markerEnd={(() => {
                              const marker = liveEdgeMarkerEntries.find((entry) => entry.color === dragInsertPreview.stroke);
                              return marker ? `url(#${marker.id})` : undefined;
                            })()}
                            stroke={withAlpha(dragInsertPreview.stroke, 0.9)}
                            strokeWidth={1.8}
                          />
                        </>
                      ) : null}

                      {connectingState ? (
                        <path
                          className="edge-path edge-path--preview"
                          d={(() => {
                            const originNode = edgeEndpointMap.get(connectingState.fromId);
                            if (!originNode) {
                              return '';
                            }

                            return buildPreviewEdgePath(originNode, connectingState.current, connectingState.handleSide);
                          })()}
                          markerEnd={(() => {
                            if (connectingState.edgeType === 'line') {
                              return undefined;
                            }
                            const originNode = edgeEndpointMap.get(connectingState.fromId);
                            if (!originNode) {
                              return undefined;
                            }
                            const color = withAlpha(originNode.stroke, 0.9);
                            const marker = liveEdgeMarkerEntries.find((entry) => entry.color === color);
                            return marker ? `url(#${marker.id})` : undefined;
                          })()}
                          stroke={(() => {
                            const originNode = edgeEndpointMap.get(connectingState.fromId);
                            return originNode ? withAlpha(originNode.stroke, 0.9) : '#d6ff3a';
                          })()}
                          strokeWidth={1.8}
                        />
                      ) : null}
                    </g>
                  </svg>

                  {sceneOverlayNodes.map((node) => {
                    const selected = selection.kind === 'node' && selectionContains(selection, node.id);
                    const isEditing = editingNodeId === node.id;
                    const liveContent = isEditing ? editingLabel || ' ' : node.label;
                    const liveParts = isEditing ? splitEntityDraft(liveContent) : splitEntityText(liveContent);
                    const liveSize = isEditing ? measureNodeContentSize(liveParts.title, liveParts.description) : node;
                    const validation = nodeTitleValidationMap.get(node.id);

                    return (
                      <div
                        key={node.id}
                        className={`graph-node graph-node--${node.shape}${selected ? ' is-selected' : ''}${hoveredNodeId === node.id ? ' is-hovered' : ''}${dragTargetNodeId === node.id ? ' is-drop-target' : ''}${canvasSearchNodeIds.has(node.id) ? ' is-search-match' : ''}${validation?.hasWarning ? ' has-warning' : ''}${validation?.duplicate ? ' has-duplicate-title' : ''}${validation?.illegal ? ' has-illegal-title' : ''}`}
                        data-edge-endpoint-id={node.id}
                        data-node-id={node.id}
                        onDoubleClick={(event) => {
                          if (isMobileViewport) {
                            return;
                          }
                          event.stopPropagation();
                          if (event.metaKey || event.ctrlKey) {
                            selectConnectedNodeComponent(node.id);
                            return;
                          }
                          const target = event.target as HTMLElement;
                          const nextField = target.closest('.graph-node__description')
                            ? 'description'
                            : 'title';
                          if (isEditing) {
                            setEditingNodeField(nextField);
                            return;
                          }
                          startInlineEdit(node, nextField);
                        }}
                        onMouseEnter={() => setHoveredNodeId(node.id)}
                        onMouseLeave={() => setHoveredNodeId((current) => (current === node.id ? null : current))}
                        onPointerDown={(event) => startNodeDrag(event, node)}
                        style={{
                          left: node.x - canvasBoardBounds.x,
                          top: node.y - canvasBoardBounds.y,
                          width: liveSize.width,
                          height: liveSize.height,
                          background: node.fill,
                          borderColor: node.stroke,
                          color: node.textColor,
                          '--node-fill': node.fill,
                          '--node-stroke': node.stroke,
                          '--node-text': node.textColor,
                        } as CSSProperties}
                        tabIndex={0}
                        title={validation?.tooltip || undefined}
                      >
                        <button
                          aria-label="从节点左侧拖出连线"
                          className="graph-node__connector graph-node__connector--start"
                          onPointerDown={(event) => beginConnection(event, node, 'left')}
                          type="button"
                        >
                          <WorkbenchIcon name="link-start" />
                        </button>

                        {isEditing ? (
                          <div
                            className={`graph-node__editor-shell${liveParts.description ? '' : ' graph-node__editor-shell--description-empty'}`}
                            ref={nodeEditorShellRef}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <textarea
                              className={`graph-node__editor graph-node__editor--title${editingNodeField === 'title' ? ' is-active' : ''}`}
                              ref={nodeTitleEditorRef}
                              onFocus={(event) => {
                                const target = event.currentTarget;
                                if (
                                  !pendingPlaceholderTitleSelectAllRef.current &&
                                  !shouldSelectAllInlineNodeField(target.value, 'title')
                                ) {
                                  return;
                                }

                                window.requestAnimationFrame(() => {
                                  target.selectionStart = 0;
                                  target.selectionEnd = target.value.length;
                                });
                              }}
                              onMouseUp={(event) => {
                                const target = event.currentTarget;
                                if (
                                  !pendingPlaceholderTitleSelectAllRef.current &&
                                  !shouldSelectAllInlineNodeField(target.value, 'title')
                                ) {
                                  return;
                                }

                                event.preventDefault();
                                window.requestAnimationFrame(() => {
                                  target.selectionStart = 0;
                                  target.selectionEnd = target.value.length;
                                  pendingPlaceholderTitleSelectAllRef.current = false;
                                });
                              }}
                              onBlur={() => {
                                pendingPlaceholderTitleSelectAllRef.current = false;
                                window.requestAnimationFrame(() => {
                                  if (nodeEditorShellRef.current?.contains(document.activeElement)) {
                                    persistInlineNodeDraft(node.id, {
                                      historyTitle: '已暂存节点',
                                      historyDetail: '已在切换编辑区域时暂存节点草稿。',
                                    });
                                    return;
                                  }
                                  commitInlineEdit(node.id);
                                });
                              }}
                              onChange={(event) => updateEditingNodeFieldValue('title', event.target.value)}
                              onKeyDown={(event) => {
                                if (handleNativeSelectAllShortcut(event)) {
                                  return;
                                }

                                if (isCompositionConfirming(event)) {
                                  return;
                                }

                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  commitInlineEdit(node.id);
                                  return;
                                }

                                if (event.key === 'Tab') {
                                  event.preventDefault();
                                  setEditingLabel((current) => ensureInlineEntityFieldValue(current, 'description'));
                                  setEditingNodeField('description');
                                  return;
                                }

                                  if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setEditingNodeId(null);
                                    setEditingNodeField('title');
                                    setEditingNodeSelectAll(false);
                                    setEditingLabel('');
                                  }
                              }}
                              rows={1}
                              placeholder="未命名内容"
                              value={liveParts.title}
                            />
                            <textarea
                              className={`graph-node__editor graph-node__editor--description${editingNodeField === 'description' ? ' is-active' : ''}`}
                              ref={nodeDescriptionEditorRef}
                              onBlur={() => {
                                window.requestAnimationFrame(() => {
                                  if (nodeEditorShellRef.current?.contains(document.activeElement)) {
                                    persistInlineNodeDraft(node.id, {
                                      historyTitle: '已暂存节点',
                                      historyDetail: '已在切换编辑区域时暂存节点草稿。',
                                    });
                                    return;
                                  }
                                  commitInlineEdit(node.id);
                                });
                              }}
                              onChange={(event) => updateEditingNodeFieldValue('description', event.target.value)}
                              onKeyDown={(event) => {
                                if (handleNativeSelectAllShortcut(event)) {
                                  return;
                                }

                                if (isCompositionConfirming(event)) {
                                  return;
                                }

                                if (
                                  event.key === 'Enter' &&
                                  (event.shiftKey || event.ctrlKey || event.altKey)
                                ) {
                                  event.preventDefault();
                                  const textarea = event.currentTarget;
                                  const start = textarea.selectionStart;
                                  const end = textarea.selectionEnd;
                                  const nextValue = `${liveParts.description.slice(0, start)}\n${liveParts.description.slice(end)}`;
                                  updateEditingNodeFieldValue('description', nextValue);
                                  window.requestAnimationFrame(() => {
                                    textarea.selectionStart = start + 1;
                                    textarea.selectionEnd = start + 1;
                                  });
                                  return;
                                }

                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  commitInlineEdit(node.id);
                                  return;
                                }

                                if (event.key === 'Tab') {
                                  event.preventDefault();
                                  setEditingNodeField('title');
                                  return;
                                }

                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  setEditingNodeId(null);
                                  setEditingNodeField('title');
                                  setEditingNodeSelectAll(false);
                                  setEditingLabel('');
                                }
                              }}
                              placeholder="（空）"
                              rows={Math.max(2, liveParts.description.split('\n').length || 1)}
                              style={{ minHeight: Math.max(liveSize.height - 66, 42) }}
                              value={liveParts.description}
                            />
                          </div>
                        ) : (
                          <div className={`graph-node__content${liveParts.description ? '' : ' graph-node__content--description-empty'}`}>
                            <div className="graph-node__title">{liveParts.title}</div>
                            <div className={`graph-node__description${liveParts.description ? '' : ' graph-node__description--empty'}`}>
                              {liveParts.description || '（空）'}
                            </div>
                          </div>
                        )}

                        <button
                          aria-label="从节点右侧拖出连线"
                          className="graph-node__connector graph-node__connector--end"
                          onPointerDown={(event) => beginConnection(event, node, 'right')}
                          type="button"
                        >
                          <WorkbenchIcon name="link-end" />
                        </button>
                      </div>
                    );
                  })}

                  {boxState ? (
                    null
                  ) : null}
                </div>

                {boxState ? (
                  <div
                    className="selection-box"
                    style={selectionBoxStyle(
                      rectFromPoints(boxState.origin, boxState.current),
                      documentState.layout.viewport,
                    )}
                  />
                ) : null}

                {(
                  <div
                    className={`content-card content-card--pinned${selectedContent ? ' is-selected' : ''}${editingContent ? ' is-editing' : ''}${contentCardCollapsed ? ' is-collapsed' : ''}`}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      startContentInlineEdit();
                    }}
                    onWheelCapture={(event) => event.stopPropagation()}
                    onPointerDown={(event) => {
                      const target = event.target as HTMLElement;
                      if (target.closest('.content-card__action, .content-card__editor, .content-card__resize-handle')) {
                        return;
                      }

                      event.stopPropagation();
                      if (event.shiftKey) {
                        setSelection((current) => toggleSelectionIds(current, 'content', [CONTENT_CARD_ID]));
                        return;
                      }
                      setSelection({ kind: 'content', ids: [CONTENT_CARD_ID] });
                    }}
                    style={contentCardStyle}
                  >
                    <div
                      className="content-card__header"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                      }}
                    >
                      <div className="content-card__header-copy">
                        <span className="content-card__eyebrow">Additional</span>
                        <strong>附加信息</strong>
                      </div>
                      <button
                        aria-label={contentCardLayout.collapsed ? '展开附加信息' : '折叠附加信息'}
                        className="content-card__action"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleContentCollapsed();
                        }}
                        type="button"
                      >
                        <WorkbenchIcon name={contentCardLayout.collapsed ? 'plus' : 'minus'} />
                      </button>
                    </div>

                        {editingContent ? (
                          <textarea
                            autoFocus
                        className="content-card__editor"
                        onBlur={commitContentInlineEdit}
                        onChange={(event) =>
                          setContentInspectorDraft({ markdown: event.target.value })
                        }
                        onDoubleClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (handleNativeSelectAllShortcut(event)) {
                            return;
                          }

                          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                            event.preventDefault();
                            commitContentInlineEdit();
                            event.currentTarget.blur();
                            return;
                          }

                          if (event.key === 'Escape') {
                            event.preventDefault();
                            setEditingContent(false);
                            setContentInspectorDraft({ markdown: contentMarkdown });
                          }
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onWheelCapture={(event) => event.stopPropagation()}
                        rows={Math.max(8, contentInspectorDraft.markdown.split(/\r?\n/).length + 2)}
                        spellCheck={false}
                        value={contentInspectorDraft.markdown}
                      />
                    ) : contentCardCollapsed ? (
                      <div className="content-card__summary">
                        <p>{contentCardSummary}</p>
                      </div>
                    ) : (
                        <div
                          className="content-card__body"
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            startContentInlineEdit();
                          }}
                          onWheelCapture={(event) => event.stopPropagation()}
                          dangerouslySetInnerHTML={{ __html: contentCardPreviewHtml }}
                        />
                      )}
                    <div
                      aria-hidden="true"
                      className="content-card__resize-handle content-card__resize-handle--right"
                      onPointerDown={(event) => beginContentCardResize(event, 'right')}
                    />
                    <div
                      aria-hidden="true"
                      className="content-card__resize-handle content-card__resize-handle--bottom"
                      onPointerDown={(event) => beginContentCardResize(event, 'bottom')}
                    />
                    <div
                      aria-hidden="true"
                      className="content-card__resize-handle content-card__resize-handle--corner"
                      onPointerDown={(event) => beginContentCardResize(event, 'corner')}
                    />
                  </div>
                )}

                <div className="tool-dock" role="toolbar" aria-label="画布工具">
                  <button
                    aria-label="选择"
                    className="tool-dock__button has-tooltip is-active"
                    data-tooltip="选择"
                    type="button"
                  >
                    <WorkbenchIcon name="cursor" />
                  </button>
                  <button
                    aria-label="新建节点"
                    className="tool-dock__button has-tooltip"
                    data-tooltip="新建节点"
                    onClick={() => {
                      const viewport = documentState.layout.viewport;
                      createNodeAt({
                        x: (540 - viewport.x) / viewport.zoom,
                        y: (260 - viewport.y) / viewport.zoom,
                      });
                    }}
                    type="button"
                  >
                    <WorkbenchIcon name="node" />
                  </button>
                  <button
                    aria-label="创建分组"
                    className={canGroupSelection ? 'tool-dock__button has-tooltip' : 'tool-dock__button has-tooltip is-disabled'}
                    data-tooltip="创建分组"
                    disabled={!canGroupSelection}
                    onClick={wrapSelectionInSubgraph}
                    type="button"
                  >
                    <WorkbenchIcon name="group" />
                  </button>
                  <button
                    aria-label="重置视口"
                    className="tool-dock__button has-tooltip"
                    data-tooltip="重置视口"
                    onClick={() => {
                      updateViewport(() => ({ x: 120, y: 90, zoom: 1 }));
                      setHistory((current) => [
                        createHistoryEntry('视口已重置', '已重置画布视角。'),
                        ...current,
                      ].slice(0, 40));
                    }}
                    type="button"
                  >
                    <WorkbenchIcon name="reset" />
                  </button>

                  <span className="tool-dock__divider" />

                  <button
                    aria-label="缩小"
                    className="tool-dock__button has-tooltip"
                    data-tooltip="缩小"
                    onClick={() =>
                      updateViewport((viewport) => ({
                        ...viewport,
                        zoom: clamp(viewport.zoom - 0.1, MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM),
                      }))
                    }
                    type="button"
                  >
                    <WorkbenchIcon name="minus" />
                  </button>
                  <span className="tool-dock__zoom">{Math.round(documentState.layout.viewport.zoom * 100)}%</span>
                  <button
                    aria-label="放大"
                    className="tool-dock__button has-tooltip"
                    data-tooltip="放大"
                    onClick={() =>
                      updateViewport((viewport) => ({
                        ...viewport,
                        zoom: clamp(viewport.zoom + 0.1, MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM),
                      }))
                    }
                    type="button"
                  >
                    <WorkbenchIcon name="plus" />
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {!isVsCodeHost && mode === 'source' ? (
            <div className="source-mode">
              <section className="source-pane">
                <div className="pane-header">
                  <div>
                    <p className="eyebrow">Project Markdown</p>
                    <h2>工程源码编辑器</h2>
                  </div>
                  <div className="source-pane__actions">
                    <button
                      className="ghost-button"
                      onClick={() => setSourceDraft(documentState.markdown ?? documentState.source)}
                      type="button"
                    >
                      回退到有效图
                    </button>
                    {isMobileViewport ? (
                      <button
                        className="solid-button"
                        onClick={() => setMobileSourcePreviewOpen((current) => !current)}
                        type="button"
                      >
                        {mobileSourcePreviewOpen ? '收起预览' : '查看预览'}
                      </button>
                    ) : null}
                  </div>
                </div>

                <textarea
                  className="source-editor"
                  ref={sourceEditorRef}
                  onChange={(event) => {
                    setSaveStatus('saving');
                    setSourceDraft(event.target.value);
                  }}
                  onBlur={commitSourceDraft}
                  onKeyDown={(event) => {
                    handleNativeSelectAllShortcut(event);
                  }}
                  spellCheck={false}
                  value={sourceDraft}
                />

                <div className="source-status">
                  <span>
                    {sourceParseError
                      ? '当前工程 Markdown 存在语法问题，退出编辑前不会提交。'
                      : '工程 Markdown 草稿会在失焦或切换模式后提交到共享图模型。'}
                  </span>
                  {sourceParseError ? <strong>{sourceParseError}</strong> : null}
                  {documentState.warnings.length > 0 ? (
                    <p>{documentState.warnings[0]}</p>
                  ) : null}
                </div>
              </section>

              {!isMobileViewport ? (
                <section className="preview-pane">
                  <div className="pane-header">
                    <div>
                      <p className="eyebrow">实时预览</p>
                      <h2>标准 Mermaid 渲染</h2>
                    </div>
                  </div>
                  <MermaidPreview source={extractMermaidFromProjectMarkdown(sourceDraft)} />
                </section>
              ) : null}
            </div>
          ) : null}

          {!isVsCodeHost && mode === 'history' ? (
            <div className="history-mode">
              <div className="pane-header">
                <div>
                  <p className="eyebrow">协作流</p>
                  <h2>工作区历史</h2>
                </div>
              </div>

              <div className="history-timeline">
                {history.map((entry) => (
                  <article className="history-card" key={entry.id}>
                    <div className="history-card__time">{formatTime(entry.at)}</div>
                    <div>
                      <h3>{entry.title}</h3>
                      <p>{entry.detail}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <aside
          className={`inspector${showInspector ? ' is-open' : ''}`}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {isMobileViewport ? (
            <div className="mobile-sheet-handle" aria-hidden="true" />
          ) : null}

          {!isVsCodeHost ? (
            <div className="inspector-tabs" role="tablist" aria-label="右侧面板视图">
              <button
                className={inspectorView === 'properties' ? 'inspector-tab is-active' : 'inspector-tab'}
                onClick={() => setInspectorView('properties')}
                type="button"
              >
                属性
              </button>
              <button
                className={inspectorView === 'ai' ? 'inspector-tab is-active' : 'inspector-tab'}
                onClick={() => setInspectorView('ai')}
                type="button"
              >
                AI
              </button>
            </div>
          ) : null}

          {inspectorView === 'properties' ? (
            <>
          {selectedNodes.length > 0 ? (
            <section className="sidebar-card">
              <div className="sidebar-card__header">
                <h2>节点</h2>
                <span>{selectedNodes.length === 1 ? selectedNode?.id : `已选中 ${selectedNodes.length} 个`}</span>
              </div>
              {selectedNodes.length === 1 ? (
                <>
                  <label className="field">
                    <span>ID / 标题</span>
                    <input
                      onBlur={() => applyNodeInspectorDraft(nodeInspectorDraft, selectedNodes.map((node) => node.id))}
                      onChange={(event) =>
                        setNodeInspectorDraft((current) => ({ ...current, label: event.target.value }))
                      }
                      onKeyDown={(event) => {
                        if (handleNativeSelectAllShortcut(event)) {
                          return;
                        }

                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                          event.preventDefault();
                          applyNodeInspectorDraft(nodeInspectorDraft, selectedNodes.map((node) => node.id));
                          event.currentTarget.blur();
                        }
                      }}
                      type="text"
                      value={nodeInspectorDraft.label}
                    />
                  </label>
                  <label className="field">
                    <span>描述</span>
                    <textarea
                      onBlur={() => applyNodeInspectorDraft(nodeInspectorDraft, selectedNodes.map((node) => node.id))}
                      onChange={(event) =>
                        setNodeInspectorDraft((current) => ({ ...current, description: event.target.value }))
                      }
                      onKeyDown={(event) => {
                        if (handleNativeSelectAllShortcut(event)) {
                          return;
                        }

                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                          event.preventDefault();
                          applyNodeInspectorDraft(nodeInspectorDraft, selectedNodes.map((node) => node.id));
                          event.currentTarget.blur();
                        }
                      }}
                      rows={5}
                      value={nodeInspectorDraft.description}
                    />
                  </label>
                </>
              ) : (
                <p className="field-hint">多选时可批量修改样式与形状，文本内容保持不变。</p>
              )}
              <label className="field">
                <span>形状</span>
                <select
                  onChange={(event) => {
                    const nextDraft = { ...nodeInspectorDraft, shape: event.target.value as NodeShape };
                    setNodeInspectorDraft(nextDraft);
                    applyNodeInspectorDraft(nextDraft);
                  }}
                  value={nodeInspectorDraft.shape}
                >
                  {shapeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span>样式预设</span>
                <div className="node-style-presets" role="list">
                  {nodeStylePresets.map((preset) => (
                    <button
                      key={preset.id}
                      className={selectedNodePresetId === preset.id ? 'node-style-preset is-active' : 'node-style-preset'}
                      onClick={() => {
                        setNodeInspectorDraft({
                          ...nodeInspectorDraft,
                          fill: preset.fill,
                          stroke: preset.stroke,
                          textColor: preset.textColor,
                        });
                        applyNodeStylePreset(preset);
                      }}
                      type="button"
                    >
                      <span className="node-style-preset__swatches" aria-hidden="true">
                        <span style={{ background: preset.fill }} />
                        <span style={{ background: preset.stroke }} />
                        <span style={{ background: preset.textColor }} />
                      </span>
                      <span className="node-style-preset__label">{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="color-grid">
                <label className="field">
                  <span>填充</span>
                  <input
                    onChange={(event) => {
                      const nextDraft = { ...nodeInspectorDraft, fill: event.target.value };
                      setNodeInspectorDraft(nextDraft);
                      applyNodeInspectorDraft(nextDraft);
                    }}
                    type="color"
                    value={nodeInspectorDraft.fill}
                  />
                </label>
                <label className="field">
                  <span>描边</span>
                  <input
                    onChange={(event) => {
                      const nextDraft = { ...nodeInspectorDraft, stroke: event.target.value };
                      setNodeInspectorDraft(nextDraft);
                      applyNodeInspectorDraft(nextDraft);
                    }}
                    type="color"
                    value={nodeInspectorDraft.stroke}
                  />
                </label>
                <label className="field">
                  <span>文字</span>
                  <input
                    onChange={(event) => {
                      const nextDraft = { ...nodeInspectorDraft, textColor: event.target.value };
                      setNodeInspectorDraft(nextDraft);
                      applyNodeInspectorDraft(nextDraft);
                    }}
                    type="color"
                    value={nodeInspectorDraft.textColor}
                  />
                </label>
              </div>
            </section>
          ) : null}

          {selectedEdge ? (
            <section className="sidebar-card">
              <div className="sidebar-card__header">
                <h2>连线</h2>
                <span>{selectedEdge.from} 到 {selectedEdge.to}</span>
              </div>
              <label className="field">
                <span>标签</span>
                <textarea
                  onBlur={() => applyEdgeInspectorDraft(edgeInspectorDraft, selectedEdge ? [selectedEdge.id] : [])}
                  onChange={(event) =>
                    setEdgeInspectorDraft((current) => ({ ...current, label: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (handleNativeSelectAllShortcut(event)) {
                      return;
                    }

                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      applyEdgeInspectorDraft(edgeInspectorDraft, selectedEdge ? [selectedEdge.id] : []);
                      event.currentTarget.blur();
                    }
                  }}
                  rows={4}
                  value={edgeInspectorDraft.label}
                />
              </label>
              <label className="field">
                <span>类型</span>
                <select
                  onChange={(event) => {
                    const nextDraft = { ...edgeInspectorDraft, type: event.target.value as GraphEdge['type'] };
                    setEdgeInspectorDraft(nextDraft);
                    applyEdgeInspectorDraft(nextDraft);
                  }}
                  value={edgeInspectorDraft.type}
                >
                  <option value="solid">箭头</option>
                  <option value="line">直线</option>
                  <option value="dotted">虚线</option>
                  <option value="thick">粗线</option>
                </select>
              </label>
              <div className="color-grid">
                <label className="field">
                  <span>颜色</span>
                  <input
                    onChange={(event) => {
                      const nextDraft = { ...edgeInspectorDraft, strokeColor: event.target.value };
                      setEdgeInspectorDraft(nextDraft);
                      applyEdgeInspectorDraft(nextDraft);
                    }}
                    type="color"
                    value={edgeInspectorDraft.strokeColor}
                  />
                </label>
                <label className="field">
                  <span>粗细</span>
                  <input
                    max={12}
                    min={1}
                    onBlur={() => applyEdgeInspectorDraft(edgeInspectorDraft, selectedEdge ? [selectedEdge.id] : [])}
                    onChange={(event) =>
                      setEdgeInspectorDraft((current) => ({
                        ...current,
                        strokeWidthInput: event.target.value,
                      }))
                    }
                  onKeyDown={(event) => {
                    if (handleNativeSelectAllShortcut(event)) {
                      return;
                    }

                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyEdgeInspectorDraft(edgeInspectorDraft, selectedEdge ? [selectedEdge.id] : []);
                      event.currentTarget.blur();
                      }
                    }}
                    step={0.2}
                    type="number"
                    value={edgeInspectorDraft.strokeWidthInput}
                  />
                </label>
              </div>
            </section>
          ) : null}

          {selectedSubgraph ? (
            <section className="sidebar-card">
              <div className="sidebar-card__header">
                <h2>分组</h2>
                <span>{selectedSubgraph.id}</span>
              </div>
              <label className="field">
                <span>ID / 标题</span>
                <input
                  onBlur={() => applySubgraphInspectorDraft(subgraphInspectorDraft, selectedSubgraph ? [selectedSubgraph.id] : [])}
                  onChange={(event) =>
                    setSubgraphInspectorDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (handleNativeSelectAllShortcut(event)) {
                      return;
                    }

                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applySubgraphInspectorDraft(subgraphInspectorDraft, selectedSubgraph ? [selectedSubgraph.id] : []);
                      event.currentTarget.blur();
                    }
                  }}
                  value={subgraphInspectorDraft.title}
                />
              </label>
              <label className="field">
                <span>描述</span>
                <textarea
                  onBlur={() => applySubgraphInspectorDraft(subgraphInspectorDraft, selectedSubgraph ? [selectedSubgraph.id] : [])}
                  onChange={(event) =>
                    setSubgraphInspectorDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (handleNativeSelectAllShortcut(event)) {
                      return;
                    }

                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      applySubgraphInspectorDraft(subgraphInspectorDraft, selectedSubgraph ? [selectedSubgraph.id] : []);
                      event.currentTarget.blur();
                    }
                  }}
                  rows={4}
                  value={subgraphInspectorDraft.description}
                />
              </label>
              <label className="toggle-row">
                <span>折叠</span>
                <input
                  checked={subgraphInspectorDraft.collapsed}
                  onChange={(event) => {
                    const nextDraft = { ...subgraphInspectorDraft, collapsed: event.target.checked };
                    setSubgraphInspectorDraft(nextDraft);
                    applySubgraphInspectorDraft(nextDraft);
                  }}
                  type="checkbox"
                />
              </label>
              <div className="field">
                <span>样式预设</span>
                <div className="node-style-presets" role="list">
                  {nodeStylePresets.map((preset) => (
                    <button
                      key={`subgraph-${preset.id}`}
                      className={
                        subgraphInspectorDraft.fill === preset.fill &&
                        subgraphInspectorDraft.stroke === preset.stroke &&
                        subgraphInspectorDraft.textColor === preset.textColor
                          ? 'node-style-preset is-active'
                          : 'node-style-preset'
                      }
                      onClick={() => {
                        const nextDraft = {
                          ...subgraphInspectorDraft,
                          fill: preset.fill,
                          stroke: preset.stroke,
                          textColor: preset.textColor,
                        };
                        setSubgraphInspectorDraft(nextDraft);
                        applySubgraphInspectorDraft(nextDraft);
                      }}
                      type="button"
                    >
                      <span className="node-style-preset__swatches" aria-hidden="true">
                        <span style={{ background: preset.fill }} />
                        <span style={{ background: preset.stroke }} />
                        <span style={{ background: preset.textColor }} />
                      </span>
                      <span className="node-style-preset__label">{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="color-grid">
                <label className="field">
                  <span>填充</span>
                  <input
                    onChange={(event) => {
                      const nextDraft = { ...subgraphInspectorDraft, fill: event.target.value };
                      setSubgraphInspectorDraft(nextDraft);
                      applySubgraphInspectorDraft(nextDraft);
                    }}
                    type="color"
                    value={subgraphInspectorDraft.fill}
                  />
                </label>
                <label className="field">
                  <span>描边</span>
                  <input
                    onChange={(event) => {
                      const nextDraft = { ...subgraphInspectorDraft, stroke: event.target.value };
                      setSubgraphInspectorDraft(nextDraft);
                      applySubgraphInspectorDraft(nextDraft);
                    }}
                    type="color"
                    value={subgraphInspectorDraft.stroke}
                  />
                </label>
                <label className="field">
                  <span>文字</span>
                  <input
                    onChange={(event) => {
                      const nextDraft = { ...subgraphInspectorDraft, textColor: event.target.value };
                      setSubgraphInspectorDraft(nextDraft);
                      applySubgraphInspectorDraft(nextDraft);
                    }}
                    type="color"
                    value={subgraphInspectorDraft.textColor}
                  />
                </label>
              </div>
            </section>
          ) : null}

          {selectedContent ? (
            <section className="sidebar-card">
              <div className="sidebar-card__header">
                <h2>附加信息</h2>
                <span>Additional</span>
              </div>
              <label className="field field--inline">
                <span>折叠</span>
                <input
                  checked={contentCardLayout.collapsed}
                  onChange={(event) => toggleContentCollapsed(event.target.checked)}
                  type="checkbox"
                />
              </label>
              <label className="field">
                <span>Markdown</span>
                <textarea
                  onBlur={() => applyContentInspectorDraft()}
                  onChange={(event) =>
                    setContentInspectorDraft({ markdown: event.target.value })
                  }
                  onKeyDown={(event) => {
                    if (handleNativeSelectAllShortcut(event)) {
                      return;
                    }

                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      applyContentInspectorDraft();
                      event.currentTarget.blur();
                    }
                  }}
                  rows={Math.min(10, Math.max(7, contentInspectorDraft.markdown.split(/\r?\n/).length + 2))}
                  value={contentInspectorDraft.markdown}
                />
              </label>
            </section>
          ) : null}

          {!selectedNode && !selectedEdge && !selectedSubgraph && !selectedContent ? (
            <section className="sidebar-card inspector-empty">
              <div className="sidebar-card__header">
                <h2>工程信息</h2>
                <span>Project</span>
              </div>
              <label className="field">
                <span>Project Name</span>
                <input
                  onBlur={() => applyProjectInspectorDraft()}
                  onChange={(event) =>
                    setProjectInspectorDraft((current) => ({
                      ...current,
                      projectName: event.target.value,
                    }))
                  }
                  onKeyDown={(event) => {
                    if (handleNativeSelectAllShortcut(event)) {
                      return;
                    }

                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyProjectInspectorDraft();
                      event.currentTarget.blur();
                    }
                  }}
                  type="text"
                  value={projectInspectorDraft.projectName}
                />
              </label>
              <label className="field">
                <span>Summary</span>
                <textarea
                  onBlur={() => applyProjectInspectorDraft()}
                  onChange={(event) =>
                    setProjectInspectorDraft((current) => ({
                      ...current,
                      projectSummary: event.target.value,
                    }))
                  }
                  onKeyDown={(event) => {
                    if (handleNativeSelectAllShortcut(event)) {
                      return;
                    }

                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      applyProjectInspectorDraft();
                      event.currentTarget.blur();
                    }
                  }}
                  rows={3}
                  value={projectInspectorDraft.projectSummary}
                />
              </label>
              <label className="field">
                <span>附加信息</span>
                <textarea
                  onBlur={() => applyProjectInspectorDraft()}
                  onChange={(event) =>
                    setProjectInspectorDraft((current) => ({
                      ...current,
                      contentMarkdown: event.target.value,
                    }))
                  }
                  onKeyDown={(event) => {
                    if (handleNativeSelectAllShortcut(event)) {
                      return;
                    }

                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      applyProjectInspectorDraft();
                      event.currentTarget.blur();
                    }
                  }}
                  rows={Math.min(10, Math.max(7, projectInspectorDraft.contentMarkdown.split(/\r?\n/).length + 2))}
                  value={projectInspectorDraft.contentMarkdown}
                />
              </label>
            </section>
          ) : null}
            </>
          ) : !isVsCodeHost ? (
            <section className="ai-sidebar" aria-label="AI 助手">
              <div className="ai-sidebar__header">
                <div className="ai-sidebar__title">
                  <strong>AI 助手</strong>
                  <span>{activeAiRecord?.title ?? '新对话'}</span>
                </div>
                <div className="ai-sidebar__header-actions">
                  <button
                    aria-label="新建对话"
                    className="panel-icon-button has-tooltip"
                    data-tooltip="新对话"
                    onClick={createAiConversation}
                    type="button"
                  >
                    <WorkbenchIcon name="plus" />
                  </button>
                  <button
                    aria-label="清空当前记录"
                    className="panel-icon-button has-tooltip"
                    data-tooltip="清空当前记录"
                    onClick={clearActiveAiConversation}
                    type="button"
                  >
                    <WorkbenchIcon name="trash" />
                  </button>
                </div>
              </div>

              <div className="ai-sidebar__tabs" role="tablist" aria-label="AI 面板页签">
                <button
                  className={aiPanelTab === 'chat' ? 'ai-sidebar__tab is-active' : 'ai-sidebar__tab'}
                  onClick={() => setAiPanelTab('chat')}
                  type="button"
                >
                  聊天
                </button>
                <button
                  className={aiPanelTab === 'settings' ? 'ai-sidebar__tab is-active' : 'ai-sidebar__tab'}
                  onClick={() => setAiPanelTab('settings')}
                  type="button"
                >
                  设置
                </button>
              </div>

              {aiPanelTab === 'chat' ? (
                <div className="ai-sidebar__chat">
                  <div className="ai-sidebar__topbar">
                    <button
                      aria-expanded={aiRecordsExpanded}
                      className={aiRecordsExpanded ? 'ai-sidebar__toggle is-active' : 'ai-sidebar__toggle'}
                      onClick={() => setAiRecordsExpanded((current) => !current)}
                      type="button"
                    >
                      <WorkbenchIcon name="history" />
                      <span>记录 {aiRecords.length}</span>
                    </button>
                    <div className="ai-lock-row" aria-label="Agent 模式控制">
                      {aiLockControls.map((control) => {
                        const checked = aiSettings[control.key];
                        return (
                          <button
                            aria-pressed={!checked}
                            className={checked ? 'ai-lock-chip is-locked' : 'ai-lock-chip is-unlocked'}
                            key={control.key}
                            onClick={() =>
                              setAiSettings((current) => ({
                                ...current,
                                [control.key]: !current[control.key],
                              }))
                            }
                            type="button"
                          >
                            <span>{control.label}</span>
                            <strong>{checked ? '锁定' : '开锁'}</strong>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {aiRecordsExpanded ? (
                    <section className="ai-sidebar__records-drawer" aria-label="AI 对话记录">
                      <div className="ai-sidebar__section-header">
                        <strong>记录列表</strong>
                        <span>{aiRecords.length} 条</span>
                      </div>
                      <div className="ai-sidebar__record-list">
                        {aiRecords.map((record) => {
                          const previewMessage = [...record.messages]
                            .reverse()
                            .find((message) => message.role === 'assistant' || message.role === 'user');
                          const preview = previewMessage?.content?.replace(/\s+/g, ' ').trim() || '空白对话';
                          return (
                            <button
                              className={record.id === activeAiRecord?.id ? 'ai-record is-active' : 'ai-record'}
                              key={record.id}
                              onClick={() => activateAiConversation(record.id)}
                              type="button"
                            >
                              <strong>{record.title}</strong>
                              <span>{preview}</span>
                              <small>{new Date(record.updatedAt).toLocaleString('zh-CN', { hour12: false })}</small>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

                  <div className={`ai-selection-scope${selectionContextSummary ? ' is-active' : ''}`}>
                    <strong>当前选中内容：</strong>
                    <span>{selectionContextSummary || '默认按整份文档执行'}</span>
                  </div>

                  <section className="ai-sidebar__messages-section">
                    <div className="ai-sidebar__section-header">
                      <strong>对话</strong>
                      <span>{aiSending ? '处理中' : '就绪'}</span>
                    </div>
                    <div className="ai-sidebar__messages" onWheelCapture={(event) => event.stopPropagation()}>
                      {aiMessages.map((message) => (
                        <article
                          className={
                            message.status === 'error'
                              ? `ai-sidebar__message ai-sidebar__message--${message.role} is-error`
                              : `ai-sidebar__message ai-sidebar__message--${message.role}`
                          }
                          key={message.id}
                        >
                          <div className="ai-sidebar__message-meta">
                            <strong>{message.role === 'assistant' ? 'AI' : '你'}</strong>
                            <span>{new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                          </div>
                          <p>{message.content}</p>
                        </article>
                      ))}
                      {aiSending ? (
                        <article className="ai-sidebar__message ai-sidebar__message--assistant">
                          <div className="ai-sidebar__message-meta">
                            <strong>AI</strong>
                            <span>处理中</span>
                          </div>
                          <p>正在读取完整 LMD、最近改动与当前选中内容...</p>
                        </article>
                      ) : null}
                    </div>
                  </section>

                  <div className="ai-sidebar__composer">
                    <textarea
                      className="ai-sidebar__input"
                      onChange={(event) => setAiInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (handleNativeSelectAllShortcut(event)) {
                          return;
                        }

                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void sendAiMessage();
                        }
                      }}
                      onWheelCapture={(event) => event.stopPropagation()}
                      placeholder={
                        selectionContextSummary
                          ? `当前选中内容：${selectionContextSummary}\n请输入你要对这部分执行的操作`
                          : '请输入你希望 AI 修改、整理或解释的内容'
                      }
                      rows={3}
                      value={aiInput}
                    />
                    <div className="ai-sidebar__composer-bar">
                      <span>Enter 发送，Shift + Enter 换行</span>
                      <button
                        className="solid-button"
                        disabled={aiSending || !aiInput.trim()}
                        onClick={() => {
                          void sendAiMessage();
                        }}
                        type="button"
                      >
                        发送
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="ai-sidebar__settings" onWheelCapture={(event) => event.stopPropagation()}>
                  <label className="field">
                    <span>API URL</span>
                    <input
                      onChange={(event) =>
                        setAiSettings((current) => ({ ...current, apiUrl: event.target.value }))
                      }
                      type="url"
                      value={aiSettings.apiUrl}
                    />
                  </label>
                  <label className="field">
                    <span>API Key</span>
                    <input
                      onChange={(event) =>
                        setAiSettings((current) => ({ ...current, apiKey: event.target.value }))
                      }
                      type="password"
                      value={aiSettings.apiKey}
                    />
                    <small>仅保存在当前浏览器，不写入工程 LMD。</small>
                  </label>
                  <label className="field">
                    <span>Model</span>
                    <input
                      onChange={(event) =>
                        setAiSettings((current) => ({ ...current, model: event.target.value }))
                      }
                      type="text"
                      value={aiSettings.model}
                    />
                  </label>
                  <label className="field">
                    <span>Context Window</span>
                    <input
                      onChange={(event) =>
                        setAiSettings((current) => ({
                          ...current,
                          contextWindow: Number.parseInt(event.target.value, 10) || current.contextWindow,
                        }))
                      }
                      type="number"
                      value={aiSettings.contextWindow}
                    />
                  </label>
                  <label className="field">
                    <span>System Prompt</span>
                    <textarea
                      onChange={(event) =>
                        setAiSettings((current) => ({ ...current, systemPrompt: event.target.value }))
                      }
                      rows={8}
                      value={aiSettings.systemPrompt}
                    />
                  </label>
                </div>
              )}
            </section>
          ) : null}
        </aside>

        {!isMobileViewport ? (
          <button
            aria-label={showInspector ? '收起右侧侧栏' : '展开右侧侧栏'}
            className="edge-toggle edge-toggle--right"
            onClick={() => setInspectorOpen((current) => !current)}
            type="button"
          >
            <WorkbenchIcon name={showInspector ? 'chevron-right' : 'chevron-left'} />
          </button>
        ) : null}

        {!isMobileViewport && showInspector ? (
          <div
            aria-label="拖拽调整右侧栏宽度"
            aria-orientation="vertical"
            className="panel-resizer panel-resizer--right"
            onPointerDown={(event) => startPanelResize('right', event)}
            role="separator"
          />
        ) : null}

        {!isVsCodeHost && isMobileViewport && mode === 'source' ? (
          <section className={`mobile-source-preview-sheet${mobileSourcePreviewOpen ? ' is-open' : ''}`}>
            <div className="mobile-sheet-handle" aria-hidden="true" />
            <div className="pane-header">
              <div>
                <p className="eyebrow">实时预览</p>
                <h2>标准 Mermaid 渲染</h2>
              </div>
              <button
                aria-label="收起预览"
                className="panel-icon-button"
                onClick={() => setMobileSourcePreviewOpen(false)}
                type="button"
              >
                <WorkbenchIcon name="chevron-right" />
              </button>
            </div>
            <MermaidPreview source={extractMermaidFromProjectMarkdown(sourceDraft)} />
          </section>
        ) : null}

        {isMobileViewport ? (
          <div className="mobile-bottom-bar" role="toolbar" aria-label="安卓竖屏工作台控制">
            <button
              aria-label={isVsCodeHost ? '打开图谱面板' : '打开资源面板'}
              className={showSidebar && leftPanel === (isVsCodeHost ? 'graph' : 'files') ? 'mobile-bottom-bar__button is-active' : 'mobile-bottom-bar__button'}
              onClick={() => toggleLeftPanel(isVsCodeHost ? 'graph' : 'files')}
              type="button"
            >
              <WorkbenchIcon name={isVsCodeHost ? 'graph' : 'files'} />
            </button>

            <div className="mobile-bottom-bar__modes" role="tablist" aria-label="模式切换">
              {visibleModeMeta.map((entry) => (
                <button
                  aria-label={entry.label}
                  className={entry.id === mode ? 'mobile-mode-pill is-active' : 'mobile-mode-pill'}
                  key={entry.id}
                  onClick={() => goToMode(entry.id)}
                  type="button"
                >
                  <WorkbenchIcon name={entry.icon} />
                </button>
              ))}
            </div>

            <button
              aria-label={isVsCodeHost ? '打开属性' : mode === 'source' ? '打开预览' : '打开属性'}
              className={showInspector || mobileSourcePreviewOpen ? 'mobile-bottom-bar__button is-active' : 'mobile-bottom-bar__button'}
              onClick={handleMobileInspectorToggle}
              type="button"
            >
              <WorkbenchIcon name={isVsCodeHost ? 'inspect' : mode === 'source' ? 'preview' : 'inspect'} />
            </button>
          </div>
        ) : null}
      </main>

      {svgPreviewOpen ? (
        <div
          aria-label="SVG 预览"
          className="svg-preview-backdrop"
          onClick={() => setSvgPreviewOpen(false)}
          role="presentation"
        >
          <section
            aria-modal="true"
            className="svg-preview"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="svg-preview__toolbar">
              <strong>线框 SVG 预览</strong>
              <div className="svg-preview__actions">
                <button
                  aria-label="缩小"
                  className="icon-button has-tooltip"
                  data-tooltip="缩小"
                  onClick={() => setSvgPreviewScale((current) => Math.max(0.5, Number((current - 0.1).toFixed(2))))}
                  type="button"
                >
                  <WorkbenchIcon name="minus" />
                </button>
                <span className="svg-preview__scale">{Math.round(svgPreviewScale * 100)}%</span>
                <button
                  aria-label="放大"
                  className="icon-button has-tooltip"
                  data-tooltip="放大"
                  onClick={() => setSvgPreviewScale((current) => Math.min(3, Number((current + 0.1).toFixed(2))))}
                  type="button"
                >
                  <WorkbenchIcon name="plus" />
                </button>
                <button
                  aria-label="重置缩放"
                  className="icon-button has-tooltip"
                  data-tooltip="重置"
                  onClick={() => setSvgPreviewScale(1)}
                  type="button"
                >
                  <WorkbenchIcon name="reset" />
                </button>
                <button
                  aria-label="保存 PNG"
                  className="svg-preview__save-button"
                  onClick={exportCanvasImage}
                  type="button"
                >
                  <WorkbenchIcon name="download" />
                  <span>下载 PNG</span>
                </button>
                <button
                  aria-label="关闭 SVG 预览"
                  className="icon-button has-tooltip"
                  data-tooltip="关闭"
                  onClick={() => setSvgPreviewOpen(false)}
                  type="button"
                >
                  <WorkbenchIcon name="chevron-right" />
                </button>
              </div>
            </div>

            <div className="svg-preview__body">
              {svgPreviewMarkup ? (
                <div
                  className="svg-preview__canvas"
                  dangerouslySetInnerHTML={{ __html: svgPreviewMarkup }}
                  style={{ transform: `scale(${svgPreviewScale})` }}
                />
              ) : (
                <div className="preview-empty">
                  <h3>SVG 预览暂不可用</h3>
                  <p>当前画布尚未生成有效的 SVG 快照。</p>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {helpDialogOpen ? (
        <div
          aria-label="操作说明"
          className="help-dialog-backdrop"
          onClick={() => setHelpDialogOpen(false)}
          role="presentation"
        >
          <section
            aria-modal="true"
            className="help-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="help-dialog__header">
              <div>
                <p className="eyebrow">Quick Guide</p>
                <h2>操作说明</h2>
              </div>
              <button
                aria-label="关闭操作说明"
                className="panel-icon-button"
                onClick={() => setHelpDialogOpen(false)}
                type="button"
              >
                <WorkbenchIcon name="chevron-right" />
              </button>
            </div>

            <div className="help-dialog__grid">
              <article className="help-card">
                <strong>🖱️ 画布</strong>
                <p>左键空白框选，左键拖节点移动，中键按住平移；`Shift + Click` 和 `Shift + Drag` 都能加选/减选；滚轮直接缩放，触控板双指捏合缩放、双指拖拽平移，`Space + Drag` 也能临时平移。</p>
              </article>
              <article className="help-card">
                <strong>🔗 连线</strong>
                <p>右键从节点或分组直接拖出连线；按住 `Ctrl/Cmd` 再拖会创建普通线。多选节点后右拖会汇聚指向同一目标。</p>
              </article>
              <article className="help-card">
                <strong>⌨️ 快捷键</strong>
                <p>`Delete` 删除，`Ctrl/Cmd + G` 分组，`Ctrl/Cmd + C / V` 复制粘贴，`Alt + Drag` 复制并拖拽，`Ctrl/Cmd + Z` 撤回，`Ctrl/Cmd + 双击节点` 选中整块连通节点。</p>
              </article>
              <article className="help-card">
                <strong>✍️ 编辑</strong>
                <p>双击节点/连线或选中后按 `Enter` 进入编辑；编辑时 `Enter` 保存，`Shift/Ctrl/Alt + Enter` 换行。</p>
              </article>
              <article className="help-card">
                <strong>🌿 快速新建</strong>
                <p>双击空白会创建一个未链接的新节点；如果双击发生在组内，就直接创建在该组里。选中节点按 `Tab` 会在旁边快速新建并自动连线；按 `Shift + Tab` 会创建同级镜像节点，并复制当前节点的入线关系；多选时会为每个节点分别执行。</p>
              </article>
              <article className="help-card">
                <strong>📦 分组层级</strong>
                <p>按住 `Ctrl/Cmd` 拖拽节点或组可以改层级：拖进组里会纳入该组，拖到外层会脱出；拖到另一个节点上会把那个节点直接转换成分组；如果把组里唯一的节点拖出来，空组会自动收缩回一个普通节点。</p>
              </article>
	              <article className="help-card">
	                <strong>🧩 插入连线</strong>
	                <p>按住 `Ctrl/Cmd` 拖拽单个节点或组到一条连线中间，会把它插入这条线：原来的 `A -&gt; C` 会变成 `A -&gt; B -&gt; C`，并保留原来前半段的线条文字。</p>
	              </article>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
