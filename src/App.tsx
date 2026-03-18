import {
  startTransition,
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
  parseMermaidDocument,
  serializeMermaidDocument,
  syncDocument,
  toSidecar,
} from './lib/mermaid';
import { sampleSource } from './lib/sample';
import { storageKeys } from './lib/storage';
import type {
  Direction,
  EditorMode,
  GraphDocument,
  GraphEdge,
  GraphNode,
  GraphSubgraph,
  HistoryEntry,
  LayoutSidecar,
  NodeShape,
  SelectionState,
  ViewportState,
} from './lib/types';

type NoticeTone = 'info' | 'warn' | 'error';
type LeftPanel = 'files' | 'graph' | 'comments';
type WorkspaceTabId = 'diagram' | 'release-notes' | 'sdk';

interface NoticeState {
  tone: NoticeTone;
  message: string;
}

interface Point {
  x: number;
  y: number;
}

interface DragState {
  origin: Point;
  current: Point;
  ids: string[];
  initialPositions: Record<string, Point>;
}

interface BoxState {
  origin: Point;
  current: Point;
}

interface PanState {
  origin: Point;
  initialViewport: ViewportState;
}

interface ConnectingState {
  fromId: string;
  origin: Point;
  current: Point;
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
}

type IconName =
  | 'files'
  | 'graph'
  | 'comments'
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
  | 'chevron-left'
  | 'chevron-right';

const shapeOptions: Array<{ label: string; value: NodeShape }> = [
  { label: '矩形', value: 'rect' },
  { label: '圆角', value: 'round' },
  { label: '菱形', value: 'diamond' },
  { label: '圆形', value: 'circle' },
  { label: '六边形', value: 'hexagon' },
  { label: '数据库', value: 'database' },
  { label: '子程序', value: 'subroutine' },
];

const collaboratorPresets = [
  { id: 'lin', name: 'Lin', role: '画布', color: '#f97316' },
  { id: 'mina', name: 'Mina', role: '源码', color: '#22c55e' },
  { id: 'kai', name: 'Kai', role: '评审', color: '#38bdf8' },
] as const;

const workspaceTabs: Array<{ id: WorkspaceTabId; label: string; detail: string }> = [
  { id: 'diagram', label: 'diagram.md', detail: '主图' },
  { id: 'release-notes', label: 'release-notes.md', detail: '关联说明' },
  { id: 'sdk', label: 'sdk-v0.1.md', detail: '平台规范' },
];

const leftPanelMeta: Array<{ id: LeftPanel; label: string; icon: IconName }> = [
  { id: 'files', label: '文件', icon: 'files' },
  { id: 'graph', label: '图谱', icon: 'graph' },
  { id: 'comments', label: '协作', icon: 'comments' },
];

const modeMeta: Array<{ id: EditorMode; label: string; icon: IconName }> = [
  { id: 'canvas', label: '画布', icon: 'canvas' },
  { id: 'source', label: '源码', icon: 'source' },
  { id: 'history', label: '历史', icon: 'history' },
];

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
    case 'comments':
      return (
        <svg {...props}>
          <path d="M5 6h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H11l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
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
    default:
      return null;
  }
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
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
    candidate.edges,
    candidate.subgraphs,
    candidate.unsupportedLines,
  );

  return {
    ...candidate,
    layout,
    source,
  };
}

function loadWorkspace() {
  const savedSource = localStorage.getItem(storageKeys.source);
  const savedLayout = localStorage.getItem(storageKeys.sidecar);
  const savedHistory = localStorage.getItem(storageKeys.history);

  let layout = createDefaultLayout();
  let history: HistoryEntry[] = [createHistoryEntry('工作区已启动', '已打开原型编辑器。')];

  if (savedLayout) {
    try {
      layout = JSON.parse(savedLayout) as LayoutSidecar;
    } catch {
      layout = createDefaultLayout();
    }
  }

  if (savedHistory) {
    try {
      history = (JSON.parse(savedHistory) as HistoryEntry[]).map(localizeLegacyHistoryEntry);
    } catch {
      history = [createHistoryEntry('工作区已启动', '已重置本地历史缓存。')];
    }
  }

  const source = savedSource ?? sampleSource;
  const parsed = parseMermaidDocument(source, layout);

  return {
    document: syncDocument(parsed, source),
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
  return {
    id,
    label,
    shape: 'rect',
    x: position.x,
    y: position.y,
    width: Math.max(140, Math.min(220, 84 + label.length * 6)),
    height: 58,
    fill: '#fff8ef',
    stroke: '#24404f',
    textColor: '#12212c',
    subgraphId,
  };
}

function selectionContains(selection: SelectionState, id: string) {
  return selection.ids.includes(id);
}

function rectFromPoints(left: Point, right: Point) {
  return {
    x: Math.min(left.x, right.x),
    y: Math.min(left.y, right.y),
    width: Math.abs(left.x - right.x),
    height: Math.abs(left.y - right.y),
  };
}

function intersects(rect: { x: number; y: number; width: number; height: number }, node: GraphNode) {
  return !(
    node.x + node.width < rect.x ||
    node.x > rect.x + rect.width ||
    node.y + node.height < rect.y ||
    node.y > rect.y + rect.height
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

function downloadFile(filename: string, content: string, contentType: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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

function toMarkdownDocument(source: string) {
  return `\`\`\`mermaid\n${source}\n\`\`\`\n`;
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

function buildSubgraphFrames(document: GraphDocument, visibleNodes: GraphNode[]) {
  const frames: SubgraphFrame[] = [];
  const lookup = getVisibleSubgraphIds(document.subgraphs);

  for (const subgraph of document.subgraphs) {
    const members = visibleNodes.filter((node) => belongsToSubgraph(node, subgraph.id, lookup));
    if (members.length === 0) {
      continue;
    }

    const minX = Math.min(...members.map((node) => node.x)) - 36;
    const minY = Math.min(...members.map((node) => node.y)) - 48;
    const maxX = Math.max(...members.map((node) => node.x + node.width)) + 36;
    const maxY = Math.max(...members.map((node) => node.y + node.height)) + 36;

    frames.push({
      id: subgraph.id,
      x: minX,
      y: minY,
      width: Math.max(260, maxX - minX),
      height: subgraph.collapsed ? 112 : Math.max(160, maxY - minY),
      depth: getSubgraphDepth(subgraph, lookup),
      collapsed: subgraph.collapsed,
    });
  }

  return frames;
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
  const [initialWorkspace] = useState(() => loadWorkspace());
  const [documentState, setDocumentState] = useState<GraphDocument>(initialWorkspace.document);
  const [mode, setMode] = useState<EditorMode>('canvas');
  const [leftPanel, setLeftPanel] = useState<LeftPanel>('files');
  const [activeFileTab, setActiveFileTab] = useState<WorkspaceTabId>('diagram');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [canvasHovered, setCanvasHovered] = useState(false);
  const [selection, setSelection] = useState<SelectionState>({ kind: 'none', ids: [] });
  const [history, setHistory] = useState<HistoryEntry[]>(initialWorkspace.history);
  const [sourceDraft, setSourceDraft] = useState(initialWorkspace.document.source);
  const [notice, setNotice] = useState<NoticeState | null>({
    tone: 'info',
    message: '画布模式和源码模式已经同时打通，所有变更都会通过同一份图模型保持同步。',
  });
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [boxState, setBoxState] = useState<BoxState | null>(null);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [connectingState, setConnectingState] = useState<ConnectingState | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const gestureStateRef = useRef<GestureState | null>(null);
  const deferredSource = useDeferredValue(sourceDraft);
  const sourceParseError = useMemo(() => {
    try {
      parseMermaidDocument(deferredSource, documentState.layout);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : '无法解析 Mermaid 源码。';
    }
  }, [deferredSource, documentState.layout]);

  const subgraphLookup = getVisibleSubgraphIds(documentState.subgraphs);
  const visibleNodes = documentState.nodes.filter(
    (node) => !isInsideCollapsedSubgraph(node, subgraphLookup),
  );
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = documentState.edges.filter(
    (edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to),
  );
  const subgraphFrames = buildSubgraphFrames(documentState, visibleNodes);
  const filteredNodes = documentState.nodes.filter((node) => {
    if (!searchQuery.trim()) {
      return true;
    }

    const query = searchQuery.toLowerCase();
    return (
      node.id.toLowerCase().includes(query) ||
      node.label.toLowerCase().includes(query)
    );
  });
  const filteredSubgraphs = documentState.subgraphs.filter((subgraph) => {
    if (!searchQuery.trim()) {
      return true;
    }

    return subgraph.title.toLowerCase().includes(searchQuery.toLowerCase());
  });
  const activeTab = workspaceTabs.find((tab) => tab.id === activeFileTab) ?? workspaceTabs[0];
  const activityFeed = history.slice(0, 6);
  const explorerItems = useMemo(
    () => [
      {
        id: 'project',
        label: '产品图谱平台',
        meta: '云端工作区',
        depth: 0,
        kind: 'project' as const,
      },
      {
        id: 'folder-planning',
        label: '规划',
        meta: `${documentState.subgraphs.length} 个分组`,
        depth: 1,
        kind: 'folder' as const,
      },
      {
        id: 'file-diagram',
        label: 'diagram.md',
        meta: '共享实时文件',
        depth: 2,
        kind: 'file' as const,
      },
      {
        id: 'block-main',
        label: '主 Mermaid 区块',
        meta: `${documentState.nodes.length} 个节点 / ${documentState.edges.length} 条连线`,
        depth: 3,
        kind: 'block' as const,
      },
      {
        id: 'sidecar-layout',
        label: 'diagram.layout.json',
        meta: '工作区布局 sidecar',
        depth: 3,
        kind: 'sidecar' as const,
      },
      {
        id: 'folder-ai',
        label: '自动化',
        meta: 'SDK 与提示词',
        depth: 1,
        kind: 'folder' as const,
      },
      {
        id: 'file-sdk',
        label: 'sdk-v0.1.md',
        meta: '扩展接口约定',
        depth: 2,
        kind: 'file' as const,
      },
    ],
    [documentState.edges.length, documentState.nodes.length, documentState.subgraphs.length],
  );

  const commitDocument = useCallback((
    updater: (current: GraphDocument) => GraphDocument,
    title: string,
    detail: string,
  ) => {
    const nextDocument = materializeDocument(updater(structuredClone(documentState)));
    setSaveStatus('saving');
    setDocumentState(nextDocument);
    setSourceDraft(nextDocument.source);
    setHistory((current) => [createHistoryEntry(title, detail), ...current].slice(0, 40));
    setNotice({ tone: 'info', message: detail });
  }, [documentState]);

  const selectSingle = useCallback((kind: SelectionState['kind'], id: string) => {
    setSelection({ kind, ids: [id] });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection({ kind: 'none', ids: [] });
  }, []);

  const toggleLeftPanel = useCallback((nextPanel: LeftPanel) => {
    setLeftPanel((current) => {
      const samePanel = current === nextPanel;
      setSidebarOpen((isOpen) => (samePanel ? !isOpen : true));
      return samePanel ? current : nextPanel;
    });
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

  function updateSelectedNode<K extends keyof GraphNode>(key: K, value: GraphNode[K]) {
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
                [key]: value,
              }
            : node,
        ),
      }),
      '已更新节点',
      `已更新 ${selection.ids.length} 个节点属性。`,
    );
  }

  function updateSelectedEdge<K extends keyof GraphEdge>(key: K, value: GraphEdge[K]) {
    if (selection.kind !== 'edge' || selection.ids.length === 0) {
      return;
    }

    const ids = new Set(selection.ids);
    commitDocument(
      (current) => ({
        ...current,
        edges: current.edges.map((edge) =>
          ids.has(edge.id)
            ? {
                ...edge,
                [key]: value,
              }
            : edge,
        ),
      }),
      '已更新连线',
      `已更新 ${selection.ids.length} 条连线属性。`,
    );
  }

  function updateSelectedSubgraph<K extends keyof GraphSubgraph>(
    key: K,
    value: GraphSubgraph[K],
  ) {
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
                [key]: value,
              }
            : subgraph,
        ),
      }),
      '已更新分组',
      `已更新 ${selection.ids.length} 个分组设置。`,
    );
  }

  const createNodeAt = useCallback((point: Point, sourceNodeId?: string) => {
    const id = nextNodeId(documentState.nodes);
    const selectionSubgraph =
      selection.kind === 'subgraph' && selection.ids.length === 1 ? selection.ids[0] : null;
    const newNode = buildNode(id, `新建 ${id}`, point, selectionSubgraph);

    commitDocument(
      (current) => ({
        ...current,
        nodes: [...current.nodes, newNode],
        edges: sourceNodeId
          ? [
              ...current.edges,
              {
                id: crypto.randomUUID(),
                from: sourceNodeId,
                to: id,
                label: '',
                type: 'solid',
              },
            ]
          : current.edges,
      }),
      '已创建节点',
      sourceNodeId
        ? `已创建 ${id}，并从 ${sourceNodeId} 建立连接。`
        : `已在画布中创建 ${id}。`,
    );

    setSelection({ kind: 'node', ids: [id] });
  }, [commitDocument, documentState.nodes, selection]);

  const deleteSelection = useCallback(() => {
    if (selection.kind === 'none' || selection.ids.length === 0) {
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

        const deletedSubgraphIds = collectDescendantSubgraphIds(selection.ids, current.subgraphs);

        return {
          ...current,
          subgraphs: current.subgraphs.filter((subgraph) => !deletedSubgraphIds.has(subgraph.id)),
          nodes: current.nodes.map((node) =>
            deletedSubgraphIds.has(node.subgraphId ?? '')
              ? { ...node, subgraphId: null }
              : node,
          ),
        };
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
          ...node,
          id: nextId,
          label: `${node.label} 副本`,
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

  const wrapSelectionInSubgraph = useCallback(() => {
    if (selection.kind !== 'node' || selection.ids.length < 2) {
      setNotice({
        tone: 'warn',
        message: '请至少选中两个节点后再创建分组。',
      });
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
      'diagram.md',
      toMarkdownDocument(documentState.source),
      'text/markdown;charset=utf-8',
    );
    setNotice({ tone: 'info', message: '已导出标准 Markdown 与 Mermaid 源码。' });
  }, [documentState.source]);

  const exportSidecar = useCallback(() => {
    downloadFile(
      'diagram.layout.json',
      JSON.stringify(toSidecar(documentState), null, 2),
      'application/json;charset=utf-8',
    );
    setNotice({ tone: 'info', message: '已导出布局 sidecar。' });
  }, [documentState]);

  const copySource = useCallback(() => {
    navigator.clipboard
      .writeText(documentState.source)
      .then(() => {
        setNotice({ tone: 'info', message: '已将 Mermaid 源码复制到剪贴板。' });
      })
      .catch(() => {
        setNotice({ tone: 'error', message: '当前设备无法复制源码。' });
      });
  }, [documentState.source]);

  const goToMode = useCallback((nextMode: EditorMode) => {
    if (mode === 'source' && nextMode !== 'source' && sourceParseError) {
      setNotice({
        tone: 'error',
        message: '源码模式里还有未解决的问题，请先修复或回退草稿，再返回画布。',
      });
      return;
    }

    setMode(nextMode);
  }, [mode, sourceParseError]);

  useEffect(() => {
    if (deferredSource === documentState.source) {
      return;
    }

    try {
      const parsed = parseMermaidDocument(deferredSource, documentState.layout);
      startTransition(() => {
        setDocumentState(syncDocument(parsed, deferredSource));
      });
    } catch (error) {
      void error;
    }
  }, [deferredSource, documentState.layout, documentState.source]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKeys.source, documentState.source);
        localStorage.setItem(storageKeys.sidecar, JSON.stringify(documentState.layout));
        localStorage.setItem(storageKeys.history, JSON.stringify(history));
        if (!cancelled) {
          setSaveStatus('saved');
        }
      } catch {
        if (!cancelled) {
          setSaveStatus('error');
        }
      }
    }, 140);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [documentState.layout, documentState.source, history]);

  useEffect(() => {
    if (mode !== 'canvas') {
      setSidebarOpen(true);
      setInspectorOpen(true);
      return;
    }

    if (selection.kind !== 'none') {
      setInspectorOpen(true);
    }
  }, [mode, selection.kind]);

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
      zoomViewportAtPoint(clientX, clientY, nextScale / previousScale);
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
      if (event.code === 'Space' && !isTypingTarget(event.target)) {
        setSpacePressed(true);
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      const canvasHasFocus =
        mode === 'canvas' &&
        (canvasHovered ||
          (canvasRef.current !== null &&
            document.activeElement instanceof Node &&
            canvasRef.current.contains(document.activeElement)));

      if ((event.metaKey || event.ctrlKey) && canvasHasFocus) {
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
        setEditingNodeId(null);
        clearSelection();
        setConnectingState(null);
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
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
    deleteSelection,
    duplicateSelection,
    goToMode,
    mode,
    updateViewport,
    wrapSelectionInSubgraph,
    zoomViewportAtPoint,
  ]);

  useEffect(() => {
    if (!dragState && !boxState && !panState && !connectingState) {
      return;
    }

    function onPointerMove(event: PointerEvent) {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const bounds = canvas.getBoundingClientRect();
      const viewport = documentState.layout.viewport;
      const x = (event.clientX - bounds.left - viewport.x) / viewport.zoom;
      const y = (event.clientY - bounds.top - viewport.y) / viewport.zoom;

      if (dragState) {
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
              }
            : null,
        );
      }
    }

    function onPointerUp(event: PointerEvent) {
      if (dragState) {
        const deltaX = dragState.current.x - dragState.origin.x;
        const deltaY = dragState.current.y - dragState.origin.y;

        commitDocument(
          (current) => ({
            ...current,
            nodes: current.nodes.map((node) => {
              const initial = dragState.initialPositions[node.id];
              if (!initial) {
                return node;
              }
              return {
                ...node,
                x: Math.round(initial.x + deltaX),
                y: Math.round(initial.y + deltaY),
              };
            }),
          }),
          '已移动节点',
          `已在画布中移动 ${dragState.ids.length} 个节点。`,
        );
        setDragState(null);
      }

      if (boxState) {
        const rect = rectFromPoints(boxState.origin, boxState.current);
        const nextIds = visibleNodes.filter((node) => intersects(rect, node)).map((node) => node.id);
        setSelection(nextIds.length > 0 ? { kind: 'node', ids: nextIds } : { kind: 'none', ids: [] });
        setBoxState(null);
      }

      if (panState) {
          setHistory((current) => [
          createHistoryEntry('视口已移动', '已调整画布视口位置。'),
          ...current,
        ].slice(0, 40));
        setPanState(null);
      }

      if (connectingState) {
        const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-node-id]');
        const targetId = target?.dataset.nodeId;

        if (targetId && targetId !== connectingState.fromId) {
          const nextEdgeId = crypto.randomUUID();
          commitDocument(
            (current) => ({
              ...current,
              edges: [
                ...current.edges,
                {
                  id: nextEdgeId,
                  from: connectingState.fromId,
                  to: targetId,
                  label: '',
                  type: 'solid',
                },
              ],
            }),
            '已创建连线',
            `已将 ${connectingState.fromId} 连接到 ${targetId}。`,
          );
          setSelection({ kind: 'edge', ids: [nextEdgeId] });
        } else {
          const point = pointFromClient(event.clientX, event.clientY);
          if (!point) {
            setConnectingState(null);
            return;
          }
          createNodeAt(point, connectingState.fromId);
        }

        setConnectingState(null);
      }
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [
    boxState,
    commitDocument,
    connectingState,
    createNodeAt,
    documentState.edges,
    documentState.layout.viewport,
    dragState,
    panState,
    pointFromClient,
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
        Math.exp((-event.deltaY * deltaScale) / 520),
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
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest('.graph-node, .subgraph-frame')) {
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

    clearSelection();
    setBoxState({
      origin: point,
      current: point,
    });
  }

  function startNodeDrag(event: ReactPointerEvent<HTMLDivElement>, node: GraphNode) {
    if (event.button !== 0 || editingNodeId) {
      return;
    }

    event.stopPropagation();

    const point = pointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    let activeIds = selection.kind === 'node' && selectionContains(selection, node.id)
      ? selection.ids
      : [node.id];

    if (event.shiftKey) {
      const nextSet = new Set(selection.ids);
      if (nextSet.has(node.id)) {
        nextSet.delete(node.id);
      } else {
        nextSet.add(node.id);
      }
      activeIds = [...nextSet];
      setSelection(activeIds.length > 0 ? { kind: 'node', ids: activeIds } : { kind: 'none', ids: [] });
    } else {
      setSelection({ kind: 'node', ids: activeIds });
    }

    const initialPositions = Object.fromEntries(
      documentState.nodes
        .filter((entry) => activeIds.includes(entry.id))
        .map((entry) => [entry.id, { x: entry.x, y: entry.y }]),
    );

    setDragState({
      origin: point,
      current: point,
      ids: activeIds,
      initialPositions,
    });
  }

  function visiblePosition(node: GraphNode) {
    if (!dragState || !dragState.initialPositions[node.id]) {
      return { x: node.x, y: node.y };
    }

    const deltaX = dragState.current.x - dragState.origin.x;
    const deltaY = dragState.current.y - dragState.origin.y;
    const initial = dragState.initialPositions[node.id];

    return {
      x: initial.x + deltaX,
      y: initial.y + deltaY,
    };
  }

  function beginConnection(event: ReactPointerEvent<HTMLButtonElement>, node: GraphNode) {
    event.stopPropagation();
    if (!canvasRef.current) {
      return;
    }

    const origin = {
      x: node.x + node.width,
      y: node.y + node.height / 2,
    };
    const current = pointFromClient(event.clientX, event.clientY);
    if (!current) {
      return;
    }
    setConnectingState({
      fromId: node.id,
      origin,
      current,
    });
  }

  function startInlineEdit(node: GraphNode) {
    setEditingNodeId(node.id);
    setEditingLabel(node.label);
    setSelection({ kind: 'node', ids: [node.id] });
  }

  function commitInlineEdit(nodeId: string) {
    commitDocument(
      (current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                label: editingLabel.trim() || node.id,
              }
            : node,
        ),
      }),
      '已重命名节点',
      `已更新 ${nodeId} 的标签。`,
    );

    setEditingNodeId(null);
  }

  const selectedNode =
    selection.kind === 'node' && selection.ids.length === 1
      ? documentState.nodes.find((node) => node.id === selection.ids[0]) ?? null
      : null;
  const selectedEdge =
    selection.kind === 'edge' && selection.ids.length === 1
      ? documentState.edges.find((edge) => edge.id === selection.ids[0]) ?? null
      : null;
  const selectedSubgraph =
    selection.kind === 'subgraph' && selection.ids.length === 1
      ? documentState.subgraphs.find((subgraph) => subgraph.id === selection.ids[0]) ?? null
      : null;
  const selectionLabel =
    selection.kind === 'none'
      ? '未选中任何内容'
      : `已选中 ${selection.ids.length} 个${selectionKindLabel(selection.kind)}`;
  const activeModeLabel =
    mode === 'canvas' ? '画布模式' : mode === 'source' ? '源码模式' : '历史模式';
  const showSidebar = mode === 'canvas' ? sidebarOpen : true;
  const showInspector = mode === 'canvas' ? inspectorOpen : true;
  const workspaceClassName = `workspace workspace--${mode}${showSidebar ? ' workspace--sidebar-open' : ''}${showInspector ? ' workspace--inspector-open' : ''}`;

  // External Control API - allows external AI agents to control the editor
  useEffect(() => {
    const api = {
      setSource: (code: string) => {
        setSourceDraft(code);
      },
      getSource: () => sourceDraft,
      render: async () => {
        // trigger re-render by updating source draft
        setSourceDraft((s) => s);
      },
      getSvg: () => svg || null,
    };

    // Expose as global
    (window as unknown as Record<string, unknown>).MermaidEditor = api;

    // postMessage interface
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || event.data.type !== 'mermaid-editor') return;
      const { action, payload } = event.data;
      let responsePayload: unknown = null;
      if (action === 'setSource' && typeof payload === 'string') {
        api.setSource(payload);
      } else if (action === 'getSource') {
        responsePayload = api.getSource();
      } else if (action === 'render') {
        void api.render();
      } else if (action === 'getSvg') {
        responsePayload = api.getSvg();
      }
      event.source?.postMessage(
        { type: 'mermaid-editor-response', action, payload: responsePayload },
        { targetOrigin: event.origin }
      );
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      delete (window as unknown as Record<string, unknown>).MermaidEditor;
    };
  }, [sourceDraft, svg, setSourceDraft]);

  return (
    <div className="app-shell">
      <header className="workbench-bar">
        <div className="workbench-brand">
          <div className="topbar__mark">LTHS</div>
          <div className="workbench-brand__copy">
            <p className="eyebrow">云端 Mermaid 工作台</p>
            <h1>产品图谱平台</h1>
          </div>
        </div>

        <div className="workbench-tabs" aria-label="已打开文件">
          {workspaceTabs.map((tab) => (
            <button
              key={tab.id}
              className={tab.id === activeFileTab ? 'workbench-tab is-active' : 'workbench-tab'}
              onClick={() => {
                setActiveFileTab(tab.id);
                if (tab.id === 'diagram') {
                  setMode('canvas');
                } else {
                  setNotice({
                    tone: 'info',
                    message: `当前原型只把 ${tab.label} 作为工作台标签展示，真正实时编辑的仍然是 diagram.md。`,
                  });
                }
              }}
              type="button"
            >
              <strong>{tab.label}</strong>
              <span>{tab.detail}</span>
            </button>
          ))}
        </div>

        <div className="workbench-bar__actions">
          <div className="presence-strip" aria-label="在线协作者">
            {collaboratorPresets.map((collaborator) => (
              <button
                aria-label={`${collaborator.name}，当前${collaborator.role}`}
                className="presence-avatar has-tooltip"
                data-tooltip={`${collaborator.name} · ${collaborator.role}`}
                key={collaborator.id}
                onClick={() =>
                  setNotice({
                    tone: 'info',
                    message: `${collaborator.name} 当前聚焦在${collaborator.role}工作流。`,
                  })
                }
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
            aria-label={saveStatus === 'saving' ? '正在同步缓存' : saveStatus === 'error' ? '同步异常' : '云端缓存就绪'}
            className={`status-pill status-pill--${saveStatus}`}
            data-tooltip={saveStatus === 'saving' ? '正在同步缓存' : saveStatus === 'error' ? '同步异常' : '云端缓存就绪'}
          >
            <span className="status-pill__dot" />
            {saveStatus === 'saving'
              ? '正在同步缓存'
              : saveStatus === 'error'
                ? '同步异常'
                : '云端缓存就绪'}
          </div>

          <div className="workbench-icon-row" role="toolbar" aria-label="工作台控制">
            <div className="mode-switch" role="tablist" aria-label="工作区模式">
              {modeMeta.map((entry) => (
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

            <button
              aria-label={showInspector ? '收起属性面板' : '展开属性面板'}
              className={showInspector ? 'icon-button has-tooltip is-active' : 'icon-button has-tooltip'}
              data-tooltip={showInspector ? '收起属性' : '展开属性'}
              onClick={() => setInspectorOpen((current) => !current)}
              type="button"
            >
              <WorkbenchIcon name="inspect" />
            </button>

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
              aria-label="导出标准 Markdown"
              className="icon-button icon-button--primary has-tooltip"
              data-tooltip="分享 / 导出"
              onClick={exportMarkdown}
              type="button"
            >
              <WorkbenchIcon name="share" />
            </button>
          </div>
        </div>
      </header>

      {notice ? (
        <div className={`notice notice--${notice.tone}`}>
          <span>{notice.message}</span>
          <button onClick={() => setNotice(null)} type="button">
            关闭
          </button>
        </div>
      ) : null}

      <main className={workspaceClassName}>
        <nav className="nav-rail" aria-label="工作台导航">
          {leftPanelMeta.map((item) => (
            <button
              aria-label={item.label}
              className={leftPanel === item.id ? 'nav-rail__button has-tooltip is-active' : 'nav-rail__button has-tooltip'}
              data-tooltip={item.label}
              key={item.id}
              onClick={() => toggleLeftPanel(item.id)}
              type="button"
            >
              <WorkbenchIcon name={item.icon} />
            </button>
          ))}
        </nav>

        <aside className={`sidebar${showSidebar ? ' is-open' : ''}`}>
          <section className="sidebar-card sidebar-card--header">
            <div>
              <p className="eyebrow">
                {leftPanel === 'files'
                  ? '项目资源'
                  : leftPanel === 'graph'
                    ? '图谱导航'
                    : '协作状态'}
              </p>
              <h2>
                {leftPanel === 'files'
                  ? '云端文件'
                  : leftPanel === 'graph'
                    ? '图谱导航'
                    : '实时动态'}
              </h2>
            </div>
            <div className="panel-header-actions">
              <span className="panel-badge">
                {leftPanel === 'files' ? 'Linux 存储' : leftPanel === 'graph' ? '联动画布' : '3 人在线'}
              </span>
              <button
                aria-label="收起左侧面板"
                className="panel-icon-button has-tooltip"
                data-tooltip="收起侧栏"
                onClick={() => setSidebarOpen(false)}
                type="button"
              >
                <WorkbenchIcon name="chevron-left" />
              </button>
            </div>
          </section>

          {leftPanel === 'files' ? (
            <>
              <section className="sidebar-card">
                <div className="sidebar-card__header">
                  <h2>工作区</h2>
                  <span>{activeTab.label}</span>
                </div>
                <p className="sidebar-copy">
                  项目文件以服务器为准，本地浏览器只保留短期缓存，sidecar 只负责记录工作区布局状态。
                </p>
                <div className="explorer-list">
                  {explorerItems.map((item) => (
                    <button
                      key={item.id}
                      className={item.id === 'file-diagram' || item.id === 'block-main' ? 'explorer-item is-active' : 'explorer-item'}
                      onClick={() => {
                        if (item.id === 'file-diagram') {
                          setMode('source');
                          setSidebarOpen(false);
                        } else if (item.id === 'block-main') {
                          setMode('canvas');
                          setSidebarOpen(false);
                        } else if (item.id === 'sidecar-layout') {
                          setNotice({
                            tone: 'info',
                            message: '布局 sidecar 只在本工作区内部使用，不会改写导出的 Mermaid 或 Markdown。',
                          });
                        }
                      }}
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

              <section className="sidebar-card sidebar-card--muted">
                <div className="sidebar-card__header">
                  <h2>项目规则</h2>
                  <span>Mermaid 兼容</span>
                </div>
                <div className="stack-list">
                  <div className="info-row">
                    <strong>真相源</strong>
                    <span>云端项目中的 Markdown 文件</span>
                  </div>
                  <div className="info-row">
                    <strong>布局状态</strong>
                    <span>独立 sidecar，绝不写进 Mermaid</span>
                  </div>
                  <div className="info-row">
                    <strong>同步模型</strong>
                    <span>画布和源码共享同一份图文档</span>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {leftPanel === 'graph' ? (
            <>
              <section className="sidebar-card">
                <p className="sidebar-copy">
                  搜索节点、分组和源码区块。点击结果后会保持当前文档焦点，并把选中项定位回画布。
                </p>
                <label className="field">
                  <span>搜索</span>
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="查找节点或分组"
                  />
                </label>
              </section>

              <section className="sidebar-card">
                <div className="sidebar-card__header">
                  <h2>分组</h2>
                  <span>{documentState.subgraphs.length}</span>
                </div>
                <div className="project-list">
                  {filteredSubgraphs.map((subgraph) => (
                    <button
                      key={subgraph.id}
                      className={selection.kind === 'subgraph' && selectionContains(selection, subgraph.id) ? 'project-item is-active' : 'project-item'}
                      onClick={() => {
                        setSelection({ kind: 'subgraph', ids: [subgraph.id] });
                        setMode('canvas');
                        setSidebarOpen(false);
                      }}
                      type="button"
                    >
                      <span>{subgraph.title}</span>
                      <small>{subgraph.collapsed ? '已折叠' : '已展开'}</small>
                    </button>
                  ))}
                </div>
              </section>

              <section className="sidebar-card">
                <div className="sidebar-card__header">
                  <h2>节点</h2>
                  <span>{filteredNodes.length}</span>
                </div>
                <div className="project-list">
                  {filteredNodes.map((node) => (
                    <button
                      key={node.id}
                      className={selection.kind === 'node' && selectionContains(selection, node.id) ? 'project-item is-active' : 'project-item'}
                      onClick={() => {
                        setSelection({ kind: 'node', ids: [node.id] });
                        setMode('canvas');
                        setSidebarOpen(false);
                      }}
                      type="button"
                    >
                      <span>{node.label}</span>
                      <small>{node.id}</small>
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          {leftPanel === 'comments' ? (
            <>
              <section className="sidebar-card">
                <div className="sidebar-card__header">
                  <h2>在线协作者</h2>
                  <span>{collaboratorPresets.length}</span>
                </div>
                <div className="presence-list">
                  {collaboratorPresets.map((collaborator) => (
                    <div className="presence-list__item" key={collaborator.id}>
                      <span
                        className="presence-list__swatch"
                        style={{ background: collaborator.color }}
                      />
                      <div>
                        <strong>{collaborator.name}</strong>
                        <span>正在编辑{collaborator.role}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="sidebar-card sidebar-card--muted">
                <div className="sidebar-card__header">
                  <h2>最近动态</h2>
                  <span>实时流</span>
                </div>
                <div className="activity-feed">
                  {activityFeed.map((entry) => (
                    <article className="activity-item" key={entry.id}>
                      <strong>{entry.title}</strong>
                      <span>{entry.detail}</span>
                      <small>{formatTime(entry.at)}</small>
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </aside>

        <section className={`workspace-main workspace-main--${mode}`}>
          {mode === 'canvas' ? (
            <div className="canvas-mode">
              <div className="canvas-status-strip" aria-label="画布状态">
                <span className="canvas-status-pill">{activeModeLabel}</span>
                <span className="canvas-status-pill">{selectionLabel}</span>
                <span className="canvas-status-pill">{documentState.nodes.length} 个节点</span>
              </div>

              <div
                className={`canvas-surface${spacePressed ? ' is-panning' : ''}`}
                onMouseEnter={() => setCanvasHovered(true)}
                onMouseLeave={() => setCanvasHovered(false)}
                onDoubleClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest('.graph-node, .subgraph-frame')) {
                    return;
                  }

                  const point = pointFromClient(event.clientX, event.clientY);
                  if (!point) {
                    return;
                  }

                  createNodeAt(point);
                }}
                onPointerDown={startBackgroundInteraction}
                onWheel={handleCanvasWheel}
                ref={canvasRef}
              >
                <div
                  className="canvas-board"
                  style={{
                    transform: `translate(${documentState.layout.viewport.x}px, ${documentState.layout.viewport.y}px) scale(${documentState.layout.viewport.zoom})`,
                  }}
                >
                  {subgraphFrames.map((frame) => {
                    const subgraph = documentState.subgraphs.find((entry) => entry.id === frame.id);
                    if (!subgraph) {
                      return null;
                    }

                    return (
                      <button
                        key={frame.id}
                        className={`subgraph-frame${selection.kind === 'subgraph' && selectionContains(selection, frame.id) ? ' is-selected' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectSingle('subgraph', frame.id);
                        }}
                        style={{
                          left: frame.x,
                          top: frame.y,
                          width: frame.width,
                          height: frame.height,
                          '--depth': String(frame.depth),
                        } as CSSProperties}
                        type="button"
                      >
                        <span className="subgraph-frame__title">{subgraph.title}</span>
                        <span className="subgraph-frame__meta">
                          {subgraph.collapsed
                            ? '已折叠'
                            : `${countNodesInSubgraph(documentState.nodes, subgraph.id, subgraphLookup)} 个节点`}
                        </span>
                      </button>
                    );
                  })}

                  <svg className="edge-layer" aria-hidden="true">
                    <defs>
                      <marker
                        id="arrow-solid"
                        markerWidth="10"
                        markerHeight="10"
                        refX="8"
                        refY="5"
                        orient="auto"
                      >
                        <path d="M0,0 L10,5 L0,10 z" fill="#24404f" />
                      </marker>
                    </defs>
                    {visibleEdges.map((edge) => {
                      const fromNode = visibleNodes.find((node) => node.id === edge.from);
                      const toNode = visibleNodes.find((node) => node.id === edge.to);
                      if (!fromNode || !toNode) {
                        return null;
                      }

                      const from = visiblePosition(fromNode);
                      const to = visiblePosition(toNode);
                      const startX = from.x + fromNode.width;
                      const startY = from.y + fromNode.height / 2;
                      const endX = to.x;
                      const endY = to.y + toNode.height / 2;
                      const midX = (startX + endX) / 2;
                      const midY = (startY + endY) / 2;

                      return (
                        <g key={edge.id}>
                          <path
                            className={`edge-path edge-path--${edge.type}${selection.kind === 'edge' && selectionContains(selection, edge.id) ? ' is-selected' : ''}`}
                            d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                            markerEnd={edge.type === 'line' ? undefined : 'url(#arrow-solid)'}
                            onClick={(event) => {
                              event.stopPropagation();
                              selectSingle('edge', edge.id);
                            }}
                          />
                          {edge.label ? (
                            <text className="edge-label" x={midX} y={midY - 10}>
                              {edge.label}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}

                    {connectingState ? (
                      <path
                        className="edge-path edge-path--preview"
                        d={`M ${connectingState.origin.x} ${connectingState.origin.y} C ${(connectingState.origin.x + connectingState.current.x) / 2} ${connectingState.origin.y}, ${(connectingState.origin.x + connectingState.current.x) / 2} ${connectingState.current.y}, ${connectingState.current.x} ${connectingState.current.y}`}
                        markerEnd="url(#arrow-solid)"
                      />
                    ) : null}
                  </svg>

                  {visibleNodes.map((node) => {
                    const position = visiblePosition(node);
                    const selected = selection.kind === 'node' && selectionContains(selection, node.id);

                    return (
                      <div
                        key={node.id}
                        className={`graph-node graph-node--${node.shape}${selected ? ' is-selected' : ''}${hoveredNodeId === node.id ? ' is-hovered' : ''}`}
                        data-node-id={node.id}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          startInlineEdit(node);
                        }}
                        onMouseEnter={() => setHoveredNodeId(node.id)}
                        onMouseLeave={() => setHoveredNodeId((current) => (current === node.id ? null : current))}
                        onPointerDown={(event) => startNodeDrag(event, node)}
                        style={{
                          left: position.x,
                          top: position.y,
                          width: node.width,
                          height: node.height,
                          background: node.fill,
                          borderColor: node.stroke,
                          color: node.textColor,
                        }}
                        tabIndex={0}
                      >
                        <div className="graph-node__header">
                          <span className="graph-node__id">{node.id}</span>
                          <button
                            aria-label={`从 ${node.label} 创建连线`}
                            className="graph-node__connector"
                            onPointerDown={(event) => beginConnection(event, node)}
                            type="button"
                          >
                            +
                          </button>
                        </div>

                        {editingNodeId === node.id ? (
                          <textarea
                            autoFocus
                            className="graph-node__editor"
                            onBlur={() => commitInlineEdit(node.id)}
                            onChange={(event) => setEditingLabel(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                commitInlineEdit(node.id);
                              }

                              if (event.key === 'Escape') {
                                event.preventDefault();
                                setEditingNodeId(null);
                              }
                            }}
                            rows={3}
                            value={editingLabel}
                          />
                        ) : (
                          <div className="graph-node__label">{node.label}</div>
                        )}
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

                <div className="canvas-hud">
                  <div className="canvas-hud__card">
                    <strong>空白拖拽框选，双指平移，Pinch 缩放，`Space` 临时拖动画布。</strong>
                  </div>
                </div>

                <div className="tool-dock" role="toolbar" aria-label="画布工具">
                  <button
                    aria-label="选择"
                    className="tool-dock__button has-tooltip is-active"
                    data-tooltip="选择"
                    onClick={() => setNotice({ tone: 'info', message: '选择仍然是默认工具。拖拽空白处可框选，拖拽节点即可移动。' })}
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
                    className="tool-dock__button has-tooltip"
                    data-tooltip="创建分组"
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
                    <p className="eyebrow">Markdown + Mermaid</p>
                    <h2>源码编辑器</h2>
                  </div>
                  <button
                    className="ghost-button"
                    onClick={() => setSourceDraft(documentState.source)}
                    type="button"
                  >
                    回退到有效图
                  </button>
                </div>

                <textarea
                  className="source-editor"
                  onChange={(event) => {
                    setSaveStatus('saving');
                    setSourceDraft(event.target.value);
                  }}
                  spellCheck={false}
                  value={sourceDraft}
                />

                <div className="source-status">
                  <span>
                    {sourceParseError
                      ? '当前草稿存在语法问题，已暂停从源码模式回写。'
                      : '你输入的内容会实时同步回共享图模型。'}
                  </span>
                  {sourceParseError ? <strong>{sourceParseError}</strong> : null}
                  {documentState.warnings.length > 0 ? (
                    <p>{documentState.warnings[0]}</p>
                  ) : null}
                </div>
              </section>

              <section className="preview-pane">
                <div className="pane-header">
                  <div>
                    <p className="eyebrow">实时预览</p>
                    <h2>标准 Mermaid 渲染</h2>
                  </div>
                </div>
                <MermaidPreview source={sourceDraft} />
              </section>
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

        <aside className={`inspector${showInspector ? ' is-open' : ''}`}>
          <section className="sidebar-card">
            <div className="sidebar-card__header">
              <h2>会话</h2>
              <div className="panel-header-actions">
                <span>{activeTab.label}</span>
                <button
                  aria-label="收起属性面板"
                  className="panel-icon-button has-tooltip"
                  data-tooltip="收起属性"
                  onClick={() => setInspectorOpen(false)}
                  type="button"
                >
                  <WorkbenchIcon name="chevron-right" />
                </button>
              </div>
            </div>
            <div className="stack-list">
              <div className="info-row">
                <strong>云端项目</strong>
                <span>产品图谱平台 / 规划</span>
              </div>
              <div className="info-row">
                <strong>当前模式</strong>
                <span>{mode === 'canvas' ? '画布' : mode === 'source' ? '源码' : '历史'}</span>
              </div>
              <div className="info-row">
                <strong>存储拆分</strong>
                <span>标准 Markdown + 独立布局 sidecar</span>
              </div>
            </div>
          </section>

          <section className="sidebar-card">
            <h2>文档</h2>
            <label className="field">
              <span>方向</span>
              <select
                onChange={(event) =>
                  commitDocument(
                    (current) => ({
                      ...current,
                      direction: event.target.value as Direction,
                    }),
                    '已更新方向',
                    `已将流向改为 ${event.target.value}。`,
                  )
                }
                value={documentState.direction}
              >
                <option value="LR">LR</option>
                <option value="RL">RL</option>
                <option value="TD">TD</option>
                <option value="BT">BT</option>
              </select>
            </label>

            <div className="stats-grid">
              <div>
                <strong>{documentState.nodes.length}</strong>
                <span>节点</span>
              </div>
              <div>
                <strong>{documentState.edges.length}</strong>
                <span>连线</span>
              </div>
              <div>
                <strong>{documentState.subgraphs.length}</strong>
                <span>分组</span>
              </div>
              <div>
                <strong>{documentState.unsupportedLines.length}</strong>
                <span>仅源码</span>
              </div>
            </div>
          </section>

          {selectedNode ? (
            <section className="sidebar-card">
              <div className="sidebar-card__header">
                <h2>节点</h2>
                <span>{selectedNode.id}</span>
              </div>
              <label className="field">
                <span>标签</span>
                <input
                  onChange={(event) => updateSelectedNode('label', event.target.value)}
                  value={selectedNode.label}
                />
              </label>
              <label className="field">
                <span>形状</span>
                <select
                  onChange={(event) => updateSelectedNode('shape', event.target.value as NodeShape)}
                  value={selectedNode.shape}
                >
                  {shapeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="color-grid">
                <label className="field">
                  <span>填充</span>
                  <input
                    onChange={(event) => updateSelectedNode('fill', event.target.value)}
                    type="color"
                    value={selectedNode.fill}
                  />
                </label>
                <label className="field">
                  <span>描边</span>
                  <input
                    onChange={(event) => updateSelectedNode('stroke', event.target.value)}
                    type="color"
                    value={selectedNode.stroke}
                  />
                </label>
                <label className="field">
                  <span>文字</span>
                  <input
                    onChange={(event) => updateSelectedNode('textColor', event.target.value)}
                    type="color"
                    value={selectedNode.textColor}
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
                <input
                  onChange={(event) => updateSelectedEdge('label', event.target.value)}
                  value={selectedEdge.label}
                />
              </label>
              <label className="field">
                <span>类型</span>
                <select
                  onChange={(event) => updateSelectedEdge('type', event.target.value as GraphEdge['type'])}
                  value={selectedEdge.type}
                >
                  <option value="solid">箭头</option>
                  <option value="line">直线</option>
                  <option value="dotted">虚线</option>
                  <option value="thick">粗线</option>
                </select>
              </label>
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
                  onChange={(event) => updateSelectedSubgraph('title', event.target.value)}
                  value={selectedSubgraph.title}
                />
              </label>
              <label className="toggle-row">
                <span>折叠</span>
                <input
                  checked={selectedSubgraph.collapsed}
                  onChange={(event) => updateSelectedSubgraph('collapsed', event.target.checked)}
                  type="checkbox"
                />
              </label>
            </section>
          ) : null}

          <section className="sidebar-card sidebar-card--muted">
            <h2>AI 动作</h2>
            <div className="ai-list">
              <button className="ai-card" type="button">
                <strong>节点重命名</strong>
                <span>生成稳定的命令批次，让命名规则保持一致。</span>
              </button>
              <button className="ai-card" type="button">
                <strong>总结图谱</strong>
                <span>把当前区块整理成发布说明或评审摘要。</span>
              </button>
              <button className="ai-card" type="button">
                <strong>兼容性检查</strong>
                <span>检查当前区块是否仍然保持在标准 Mermaid 的兼容范围内。</span>
              </button>
            </div>
            <div className="inspector-actions">
              <button className="ghost-button" onClick={exportSidecar} type="button">
                导出 Sidecar
              </button>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
