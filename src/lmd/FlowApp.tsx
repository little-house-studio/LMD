import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createDefaultLayout,
  createStressTestProjectMarkdown,
  parseProjectMarkdown,
  sampleProjectMarkdown,
  serializeMermaidDocument,
  serializeProjectMarkdown,
  standardizeProjectMarkdown,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
} from '.';
import { storageKeys } from './storage';
import { documentToCompat } from './flow/adapter';
import {
  autoLayoutDocument,
  createRelatedNodesInDocument,
  duplicateNodesInDocument,
  groupNodesInDocument,
  pasteClonedNodesInDocument,
  tidyLayoutDocument,
  ungroupNodesInDocument,
  updateEdgeInDocument,
  updateNodeInDocument,
  updateProjectMeta,
  updateSubgraphInDocument,
} from './flow/documentOps';
import { FlowPerfHud } from './flow/FlowPerfHud';
import { InspectorPanel } from './flow/InspectorPanel';
import { flowPerfMeasure } from './flow/flowPerf';
import { splitEntityText } from './flow/label';
import { StageCanvas, type StageSelection } from './stage/StageCanvas';
import { StageMinimap } from './stage/StageMinimap';
import '../styles.css';

type ShellMode = 'canvas' | 'source';

type HostConfig = {
  platform: 'web' | 'vscode';
  initialMarkdown?: string;
  fileName?: string;
};

type VsCodeApiLike = {
  postMessage(message: unknown): void;
};

type ViewportInfo = {
  world: { x: number; y: number; width: number; height: number };
  view: { x: number; y: number; width: number; height: number };
};

const MAX_HISTORY = 40;

function readHostConfig(): HostConfig {
  const config = (window as Window & { __LMD_EDITOR_CONFIG__?: HostConfig }).__LMD_EDITOR_CONFIG__;
  if (!config || typeof config !== 'object') {
    return { platform: 'web' };
  }
  return {
    platform: config.platform === 'vscode' ? 'vscode' : 'web',
    initialMarkdown: typeof config.initialMarkdown === 'string' ? config.initialMarkdown : undefined,
    fileName: typeof config.fileName === 'string' ? config.fileName : undefined,
  };
}

function fallbackNameFromFile(fileName?: string) {
  if (!fileName) {
    return 'LMD Project';
  }
  return fileName.replace(/\.(lmd|md)$/i, '') || 'LMD Project';
}

function loadInitialMarkdown(host: HostConfig) {
  if (host.platform === 'vscode' && host.initialMarkdown?.trim()) {
    return host.initialMarkdown;
  }
  try {
    const saved = localStorage.getItem(storageKeys.project);
    if (saved?.trim()) {
      return saved;
    }
  } catch {
    // ignore
  }
  return sampleProjectMarkdown;
}

const HOST_CONFIG = readHostConfig();

function acquireVsCodeApi(): VsCodeApiLike | null {
  const acquire = (window as Window & { acquireVsCodeApi?: () => VsCodeApiLike }).acquireVsCodeApi;
  return typeof acquire === 'function' ? acquire() : null;
}

function selectionForHost(selection: StageSelection, document: GraphDocument) {
  if (selection.kind === 'none') {
    return { kind: 'none' as const };
  }
  if (selection.kind === 'node') {
    return { kind: 'node' as const, nodeIds: selection.ids };
  }
  if (selection.kind === 'group') {
    return { kind: 'subgraph' as const, subgraphIds: selection.ids };
  }
  return {
    kind: 'edge' as const,
    edges: selection.ids.flatMap((id) => {
      const edge = document.edges.find((entry) => entry.id === id);
      return edge ? [{ from: edge.from, to: edge.to, label: edge.label }] : [];
    }),
  };
}

function parseSafe(markdown: string, fallbackName = 'LMD Project'): GraphDocument {
  try {
    return parseProjectMarkdown(markdown, fallbackName, createDefaultLayout());
  } catch (error) {
    console.warn('[FlowApp] parse failed, using empty flowchart', error);
    return parseProjectMarkdown(
      `# ${fallbackName}\n\n## Summary\n\n\n## Diagram\n\`\`\`mermaid\nflowchart LR\n  Start[Start]\n\`\`\`\n\n## Content\n\n`,
      fallbackName,
      createDefaultLayout(),
    );
  }
}

function documentToMarkdown(document: GraphDocument) {
  return flowPerfMeasure('shell.documentToMarkdown', 'shell/documentToMarkdown', () =>
    serializeProjectMarkdown({
      projectName: document.projectName || 'LMD Project',
      projectSummary: document.projectSummary || '',
      prefixMarkdown: document.prefixMarkdown,
      contentMarkdown: document.contentMarkdown ?? '',
      mermaidSource:
        document.source ||
        serializeMermaidDocument(
          document.direction,
          document.nodes,
          document.edges,
          document.subgraphs,
          document.unsupportedLines,
        ),
      compat: documentToCompat(document),
      nodes: document.nodes,
      subgraphs: document.subgraphs,
    }),
  );
}

export default function FlowApp() {
  const vscodeApiRef = useRef<VsCodeApiLike | null>(null);
  const lastVsCodeSyncedRef = useRef(
    HOST_CONFIG.platform === 'vscode' ? HOST_CONFIG.initialMarkdown ?? '' : '',
  );
  const inspectorHistoryArmedRef = useRef(true);
  const inspectorHistoryTimerRef = useRef<number | null>(null);
  const hostFileNameRef = useRef(HOST_CONFIG.fileName);
  const clipboardRef = useRef<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);

  const [mode, setMode] = useState<ShellMode>('canvas');
  const [document, setDocument] = useState<GraphDocument>(() =>
    parseSafe(
      loadInitialMarkdown(HOST_CONFIG),
      fallbackNameFromFile(HOST_CONFIG.fileName),
    ),
  );
  const [revision, setRevision] = useState(1);
  const [sourceDraft, setSourceDraft] = useState(() => documentToMarkdown(document));
  const [selection, setSelection] = useState<StageSelection>({ kind: 'none' });
  const [savePulse, setSavePulse] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const [viewportInfo, setViewportInfo] = useState<ViewportInfo | null>(null);
  const [past, setPast] = useState<GraphDocument[]>([]);
  const [future, setFuture] = useState<GraphDocument[]>([]);
  const persistTimerRef = useRef<number | null>(null);
  const documentRef = useRef(document);

  const isVsCodeHost = HOST_CONFIG.platform === 'vscode';

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  const projectLabel = document.projectName || 'LMD Project';
  const selectedSummary = useMemo(() => {
    if (selection.kind === 'none') {
      return '未选中';
    }
    if (selection.kind === 'node') {
      const node = document.nodes.find((entry) => entry.id === selection.ids[0]);
      if (!node) {
        return `${selection.ids.length} 个节点`;
      }
      const parts = splitEntityText(node.label);
      return selection.ids.length > 1
        ? `${selection.ids.length} 个节点`
        : parts.title || node.id;
    }
    if (selection.kind === 'group') {
      const group = document.subgraphs.find((entry) => entry.id === selection.ids[0]);
      return selection.ids.length > 1
        ? `${selection.ids.length} 个分组`
        : group?.title || selection.ids[0];
    }
    const edge = document.edges.find((entry) => entry.id === selection.ids[0]);
    return selection.ids.length > 1
      ? `${selection.ids.length} 条连线`
      : edge?.label || `${edge?.from} → ${edge?.to}`;
  }, [document.edges, document.nodes, document.subgraphs, selection]);

  const persistMarkdown = useCallback((markdown: string) => {
    setSavePulse('saving');
    if (HOST_CONFIG.platform === 'vscode' && !vscodeApiRef.current) {
      vscodeApiRef.current = acquireVsCodeApi();
    }
    if (vscodeApiRef.current) {
      if (markdown !== lastVsCodeSyncedRef.current) {
        vscodeApiRef.current.postMessage({
          type: 'lmd/updateDocument',
          markdown,
        });
        lastVsCodeSyncedRef.current = markdown;
      }
    } else {
      flowPerfMeasure('shell.localStorage', 'shell/localStorage.setItem', () => {
        try {
          localStorage.setItem(storageKeys.project, markdown);
        } catch {
          // ignore
        }
      });
    }
    window.setTimeout(() => setSavePulse('saved'), 120);
    window.setTimeout(() => setSavePulse('idle'), 1200);
  }, []);

  const schedulePersist = useCallback(
    (next: GraphDocument, syncSource: boolean) => {
      const markdown = documentToMarkdown(next);
      if (syncSource) {
        setSourceDraft(markdown);
      }
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
      }
      persistTimerRef.current = window.setTimeout(() => {
        persistMarkdown(markdown);
      }, 280);
    },
    [persistMarkdown],
  );

  const pushHistory = useCallback((previous: GraphDocument) => {
    setPast((stack) => [...stack.slice(-(MAX_HISTORY - 1)), previous]);
    setFuture([]);
  }, []);

  /** Canvas stage commits: no external remount. History only when graph body changes. */
  const handleCanvasDocumentChange = useCallback(
    (next: GraphDocument) => {
      const current = documentRef.current;
      const structural =
        current.nodes.length !== next.nodes.length ||
        current.edges.length !== next.edges.length ||
        current.subgraphs.length !== next.subgraphs.length ||
        current.source !== next.source ||
        current.nodes.some((node, index) => {
          const other = next.nodes[index];
          return (
            !other ||
            node.id !== other.id ||
            Math.abs(node.x - other.x) > 0.5 ||
            Math.abs(node.y - other.y) > 0.5
          );
        });
      if (structural) {
        pushHistory(current);
      }
      setDocument(next);
      // Stage owns interactive state — do NOT bump revision on canvas commits.
      schedulePersist(next, true);
    },
    [pushHistory, schedulePersist],
  );

  /** Structural edits from shell (toolbar / open / layout): reload stage from document. */
  const commitExternal = useCallback(
    (next: GraphDocument, options?: { history?: boolean; syncSource?: boolean }) => {
      if (options?.history !== false) {
        pushHistory(documentRef.current);
      }
      setDocument(next);
      setRevision((value) => value + 1);
      schedulePersist(next, options?.syncSource !== false);
    },
    [pushHistory, schedulePersist],
  );

  /** Inspector / meta patches: keep the live camera, do not remount the stage. */
  const commitWorking = useCallback(
    (next: GraphDocument, options?: { history?: boolean; syncSource?: boolean }) => {
      if (options?.history !== false) {
        pushHistory(documentRef.current);
      }
      setDocument(next);
      schedulePersist(next, options?.syncSource !== false);
    },
    [pushHistory, schedulePersist],
  );

  const commitInspectorPatch = useCallback(
    (next: GraphDocument) => {
      const recordHistory = inspectorHistoryArmedRef.current;
      inspectorHistoryArmedRef.current = false;
      if (inspectorHistoryTimerRef.current !== null) {
        window.clearTimeout(inspectorHistoryTimerRef.current);
      }
      inspectorHistoryTimerRef.current = window.setTimeout(() => {
        inspectorHistoryArmedRef.current = true;
        inspectorHistoryTimerRef.current = null;
      }, 700);
      commitWorking(next, { history: recordHistory });
    },
    [commitWorking],
  );

  const loadExternalDocument = useCallback(
    (next: GraphDocument, options?: { syncSource?: boolean; history?: boolean; persist?: boolean }) => {
      if (options?.history !== false) {
        pushHistory(documentRef.current);
      }
      setDocument(next);
      setRevision((value) => value + 1);
      setFuture([]);
      if (options?.persist === false) {
        if (options.syncSource !== false) {
          setSourceDraft(documentToMarkdown(next));
        }
        return;
      }
      schedulePersist(next, options?.syncSource !== false);
    },
    [pushHistory, schedulePersist],
  );

  const undo = useCallback(() => {
    setPast((stack) => {
      if (stack.length === 0) {
        return stack;
      }
      const previous = stack[stack.length - 1];
      setFuture((nextFuture) => [documentRef.current, ...nextFuture].slice(0, MAX_HISTORY));
      setDocument(previous);
      setRevision((value) => value + 1);
      schedulePersist(previous, true);
      return stack.slice(0, -1);
    });
  }, [schedulePersist]);

  const redo = useCallback(() => {
    setFuture((stack) => {
      if (stack.length === 0) {
        return stack;
      }
      const [next, ...rest] = stack;
      setPast((prev) => [...prev, documentRef.current].slice(-MAX_HISTORY));
      setDocument(next);
      setRevision((value) => value + 1);
      schedulePersist(next, true);
      return rest;
    });
  }, [schedulePersist]);

  const applySourceDraft = useCallback(() => {
    try {
      const parsed = flowPerfMeasure('shell.parseProjectMarkdown', 'shell/parseProjectMarkdown', () =>
        parseProjectMarkdown(
          sourceDraft,
          document.projectName || 'LMD Project',
          document.layout,
        ),
      );
      loadExternalDocument(parsed, { syncSource: false });
      setMode('canvas');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '源码解析失败');
    }
  }, [document.layout, document.projectName, loadExternalDocument, sourceDraft]);

  const createNode = useCallback(() => {
    window.dispatchEvent(new CustomEvent('lmd-flow:create-node'));
  }, []);

  const deleteSelection = useCallback(() => {
    if (selection.kind === 'none') {
      return;
    }
    window.dispatchEvent(new CustomEvent('lmd-flow:delete-selection'));
  }, [selection.kind]);

  const fitView = useCallback(() => {
    window.dispatchEvent(new CustomEvent('lmd-flow:fit-view'));
  }, []);

  const exportPng = useCallback(() => {
    window.dispatchEvent(new CustomEvent('lmd-flow:export-png'));
  }, []);

  const selectAll = useCallback(() => {
    window.dispatchEvent(new CustomEvent('lmd-flow:select-all'));
  }, []);

  const connectSelection = useCallback(() => {
    if (selection.kind !== 'node' || selection.ids.length < 2) {
      return;
    }
    window.dispatchEvent(new CustomEvent('lmd-flow:connect-selection'));
  }, [selection]);

  const focusOutlineSelection = useCallback((sel: StageSelection) => {
    setSelection(sel);
    setInspectorOpen(true);
    window.dispatchEvent(
      new CustomEvent('lmd-flow:focus-selection', { detail: sel }),
    );
  }, []);

  const exportMarkdown = useCallback(() => {
    const markdown = documentToMarkdown(document);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `${projectLabel.replace(/\s+/g, '_') || 'project'}.lmd`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [document, projectLabel]);

  const openLocalFile = useCallback(() => {
    const input = window.document.createElement('input');
    input.type = 'file';
    input.accept = '.lmd,.md,text/markdown,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      const text = await file.text();
      try {
        const parsed = parseProjectMarkdown(
          text,
          file.name.replace(/\.(lmd|md)$/i, ''),
          createDefaultLayout(),
        );
        loadExternalDocument(parsed);
        setMode('canvas');
      } catch (error) {
        window.alert(error instanceof Error ? error.message : '无法打开文件');
      }
    };
    input.click();
  }, [loadExternalDocument]);

  const loadSample = useCallback(() => {
    loadExternalDocument(parseSafe(sampleProjectMarkdown));
    setMode('canvas');
  }, [loadExternalDocument]);

  const groupSelection = useCallback(() => {
    if (selection.kind !== 'node' || selection.ids.length < 2) {
      return;
    }
    const { document: next } = groupNodesInDocument(document, selection.ids);
    commitExternal(next);
    setSelection({ kind: 'none' });
  }, [commitExternal, document, selection]);

  const ungroupSelection = useCallback(() => {
    if (selection.kind !== 'group' || selection.ids.length === 0) {
      return;
    }
    commitExternal(ungroupNodesInDocument(document, selection.ids));
    setSelection({ kind: 'none' });
  }, [commitExternal, document, selection]);

  const duplicateSelection = useCallback(() => {
    if (selection.kind !== 'node' || selection.ids.length === 0) {
      return;
    }
    const { document: next, newIds } = duplicateNodesInDocument(document, selection.ids);
    commitExternal(next);
    setSelection({ kind: 'node', ids: newIds });
  }, [commitExternal, document, selection]);

  const copySelection = useCallback(() => {
    if (selection.kind !== 'node' || selection.ids.length === 0) {
      return;
    }
    const ids = new Set(selection.ids);
    clipboardRef.current = {
      nodes: document.nodes.filter((node) => ids.has(node.id)).map((node) => ({ ...node })),
      edges: document.edges
        .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
        .map((edge) => ({ ...edge })),
    };
  }, [document.edges, document.nodes, selection]);

  const pasteSelection = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard || clipboard.nodes.length === 0) {
      return;
    }
    const { document: next, newIds } = pasteClonedNodesInDocument(
      document,
      clipboard.nodes,
      clipboard.edges,
    );
    commitExternal(next);
    setSelection({ kind: 'node', ids: newIds });
  }, [commitExternal, document]);

  const runAutoLayout = useCallback(() => {
    commitExternal(autoLayoutDocument(document));
    window.setTimeout(() => fitView(), 40);
  }, [commitExternal, document, fitView]);

  const runTidyLayout = useCallback(() => {
    commitExternal(tidyLayoutDocument(document));
    window.setTimeout(() => fitView(), 40);
  }, [commitExternal, document, fitView]);

  const runStandardize = useCallback(() => {
    try {
      const markdown = documentToMarkdown(document);
      const next = standardizeProjectMarkdown(
        markdown,
        document.projectName || 'LMD Project',
        document.layout,
      );
      commitExternal(next);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '标准化失败');
    }
  }, [commitExternal, document]);

  const onPatchNode = useCallback(
    (nodeId: string, patch: Parameters<typeof updateNodeInDocument>[2]) => {
      commitInspectorPatch(updateNodeInDocument(document, nodeId, patch));
    },
    [commitInspectorPatch, document],
  );
  const onPatchEdge = useCallback(
    (edgeId: string, patch: Parameters<typeof updateEdgeInDocument>[2]) => {
      commitInspectorPatch(updateEdgeInDocument(document, edgeId, patch));
    },
    [commitInspectorPatch, document],
  );
  const onPatchGroup = useCallback(
    (subgraphId: string, patch: Parameters<typeof updateSubgraphInDocument>[2]) => {
      commitInspectorPatch(updateSubgraphInDocument(document, subgraphId, patch));
    },
    [commitInspectorPatch, document],
  );
  const onPatchProject = useCallback(
    (patch: Parameters<typeof updateProjectMeta>[1]) => {
      commitInspectorPatch(updateProjectMeta(document, patch));
    },
    [commitInspectorPatch, document],
  );

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return [] as Array<{ kind: 'node' | 'group'; id: string; label: string; meta: string }>;
    }
    const groups = document.subgraphs.flatMap((subgraph) => {
      const haystack = `${subgraph.id} ${subgraph.title}`.toLowerCase();
      if (!haystack.includes(query)) {
        return [];
      }
      return [{
        kind: 'group' as const,
        id: subgraph.id,
        label: subgraph.title,
        meta: subgraph.id,
      }];
    });
    const nodes = document.nodes.flatMap((node) => {
      const parts = splitEntityText(node.label);
      const haystack = `${node.id} ${parts.title} ${parts.description}`.toLowerCase();
      if (!haystack.includes(query)) {
        return [];
      }
      return [{
        kind: 'node' as const,
        id: node.id,
        label: parts.title || node.id,
        meta: parts.description || node.id,
      }];
    });
    return [...groups, ...nodes].slice(0, 12);
  }, [document.nodes, document.subgraphs, searchQuery]);

  const closeSearch = useCallback((restoreViewport = false) => {
    if (restoreViewport && searchViewportRef.current) {
      window.dispatchEvent(new CustomEvent('lmd-flow:set-viewport', {
        detail: searchViewportRef.current,
      }));
    }
    searchViewportRef.current = null;
    setSearchOpen(false);
    setSearchQuery('');
    setSearchIndex(0);
  }, []);

  const focusSearchResult = useCallback((index: number) => {
    const result = searchResults[index];
    if (!result) {
      return;
    }
    const sel: StageSelection = result.kind === 'group'
      ? { kind: 'group', ids: [result.id] }
      : { kind: 'node', ids: [result.id] };
    focusOutlineSelection(sel);
  }, [focusOutlineSelection, searchResults]);

  const openCanvasSearch = useCallback(() => {
    if (!searchOpen) {
      searchViewportRef.current = { ...documentRef.current.layout.viewport };
    }
    setSearchOpen(true);
    setSearchIndex(0);
    window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
  }, [searchOpen]);

  const openHostSource = useCallback(() => {
    vscodeApiRef.current?.postMessage({
      type: 'lmd/openSource',
      selection: selectionForHost(selection, document),
    });
  }, [document, selection]);

  const goToSource = useCallback(() => {
    if (HOST_CONFIG.platform === 'vscode') {
      openHostSource();
      return;
    }
    setSourceDraft(documentToMarkdown(documentRef.current));
    setMode('source');
  }, [openHostSource]);

  const createRelatedFromSelection = useCallback((relation: 'linked' | 'sibling' | 'mirrored') => {
    if (selection.kind !== 'node' || selection.ids.length === 0) {
      return;
    }
    const { document: next, newIds } = createRelatedNodesInDocument(document, selection.ids, relation);
    commitExternal(next);
    setSelection({ kind: 'node', ids: newIds });
    setInspectorOpen(true);
    window.setTimeout(() => {
      const field = window.document.querySelector<HTMLInputElement>('[data-inspector="node-title"]');
      field?.focus();
      field?.select();
    }, 0);
  }, [commitExternal, document, selection]);

  const beginInlineEdit = useCallback(() => {
    setInspectorOpen(true);
    window.setTimeout(() => {
      const selector =
        selection.kind === 'edge'
          ? '[data-inspector="edge-label"]'
          : selection.kind === 'group'
            ? '[data-inspector="group-title"]'
            : '[data-inspector="node-description"]';
      const field = window.document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
        ?? window.document.querySelector<HTMLInputElement>('[data-inspector="node-title"]');
      field?.focus();
      field?.select();
    }, 0);
  }, [selection.kind]);

  const onNodeDoubleClick = useCallback(
    (nodeId: string) => {
      setSelection({ kind: 'node', ids: [nodeId] });
      setInspectorOpen(true);
      window.setTimeout(() => {
        const field = window.document.querySelector<HTMLTextAreaElement>('[data-inspector="node-description"]');
        field?.focus();
        field?.select();
      }, 0);
    },
    [],
  );

  // Keyboard shortcuts (matches footer / interaction guide)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable),
      );
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (helpOpen && event.key !== 'Escape') {
        return;
      }

      if (typing) {
        if (mod && key === 'f' && mode === 'canvas') {
          event.preventDefault();
          openCanvasSearch();
        }
        return;
      }

      if (mod && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && key === 'c') {
        event.preventDefault();
        copySelection();
        return;
      }
      if (mod && key === 'v') {
        event.preventDefault();
        pasteSelection();
        return;
      }
      if (mod && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('lmd-flow:zoom-in'));
        return;
      }
      if (mod && (event.key === '-' || event.key === '_')) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('lmd-flow:zoom-out'));
        return;
      }
      if (mod && event.key === '0') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('lmd-flow:zoom-reset'));
        return;
      }
      if (mod && key === 'd') {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod && key === 'g') {
        event.preventDefault();
        groupSelection();
        return;
      }
      if (mod && key === 'a') {
        event.preventDefault();
        selectAll();
        return;
      }
      if (mod && key === 'l') {
        event.preventDefault();
        connectSelection();
        return;
      }
      if (mod && key === 's') {
        event.preventDefault();
        schedulePersist(documentRef.current, true);
        setSavePulse('saved');
        return;
      }
      if (mod && key === '/') {
        event.preventDefault();
        setHelpOpen((value) => !value);
        return;
      }
      if (mod && key === 'f' && mode === 'canvas') {
        event.preventDefault();
        openCanvasSearch();
        return;
      }
      if (mod && event.key === '1') {
        event.preventDefault();
        setMode('canvas');
        return;
      }
      if (mod && (event.key === '2' || key === 'e')) {
        event.preventDefault();
        goToSource();
        return;
      }
      if (event.shiftKey && !mod && key === 'e' && selection.kind !== 'none') {
        event.preventDefault();
        goToSource();
        return;
      }
      if (event.key === 'Tab' && selection.kind === 'node' && selection.ids.length > 0) {
        event.preventDefault();
        createRelatedFromSelection(event.shiftKey ? 'mirrored' : 'linked');
        return;
      }
      if (event.code === 'Space' && selection.kind === 'node' && selection.ids.length === 1) {
        event.preventDefault();
        createRelatedFromSelection('sibling');
        return;
      }
      if (event.key === 'Enter' && selection.kind !== 'none') {
        event.preventDefault();
        beginInlineEdit();
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        // Engine also listens; shell covers cases when focus is outside canvas.
        if (selection.kind !== 'none') {
          event.preventDefault();
          deleteSelection();
        }
        return;
      }
      if (key === 'escape') {
        if (searchOpen) {
          closeSearch(true);
          return;
        }
        setSelection({ kind: 'none' });
        window.dispatchEvent(
          new CustomEvent('lmd-flow:focus-selection', {
            detail: { kind: 'none' },
          }),
        );
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    beginInlineEdit,
    closeSearch,
    connectSelection,
    copySelection,
    createRelatedFromSelection,
    deleteSelection,
    duplicateSelection,
    goToSource,
    helpOpen,
    openCanvasSearch,
    pasteSelection,
    groupSelection,
    mode,
    redo,
    schedulePersist,
    searchOpen,
    selectAll,
    selection.kind,
    undo,
  ]);

  // Stress test from HUD
  useEffect(() => {
    const onStress = (event: Event) => {
      const detail = (event as CustomEvent<{
        groupCount?: number;
        nodesPerGroup?: number;
      }>).detail ?? {};
      const markdown = flowPerfMeasure('stress.generateMarkdown', 'stress/generateMarkdown', () =>
        createStressTestProjectMarkdown({
          groupCount: detail.groupCount,
          nodesPerGroup: detail.nodesPerGroup,
        }),
      );
      const parsed = flowPerfMeasure('stress.parse', 'stress/parseProjectMarkdown', () =>
        parseSafe(markdown, 'LMD Stress Test'),
      );
      loadExternalDocument(parsed);
      setMode('canvas');
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('lmd-flow:fit-view'));
      }, 80);
    };
    window.addEventListener('lmd-flow:stress-test', onStress as EventListener);
    return () => window.removeEventListener('lmd-flow:stress-test', onStress as EventListener);
  }, [loadExternalDocument]);

  // VS Code custom-editor protocol (ready / document / updateDocument).
  useEffect(() => {
    if (HOST_CONFIG.platform === 'vscode' && !vscodeApiRef.current) {
      vscodeApiRef.current = acquireVsCodeApi();
    }
    if (!vscodeApiRef.current) {
      return undefined;
    }
    const handleHostMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || typeof payload !== 'object' || !('type' in payload)) {
        return;
      }
      if (payload.type !== 'lmd/document' || typeof payload.markdown !== 'string') {
        return;
      }
      if (payload.markdown === lastVsCodeSyncedRef.current) {
        return;
      }
      lastVsCodeSyncedRef.current = payload.markdown;
      const fileName = typeof payload.fileName === 'string' ? payload.fileName : hostFileNameRef.current;
      hostFileNameRef.current = fileName;
      try {
        const parsed = parseProjectMarkdown(
          payload.markdown,
          fallbackNameFromFile(fileName),
          createDefaultLayout(),
        );
        loadExternalDocument(parsed, { syncSource: true, history: false, persist: false });
      } catch (error) {
        console.warn('[FlowApp] host document parse failed', error);
      }
    };
    window.addEventListener('message', handleHostMessage);
    vscodeApiRef.current.postMessage({ type: 'lmd/ready' });
    return () => window.removeEventListener('message', handleHostMessage);
  }, [loadExternalDocument]);

  useEffect(() => {
    if (!vscodeApiRef.current || selection.kind === 'none') {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      vscodeApiRef.current?.postMessage({
        type: 'lmd/revealSelection',
        selection: selectionForHost(selection, documentRef.current),
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [selection]);

  // VS Code / external API bridge
  useEffect(() => {
    const api = {
      setSource(code: string) {
        setSourceDraft(code);
        try {
          const parsed = parseProjectMarkdown(
            code,
            document.projectName || 'LMD Project',
            document.layout,
          );
          loadExternalDocument(parsed, { syncSource: false });
        } catch {
          // keep draft
        }
      },
      getSource() {
        return documentToMarkdown(document);
      },
      render: async () => undefined,
      getSvg: () => null as string | null,
    };
    (window as unknown as { MermaidEditor?: typeof api }).MermaidEditor = api;
    return () => {
      delete (window as unknown as { MermaidEditor?: typeof api }).MermaidEditor;
    };
  }, [document, loadExternalDocument]);

  return (
    <div className={`flow-shell${isVsCodeHost ? ' flow-shell--vscode' : ''}${inspectorOpen ? ' has-inspector' : ''}`}>
      <header className="flow-topbar">
        <div className="flow-brand">
          <button className="flow-mark" onClick={loadSample} title="加载示例" type="button">
            LMD
          </button>
          <div className="flow-title">
            <strong>{projectLabel}</strong>
            <span>
              {document.nodes.length} 节点 · {document.edges.length} 连线 · {document.subgraphs.length} 分组
            </span>
          </div>
        </div>

        <div className="flow-toolbar" role="toolbar" aria-label="画布工具">
          {isVsCodeHost ? (
            <button className="flow-btn" onClick={openHostSource} type="button">
              源码
            </button>
          ) : (
            <>
              <button className="flow-btn" onClick={openLocalFile} type="button">打开</button>
              <button className="flow-btn" onClick={exportMarkdown} type="button">导出 LMD</button>
            </>
          )}
          <button className="flow-btn" onClick={exportPng} type="button">导出 PNG</button>
          <span className="flow-sep" />
          <button className="flow-btn" disabled={past.length === 0} onClick={undo} type="button">撤销</button>
          <button className="flow-btn" disabled={future.length === 0} onClick={redo} type="button">重做</button>
          <span className="flow-sep" />
          <button className="flow-btn" onClick={createNode} type="button">新建节点</button>
          <button
            className="flow-btn"
            disabled={selection.kind !== 'node' || selection.ids.length === 0}
            onClick={duplicateSelection}
            type="button"
          >
            复制
          </button>
          <button
            className="flow-btn"
            disabled={selection.kind !== 'node' || selection.ids.length < 2}
            onClick={groupSelection}
            type="button"
          >
            分组
          </button>
          <button
            className="flow-btn"
            disabled={selection.kind !== 'group' || selection.ids.length === 0}
            onClick={ungroupSelection}
            type="button"
          >
            解组
          </button>
          <button
            className="flow-btn"
            disabled={selection.kind !== 'node' || selection.ids.length < 2}
            onClick={connectSelection}
            title="连接选中的前两个节点 (⌘L)"
            type="button"
          >
            连线
          </button>
          <button
            className="flow-btn"
            disabled={selection.kind === 'none'}
            onClick={deleteSelection}
            type="button"
          >
            删除
          </button>
          <span className="flow-sep" />
          <button className="flow-btn" onClick={runTidyLayout} type="button">整理</button>
          <button className="flow-btn" onClick={runAutoLayout} type="button">布局</button>
          <button className="flow-btn" onClick={runStandardize} type="button">标准化</button>
          <button className="flow-btn" onClick={fitView} type="button">适应</button>
          <button className="flow-btn" onClick={selectAll} title="全选节点 (⌘A)" type="button">
            全选
          </button>
          <span className="flow-sep" />
          {isVsCodeHost ? null : (
            <>
              <button
                className={mode === 'canvas' ? 'flow-btn is-active' : 'flow-btn'}
                onClick={() => setMode('canvas')}
                type="button"
              >
                画布
              </button>
              <button
                className={mode === 'source' ? 'flow-btn is-active' : 'flow-btn'}
                onClick={() => {
                  setSourceDraft(documentToMarkdown(document));
                  setMode('source');
                }}
                type="button"
              >
                源码
              </button>
            </>
          )}
          <button
            className={inspectorOpen ? 'flow-btn is-active' : 'flow-btn'}
            onClick={() => setInspectorOpen((value) => !value)}
            type="button"
          >
            属性
          </button>
          <button
            className={helpOpen ? 'flow-btn is-active' : 'flow-btn'}
            onClick={() => setHelpOpen((value) => !value)}
            title="交互说明 (⌘/)"
            type="button"
          >
            帮助
          </button>
        </div>

        <div className="flow-status">
          <span className="flow-status__sel">{selectedSummary}</span>
          <span className={`flow-status__save flow-status__save--${savePulse}`}>
            {savePulse === 'saving' ? '保存中' : savePulse === 'saved' ? '已保存' : '就绪'}
          </span>
        </div>
      </header>

      <main className="flow-main">
        {mode === 'canvas' ? (
          <>
            <div className="flow-canvas-wrap">
              <StageCanvas
                document={document}
                externalRevision={revision}
                onDocumentChange={handleCanvasDocumentChange}
                onNodeDoubleClick={onNodeDoubleClick}
                onSelectionChange={setSelection}
                onViewportChange={setViewportInfo}
              />
              <StageMinimap document={document} viewport={viewportInfo} />
              {searchOpen ? (
                <div className="stage-search" role="search">
                  <input
                    ref={searchInputRef}
                    aria-label="查找节点或分组"
                    className="stage-search__input"
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                      setSearchIndex(0);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        closeSearch(true);
                        return;
                      }
                      if (event.key === 'Enter' && searchResults.length > 0) {
                        event.preventDefault();
                        focusSearchResult(searchIndex);
                        closeSearch();
                        return;
                      }
                      if (event.key === 'Tab' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        if (searchResults.length === 0) {
                          return;
                        }
                        const delta = event.key === 'ArrowUp' || event.shiftKey ? -1 : 1;
                        const next = (searchIndex + delta + searchResults.length) % searchResults.length;
                        setSearchIndex(next);
                        focusSearchResult(next);
                      }
                    }}
                    placeholder="查找节点 / 分组"
                    value={searchQuery}
                  />
                  {searchResults.length > 0 ? (
                    <ul className="stage-search__list">
                      {searchResults.map((result, index) => (
                        <li key={`${result.kind}-${result.id}`}>
                          <button
                            className={index === searchIndex ? 'is-active' : undefined}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setSearchIndex(index);
                              focusSearchResult(index);
                            }}
                            type="button"
                          >
                            <strong>{result.label}</strong>
                            <span>{result.kind === 'group' ? '分组' : '节点'} · {result.meta}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : searchQuery.trim() ? (
                    <div className="stage-search__empty">没有匹配项</div>
                  ) : null}
                </div>
              ) : null}
              {helpOpen ? (
                <div className="stage-help" role="dialog" aria-label="交互说明">
                  <button
                    className="stage-help__close"
                    onClick={() => setHelpOpen(false)}
                    type="button"
                  >
                    ✕
                  </button>
                  <h4>LMD 交互说明</h4>
                  <ul>
                    <li>拖拽节点 / 分组移动；空白拖出框选；Shift 框选追加</li>
                    <li>触控板双指滑动平移；捏合或 ⌃/⌘+滚轮缩放</li>
                    <li>中键 / 空格拖 = 平移；Shift+滚轮横向平移</li>
                    <li>Shift / ⌘ 点击加减选；Alt 拖节点 = 复制并拖走</li>
                    <li>选中后拖端口连线；右键拖节点连线；⌘/⌃ 连出虚线</li>
                    <li>⌘/⌃ 拖到分组上 = 编入该组；拖到空白 = 移出分组</li>
                    <li>Tab 建并连接子节点；Shift+Tab 镜像；空格建同级</li>
                    <li>Enter 编辑属性；⌘F 查找；⌘1 画布；⌘2 / ⌘E 源码</li>
                    <li>双击空白 = 新建节点；双击节点 = 打开属性；双击分组折叠</li>
                    <li>Del 删除；⌘A 全选；⌘C/V 复制粘贴；⌘D 再制；⌘G 分组</li>
                    <li>⌘+ / ⌘- / ⌘0 缩放；⌘Z / ⌘⇧Z 撤销重做；⌘S 保存</li>
                    <li>大纲 / 连线列表点击 = 选中并聚焦</li>
                    <li>右下角导航图点击 = 跳转视野</li>
                    <li>整理 / 布局 / 标准化 / 适应 / 导出 LMD·PNG</li>
                  </ul>
                </div>
              ) : null}
            </div>
            {inspectorOpen ? (
              <InspectorPanel
                document={document}
                onPatchEdge={onPatchEdge}
                onPatchGroup={onPatchGroup}
                onPatchNode={onPatchNode}
                onPatchProject={onPatchProject}
                onSelect={focusOutlineSelection}
                selection={selection}
              />
            ) : null}
          </>
        ) : (
          <div className="flow-source">
            <div className="flow-source__bar">
              <span>LMD 源码</span>
              <div className="flow-source__actions">
                <button className="flow-btn" onClick={() => setMode('canvas')} type="button">
                  取消
                </button>
                <button className="flow-btn is-active" onClick={applySourceDraft} type="button">
                  应用并返回画布
                </button>
              </div>
            </div>
            <textarea
              className="flow-source__editor"
              onChange={(event) => setSourceDraft(event.target.value)}
              spellCheck={false}
              value={sourceDraft}
            />
          </div>
        )}
      </main>

      <footer className="flow-footer">
        <span>
          双指平移 · 捏合缩放 · Tab/空格建节点 · Enter 编辑 · ⌘F 查找 · ⌘C/V · 空格/中键平移 · ⌘/ 帮助
        </span>
        <span>Canvas2D · 大纲 · 导航图 · Project Graph 路线</span>
      </footer>

      <FlowPerfHud />
    </div>
  );
}
