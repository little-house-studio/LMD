import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
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
import { sampleProjectMarkdown } from './lib/sample';
import { storageKeys } from './lib/storage';
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

interface NodeClipboardState {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const PINCH_RESPONSE = 1.3;
const WHEEL_PINCH_DIVISOR = 360;
const NAV_RAIL_WIDTH = 38;
const DEFAULT_SIDEBAR_WIDTH = 188;
const DEFAULT_INSPECTOR_WIDTH = 176;
const MIN_SIDEBAR_WIDTH = 164;
const MIN_INSPECTOR_WIDTH = 156;
const MAX_SIDEBAR_WIDTH = 280;
const MAX_INSPECTOR_WIDTH = 248;
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
  annotation: string;
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
  lockAnnotations: boolean;
  lockDiagram: boolean;
}

interface AiMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  status?: 'error';
}

interface AppHostConfig {
  platform?: 'web' | 'vscode';
  initialMarkdown?: string;
  fileName?: string;
}

interface VsCodeWebviewApi {
  postMessage(message: unknown): void;
  setState?(state: unknown): void;
  getState?(): unknown;
}

type AiPanelTab = 'chat' | 'settings';
type InspectorView = 'properties' | 'ai';

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
  | 'standardize';

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
  { id: 'sunrise', label: '晨曦', fill: '#ffd5a1', stroke: '#f97316', textColor: '#4a1d00' },
  { id: 'ocean', label: '海岸', fill: '#8ed8ff', stroke: '#0284c7', textColor: '#082f49' },
  { id: 'mint', label: '薄荷', fill: '#9ef0b8', stroke: '#16a34a', textColor: '#052e16' },
  { id: 'rose', label: '玫瑰', fill: '#ffb4c7', stroke: '#e11d48', textColor: '#4a001f' },
  { id: 'violet', label: '暮紫', fill: '#cdb7ff', stroke: '#7c3aed', textColor: '#2e1065' },
  { id: 'slate', label: '石墨', fill: '#cfd8e3', stroke: '#475569', textColor: '#111827' },
  { id: 'ember', label: '炽焰', fill: '#ffb089', stroke: '#ea580c', textColor: '#431407' },
  { id: 'teal', label: '湖青', fill: '#88ede0', stroke: '#0f766e', textColor: '#042f2e' },
  { id: 'gold', label: '琥珀', fill: '#ffd86e', stroke: '#ca8a04', textColor: '#422006' },
  { id: 'night', label: '夜幕', fill: '#0f172a', stroke: '#60a5fa', textColor: '#f8fafc' },
] as const;

const collaboratorPresets = [
  { id: 'lin', name: 'Lin', role: '画布', color: '#f97316' },
  { id: 'mina', name: 'Mina', role: '源码', color: '#22c55e' },
  { id: 'kai', name: 'Kai', role: '评审', color: '#38bdf8' },
] as const;

function getSubgraphStyle(subgraph: Pick<GraphSubgraph, 'fill' | 'stroke' | 'textColor'> | null | undefined) {
  return {
    fill: subgraph?.fill ?? defaultSubgraphStyle.fill,
    stroke: subgraph?.stroke ?? defaultSubgraphStyle.stroke,
    textColor: subgraph?.textColor ?? defaultSubgraphStyle.textColor,
  };
}

const workspaceTabs: Array<{ id: WorkspaceTabId; label: string; detail: string }> = [
  { id: 'diagram', label: 'diagram.md', detail: '主图' },
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

      if (!/\.md$/i.test(name)) {
        continue;
      }

      const id = `local-file-${fileIndex++}`;
      nextItems.push({
        id,
        label: name,
        meta: 'Markdown 工程',
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

const desktopCommandGroups = [
  { id: 'resource', label: '资源' },
  { id: 'edit', label: '编辑' },
  { id: 'view', label: '视图' },
] as const;

const defaultAiSettings: AiSettingsDraft = {
  apiKey: '',
  apiUrl: 'https://api.gpt.ge/v1/chat/completions',
  model: 'gpt-5.4-mini',
  contextWindow: 200000,
  systemPrompt:
    'You are the internal assistant for an LMD workspace. LMD is a single-file Markdown format for Mermaid-based projects. Use the current graph semantic snapshot and the latest full LMD document as the primary context. Be concise, practical, and grounded in the provided workspace state. Unless the request requires it, avoid changing already-written text. Prefer targeted edits over refactors. Prefer creating groups, and nested groups when they improve clarity. If node annotations exist, preserve them unless the request clearly requires updating them.',
  lockProjectMeta: true,
  lockAdditionalInfo: true,
  lockAnnotations: true,
  lockDiagram: false,
};

const defaultAiMessages: AiMessage[] = [
  {
    id: 'ai-welcome',
    role: 'assistant',
    content: 'AI 验证入口已打开。现在会附带完整 LMD 文档、Node Annotations、相对上一轮的改动、当前选中内容，并允许 AI 调用本地工具修改文档。',
  },
];

const aiLockControls = [
  { key: 'lockProjectMeta', label: '标题 / 简介', unlocked: '允许修改标题与简介' },
  { key: 'lockAdditionalInfo', label: '附加信息', unlocked: '允许修改附加信息' },
  { key: 'lockAnnotations', label: '节点注释', unlocked: '允许修改节点注释' },
  { key: 'lockDiagram', label: '流程图', unlocked: '允许修改流程图' },
] as const;

const aiToolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_graph_semantic_snapshot',
      description: 'Read the current semantic LMD project snapshot, including Project Name, Summary, Additional Information, nodes, edges, subgraphs, current selection, and node annotations, without layout or style details.',
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
      name: 'apply_graph_operation_batch',
      description: 'Apply structured semantic operations to the current LMD document. Supported operations include project meta updates, Additional Information updates, node label updates, node annotation updates, edge label updates, subgraph updates, and node/subgraph structural edits.',
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
      description: 'Read the latest full LMD document, including Project Name, Summary, Diagram, Additional Information, Node Annotations, and lths-compat.',
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
      description: 'Write the full LMD document and normalize it into the current structure: Project Name, Summary, Diagram, Content, Node Annotations, and lths-compat.',
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
  'Prefer apply_graph_operation_batch for structural diagram edits.',
  'Use updateNodeAnnotation operations when the request is specifically about node annotations.',
  'Treat the project as an LMD document: a single Markdown file with the sections Project Name, Summary, Diagram, Content, Node Annotations, and a final lths-compat block.',
  'Prefer the smallest valid layer: graph operations first, section-preserving Markdown edits second, full rewrites last.',
  'Do not invent new top-level sections unless the user explicitly asks for them.',
  'Prefer preserving the existing section structure instead of rewriting the whole file.',
  'Use set_project_markdown only for broader Markdown rewrites or when the batch tool cannot express the change cleanly.',
  'Treat the current selection as the primary scope unless the user clearly asks for a wider change.',
  'After editing, briefly summarize what changed.',
].join('\n');

const aiProjectFormatGuide = [
  'LMD document format:',
  'LMD stands for a single-file Markdown document used by this editor.',
  '1. `# Project Name`',
  '2. `## Summary`',
  '3. `## Diagram` with one standard ```mermaid``` block',
  '4. `## Content` for Additional Information Markdown',
  '5. `## Node Annotations` for node-level notes, keyed by `### `NodeId`` headings',
  '6. final ```lths-compat``` block for editor-only layout state',
  'The Mermaid block should stay standard Mermaid syntax.',
  'Node annotations live in Markdown, not inside Mermaid node syntax.',
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
  };
}

function getProjectFallbackName(fileName?: string) {
  if (!fileName) {
    return 'Untitled LMD';
  }

  return fileName.replace(/\.(lmd|md)$/i, '') || 'Untitled LMD';
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

function WorkbenchIcon({ name, className }: { name: IconName; className?: string }) {
  const props = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
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

function materializeDocument(candidate: GraphDocument): GraphDocument {
  const normalizedEdges = candidate.edges.map(normalizeEdgeStyle);
  const layout: LayoutSidecar = {
    version: candidate.layout.version,
    viewport: { ...candidate.layout.viewport },
    nodes: Object.fromEntries(
      candidate.nodes.map((node) => [
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
      candidate.subgraphs.map((subgraph) => [
        subgraph.id,
        { collapsed: subgraph.collapsed },
      ]),
    ),
  };

  const source = serializeMermaidDocument(
    candidate.direction,
    candidate.nodes,
    normalizedEdges,
    candidate.subgraphs,
    candidate.unsupportedLines,
  );
  const projectName = candidate.projectName ?? 'Untitled Project';
  const projectSummary = candidate.projectSummary ?? '';
  const contentMarkdown = normalizeContentMarkdown(candidate.contentMarkdown ?? extractContentMarkdown(candidate.suffixMarkdown));
  const nodeAnnotations = sanitizeNodeAnnotations(candidate.nodeAnnotations ?? getNodeAnnotationMap(candidate), candidate.nodes);
  const extras = sanitizeCompatExtras(candidate.compat?.extras, candidate.nodes);
  const compat = {
    version: candidate.compat?.version ?? 1,
    layout,
    editor: {
      localFileActions: {
        enabled: candidate.compat?.editor?.localFileActions?.enabled ?? true,
      },
    },
    extras,
  };
  const markdown = serializeProjectMarkdown({
    projectName,
    projectSummary,
    prefixMarkdown: candidate.prefixMarkdown,
    contentMarkdown,
    nodeAnnotations,
    mermaidSource: source,
    compat,
    nodes: candidate.nodes,
    subgraphs: candidate.subgraphs,
  });

  return {
    ...candidate,
    edges: normalizedEdges,
    layout,
    source,
    markdown,
    projectName,
    projectSummary,
    prefixMarkdown: candidate.prefixMarkdown ?? '',
    suffixMarkdown: buildProjectSuffixMarkdown(contentMarkdown, nodeAnnotations),
    contentMarkdown,
    nodeAnnotations,
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

function nextNodeId(nodes: GraphNode[]) {
  let index = nodes.length + 1;
  while (nodes.some((node) => node.id === `N${index}`)) {
    index += 1;
  }

  return `N${index}`;
}

function buildNode(
  id: string,
  label: string,
  position: Point,
  subgraphId: string | null,
): GraphNode {
  const size = measureNodeContentSize(label);
  return {
    id,
    label,
    shape: 'rect',
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    fill: '#fff8ef',
    stroke: '#24404f',
    textColor: '#12212c',
    subgraphId,
  };
}

function resizeNodeToContent(node: GraphNode, content: string) {
  const size = measureNodeContentSize(content);

  return {
    ...node,
    label: content,
    width: size.width,
    height: size.height,
  };
}

function getShortcutNodePlacement(
  node: GraphNode,
  direction: Direction,
  relation: 'linked' | 'sibling',
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
      width: clamp(188 + summary.length * 4.1, 220, 340),
      height: 96,
    };
  }

  const normalizedMarkdown = normalizeContentMarkdown(markdown);
  const content = normalizedMarkdown.trim();
  if (!content) {
    return {
      width: 360,
      height: 220,
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
    width: clamp(320 + longestLine * 5.8, 400, 760),
    height: Math.max(
      220,
      104 + wrappedLines * 26 + Math.max(0, blockCount - 1) * 18 + (hasStructuredBlocks ? 20 : 0),
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

function getContentCardLayout(document: GraphDocument, size: { width: number; height: number }): ContentCardLayout {
  const raw = document.compat?.extras && typeof document.compat.extras === 'object'
    ? (document.compat.extras as Record<string, unknown>).contentBox
    : null;
  const collapsed = Array.isArray(raw) && raw.length >= 3 && (raw[2] === 1 || raw[2] === true);

  if (document.nodes.length === 0) {
    return { x: 56, y: 56, collapsed };
  }

  const minX = Math.min(...document.nodes.map((node) => node.x));
  const minY = Math.min(...document.nodes.map((node) => node.y));

  return {
    x: Math.min(56, Math.max(32, minX - size.width - 68)),
    y: Math.min(56, Math.max(32, minY - 24)),
    collapsed,
  };
}

function getNodeAnnotationMap(document: GraphDocument) {
  const raw = document.nodeAnnotations ?? document.compat?.extras?.nodeNotes;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {} as Record<string, string>;
  }

  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] =>
      typeof entry[0] === 'string' &&
      typeof entry[1] === 'string' &&
      entry[1].trim().length > 0,
    ),
  );
}

function sanitizeNodeAnnotations(
  nodeAnnotations: Record<string, string> | undefined,
  nodes: GraphNode[],
) {
  if (!nodeAnnotations) {
    return {} as Record<string, string>;
  }

  const existingNodeIds = new Set(nodes.map((node) => node.id));
  return Object.fromEntries(
    Object.entries(nodeAnnotations).filter((entry): entry is [string, string] =>
      existingNodeIds.has(entry[0]) &&
      typeof entry[1] === 'string' &&
      entry[1].trim().length > 0,
    ),
  );
}

function sanitizeCompatExtras(
  extras: ProjectCompatExtras | undefined,
  nodes: GraphNode[],
): ProjectCompatExtras | undefined {
  if (!extras) {
    return undefined;
  }

  const nextExtras: ProjectCompatExtras = {};

  if (Array.isArray(extras.contentBox)) {
    nextExtras.contentBox = extras.contentBox;
  }

  if (extras.nodeNotes && typeof extras.nodeNotes === 'object' && !Array.isArray(extras.nodeNotes)) {
    const filteredNodeNotes = sanitizeNodeAnnotations(extras.nodeNotes, nodes);
    if (Object.keys(filteredNodeNotes).length > 0) {
      nextExtras.nodeNotes = filteredNodeNotes;
    }
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
        contentBox: layout.collapsed ? [56, 56, 1] : [56, 56],
      },
    },
  };
}

function buildGraphSemanticSnapshotFromDocument(
  document: GraphDocument,
  selection: SelectionState,
  revision: number,
): GraphSemanticSnapshot {
  const nodeNotes = getNodeAnnotationMap(document);
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
        subgraphId: node.subgraphId,
        annotation: nodeNotes[node.id],
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
    settings.lockAnnotations
      ? 'Do not modify node annotations except to remove annotations of nodes that are deleted.'
      : 'Node annotations may be modified if needed.',
    settings.lockDiagram
      ? 'Do not modify the flowchart structure.'
      : 'The flowchart structure may be modified if needed.',
  ];

  return lines.join('\n');
}

function isDiagramOperation(operation: GraphOperation) {
  return (
    operation.type !== 'updateProjectMeta' &&
    operation.type !== 'updateContentMarkdown' &&
    operation.type !== 'updateNodeAnnotation'
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

    if (settings.lockAnnotations && operation.type === 'updateNodeAnnotation') {
      warnings.push('Blocked node annotation update because the Node Annotation lock is enabled.');
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

  if (settings.lockAnnotations) {
    nextCandidate.nodeAnnotations = sanitizeNodeAnnotations(current.nodeAnnotations, nextCandidate.nodes);
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
    const nodeAnnotations = getNodeAnnotationMap(document);
    return JSON.stringify({
      kind: 'node',
      items: document.nodes
        .filter((node) => selection.ids.includes(node.id))
        .map((node) => ({
          id: node.id,
          label: node.label,
          subgraphId: node.subgraphId,
          annotation: nodeAnnotations[node.id] ?? '',
        })),
    }, null, 2);
  }

  if (selection.kind === 'edge') {
    return JSON.stringify({
      kind: 'edge',
      items: document.edges
        .filter((edge) => selection.ids.includes(edge.id))
        .map((edge) => ({
          id: edge.id,
          from: edge.from,
          to: edge.to,
          label: edge.label,
          type: edge.type,
        })),
    }, null, 2);
  }

  if (selection.kind === 'subgraph') {
    return JSON.stringify({
      kind: 'subgraph',
      items: document.subgraphs
        .filter((subgraph) => selection.ids.includes(subgraph.id))
        .map((subgraph) => ({
          id: subgraph.id,
          title: subgraph.title,
          parentId: subgraph.parentId,
          collapsed: subgraph.collapsed,
          nodeIds: document.nodes
            .filter((node) => node.subgraphId === subgraph.id)
            .map((node) => node.id),
        })),
    }, null, 2);
  }

  return JSON.stringify({
    kind: 'content',
    title: 'Additional Information',
    markdown: normalizeContentMarkdown(document.contentMarkdown ?? extractContentMarkdown(document.suffixMarkdown)),
    id: CONTENT_CARD_ID,
  }, null, 2);
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
  const groups = new Map<string, Array<{ edgeId: string; end: 'from' | 'to'; angle: number }>>();
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
    const fromAngle = Math.atan2(toCenter.y - fromCenter.y, toCenter.x - fromCenter.x);
    const toAngle = Math.atan2(fromCenter.y - toCenter.y, fromCenter.x - toCenter.x);
    const pairKey = [edge.from, edge.to].sort().join('::');

    groups.set(fromKey, [...(groups.get(fromKey) ?? []), { edgeId: edge.id, end: 'from', angle: fromAngle }]);
    groups.set(toKey, [...(groups.get(toKey) ?? []), { edgeId: edge.id, end: 'to', angle: toAngle }]);
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
    const sorted = [...entries].sort((left, right) => left.angle - right.angle);
    sorted.forEach((entry, index) => {
      if (reciprocalEdgeIds.has(entry.edgeId)) {
        return;
      }
      const current = offsets.get(entry.edgeId);
      if (!current) {
        return;
      }

      const nextOffset = (index - (sorted.length - 1) / 2) * 16;
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

function buildEdgeGeometry(
  fromNode: Pick<GraphNode, 'x' | 'y' | 'width' | 'height'>,
  toNode: Pick<GraphNode, 'x' | 'y' | 'width' | 'height'>,
  laneOffset = 0,
  endpointOffsets: { from: number; to: number } = { from: 0, to: 0 },
) {
  const endInset = 12;
  const fromAnchor = getNodeAnchor(fromNode, getNodeCenter(toNode));
  const toAnchor = getNodeAnchor(toNode, getNodeCenter(fromNode));
  const fromCenter = getNodeCenter(fromNode);
  const toCenter = getNodeCenter(toNode);
  const deltaX = toCenter.x - fromCenter.x;
  const deltaY = toCenter.y - fromCenter.y;
  const distance = Math.max(1, Math.hypot(deltaX, deltaY));
  const centerNormal = {
    x: -deltaY / distance,
    y: deltaX / distance,
  };
  const fromNormal = normalFromAnchor(fromAnchor);
  const toNormal = normalFromAnchor(toAnchor);
  const handleLength = Math.max(32, Math.min(78, distance * 0.28));
  const start = {
    x: fromAnchor.x + fromAnchor.dirX * endInset + fromNormal.x * endpointOffsets.from,
    y: fromAnchor.y + fromAnchor.dirY * endInset + fromNormal.y * endpointOffsets.from,
  };
  const end = {
    x: toAnchor.x + toAnchor.dirX * endInset + toNormal.x * endpointOffsets.to,
    y: toAnchor.y + toAnchor.dirY * endInset + toNormal.y * endpointOffsets.to,
  };
  const laneInfluence = laneOffset * (Math.abs(laneOffset) >= 30 ? 0.66 : 0.52);
  const controlA = {
    x:
      start.x +
      fromAnchor.dirX * handleLength +
      fromNormal.x * endpointOffsets.from * 0.48 +
      centerNormal.x * laneInfluence,
    y:
      start.y +
      fromAnchor.dirY * handleLength +
      fromNormal.y * endpointOffsets.from * 0.48 +
      centerNormal.y * laneInfluence,
  };
  const controlB = {
    x:
      end.x +
      toAnchor.dirX * handleLength +
      toNormal.x * endpointOffsets.to * 0.48 +
      centerNormal.x * laneInfluence,
    y:
      end.y +
      toAnchor.dirY * handleLength +
      toNormal.y * endpointOffsets.to * 0.48 +
      centerNormal.y * laneInfluence,
  };
  const mid = cubicPoint(start, controlA, controlB, end, 0.5);
  const label = cubicPoint(start, controlA, controlB, end, 0.68);

  return {
    path: `M ${start.x} ${start.y} C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${end.x} ${end.y}`,
    mid,
    label,
    start,
    controlA,
    controlB,
    end,
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
      const assignReciprocalOffsets = (directionEdges: GraphEdge[]) => {
        const center = (directionEdges.length - 1) / 2;
        directionEdges.forEach((edge, index) => {
          laneMap.set(edge.id, 40 + (index - center) * 18);
        });
      };

      assignReciprocalOffsets(forward);
      assignReciprocalOffsets(reverse);
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
  const baseSpread = 24;
  const intraSpacing = 18;
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
  const cubicPoints = sampleCubic(geometry.start, geometry.controlA, geometry.controlB, geometry.end);
  const samples = [geometry.start, ...cubicPoints, geometry.end];
  return samples.some((point) => pointInRect(point, rect, 10));
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
  const deltaX = currentPoint.x - startAnchor.x;
  const deltaY = currentPoint.y - startAnchor.y;
  const distance = Math.max(1, Math.hypot(deltaX, deltaY));
  const handleLength = Math.max(26, Math.min(72, distance * 0.3));
  const start = {
    x: startAnchor.x + startAnchor.dirX * 10,
    y: startAnchor.y + startAnchor.dirY * 10,
  };
  const controlA = {
    x: start.x + startAnchor.dirX * handleLength,
    y: start.y + startAnchor.dirY * handleLength,
  };
  const controlB = {
    x: currentPoint.x - deltaX * 0.22,
    y: currentPoint.y - deltaY * 0.22,
  };

  return `M ${start.x} ${start.y} C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${currentPoint.x} ${currentPoint.y}`;
}

function duplicateNodesWithEdges(document: GraphDocument, sourceIds: string[], offset: Point) {
  const ids = new Set(sourceIds);
  const nodeIdMap = new Map<string, string>();
  const duplicatedNodes = document.nodes
    .filter((node) => ids.has(node.id))
    .map((node) => {
      const nextId = nextNodeId([
        ...document.nodes,
        ...Array.from(nodeIdMap.values()).map((id) =>
          buildNode(id, id, { x: 0, y: 0 }, null),
        ),
      ]);
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
  const allRects = [
    ...shapes.map((shape) => shape.rect),
    ...(viewportRect ? [viewportRect] : []),
  ];

  if (allRects.length === 0) {
    return null;
  }

  const minX = Math.min(...allRects.map((rect) => rect.x));
  const minY = Math.min(...allRects.map((rect) => rect.y));
  const maxX = Math.max(...allRects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...allRects.map((rect) => rect.y + rect.height));
  const padding = 64;
  const worldBounds = {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(160, maxX - minX + padding * 2),
    height: Math.max(120, maxY - minY + padding * 2),
  };
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
  anchor.click();
  URL.revokeObjectURL(url);
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

function collectDocumentCssText() {
  const chunks: string[] = [];

  for (const stylesheet of Array.from(document.styleSheets)) {
    try {
      const rules = stylesheet.cssRules;
      for (const rule of Array.from(rules)) {
        chunks.push(rule.cssText);
      }
    } catch {
      continue;
    }
  }

  return chunks.join('\n');
}

function loadImageFromUrl(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image load failed'));
    image.src = url;
  });
}

function buildCanvasExportBounds(input: {
  nodes: GraphNode[];
  subgraphs: SubgraphFrame[];
  contentRect: Rect;
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
  includeRect(input.contentRect);

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

function resolveVisibleEndpointId(
  endpointId: string,
  nodes: GraphNode[],
  subgraphs: GraphSubgraph[],
) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const subgraphLookup = new Map(subgraphs.map((subgraph) => [subgraph.id, subgraph]));
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
  frames: SubgraphFrame[],
  point: Point,
  excludedIds: string[] = [],
) {
  const excluded = new Set(excludedIds);

  return [...frames]
    .filter((frame) => !excluded.has(frame.id))
    .filter((frame) =>
      pointInRect(point, {
        x: frame.x + 10,
        y: frame.y + frame.headerHeight - 2,
        width: frame.width - 20,
        height: Math.max(frame.height - frame.headerHeight + 4, 24),
      }),
    )
    .sort((left, right) => {
      if (left.depth !== right.depth) {
        return right.depth - left.depth;
      }

      return left.width * left.height - right.width * right.height;
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
  const samples = sampleCubic(
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
  const size = measureNodeContentSize(subgraph.title);
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
  const nodeRects = nodes
    .filter((node) => !ignoredNodeIds.has(node.id))
    .map((node) => expandRect({ x: node.x, y: node.y, width: node.width, height: node.height }, 20));
  const subgraphRects = buildSubgraphFrames(document, nodes)
    .filter((frame) => !excludedSubgraphIds.has(frame.id))
    .map((frame) => expandRect({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }, 10));
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

  const contentMarkdown = document.contentMarkdown ?? extractContentMarkdown(document.suffixMarkdown);
  const contentLayout = getContentCardLayout(document, { width: 320, height: 180 });
  const contentSize = measureContentCard(contentMarkdown, contentLayout.collapsed);
  const contentRect = {
    x: contentLayout.x,
    y: contentLayout.y,
    width: contentSize.width,
    height: contentSize.height,
  };
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
  const obstacles: Rect[] = [expandRect(contentRect, 16)];
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
  const [leftPanel, setLeftPanel] = useState<LeftPanel>(isVsCodeHost ? 'graph' : 'files');
  const [activeFileTab, setActiveFileTab] = useState<WorkspaceTabId>('diagram');
  const [activeWorkspaceSource, setActiveWorkspaceSource] = useState<'cloud' | 'local'>(
    isVsCodeHost ? 'local' : 'cloud',
  );
  const [localExplorerItems, setLocalExplorerItems] = useState<ExplorerItem[]>(defaultLocalProjectItems);
  const [activeLocalFileId, setActiveLocalFileId] = useState<string | null>(null);
  const [activeLocalDirectoryId, setActiveLocalDirectoryId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(isVsCodeHost);
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
  const [aiSettings, setAiSettings] = useState<AiSettingsDraft>(() => ({
    ...defaultAiSettings,
    ...readStoredJson(storageKeys.aiSettings, defaultAiSettings),
  }));
  const [aiMessages, setAiMessages] = useState<AiMessage[]>(() =>
    readStoredArray(storageKeys.aiChat, defaultAiMessages),
  );
  const [aiInput, setAiInput] = useState('');
  const [aiSending, setAiSending] = useState(false);
  const [aiLastMarkdown, setAiLastMarkdown] = useState(() =>
    localStorage.getItem(storageKeys.aiLastMarkdown) ?? '',
  );
  const [canvasHovered, setCanvasHovered] = useState(false);
  const [selection, setSelection] = useState<SelectionState>({ kind: 'none', ids: [] });
  const [history, setHistory] = useState<HistoryEntry[]>(initialWorkspace.history);
  const [documentRevision, setDocumentRevision] = useState(1);
  const [, setUndoStack] = useState<GraphDocument[]>([]);
  const [, setRedoStack] = useState<GraphDocument[]>([]);
  const [sourceDraft, setSourceDraft] = useState(
    initialWorkspace.document.markdown ?? initialWorkspace.document.source,
  );
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [activeLocalExplorerItemId, setActiveLocalExplorerItemId] = useState<string | null>(null);
  const [hasLocalProjectAccess, setHasLocalProjectAccess] = useState(false);
  const [nodeInspectorDraft, setNodeInspectorDraft] = useState<NodeInspectorDraft>({
    label: '',
    annotation: '',
    shape: 'rect',
    fill: '#fff8ef',
    stroke: '#24404f',
    textColor: '#12212c',
  });
  const [edgeInspectorDraft, setEdgeInspectorDraft] = useState<EdgeInspectorDraft>({
    label: '',
    type: 'solid',
    strokeColor: defaultEdgeStyle.strokeColor,
    strokeWidthInput: String(defaultEdgeStyle.strokeWidth),
  });
  const [subgraphInspectorDraft, setSubgraphInspectorDraft] = useState<SubgraphInspectorDraft>({
    title: '',
    collapsed: false,
    fill: defaultSubgraphStyle.fill,
    stroke: defaultSubgraphStyle.stroke,
    textColor: defaultSubgraphStyle.textColor,
  });
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
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [editingEdgeLabel, setEditingEdgeLabel] = useState('');
  const [editingSubgraphId, setEditingSubgraphId] = useState<string | null>(null);
  const [editingSubgraphTitle, setEditingSubgraphTitle] = useState('');
  const [editingContent, setEditingContent] = useState(false);
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
  const [spacePressed, setSpacePressed] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasBoardRef = useRef<HTMLDivElement>(null);
  const localHandleEntriesRef = useRef<Record<string, LocalHandleEntry>>({});
  const localRootDirectoryRef = useRef<LocalProjectDirectoryHandle | null>(null);
  const nodeClipboardRef = useRef<NodeClipboardState | null>(null);
  const documentRef = useRef(documentState);
  const documentRevisionRef = useRef(documentRevision);
  const aiLastMarkdownRef = useRef(aiLastMarkdown);
  const previousModeRef = useRef(mode);
  const gestureStateRef = useRef<GestureState | null>(null);
  const backgroundHoldRef = useRef<number | null>(null);
  const pendingBackgroundRef = useRef<{
    clientX: number;
    clientY: number;
    point: Point;
  } | null>(null);
  const deferredSource = useDeferredValue(sourceDraft);
  const sourceParseError = useMemo(() => {
    try {
      parseProjectMarkdown(
        deferredSource,
        documentState.projectName ?? 'Untitled Project',
        documentState.layout,
      );
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : '无法解析工程 Markdown。';
    }
  }, [deferredSource, documentState.layout, documentState.projectName]);

  const subgraphLookup = getVisibleSubgraphIds(documentState.subgraphs);
  const fullSubgraphLookup = getVisibleSubgraphIds(documentState.subgraphs);
  const previewNodes = useMemo(
    () => applyDragPreview(documentState.nodes, dragState),
    [documentState.nodes, dragState],
  );
  const framePreviewNodes = useMemo(
    () => (dragReparentMode ? documentState.nodes : previewNodes),
    [documentState.nodes, dragReparentMode, previewNodes],
  );
  const subgraphFrames = useMemo(
    () => buildSubgraphFrames(documentState, framePreviewNodes),
    [documentState, framePreviewNodes],
  );
  const contentMarkdown = useMemo(
    () => documentState.contentMarkdown ?? extractContentMarkdown(documentState.suffixMarkdown),
    [documentState.contentMarkdown, documentState.suffixMarkdown],
  );
  const contentCardLayout = useMemo(
    () => getContentCardLayout(documentState, { width: 320, height: 180 }),
    [documentState],
  );
  const contentCardCollapsed = contentCardLayout.collapsed && !editingContent;
  const contentCardSize = useMemo(
    () => measureContentCard(editingContent ? contentInspectorDraft.markdown : contentMarkdown, contentCardCollapsed),
    [contentCardCollapsed, contentInspectorDraft.markdown, contentMarkdown, editingContent],
  );
  const contentCardRenderLayout = contentCardLayout;
  const contentCardRect = useMemo(
    () => ({
      x: contentCardRenderLayout.x,
      y: contentCardRenderLayout.y,
      width: contentCardSize.width,
      height: contentCardSize.height,
    }),
    [contentCardRenderLayout, contentCardSize],
  );
  const contentCardPreviewHtml = useMemo(
    () => renderMarkdownPreviewHtml(contentMarkdown),
    [contentMarkdown],
  );
  const contentCardSummary = useMemo(
    () => buildContentCardSummary(contentMarkdown),
    [contentMarkdown],
  );
  const miniMapModel = useMemo(() => {
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
            selected: selection.kind === 'subgraph' && selectionContains(selection, frame.id),
          };
        }),
        {
          id: CONTENT_CARD_ID,
          kind: 'content' as const,
          rect: contentCardRect,
          fill: 'rgba(248, 250, 252, 0.16)',
          stroke: '#f8fafc',
          selected: selection.kind === 'content',
        },
      ],
      viewportRect,
    );
  }, [
    contentCardRect,
    documentState.subgraphs,
    documentState.layout.viewport,
    previewNodes,
    selection,
    subgraphFrames,
  ]);
  const visibleNodes = previewNodes.filter(
    (node) => !isInsideCollapsedSubgraph(node, subgraphLookup),
  );
  const edgeEndpoints = useMemo<EdgeEndpointBox[]>(
    () => [
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
    ],
    [documentState.subgraphs, subgraphFrames, visibleNodes],
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
    () => documentState.edges.flatMap((edge) => {
      const displayFrom = resolveVisibleEndpointId(edge.from, previewNodes, documentState.subgraphs);
      const displayTo = resolveVisibleEndpointId(edge.to, previewNodes, documentState.subgraphs);
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
    }),
    [documentState.edges, documentState.subgraphs, previewNodes, visibleEdgeEndpointIds],
  );
  const edgeLaneMap = useMemo(() => buildEdgeLaneMap(visibleEdges), [visibleEdges]);
  const edgeEndpointOffsetMap = useMemo(
    () => buildEdgeEndpointOffsetMap(visibleEdges, edgeEndpoints),
    [edgeEndpoints, visibleEdges],
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
    () => buildCanvasExportBounds({
      nodes: visibleNodes,
      subgraphs: subgraphFrames,
      contentRect: contentCardRect,
      edges: visibleEdges,
      endpointMap: edgeEndpointMap,
      laneMap: edgeLaneMap,
      endpointOffsets: edgeEndpointOffsetMap,
    }),
    [
      contentCardRect,
      edgeEndpointMap,
      edgeEndpointOffsetMap,
      edgeLaneMap,
      subgraphFrames,
      visibleEdges,
      visibleNodes,
    ],
  );
  const allSubgraphFrames = useMemo(
    () => buildSubgraphFrames(documentState, framePreviewNodes),
    [documentState, framePreviewNodes],
  );
  const allSubgraphFrameMap = useMemo(
    () => new Map(allSubgraphFrames.map((frame) => [frame.id, frame])),
    [allSubgraphFrames],
  );
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
        label: 'diagram.md',
        meta: `${documentState.nodes.length} 节点 / ${documentState.edges.length} 连线`,
        depth: 2,
        kind: 'file',
        path: 'cloud://projects/product-graph-platform/docs/diagram.md',
        tabId: 'diagram',
        mode: 'canvas',
      },
    ],
    [documentState.edges.length, documentState.nodes.length],
  );
  const activeCloudPath = useMemo(() => {
      const activeItem = cloudExplorerItems.find((item) => item.tabId === activeFileTab);
      return activeItem?.path ?? 'cloud://projects/product-graph-platform/docs/diagram.md';
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
  ) => {
    const nextRevision = documentRevisionRef.current + 1;
    documentRevisionRef.current = nextRevision;
    documentRef.current = nextDocument;
    setDocumentRevision(nextRevision);
    setUndoStack((current) => [...current.slice(-39), structuredClone(previousDocument)]);
    setRedoStack([]);
    setSaveStatus('saving');
    setDocumentState(nextDocument);
    setSourceDraft(nextDocument.markdown ?? nextDocument.source);
    setHistory((current) => [createHistoryEntry(title, detail), ...current].slice(0, 40));
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
        ? activeLocalItem.label.replace(/\.md$/i, '')
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

  const selectSingle = useCallback((
    kind: Exclude<SelectionState['kind'], 'none'>,
    id: string,
    toggle = false,
  ) => {
    setSelection((current) => (toggle ? toggleSelectionIds(current, kind, [id]) : { kind, ids: [id] }));
  }, []);

  const clearSelection = useCallback(() => {
    setSelection({ kind: 'none', ids: [] });
  }, []);

  const startInlineEdit = useCallback((node: GraphNode) => {
    setEditingNodeId(node.id);
    setEditingLabel(node.label);
    setSelection({ kind: 'node', ids: [node.id] });
  }, []);

  const commitInlineEdit = useCallback((nodeId: string) => {
    commitDocument(
      (current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === nodeId
            ? resizeNodeToContent(node, editingLabel.trim() || '未命名内容')
            : node,
        ),
      }),
      '已更新节点',
      `已更新 ${nodeId} 的节点内容。`,
    );

    setEditingNodeId(null);
    setEditingLabel('');
  }, [commitDocument, editingLabel]);

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

  const updateViewport = useCallback(
    (updater: (viewport: ViewportState) => ViewportState) => {
      setDocumentState((current) => ({
        ...current,
        layout: {
          ...current.layout,
          viewport: updater(current.layout.viewport),
        },
      }));
    },
    [],
  );

  const pointFromClient = useCallback(
    (
      clientX: number,
      clientY: number,
      viewport = documentState.layout.viewport,
    ) => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds) {
        return null;
      }

      return {
        x: (clientX - bounds.left - viewport.x) / viewport.zoom,
        y: (clientY - bounds.top - viewport.y) / viewport.zoom,
      };
    },
    [documentState.layout.viewport],
  );

  const zoomViewportAtPoint = useCallback(
    (clientX: number, clientY: number, zoomFactor: number) => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      updateViewport((viewport) => {
        const pointerX = clientX - bounds.left;
        const pointerY = clientY - bounds.top;
        const nextZoom = clamp(viewport.zoom * zoomFactor, 0.35, 2.8);
        const worldX = (pointerX - viewport.x) / viewport.zoom;
        const worldY = (pointerY - viewport.y) / viewport.zoom;

        return {
          zoom: nextZoom,
          x: pointerX - worldX * nextZoom,
          y: pointerY - worldY * nextZoom,
        };
      });
    },
    [updateViewport],
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
      focusViewportOnRect(contentCardRect, anchorY);
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
    contentCardRect,
    documentState,
    focusViewportOnRect,
    isMobileViewport,
    mode,
    selection,
  ]);

  const moveViewportFromMiniMapRect = useCallback((miniX: number, miniY: number) => {
    if (!miniMapModel?.viewport) {
      return;
    }

    const clampedMiniX = clamp(miniX, 0, miniMapModel.width - miniMapModel.viewport.width);
    const clampedMiniY = clamp(miniY, 0, miniMapModel.height - miniMapModel.viewport.height);
    const worldLeft = (clampedMiniX - miniMapModel.offsetX) / miniMapModel.scale + miniMapModel.worldBounds.x;
    const worldTop = (clampedMiniY - miniMapModel.offsetY) / miniMapModel.scale + miniMapModel.worldBounds.y;

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

  const applyNodeInspectorDraft = useCallback((draft: NodeInspectorDraft = nodeInspectorDraft) => {
    if (selection.kind !== 'node' || selection.ids.length === 0) {
      return;
    }

    const ids = new Set(selection.ids);
    commitDocument(
      (current) => {
        const nextNodeAnnotations = {
          ...(current.nodeAnnotations ?? {}),
        };

        selection.ids.forEach((nodeId) => {
          const normalizedAnnotation = draft.annotation.trim();
          if (normalizedAnnotation) {
            nextNodeAnnotations[nodeId] = draft.annotation;
            return;
          }
          delete nextNodeAnnotations[nodeId];
        });

        return {
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
                draft.label,
              )
              : node,
          ),
          nodeAnnotations: nextNodeAnnotations,
        };
      },
      '已更新节点',
      `已更新 ${selection.ids.length} 个节点属性。`,
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

  const applyEdgeInspectorDraft = useCallback((draft: EdgeInspectorDraft = edgeInspectorDraft) => {
    if (selection.kind !== 'edge' || selection.ids.length === 0) {
      return;
    }

    const strokeWidth = Number.parseFloat(draft.strokeWidthInput);
    const ids = new Set(selection.ids);
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
      `已更新 ${selection.ids.length} 条连线属性。`,
    );
  }, [commitDocument, edgeInspectorDraft, selection.ids, selection.kind]);

  const applySubgraphInspectorDraft = useCallback((draft: SubgraphInspectorDraft = subgraphInspectorDraft) => {
    if (selection.kind !== 'subgraph' || selection.ids.length === 0) {
      return;
    }

    const ids = new Set(selection.ids);
    commitDocument(
      (current) => ({
        ...current,
        subgraphs: current.subgraphs.map((subgraph) =>
          ids.has(subgraph.id)
            ? {
                ...subgraph,
                title: draft.title,
                collapsed: draft.collapsed,
                fill: draft.fill,
                stroke: draft.stroke,
                textColor: draft.textColor,
              }
            : subgraph,
        ),
      }),
      '已更新分组',
      `已更新 ${selection.ids.length} 个分组设置。`,
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
    const normalizedTitle = nextTitle.trim() || '未命名分组';

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
    setEditingSubgraphTitle('');
  }, [commitDocument, editingSubgraphTitle]);

  const startSubgraphTitleEdit = useCallback((subgraph: GraphSubgraph) => {
    setEditingSubgraphId(subgraph.id);
    setEditingSubgraphTitle(subgraph.title);
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
    findSubgraphDropTarget(allSubgraphFrames, point)
  ), [allSubgraphFrames]);

  const compactLayout = useCallback(() => {
    commitDocument(
      (current) => ({
        ...current,
        nodes: tidyDocumentNodes(current),
      }),
      '已整理布局',
      '已根据当前排布做理线、压缩间距和局部避让。',
    );
  }, [commitDocument]);

  const autoLayout = useCallback(() => {
    commitDocument(
      (current) => ({
        ...current,
        nodes: layoutDocumentNodes(current),
      }),
      '已重排布局',
      '已按拓扑结构重新布局，优先减少打结、遮挡和无效留白。',
    );
  }, [commitDocument]);

  const createNodeAtForSources = useCallback((
    point: Point,
    sourceIds: string[],
    edgeType: GraphEdge['type'] = 'solid',
    forcedSubgraphId?: string | null,
  ) => {
    const id = nextNodeId(documentState.nodes);
    const selectionSubgraph =
      selection.kind === 'subgraph' && selection.ids.length === 1 ? selection.ids[0] : null;
    const targetSubgraphId = forcedSubgraphId === undefined ? selectionSubgraph : forcedSubgraphId;
    const draftNode = buildNode(id, '新建内容', point, targetSubgraphId);
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
        contentCardRect,
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
  }, [
    allSubgraphFrameMap,
    commitDocument,
    contentCardRect,
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
    relation: 'linked' | 'sibling',
  ) => {
    if (sourceNodes.length === 0) {
      return;
    }

    const workingNodes = [...documentState.nodes];
    const newNodes: GraphNode[] = [];
    const newEdges: GraphEdge[] = [];

    sourceNodes.forEach((sourceNode) => {
      const id = nextNodeId(workingNodes);
      const desiredPoint = getShortcutNodePlacement(sourceNode, documentState.direction, relation);
      const draftNode = buildNode(id, '新建内容', desiredPoint, sourceNode.subgraphId);
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
          contentCardRect,
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
      }
    });

    commitDocument(
      (current) => ({
        ...current,
        nodes: [...current.nodes, ...newNodes],
        edges: relation === 'linked' ? [...current.edges, ...newEdges] : current.edges,
      }),
      relation === 'linked' ? '已创建节点' : '已创建同级节点',
      sourceNodes.length > 1
        ? relation === 'linked'
          ? `已为 ${sourceNodes.length} 个选中节点分别创建并连接新节点。`
          : `已为 ${sourceNodes.length} 个选中节点分别创建同级节点。`
        : relation === 'linked'
          ? `已创建 ${newNodes[0]?.id ?? '新节点'}，并从 ${sourceNodes[0]?.id ?? '当前节点'} 建立连接。`
          : `已在 ${sourceNodes[0]?.id ?? '当前节点'} 同层级创建 ${newNodes[0]?.id ?? '新节点'}。`,
    );

    setSelection({ kind: 'node', ids: newNodes.map((node) => node.id) });
    if (newNodes.length === 1) {
      setEditingNodeId(newNodes[0].id);
      setEditingLabel(newNodes[0].label);
    }
  }, [allSubgraphFrameMap, commitDocument, contentCardRect, documentState, fullSubgraphLookup]);

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
        ]);
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
      const nextId = nextNodeId(workingNodes);
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
      `${(documentState.projectName ?? 'diagram').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'diagram'}.md`,
      documentState.markdown ?? '',
      'text/markdown;charset=utf-8',
    );
  }, [documentState.markdown, documentState.projectName]);

  const exportCanvasImage = useCallback(async () => {
    const board = canvasBoardRef.current;
    if (!board) {
      return;
    }

    const clone = board.cloneNode(true) as HTMLDivElement;
    clone.querySelectorAll(
      '.graph-node__connector, .subgraph-frame__connector, .subgraph-frame__action, .content-card__action',
    ).forEach((element) => element.remove());
    clone.style.transform = `translate(${-canvasExportBounds.x}px, ${-canvasExportBounds.y}px)`;
    clone.style.transformOrigin = 'top left';

    const cssText = collectDocumentCssText();
    const wrapperMarkup = `
      <div xmlns="http://www.w3.org/1999/xhtml" style="width:${canvasExportBounds.width}px;height:${canvasExportBounds.height}px;overflow:hidden;position:relative;background:
        linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px),
        linear-gradient(180deg, rgba(17,19,23,1), rgba(20,23,29,1));
        background-size:24px 24px,24px 24px,100% 100%;
        background-position:${-canvasExportBounds.x}px ${-canvasExportBounds.y}px, ${-canvasExportBounds.x}px ${-canvasExportBounds.y}px, 0 0;">
        <style>${cssText}</style>
        ${clone.outerHTML}
      </div>
    `;
    const svgMarkup = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${canvasExportBounds.width}" height="${canvasExportBounds.height}" viewBox="0 0 ${canvasExportBounds.width} ${canvasExportBounds.height}">
        <foreignObject width="100%" height="100%">${wrapperMarkup}</foreignObject>
      </svg>
    `;

    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    try {
      const image = await loadImageFromUrl(svgUrl);
      const canvas = document.createElement('canvas');
      const scale = Math.min(2, window.devicePixelRatio || 1.5);
      canvas.width = Math.ceil(canvasExportBounds.width * scale);
      canvas.height = Math.ceil(canvasExportBounds.height * scale);
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas context unavailable');
      }

      context.scale(scale, scale);
      context.drawImage(image, 0, 0, canvasExportBounds.width, canvasExportBounds.height);

      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
            return;
          }
          reject(new Error('PNG export failed'));
        }, 'image/png');
      });

      downloadBlob(
        `${sanitizeFilename(documentState.projectName ?? activeTab.label, 'diagram')}.png`,
        pngBlob,
      );
    } catch {
      downloadFile(
        `${sanitizeFilename(documentState.projectName ?? activeTab.label, 'diagram')}.svg`,
        svgMarkup,
        'image/svg+xml;charset=utf-8',
      );
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  }, [activeTab.label, canvasExportBounds, documentState.projectName]);

  const copySource = useCallback(() => {
    navigator.clipboard
      .writeText(documentState.markdown ?? '')
      .catch(() => {});
  }, [documentState.markdown]);

  const goToMode = useCallback((nextMode: EditorMode) => {
    if (isVsCodeHost) {
      if (nextMode === 'source') {
        vscodeApiRef.current?.postMessage({ type: 'lmd/openSource' });
        return;
      }

      if (nextMode === 'history') {
        return;
      }
    }

    if (mode === 'source' && nextMode !== 'source' && sourceParseError) {
      return;
    }

    setMode(nextMode);
  }, [isVsCodeHost, mode, sourceParseError]);

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
          file.name.replace(/\.md$/i, ''),
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
            description: 'Markdown',
            accept: {
              'text/markdown': ['.md'],
              'text/plain': ['.md'],
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
        meta: 'Markdown 工程',
        depth: 1,
        kind: 'file',
        path: `local-file://${file.name}`,
        parentId: 'local-project',
        tabId: 'diagram',
        mode: 'canvas',
      };

      const rootItem: ExplorerItem = {
        id: 'local-project',
        label: file.name.replace(/\.md$/i, '') || 'local-file',
        meta: '本地 Markdown 文件',
        depth: 0,
        kind: 'project',
        path: `local-file://${file.name.replace(/\.md$/i, '') || 'local-file'}`,
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

    let filename = 'untitled.md';
    let index = 2;
    while (existingNames.has(filename.toLowerCase())) {
      filename = `untitled-${index}.md`;
      index += 1;
    }

    const fileHandle = await parentEntry.handle.getFileHandle(filename, { create: true });
    if (fileHandle.createWritable) {
      const writable = await fileHandle.createWritable();
      await writable.write(
        createProjectMarkdownTemplate(
          filename.replace(/\.md$/i, ''),
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

    const nextNameInput = window.prompt('Rename Markdown file', item.label)?.trim();
    if (!nextNameInput) {
      return;
    }

    const nextFilename = /\.md$/i.test(nextNameInput) ? nextNameInput : `${nextNameInput}.md`;
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
    const viewport = documentState.layout.viewport;
    const point = bounds
      ? {
          x: (bounds.width / 2 - viewport.x) / viewport.zoom - 72,
          y: (bounds.height / 2 - viewport.y) / viewport.zoom - 30,
        }
      : { x: 220, y: 160 };

    goToMode('canvas');
    createNodeAt(point);
  }, [createNodeAt, documentState.layout.viewport, goToMode]);

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
  }, [documentState]);

  useEffect(() => {
    documentRevisionRef.current = documentRevision;
  }, [documentRevision]);

  useEffect(() => {
    function syncViewportMode() {
      setIsMobileViewport(window.innerWidth <= 820);
    }

    syncViewportMode();
    window.addEventListener('resize', syncViewportMode);
    return () => {
      window.removeEventListener('resize', syncViewportMode);
    };
  }, []);

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
  }, [inspectorView, isVsCodeHost, leftPanel, mode]);

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
    if (mode !== 'canvas') {
      setSidebarOpen(!isMobileViewport);
      setInspectorOpen(!isMobileViewport);
      return;
    }

    if (!isMobileViewport && selection.kind !== 'none') {
      setInspectorOpen(true);
      setInspectorView((current) => (current === 'ai' && inspectorOpen ? 'ai' : 'properties'));
    }
  }, [inspectorOpen, isMobileViewport, mode, selection.kind]);

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
        createNodesFromShortcut(selectedNodesForShortcut, 'linked');
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
          const ids = visibleNodes.map((node) => node.id);
          setSelection(ids.length > 0 ? { kind: 'node', ids } : { kind: 'none', ids: [] });
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

      if ((event.metaKey || event.ctrlKey) && event.key === '3') {
        event.preventDefault();
        goToMode('history');
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setHelpDialogOpen(false);
        setEditingNodeId(null);
        setEditingLabel('');
        setEditingEdgeId(null);
        setEditingEdgeLabel('');
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
          startInlineEdit(targetNode);
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
          startSubgraphTitleEdit(targetSubgraph);
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
    documentState.nodes,
    documentState.subgraphs,
    deleteSelection,
    duplicateSelection,
    documentState.edges,
    editingEdgeId,
    editingNodeId,
    helpDialogOpen,
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

    const resolveHierarchyTargets = (pointer: Point, activeDragState: DragState) => {
      const excludedNodeIds = activeDragState.ids;
      const excludedSubgraphIds = activeDragState.kind === 'subgraph' && activeDragState.entityId
        ? [activeDragState.entityId]
        : [];
      const nextNodeTargetId = findNodeDropTarget(visibleNodes, pointer, excludedNodeIds);
      const insertableEndpointId = activeDragState.kind === 'subgraph'
        ? activeDragState.entityId ?? null
        : activeDragState.ids.length === 1
          ? activeDragState.ids[0]
          : null;
      const nextEdgeTargetId = nextNodeTargetId || !insertableEndpointId
        ? null
        : findEdgeDropTarget(
          pointer,
          visibleEdges,
          edgeEndpointMap,
          edgeLaneMap,
          edgeEndpointOffsetMap,
          [insertableEndpointId],
        );
      const nextSubgraphTargetId =
        nextNodeTargetId || nextEdgeTargetId
          ? null
          : findSubgraphDropTarget(
            allSubgraphFrames,
            pointer,
            excludedSubgraphIds,
          );

      return {
        nodeId: nextNodeTargetId,
        edgeId: nextEdgeTargetId,
        subgraphId: nextSubgraphTargetId,
      };
    };

    function onPointerMove(event: PointerEvent) {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const pendingBackground = pendingBackgroundRef.current;
      if (pendingBackground) {
        const delta = Math.hypot(
          event.clientX - pendingBackground.clientX,
          event.clientY - pendingBackground.clientY,
        );
        if (delta > 8) {
          clearPendingBackgroundInteraction();
          setPanState({
            origin: { x: event.clientX, y: event.clientY },
            initialViewport: { ...documentState.layout.viewport },
          });
        }
      }

      const bounds = canvas.getBoundingClientRect();
      const viewport = documentState.layout.viewport;
      const x = (event.clientX - bounds.left - viewport.x) / viewport.zoom;
      const y = (event.clientY - bounds.top - viewport.y) / viewport.zoom;

      if (dragState) {
        if (dragState.kind !== 'content' && (event.ctrlKey || event.metaKey)) {
          setDragReparentMode(true);
          const targets = resolveHierarchyTargets({ x, y }, dragState);
          setDragTargetNodeId(targets.nodeId);
          setDragTargetEdgeId(targets.edgeId);
          setDragTargetSubgraphId(targets.subgraphId);
        } else {
          setDragReparentMode(false);
          setDragTargetNodeId(null);
          setDragTargetEdgeId(null);
          setDragTargetSubgraphId(null);
        }

        setDragState((current) =>
          current
            ? {
                ...current,
                current: { x, y },
              }
            : null,
        );
      }

      if (boxState) {
        setBoxState((current) =>
          current
            ? {
                ...current,
                current: { x, y },
                toggle: event.shiftKey,
              }
            : null,
        );
      }

      if (panState) {
        const nextViewport = {
          ...panState.initialViewport,
          x: panState.initialViewport.x + (event.clientX - panState.origin.x),
          y: panState.initialViewport.y + (event.clientY - panState.origin.y),
        };
        setDocumentState((current) => ({
          ...current,
          layout: {
            ...current.layout,
            viewport: nextViewport,
          },
        }));
      }

      if (connectingState) {
        setConnectingState((current) =>
          current
            ? {
                ...current,
                current: { x, y },
                edgeType: event.ctrlKey || event.metaKey ? 'line' : 'solid',
              }
            : null,
        );
      }
    }

    function onPointerUp(event: PointerEvent) {
      clearPendingBackgroundInteraction();

      if (dragState) {
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
          ? findSubgraphDropTarget(
            allSubgraphFrames,
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
          setDragState(null);
          setDragTargetNodeId(null);
          setDragTargetEdgeId(null);
          setDragTargetSubgraphId(null);
          setDragReparentMode(false);
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
                    contentCardRect,
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
                    contentCardRect,
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
                contentCardRect,
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
        setDragState(null);
        setDragTargetNodeId(null);
        setDragTargetEdgeId(null);
        setDragTargetSubgraphId(null);
        setDragReparentMode(false);
      }

      if (boxState) {
        const rect = rectFromPoints(boxState.origin, boxState.current);
        const nextNodeIds = visibleNodes.filter((node) => intersects(rect, node)).map((node) => node.id);
        if (nextNodeIds.length > 0) {
          setSelection((current) =>
            boxState.toggle ? toggleSelectionIds(current, 'node', nextNodeIds) : { kind: 'node', ids: nextNodeIds },
          );
        } else {
          const nextSubgraphIds = subgraphFrames
            .filter((frame) => intersects(rect, frame))
            .map((frame) => frame.id);

          if (nextSubgraphIds.length > 0) {
            setSelection((current) =>
              boxState.toggle
                ? toggleSelectionIds(current, 'subgraph', nextSubgraphIds)
                : { kind: 'subgraph', ids: nextSubgraphIds },
            );
          } else if (intersects(rect, contentCardRect)) {
            setSelection((current) =>
              boxState.toggle
                ? toggleSelectionIds(current, 'content', [CONTENT_CARD_ID])
                : { kind: 'content', ids: [CONTENT_CARD_ID] },
            );
          } else {
            const nextEdgeIds = visibleEdges
              .filter((edge) => {
                const fromNode = edgeEndpointMap.get(edge.from);
                const toNode = edgeEndpointMap.get(edge.to);
                if (!fromNode || !toNode) {
                  return false;
                }

                const geometry = buildEdgeGeometry(
                  fromNode,
                  toNode,
                  edgeLaneMap.get(edge.id) ?? 0,
                  edgeEndpointOffsetMap.get(edge.id),
                );
                return edgeIntersectsRect(rect, geometry);
              })
              .map((edge) => edge.id);

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
      clearPendingBackgroundInteraction();
      setDragState(null);
      setDragTargetNodeId(null);
      setDragTargetEdgeId(null);
      setDragTargetSubgraphId(null);
      setDragReparentMode(false);
      setBoxState(null);
      setPanState(null);
      setConnectingState(null);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    return () => {
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
    edgeEndpointMap,
    edgeLaneMap,
    edgeEndpointOffsetMap,
    allSubgraphFrames,
    subgraphFrames,
    fullSubgraphLookup,
    panState,
    pointFromClient,
    resolveSubgraphAtPoint,
    visibleEdges,
    visibleNodes,
  ]);

  function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!canvasRef.current) {
      return;
    }

    event.preventDefault();

    const deltaScale = event.deltaMode === 1 ? 16 : 1;

    if (event.ctrlKey) {
      zoomViewportAtPoint(
        event.clientX,
        event.clientY,
        Math.exp((-event.deltaY * deltaScale) / WHEEL_PINCH_DIVISOR),
      );
      return;
    }

    const deltaX = event.deltaX * deltaScale;
    const deltaY = event.deltaY * deltaScale;

    updateViewport((viewport) => ({
      ...viewport,
      x: viewport.x - deltaX,
      y: viewport.y - deltaY,
    }));
  }

  function startBackgroundInteraction(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button === 1) {
      event.preventDefault();
      setPanState({
        origin: { x: event.clientX, y: event.clientY },
        initialViewport: { ...documentState.layout.viewport },
      });
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest('.graph-node, .subgraph-frame, .content-card')) {
      return;
    }

    const viewport = documentState.layout.viewport;
    const point = pointFromClient(event.clientX, event.clientY, viewport);
    if (!point) {
      return;
    }

    if (spacePressed) {
      setPanState({
        origin: { x: event.clientX, y: event.clientY },
        initialViewport: { ...viewport },
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
    if (editingNodeId) {
      return;
    }

    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      setPanState({
        origin: { x: event.clientX, y: event.clientY },
        initialViewport: { ...documentState.layout.viewport },
      });
      return;
    }

    event.stopPropagation();

    const point = pointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    const activeIds = selection.kind === 'node' && selectionContains(selection, node.id)
      ? selection.ids
      : [node.id];

    if (event.button === 2) {
      event.preventDefault();
      setSelection({ kind: 'node', ids: activeIds });
      setConnectingState({
        fromId: activeIds[0],
        fromIds: activeIds,
        origin: point,
        current: point,
        edgeType: event.ctrlKey || event.metaKey ? 'line' : 'solid',
        handleSide: event.clientX < node.x + node.width / 2 ? 'left' : 'right',
      });
      return;
    }

    if (event.button !== 0) {
      return;
    }

    if (event.altKey) {
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
      setDragState({
        kind: 'node',
        origin: point,
        current: point,
        ids: duplicatedIds,
        initialPositions: Object.fromEntries(
          duplicatedNodes.map((entry) => [entry.id, { x: entry.x, y: entry.y }]),
        ),
      });
      return;
    }

    if (event.shiftKey) {
      const nextSelection = toggleSelectionIds(selection, 'node', [node.id]);
      setSelection(nextSelection);
      return;
    }

    setSelection({ kind: 'node', ids: activeIds });

    const initialPositions = Object.fromEntries(
      documentState.nodes
        .filter((entry) => activeIds.includes(entry.id))
        .map((entry) => [entry.id, { x: entry.x, y: entry.y }]),
    );

    setDragState({
      kind: 'node',
      origin: point,
      current: point,
      ids: activeIds,
      initialPositions,
      entityId: activeIds.length === 1 ? activeIds[0] : null,
    });
  }

  function startContentDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (editingContent) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, a')) {
      return;
    }

    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      setPanState({
        origin: { x: event.clientX, y: event.clientY },
        initialViewport: { ...documentState.layout.viewport },
      });
      return;
    }

    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();
    if (event.shiftKey) {
      setSelection((current) => toggleSelectionIds(current, 'content', [CONTENT_CARD_ID]));
      return;
    }
    setSelection({ kind: 'content', ids: [CONTENT_CARD_ID] });
  }

  function startSubgraphDrag(
    event: ReactPointerEvent<HTMLDivElement>,
    subgraphId: string,
  ) {
    if (editingSubgraphId) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest('button, input')) {
      return;
    }

    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      setPanState({
        origin: { x: event.clientX, y: event.clientY },
        initialViewport: { ...documentState.layout.viewport },
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
    setDragState({
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
  const nodeAnnotationMap = useMemo(
    () => getNodeAnnotationMap(documentState),
    [documentState],
  );
  const selectedNodePresetId = selectedNode
    ? nodeStylePresets.find((preset) =>
      preset.fill === selectedNode.fill &&
      preset.stroke === selectedNode.stroke &&
      preset.textColor === selectedNode.textColor,
    )?.id ?? null
    : null;
  const selectionLabel =
    selection.kind === 'none'
      ? '未选中任何内容'
      : `已选中 ${selection.ids.length} 个${selectionKindLabel(selection.kind)}`;
  const activeModeLabel =
    mode === 'canvas' ? '画布模式' : mode === 'source' ? '源码模式' : '历史模式';
  const canGroupSelection = selection.kind === 'node' && selection.ids.length >= 2;
  const visibleLeftPanels = isVsCodeHost
    ? leftPanelMeta.filter((item) => item.id === 'graph')
    : leftPanelMeta;
  const visibleModeMeta = isVsCodeHost
    ? modeMeta.filter((entry) => entry.id === 'canvas')
    : modeMeta;
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
    '--nav-width': `${NAV_RAIL_WIDTH}px`,
    '--sidebar-width': showSidebar ? `${clampPanelWidth('left', sidebarWidth)}px` : '0px',
    '--inspector-width': showInspector ? `${clampPanelWidth('right', inspectorWidth)}px` : '0px',
  }) as CSSProperties, [clampPanelWidth, inspectorWidth, showInspector, showSidebar, sidebarWidth]);
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
    if (!selectedNode) {
      return;
    }

    setNodeInspectorDraft({
      label: selectedNode.label,
      annotation: nodeAnnotationMap[selectedNode.id] ?? '',
      shape: selectedNode.shape,
      fill: selectedNode.fill,
      stroke: selectedNode.stroke,
      textColor: selectedNode.textColor,
    });
  }, [nodeAnnotationMap, selectedNode]);

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

    setSubgraphInspectorDraft({
      title: selectedSubgraph.title,
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
  }, [selection.kind]);

  useEffect(() => {
    localStorage.setItem(storageKeys.aiSettings, JSON.stringify(aiSettings));
  }, [aiSettings]);

  useEffect(() => {
    localStorage.setItem(storageKeys.sidebarWidth, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem(storageKeys.inspectorWidth, String(Math.round(inspectorWidth)));
  }, [inspectorWidth]);

  useEffect(() => {
    localStorage.setItem(storageKeys.aiChat, JSON.stringify(aiMessages.slice(-24)));
  }, [aiMessages]);

  useEffect(() => {
    aiLastMarkdownRef.current = aiLastMarkdown;
    if (aiLastMarkdown) {
      localStorage.setItem(storageKeys.aiLastMarkdown, aiLastMarkdown);
    } else {
      localStorage.removeItem(storageKeys.aiLastMarkdown);
    }
  }, [aiLastMarkdown]);

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
          const nodeId = operation.nodeId && !next.nodes.some((node) => node.id === operation.nodeId)
            ? operation.nodeId
            : nextNodeId(next.nodes);
          const label = operation.label?.trim() || '新建内容';
          const subgraphId = operation.subgraphId ?? null;
          if (subgraphId && !next.subgraphs.some((subgraph) => subgraph.id === subgraphId)) {
            warnings.push(`Missing subgraph: ${subgraphId}`);
            break;
          }
          next = {
            ...next,
            nodes: [
              ...next.nodes,
              buildNode(nodeId, label, getOperationNodePlacement(next, subgraphId), subgraphId),
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
        case 'updateNodeAnnotation': {
          if (!next.nodes.some((node) => node.id === operation.nodeId)) {
            warnings.push(`Missing node: ${operation.nodeId}`);
            break;
          }
          const normalizedAnnotation = trimMultilineBlock(operation.annotation);
          const nextAnnotations = {
            ...(next.nodeAnnotations ?? {}),
          };
          if (normalizedAnnotation) {
            nextAnnotations[operation.nodeId] = normalizedAnnotation;
          } else {
            delete nextAnnotations[operation.nodeId];
          }
          next = {
            ...next,
            nodeAnnotations: nextAnnotations,
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
            nodeAnnotations: Object.fromEntries(
              Object.entries(next.nodeAnnotations ?? {}).filter(([nodeId]) => nodeId !== operation.nodeId),
            ),
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
        };
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
          };
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
        };
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

    const userMessage: AiMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
    };
    const conversation = [...aiMessages, userMessage];
    const markdown = getProjectMarkdown();
    const markdownDelta = buildMarkdownDeltaContext(aiLastMarkdownRef.current, markdown);
    const selectionContext = buildSelectionContext(documentRef.current, selection);
    const historyContext = buildAiHistoryContext(aiMessages);

    setAiMessages(conversation);
    setAiInput('');
    setAiSending(true);

    try {
      const messages: Array<Record<string, unknown>> = [
        {
          role: 'system',
          content: `AI rules:\n${aiSettings.systemPrompt}`,
        },
        {
          role: 'system',
          content: `Tool rules:\n${aiToolRules}\n\nLock rules:\n${buildAiLockRules(aiSettings)}`,
        },
        {
          role: 'system',
          content: `Project format:\n${aiProjectFormatGuide}`,
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

      messages.push(
        {
          role: 'system',
          content: `Current selection:\n${selectionContext}`,
        },
        {
          role: 'user',
          content: prompt,
        },
      );

      let finalAssistantContent = '';

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

          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify(toolResult),
          });
        }
      }

      setAiMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: finalAssistantContent || '已完成当前请求。',
        },
      ]);
      setAiLastMarkdown(getProjectMarkdown());
    } catch (error) {
      setAiMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: error instanceof Error ? error.message : 'AI 请求失败。',
          status: 'error',
        },
      ]);
    } finally {
      setAiSending(false);
    }
  }, [aiInput, aiMessages, aiSending, aiSettings, executeAiToolCall, getProjectMarkdown, selection]);

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
            MD
          </button>
        </div>

        <div className="workbench-tabs" aria-label="已打开文件">
          {isVsCodeHost && !isMobileViewport ? (
            <div className="vscode-commandbar" role="toolbar" aria-label="LMD_EDITER 工具栏">
              <div className="vscode-commandbar__file" title={vscodeFileLabel}>
                <span className="vscode-commandbar__badge">LMD_EDITER</span>
                <strong>{vscodeFileLabel}</strong>
              </div>
              <div className="vscode-commandbar__tools">
                <button
                  aria-label="图谱"
                  className={showSidebar && leftPanel === 'graph' ? 'icon-button has-tooltip is-active' : 'icon-button has-tooltip'}
                  data-tooltip="图谱"
                  onClick={() => toggleLeftPanel('graph')}
                  type="button"
                >
                  <WorkbenchIcon name="graph" />
                </button>
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
                  aria-label="属性"
                  className={showInspector ? 'icon-button has-tooltip is-active' : 'icon-button has-tooltip'}
                  data-tooltip="属性"
                  onClick={() => openInspectorView('properties')}
                  type="button"
                >
                  <WorkbenchIcon name="inspect" />
                </button>
                <button
                  aria-label="导出画布图片"
                  className="icon-button has-tooltip"
                  data-tooltip="导出图片"
                  onClick={exportCanvasImage}
                  type="button"
                >
                  <WorkbenchIcon name="preview" />
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
                <span className="desktop-command-group__label">{desktopCommandGroups[0].label}</span>
                <button
                  className={showSidebar && leftPanel === 'files' ? 'desktop-command-button is-active' : 'desktop-command-button'}
                  onClick={() => toggleLeftPanel('files')}
                  type="button"
                >
                  文件
                </button>
                <button
                  className={showSidebar && leftPanel === 'graph' ? 'desktop-command-button is-active' : 'desktop-command-button'}
                  onClick={() => toggleLeftPanel('graph')}
                  type="button"
                >
                  图谱
                </button>
                <button className="desktop-command-button" onClick={exportMarkdown} type="button">
                  导出
                </button>
                <button className="desktop-command-button" onClick={exportCanvasImage} type="button">
                  导出图片
                </button>
                <button
                  className={
                    supportsLocalMarkdownPicker || supportsLocalProjectPicker
                      ? 'desktop-command-button'
                      : 'desktop-command-button is-disabled'
                  }
                  onClick={() => {
                    void openLocalMarkdownFile();
                  }}
                  type="button"
                >
                  打开 MD
                </button>
              </div>

              <div className="desktop-command-group">
                <span className="desktop-command-group__label">{desktopCommandGroups[1].label}</span>
                <button className="desktop-command-button" onClick={createNodeInViewportCenter} type="button">
                  新建节点
                </button>
                <button
                  className={selection.kind === 'node' && selection.ids.length > 0 ? 'desktop-command-button' : 'desktop-command-button is-disabled'}
                  onClick={duplicateSelection}
                  type="button"
                >
                  复制
                </button>
                <button
                  className={canGroupSelection ? 'desktop-command-button' : 'desktop-command-button is-disabled'}
                  onClick={wrapSelectionInSubgraph}
                  type="button"
                >
                  分组
                </button>
                <button
                  className={selection.kind !== 'none' ? 'desktop-command-button' : 'desktop-command-button is-disabled'}
                  onClick={deleteSelection}
                  type="button"
                >
                  删除
                </button>
                <button className="desktop-command-button" onClick={compactLayout} type="button">
                  整理
                </button>
                <button className="desktop-command-button" onClick={autoLayout} type="button">
                  布局
                </button>
                <button className="desktop-command-button" onClick={standardizeCurrentProject} type="button">
                  标准化
                </button>
              </div>

              <div className="desktop-command-group">
                <span className="desktop-command-group__label">{desktopCommandGroups[2].label}</span>
                <button
                  className={mode === 'canvas' ? 'desktop-command-button is-active' : 'desktop-command-button'}
                  onClick={() => goToMode('canvas')}
                  type="button"
                >
                  画布
                </button>
                <button
                  className={mode === 'source' ? 'desktop-command-button is-active' : 'desktop-command-button'}
                  onClick={() => goToMode('source')}
                  type="button"
                >
                  源码
                </button>
                <button
                  className={showInspector && inspectorView === 'properties' ? 'desktop-command-button is-active' : 'desktop-command-button'}
                  onClick={() => openInspectorView('properties')}
                  type="button"
                >
                  属性
                </button>
                <button
                  className={showInspector && inspectorView === 'ai' ? 'desktop-command-button is-active' : 'desktop-command-button'}
                  onClick={() => openInspectorView('ai')}
                  type="button"
                >
                  AI
                </button>
                <button
                  className={selection.kind !== 'none' ? 'desktop-command-button' : 'desktop-command-button is-disabled'}
                  onClick={focusSelectionInViewport}
                  type="button"
                >
                  聚焦
                </button>
              </div>

              <div className="desktop-path-chip">
                <strong>{activeWorkspaceSource === 'cloud' ? '云端路径' : '本地路径'}</strong>
                <span>{activeProjectPath}</span>
              </div>
            </div>
          )}
        </div>

        <div className="workbench-bar__actions">
          {isVsCodeHost && !isMobileViewport ? (
            <div
              aria-label={
                saveStatus === 'saving'
                  ? '正在写入 LMD'
                  : saveStatus === 'error'
                    ? '同步异常'
                    : 'LMD 已连接'
              }
              className={`status-pill status-pill--${saveStatus}`}
              data-tooltip={
                saveStatus === 'saving'
                  ? '正在写入 LMD'
                  : saveStatus === 'error'
                    ? '同步异常'
                    : 'LMD 已连接'
              }
            >
              <span className="status-pill__dot" />
              {saveStatus === 'saving'
                ? '正在写入 LMD'
                : saveStatus === 'error'
                  ? '同步异常'
                  : 'LMD 已连接'}
            </div>
          ) : (
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
                ) : (
                  <>
                    <button
                      aria-label="复制 Mermaid 源码"
                      className="icon-button has-tooltip"
                      data-tooltip="复制 Mermaid"
                      onClick={copySource}
                      type="button"
                    >
                      <WorkbenchIcon name="copy" />
                    </button>
                    <button
                      aria-label="导出当前画布图片"
                      className="icon-button has-tooltip"
                      data-tooltip="导出图片"
                      onClick={exportCanvasImage}
                      type="button"
                    >
                      <WorkbenchIcon name="preview" />
                    </button>
                    <button
                      aria-label="导出标准 Markdown"
                      className="icon-button icon-button--primary has-tooltip"
                      data-tooltip="导出 Markdown"
                      onClick={exportMarkdown}
                      type="button"
                    >
                      <WorkbenchIcon name="share" />
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
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
                  placeholder={leftPanel === 'files' ? '查找文件、节点、源码' : '查找图层、节点、分组'}
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
                    打开 MD
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
                    打开一个本地目录后，这里会以文件管理器方式显示 Markdown 工程。
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
                        selection.kind === 'subgraph' &&
                        selectionContains(selection, item.id)) ||
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

        <section className={`workspace-main workspace-main--${mode}`}>
          {!isMobileViewport ? (
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

                  createNodeAt(point, undefined, 'solid', resolveSubgraphAtPoint(point));
                }}
                onPointerDown={startBackgroundInteraction}
                onWheel={handleCanvasWheel}
                ref={canvasRef}
              >
                <div
                  className="canvas-board"
                  ref={canvasBoardRef}
                  style={{
                    transform: `translate(${documentState.layout.viewport.x}px, ${documentState.layout.viewport.y}px) scale(${documentState.layout.viewport.zoom})`,
                  }}
                >
                  {[...subgraphFrames].sort((left, right) => left.depth - right.depth).map((frame) => {
                    const subgraph = documentState.subgraphs.find((entry) => entry.id === frame.id);
                    if (!subgraph) {
                      return null;
                    }
                    const subgraphStyle = getSubgraphStyle(subgraph);

                    return (
                      <div
                        key={frame.id}
                        className={`subgraph-frame${selection.kind === 'subgraph' && selectionContains(selection, frame.id) ? ' is-selected' : ''}${dragTargetSubgraphId === frame.id ? ' is-drop-target' : ''}${subgraph.collapsed ? ' is-collapsed' : ''}`}
                        data-edge-endpoint-id={frame.id}
                        onDoubleClick={(event) => {
                          if (isMobileViewport) {
                            return;
                          }
                          const target = event.target as HTMLElement;
                          if (target.closest('.subgraph-frame__header, .subgraph-frame__action, .subgraph-frame__connector, .subgraph-frame__title-input, .subgraph-frame__title-button')) {
                            return;
                          }

                          if (subgraph.collapsed) {
                            return;
                          }

                          event.stopPropagation();
                          const point = pointFromClient(event.clientX, event.clientY);
                          if (!point) {
                            return;
                          }

                          createNodeAt(point, undefined, 'solid', frame.id);
                        }}
                        onPointerDown={(event) => {
                          const target = event.target as HTMLElement;
                          if (target.closest('.subgraph-frame__header, .subgraph-frame__action, .subgraph-frame__connector, .subgraph-frame__title-input')) {
                            return;
                          }

                          if (event.button === 2) {
                            startSubgraphDrag(event, frame.id);
                            return;
                          }

                          event.stopPropagation();
                          selectSingle('subgraph', frame.id, event.shiftKey);
                        }}
                        style={{
                          left: frame.x,
                          top: frame.y,
                          width: frame.width,
                          height: frame.height,
                          '--depth': String(frame.depth),
                          '--subgraph-fill': subgraphStyle.fill,
                          '--subgraph-fill-soft': withAlpha(subgraphStyle.fill, 0.16),
                          '--subgraph-fill-faint': withAlpha(subgraphStyle.fill, 0.08),
                          '--subgraph-stroke': subgraphStyle.stroke,
                          '--subgraph-text': subgraphStyle.textColor,
                        } as CSSProperties}
                      >
                        <div
                          className="subgraph-frame__header"
                          onPointerDown={(event) => startSubgraphDrag(event, frame.id)}
                        >
                          <div className="subgraph-frame__header-copy">
                            {editingSubgraphId === frame.id ? (
                              <input
                                autoFocus
                                className="subgraph-frame__title-input"
                                onBlur={() => commitSubgraphTitleEdit(frame.id)}
                                onChange={(event) => setEditingSubgraphTitle(event.target.value)}
                                onKeyDown={(event) => {
                                  if (handleNativeSelectAllShortcut(event)) {
                                    return;
                                  }

                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    commitSubgraphTitleEdit(frame.id);
                                    return;
                                  }

                                  if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setEditingSubgraphId(null);
                                    setEditingSubgraphTitle('');
                                  }
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                                value={editingSubgraphTitle}
                              />
                            ) : (
                              <span
                                className="subgraph-frame__title-button"
                                onDoubleClick={(event) => {
                                  event.stopPropagation();
                                  startSubgraphTitleEdit(subgraph);
                                }}
                              >
                                {subgraph.title}
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

                        {subgraph.collapsed ? (
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
                        ) : null}
                      </div>
                    );
                  })}

                  <div
                    className={`content-card${selectedContent ? ' is-selected' : ''}${editingContent ? ' is-editing' : ''}${contentCardCollapsed ? ' is-collapsed' : ''}`}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      startContentInlineEdit();
                    }}
                    onWheelCapture={(event) => event.stopPropagation()}
                    onPointerDown={(event) => {
                      const target = event.target as HTMLElement;
                      if (target.closest('.content-card__action, .content-card__editor')) {
                        return;
                      }

                      if (target.closest('.content-card__header')) {
                        startContentDrag(event);
                        return;
                      }

                      event.stopPropagation();
                      if (event.shiftKey) {
                        setSelection((current) => toggleSelectionIds(current, 'content', [CONTENT_CARD_ID]));
                        return;
                      }
                      setSelection({ kind: 'content', ids: [CONTENT_CARD_ID] });
                    }}
                    style={{
                      left: contentCardRenderLayout.x,
                      top: contentCardRenderLayout.y,
                      width: Math.min(contentCardSize.width, 520),
                      height: Math.min(contentCardCollapsed ? contentCardSize.height : contentCardSize.height, contentCardCollapsed ? 120 : 420),
                    }}
                  >
                    <div
                      className="content-card__header"
                      onPointerDown={startContentDrag}
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
                        onDoubleClick={(event) => event.stopPropagation()}
                        onWheelCapture={(event) => event.stopPropagation()}
                        dangerouslySetInnerHTML={{ __html: contentCardPreviewHtml }}
                      />
                    )}
                  </div>

                  <svg className="edge-layer" aria-hidden="true">
                    <defs>
                      <marker
                        id="arrow-outline"
                        markerWidth="13.4"
                        markerHeight="13.4"
                        refX="10.6"
                        refY="6.7"
                        orient="auto"
                        markerUnits="userSpaceOnUse"
                      >
                        <path d="M0,0 L13.4,6.7 L0,13.4 z" fill="rgba(255,255,255,0.56)" />
                      </marker>
                      <marker
                        id="arrow-solid"
                        markerWidth="11.2"
                        markerHeight="11.2"
                        refX="8.9"
                        refY="5.6"
                        orient="auto"
                        markerUnits="userSpaceOnUse"
                      >
                        <path
                          d="M0,0 L11.2,5.6 L0,11.2 z"
                          fill="context-stroke"
                          fillOpacity="1"
                          stroke="rgba(255,255,255,0.68)"
                          strokeWidth="0.7"
                        />
                      </marker>
                    </defs>
                    {visibleEdges.map((edge) => {
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
                        normalizedEdge.strokeColor === defaultEdgeStyle.strokeColor;

                      const geometry = buildEdgeGeometry(
                        fromNode,
                        toNode,
                        edgeLaneMap.get(edge.id) ?? 0,
                        edgeEndpointOffsetMap.get(edge.id),
                      );
                      const edgeBaseColor = inheritsSourceColor
                        ? fromNode.stroke
                        : normalizedEdge.strokeColor;
                      const baseStrokeWidth = isGroupEdge
                        ? normalizedEdge.strokeWidth * 2
                        : normalizedEdge.strokeWidth;
                      const visualStrokeWidth = Math.max(baseStrokeWidth, isGroupEdge ? 2.8 : 2.05);
                      const selectedEdgeStrokeWidth =
                        isEdgeSelected
                          ? visualStrokeWidth + 0.8
                          : visualStrokeWidth;
                      const displayStroke = withAlpha(edgeBaseColor, isGroupEdge ? 0.97 : 0.95);
                      const outlineWidth = selectedEdgeStrokeWidth + (isGroupEdge ? 0.95 : 0.75);
                      const labelBackground = mixColors(
                        edgeBaseColor,
                        '#f8fafc',
                        inheritsSourceColor ? 0.82 : 0.86,
                      );
                      const labelTextColor = getReadableLabelTextColor(
                        labelBackground,
                        edgeBaseColor,
                      );
                      const labelBorder = withAlpha(edgeBaseColor, isEdgeSelected ? 0.82 : 0.64);
                      const labelMetrics = edge.label ? measureEdgeLabelBadge(edge.label) : null;
                      const liveEdgeLabel = editingEdgeId === edge.id ? editingEdgeLabel || ' ' : edge.label;
                      const liveEdgeLabelMetrics = measureEdgeLabelBadge(liveEdgeLabel);
                      const edgeLabelLines = edge.label.split(/\r?\n/);

                      return (
                        <g key={edge.id}>
                          {isEdgeSelected ? (
                            <path
                              className={`edge-path edge-path--selection${isGroupEdge ? ' is-group-edge' : ''}${dragTargetEdgeId === edge.id ? ' is-drop-target' : ''}`}
                              d={geometry.path}
                              markerEnd={edge.type === 'line' ? undefined : 'url(#arrow-outline)'}
                              pointerEvents="none"
                              stroke={withAlpha(edgeBaseColor, 0.9)}
                              strokeWidth={selectedEdgeStrokeWidth + (isGroupEdge ? 8 : 7)}
                            />
                          ) : null}
                          <path
                            className={`edge-path edge-path--outline edge-path--${edge.type}${isGroupEdge ? ' is-group-edge' : ''}${isEdgeSelected ? ' is-selected' : ''}${dragTargetEdgeId === edge.id ? ' is-drop-target' : ''}`}
                            d={geometry.path}
                            markerEnd={edge.type === 'line' ? undefined : 'url(#arrow-outline)'}
                            pointerEvents="none"
                            stroke="#f8fafc"
                            strokeOpacity={0.72}
                            strokeWidth={outlineWidth}
                          />
                          <path
                            className={`edge-path edge-path--main edge-path--${edge.type}${isGroupEdge ? ' is-group-edge' : ''}${isEdgeSelected ? ' is-selected' : ''}${dragTargetEdgeId === edge.id ? ' is-drop-target' : ''}`}
                            d={geometry.path}
                            markerEnd={edge.type === 'line' ? undefined : 'url(#arrow-solid)'}
                            pointerEvents="none"
                            stroke={displayStroke}
                            strokeWidth={selectedEdgeStrokeWidth}
                          />
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
                                rx={11}
                                stroke={labelBorder}
                                strokeWidth={isEdgeSelected ? 1.6 : 1}
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
                          markerEnd="url(#arrow-solid)"
                          stroke={withAlpha(dragInsertPreview.stroke, 0.92)}
                        />
                        <path
                          className="edge-path edge-path--preview edge-path--insert-preview"
                          d={dragInsertPreview.second.path}
                          markerEnd="url(#arrow-solid)"
                          stroke={withAlpha(dragInsertPreview.stroke, 0.92)}
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
                        markerEnd={connectingState.edgeType === 'line' ? undefined : 'url(#arrow-solid)'}
                        stroke={(() => {
                          const originNode = edgeEndpointMap.get(connectingState.fromId);
                          return originNode ? withAlpha(originNode.stroke, 0.9) : undefined;
                        })()}
                      />
                    ) : null}
                  </svg>

                  {visibleNodes.map((node) => {
                    const selected = selection.kind === 'node' && selectionContains(selection, node.id);
                    const isEditing = editingNodeId === node.id;
                    const liveContent = isEditing ? editingLabel || ' ' : node.label;
                    const liveSize = isEditing ? measureNodeContentSize(liveContent) : node;

                    return (
                      <div
                        key={node.id}
                        className={`graph-node graph-node--${node.shape}${selected ? ' is-selected' : ''}${hoveredNodeId === node.id ? ' is-hovered' : ''}${dragTargetNodeId === node.id ? ' is-drop-target' : ''}`}
                        data-edge-endpoint-id={node.id}
                        data-node-id={node.id}
                        onDoubleClick={(event) => {
                          if (isMobileViewport) {
                            return;
                          }
                          event.stopPropagation();
                          startInlineEdit(node);
                        }}
                        onMouseEnter={() => setHoveredNodeId(node.id)}
                        onMouseLeave={() => setHoveredNodeId((current) => (current === node.id ? null : current))}
                        onPointerDown={(event) => startNodeDrag(event, node)}
                        style={{
                          left: node.x,
                          top: node.y,
                          width: liveSize.width,
                          height: liveSize.height,
                          background: node.fill,
                          borderColor: node.stroke,
                          color: node.textColor,
                        }}
                        tabIndex={0}
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
                          <textarea
                            autoFocus
                            className="graph-node__editor"
                            onBlur={() => commitInlineEdit(node.id)}
                            onChange={(event) => setEditingLabel(event.target.value)}
                            onPointerDown={(event) => event.stopPropagation()}
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
                                const nextValue = `${editingLabel.slice(0, start)}\n${editingLabel.slice(end)}`;
                                setEditingLabel(nextValue);
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

                              if (event.key === 'Escape') {
                                event.preventDefault();
                                setEditingNodeId(null);
                                setEditingLabel('');
                              }
                            }}
                            rows={1}
                            style={{ minHeight: Math.max(liveSize.height - 28, 32) }}
                            value={editingLabel}
                          />
                        ) : (
                          <div className="graph-node__content">{node.label}</div>
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
                        zoom: clamp(viewport.zoom - 0.1, 0.35, 2.8),
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
                        zoom: clamp(viewport.zoom + 0.1, 0.35, 2.8),
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

          {mode === 'source' ? (
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

          {mode === 'history' ? (
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

          <div className="inspector-tabs" role="tablist" aria-label="右侧面板视图">
            <button
              className={inspectorView === 'properties' ? 'inspector-tab is-active' : 'inspector-tab'}
              onClick={() => setInspectorView('properties')}
              type="button"
            >
              属性
            </button>
            {!isVsCodeHost ? (
              <button
                className={inspectorView === 'ai' ? 'inspector-tab is-active' : 'inspector-tab'}
                onClick={() => setInspectorView('ai')}
                type="button"
              >
                AI
              </button>
            ) : null}
          </div>

          {inspectorView === 'properties' ? (
            <>
          {selectedNode ? (
            <section className="sidebar-card">
              <div className="sidebar-card__header">
                <h2>节点</h2>
                <span>{selectedNode.id}</span>
              </div>
              <label className="field">
                <span>内容</span>
                <textarea
                  onBlur={() => applyNodeInspectorDraft()}
                  onChange={(event) =>
                    setNodeInspectorDraft((current) => ({ ...current, label: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (handleNativeSelectAllShortcut(event)) {
                      return;
                    }

                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      applyNodeInspectorDraft();
                      event.currentTarget.blur();
                    }
                  }}
                  rows={4}
                  value={nodeInspectorDraft.label}
                />
              </label>
              <label className="field">
                <span>注释</span>
                <textarea
                  onBlur={() => applyNodeInspectorDraft()}
                  onChange={(event) =>
                    setNodeInspectorDraft((current) => ({ ...current, annotation: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (handleNativeSelectAllShortcut(event)) {
                      return;
                    }

                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      applyNodeInspectorDraft();
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="节点注释会写入 ## Node Annotations，并随节点生命周期自动清理。"
                  rows={3}
                  value={nodeInspectorDraft.annotation}
                />
              </label>
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
                  onBlur={() => applyEdgeInspectorDraft()}
                  onChange={(event) =>
                    setEdgeInspectorDraft((current) => ({ ...current, label: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (handleNativeSelectAllShortcut(event)) {
                      return;
                    }

                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      applyEdgeInspectorDraft();
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
                    onBlur={() => applyEdgeInspectorDraft()}
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
                      applyEdgeInspectorDraft();
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
                <span>标题</span>
                <input
                  onBlur={() => applySubgraphInspectorDraft()}
                  onChange={(event) =>
                    setSubgraphInspectorDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (handleNativeSelectAllShortcut(event)) {
                      return;
                    }

                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applySubgraphInspectorDraft();
                      event.currentTarget.blur();
                    }
                  }}
                  value={subgraphInspectorDraft.title}
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
            <section className="sidebar-card sidebar-card--ai">
              <div className="sidebar-card__header">
                <h2>AI 助手</h2>
                <span>Local only</span>
              </div>

              <div className="ai-panel__tabs" role="tablist" aria-label="AI 面板页签">
                <button
                  className={aiPanelTab === 'chat' ? 'ai-panel__tab is-active' : 'ai-panel__tab'}
                  onClick={() => setAiPanelTab('chat')}
                  type="button"
                >
                  <WorkbenchIcon name="chat" />
                  <span>聊天</span>
                </button>
                <button
                  className={aiPanelTab === 'settings' ? 'ai-panel__tab is-active' : 'ai-panel__tab'}
                  onClick={() => setAiPanelTab('settings')}
                  type="button"
                >
                  <WorkbenchIcon name="settings" />
                  <span>设置</span>
                </button>
              </div>

              {aiPanelTab === 'chat' ? (
                <>
                  <div className="ai-panel__messages" onWheelCapture={(event) => event.stopPropagation()}>
                    {aiMessages.map((message) => (
                      <article
                        className={
                          message.status === 'error'
                            ? `ai-message ai-message--${message.role} is-error`
                            : `ai-message ai-message--${message.role}`
                        }
                        key={message.id}
                      >
                        <strong>{message.role === 'assistant' ? 'AI' : '你'}</strong>
                        <p>{message.content}</p>
                      </article>
                    ))}
                    {aiSending ? (
                      <article className="ai-message ai-message--assistant">
                        <strong>AI</strong>
                        <p>正在思考当前工程上下文...</p>
                      </article>
                    ) : null}
                  </div>
                  <section className="ai-agent-controls" aria-label="Agent 模式控制">
                    <div className="ai-agent-controls__header">
                      <strong>Agent 模式</strong>
                      <span>锁定的部分会直接禁止 AI 改写</span>
                    </div>
                    <div className="ai-agent-controls__list">
                      {aiLockControls.map((control) => {
                        const checked = aiSettings[control.key];
                        return (
                          <button
                            aria-pressed={!checked}
                            className={checked ? 'ai-agent-toggle is-locked' : 'ai-agent-toggle is-unlocked'}
                            key={control.key}
                            onClick={() =>
                              setAiSettings((current) => ({
                                ...current,
                                [control.key]: !current[control.key],
                              }))
                            }
                            type="button"
                          >
                            <span className="ai-agent-toggle__state">{checked ? '锁定' : '开锁'}</span>
                            <span className="ai-agent-toggle__label">{control.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <div className="ai-panel__composer">
                    <textarea
                      className="ai-panel__input"
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
                      placeholder="当前会自动附带完整 Markdown、上一轮改动、当前选中内容和工具规则。"
                      rows={3}
                      value={aiInput}
                    />
                    <div className="ai-panel__composer-bar">
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
                </>
              ) : (
                <div className="ai-panel__settings" onWheelCapture={(event) => event.stopPropagation()}>
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
                    <small>仅保存在当前浏览器，不写入工程 Markdown。</small>
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
                      rows={6}
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

        {isMobileViewport && mode === 'source' ? (
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
                <p>`Delete` 删除，`Ctrl/Cmd + G` 分组，`Ctrl/Cmd + C / V` 复制粘贴，`Alt + Drag` 复制并拖拽，`Ctrl/Cmd + Z` 撤回。</p>
              </article>
              <article className="help-card">
                <strong>✍️ 编辑</strong>
                <p>双击节点/连线或选中后按 `Enter` 进入编辑；编辑时 `Enter` 保存，`Shift/Ctrl/Alt + Enter` 换行。</p>
              </article>
              <article className="help-card">
                <strong>🌿 快速新建</strong>
                <p>双击空白会创建一个未链接的新节点；如果双击发生在组内，就直接创建在该组里。选中节点按 `Tab` 会在旁边快速新建并自动连线；多选时会为每个节点各建一个新节点。</p>
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
