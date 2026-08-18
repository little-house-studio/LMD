import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createStressTestProjectMarkdown,
  sampleProjectMarkdown,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
} from '../../index';
import {
  documentToMermaid,
  documentToMeta,
  initialDocument,
  parseSafe,
  printProjectBundle,
} from '../../application/io/documentIo';
import { hydrateViewDocument } from '../../application/layout/organize';
import { resolveCanvasPolicy } from '../../domain/canvasPolicy';
import { partsOf } from '../../domain/selection';
import { placeMenuAroundAnchor } from '../../application/ui/menuAnchor';
import {
  autoLayoutDocument,
  createRelatedNodesInDocument,
  duplicateNodesInDocument,
  groupNodesInDocument,
  pasteClonedNodesInDocument,
  splitEntityText,
  tidyLayoutDocument,
  ungroupNodesInDocument,
  updateEdgeInDocument,
  updateNodeInDocument,
  updateProjectMeta,
  addMindTopicInDocument,
  addSequenceMessageInDocument,
  addSequenceParticipantInDocument,
  findMindTopic,
  findSequenceMessage,
  renameMindTopicInDocument,
  renameSequenceParticipantInDocument,
  updateMindMapInDocument,
  updateMindTopicInDocument,
  updateSequenceMessageInDocument,
  updateSequenceSceneInDocument,
  updateSubgraphInDocument,
} from '../../application/editing';
import { InspectorPanel, type InspectorPane } from '../inspector/InspectorPanel';
import { HudIcon } from '../inspector/HudIcons';
import { nodeStylePresets, shapeOptions } from '../inspector/presets';
import { sameViewport } from '../../infrastructure/hotpath/paintOpt';
import { flowPerfMeasure } from '../inspector/flowPerf';
import {
  acquireVsCodeApi,
  fallbackNameFromFile,
  readHostConfig,
  selectionForHost,
  type HostConfig,
  type VsCodeApiLike,
} from '../../infrastructure/host';
import { registerEditorLayoutBackend } from '../../infrastructure/kernel/layoutBackend';
import { readLayoutFrames, writeLayoutFrames } from '../../infrastructure/layout';
import { storageKeys } from '../../infrastructure/persistence/storage';
import { StageCanvas, type StageSelection } from '../canvas/StageCanvas';
import { StageMinimap } from '../canvas/StageMinimap';
import { resolveCanvasHotkey } from './canvasHotkeys';
import { HelpOverlay } from './HelpOverlay';
import '../../../styles.css';

type ShellMode = 'canvas' | 'source';

type ViewportInfo = {
  world: { x: number; y: number; width: number; height: number };
  view: { x: number; y: number; width: number; height: number };
  scale: number;
  canvas: { width: number; height: number };
  selectionView: { x: number; y: number; width: number; height: number } | null;
};

const MAX_HISTORY = 40;
const HOST_CONFIG = readHostConfig();
const CANVAS_POLICY = resolveCanvasPolicy(HOST_CONFIG.canvas);
registerEditorLayoutBackend();

function writeBundle(document: GraphDocument) {
  return printProjectBundle(document, CANVAS_POLICY);
}

function writeMarkdown(document: GraphDocument) {
  return writeBundle(document).relation;
}

function downloadText(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function hydrate(document: GraphDocument) {
  return hydrateViewDocument(document, CANVAS_POLICY);
}

export default function FlowApp() {
  const vscodeApiRef = useRef<VsCodeApiLike | null>(null);
  const lastVsCodeSyncedRef = useRef({
    markdown: HOST_CONFIG.platform === 'vscode' ? HOST_CONFIG.initialMarkdown ?? '' : '',
    meta: HOST_CONFIG.platform === 'vscode' ? HOST_CONFIG.initialMeta ?? '' : '',
  });
  const inspectorHistoryArmedRef = useRef(true);
  const inspectorHistoryTimerRef = useRef<number | null>(null);
  const hostFileNameRef = useRef(HOST_CONFIG.fileName);
  const clipboardRef = useRef<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);

  const [mode, setMode] = useState<ShellMode>('canvas');
  const [document, setDocument] = useState<GraphDocument>(() => initialDocument(HOST_CONFIG),
  );
  const [revision, setRevision] = useState(1);
  const [sourceDraft, setSourceDraft] = useState(() => writeMarkdown(document));
  const [selection, setSelection] = useState<StageSelection>({ kind: 'none' });
  const [savePulse, setSavePulse] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [dock, setDock] = useState<InspectorPane | 'closed'>('closed');
  const [moreOpen, setMoreOpen] = useState(false);
  const [handTool, setHandTool] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const nodeMenuRef = useRef<HTMLDivElement | null>(null);
  const [nodeMenuSize, setNodeMenuSize] = useState({ width: 360, height: 72 });
  const [helpOpen, setHelpOpen] = useState(false);
  const [frameTool, setFrameTool] = useState(false);
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
  const liveViewportRef = useRef(document.layout.viewport);

  const isVsCodeHost = HOST_CONFIG.platform === 'vscode';

  useEffect(() => {
    documentRef.current = {
      ...document,
      layout: {
        ...document.layout,
        viewport: liveViewportRef.current,
      },
    };
  }, [document]);

  const projectLabel = document.projectName || 'LMD Project';
  const selectedSummary = useMemo(() => {
    if (selection.kind === 'none') {
      return '未选中';
    }
    if (selection.kind === 'mixed') {
      return `已选 ${selection.ids.length} 项`;
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
    if (selection.kind === 'frame') {
      const frames = readLayoutFrames(document.compat?.extras as Record<string, unknown> | undefined);
      const frame = frames.find((entry) => entry.id === selection.ids[0]);
      return selection.ids.length > 1
        ? `${selection.ids.length} 个形状框`
        : frame?.title || '形状框';
    }
    if (selection.kind === 'sequence') {
      const scene = document.sequence?.scenes.find((entry) => entry.id === selection.ids[0]);
      return selection.ids.length > 1
        ? `${selection.ids.length} 个时序块`
        : scene?.title || '时序';
    }
    if (selection.kind === 'seq-actor') {
      const scene = document.sequence?.scenes.find((entry) => entry.id === selection.sceneId);
      const actor = scene?.participants.find((item) => item.id === selection.ids[0]);
      return actor?.title || '参与者';
    }
    if (selection.kind === 'seq-message') {
      const message = findSequenceMessage(document, selection.sceneId, selection.ids[0] ?? '');
      return message?.label || '消息';
    }
    if (selection.kind === 'mind') {
      const map = document.mind?.maps.find((entry) => entry.id === selection.ids[0]);
      return selection.ids.length > 1
        ? `${selection.ids.length} 个思维导图`
        : map?.title || '思维导图';
    }
    if (selection.kind === 'mind-node') {
      const topic = findMindTopic(document, selection.mapId, selection.ids[0] ?? '');
      return topic?.title || '主题';
    }
    const edge = document.edges.find((entry) => entry.id === selection.ids[0]);
    return selection.ids.length > 1
      ? `${selection.ids.length} 条连线`
      : edge?.label || `${edge?.from} → ${edge?.to}`;
  }, [document.compat?.extras, document.edges, document.mind, document.nodes, document.sequence, document.subgraphs, selection]);

  const persistBundle = useCallback((bundle: { relation: string; meta: string }) => {
    setSavePulse('saving');
    if (HOST_CONFIG.platform === 'vscode' && !vscodeApiRef.current) {
      vscodeApiRef.current = acquireVsCodeApi();
    }
    const last = lastVsCodeSyncedRef.current;
    if (vscodeApiRef.current) {
      if (bundle.relation !== last.markdown || bundle.meta !== last.meta) {
        vscodeApiRef.current.postMessage({
          type: 'lmd/updateDocument',
          markdown: bundle.relation,
          meta: bundle.meta,
        });
        lastVsCodeSyncedRef.current = { markdown: bundle.relation, meta: bundle.meta };
      }
    } else {
      flowPerfMeasure('shell.localStorage', 'shell/localStorage.setItem', () => {
        try {
          localStorage.setItem(storageKeys.project, bundle.relation);
          localStorage.setItem(storageKeys.projectMeta, bundle.meta);
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
      const bundle = writeBundle(next);
      if (syncSource) {
        setSourceDraft(bundle.relation);
      }
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
      }
      persistTimerRef.current = window.setTimeout(() => {
        persistBundle(bundle);
      }, 280);
    },
    [persistBundle],
  );

  useEffect(() => {
    schedulePersist(documentRef.current, true);
  }, [schedulePersist]);

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
      if (!structural) {
        liveViewportRef.current = next.layout.viewport;
        documentRef.current = next;
        schedulePersist(next, false);
        return;
      }
      pushHistory(current);
      const view = hydrate(next);
      liveViewportRef.current = view.layout.viewport;
      setDocument(view);
      // Stage owns interactive state — do NOT bump revision on canvas commits.
      schedulePersist(view, true);
    },
    [pushHistory, schedulePersist],
  );

  const handleViewportCommit = useCallback(
    (viewport: { x: number; y: number; zoom: number }) => {
      if (sameViewport(liveViewportRef.current, viewport)) {
        return;
      }
      liveViewportRef.current = viewport;
      const current = documentRef.current;
      const next = {
        ...current,
        layout: {
          ...current.layout,
          viewport,
        },
      };
      documentRef.current = next;
      schedulePersist(next, false);
    },
    [schedulePersist],
  );

  const withLiveViewport = useCallback((next: GraphDocument): GraphDocument => ({
    ...next,
    layout: {
      ...next.layout,
      viewport: liveViewportRef.current,
    },
  }), []);

  /** Structural edits from shell (toolbar / open / layout): reload stage from document. */
  const commitExternal = useCallback(
    (next: GraphDocument, options?: { history?: boolean; syncSource?: boolean }) => {
      if (options?.history !== false) {
        pushHistory(documentRef.current);
      }
      const view = withLiveViewport(hydrate(next));
      setDocument(view);
      setRevision((value) => value + 1);
      schedulePersist(view, options?.syncSource !== false);
    },
    [pushHistory, schedulePersist, withLiveViewport],
  );

  /** Inspector / meta patches: keep the live camera, do not remount the stage. */
  const commitWorking = useCallback(
    (next: GraphDocument, options?: { history?: boolean; syncSource?: boolean }) => {
      if (options?.history !== false) {
        pushHistory(documentRef.current);
      }
      const view = withLiveViewport(hydrate(next));
      setDocument(view);
      schedulePersist(view, options?.syncSource !== false);
    },
    [pushHistory, schedulePersist, withLiveViewport],
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
      const view = hydrate(next);
      liveViewportRef.current = view.layout.viewport;
      setDocument(view);
      setRevision((value) => value + 1);
      setFuture([]);
      if (options?.persist === false) {
        if (options.syncSource !== false) {
          setSourceDraft(writeMarkdown(view));
        }
        return;
      }
      schedulePersist(view, options?.syncSource !== false);
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
      liveViewportRef.current = previous.layout.viewport;
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
      liveViewportRef.current = next.layout.viewport;
      setDocument(next);
      setRevision((value) => value + 1);
      schedulePersist(next, true);
      return rest;
    });
  }, [schedulePersist]);

  const applySourceDraft = useCallback(() => {
    try {
      const parsed = flowPerfMeasure('shell.parseLmd', 'shell/parseLmd', () =>
        parseSafe(
          sourceDraft,
          document.projectName || 'LMD Project',
          CANVAS_POLICY,
          documentToMeta(document, CANVAS_POLICY),
        ),
      );
      loadExternalDocument(parsed, { syncSource: false });
      setMode('canvas');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '源码解析失败');
    }
  }, [document.projectName, loadExternalDocument, sourceDraft]);

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

  const exportSvg = useCallback(() => {
    window.dispatchEvent(new CustomEvent('lmd-flow:export-svg'));
  }, []);

  const selectAll = useCallback(() => {
    window.dispatchEvent(new CustomEvent('lmd-flow:select-all'));
  }, []);

  const connectSelection = useCallback(() => {
    const parts = partsOf(selection);
    if (parts.nodes.length + parts.sequences.length + parts.minds.length < 2) {
      return;
    }
    window.dispatchEvent(new CustomEvent('lmd-flow:connect-selection'));
  }, [selection]);

  const focusOutlineSelection = useCallback((sel: StageSelection) => {
    setSelection(sel);
    window.dispatchEvent(
      new CustomEvent('lmd-flow:focus-selection', { detail: sel }),
    );
  }, []);

  const toggleDock = useCallback((pane: InspectorPane) => {
    setDock((current) => (current === pane ? 'closed' : pane));
    setMoreOpen(false);
  }, []);

  const setHandMode = useCallback((on: boolean) => {
    setHandTool(on);
    if (on) {
      setFrameTool(false);
    }
    window.dispatchEvent(new CustomEvent('lmd-flow:hand-tool', { detail: { on } }));
  }, []);

  const chooseSelectTool = useCallback(() => {
    setHandMode(false);
    setFrameTool(false);
    setNodeMenuOpen(false);
  }, [setHandMode]);

  const openNodeMenu = useCallback(() => {
    setHandMode(false);
    setFrameTool(false);
    setNodeMenuOpen(true);
  }, [setHandMode]);

  const createSequence = useCallback(() => {
    setHandMode(false);
    setFrameTool(false);
    setNodeMenuOpen(false);
    window.dispatchEvent(new CustomEvent('lmd-flow:create-sequence'));
  }, [setHandMode]);

  const createMind = useCallback(() => {
    setHandMode(false);
    setFrameTool(false);
    setNodeMenuOpen(false);
    window.dispatchEvent(new CustomEvent('lmd-flow:create-mind'));
  }, [setHandMode]);

  const exportMarkdown = useCallback(() => {
    const bundle = writeBundle(documentRef.current);
    const stem = projectLabel.replace(/\s+/g, '_') || 'project';
    downloadText(`${stem}.lmd`, bundle.relation, 'text/plain;charset=utf-8');
    downloadText(`${stem}.lths`, bundle.meta, 'application/json;charset=utf-8');
  }, [projectLabel]);

  const exportMermaid = useCallback(() => {
    const stem = projectLabel.replace(/\s+/g, '_') || 'project';
    downloadText(`${stem}.mmd`, documentToMermaid(documentRef.current), 'text/plain;charset=utf-8');
  }, [projectLabel]);

  const openMermaidFile = useCallback(() => {
    const input = window.document.createElement('input');
    input.type = 'file';
    input.accept = '.mmd,.md,.lmd,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      try {
        loadExternalDocument(parseSafe(await file.text(), file.name.replace(/\.(mmd|md|lmd)$/i, ''), CANVAS_POLICY));
        setMode('canvas');
      } catch (error) {
        window.alert(error instanceof Error ? error.message : '无法导入 Mermaid');
      }
    };
    input.click();
  }, [loadExternalDocument]);

  const openLocalFile = useCallback(() => {
    const input = window.document.createElement('input');
    input.type = 'file';
    input.accept = '.lmd,.lths,.md,text/markdown,text/plain,application/json';
    input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      if (files.length === 0) {
        return;
      }
      const relationFile = files.find((file) => /\.(lmd|md)$/i.test(file.name)) ?? files[0];
      const stem = relationFile.name.replace(/\.(lmd|lths|md)$/i, '');
      const metaFile = files.find((file) => (
        file !== relationFile && (
          /\.lths$/i.test(file.name) || file.name.replace(/\.(lmd|lths|md)$/i, '') === stem
        )
      ));
      try {
        const parsed = parseSafe(
          await relationFile.text(),
          stem,
          CANVAS_POLICY,
          metaFile ? await metaFile.text() : undefined,
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
    loadExternalDocument(parseSafe(sampleProjectMarkdown, 'LMD Project', CANVAS_POLICY));
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
    commitExternal(autoLayoutDocument(document, selection, CANVAS_POLICY));
    window.setTimeout(() => fitView(), 40);
  }, [commitExternal, document, fitView, selection]);

  const reflowSelectedFrame = useCallback(() => {
    window.dispatchEvent(new CustomEvent('lmd-flow:reflow-frame'));
  }, []);

  const onPatchFrame = useCallback(
    (frameId: string, patch: { title?: string; padding?: number }) => {
      const frames = readLayoutFrames(document.compat?.extras as Record<string, unknown> | undefined);
      commitInspectorPatch(writeLayoutFrames(
        document,
        frames.map((frame) => (frame.id === frameId ? { ...frame, ...patch } : frame)),
      ));
      if (patch.padding !== undefined) {
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('lmd-flow:reflow-frame'));
        }, 0);
      }
    },
    [commitInspectorPatch, document],
  );

  const releaseSelectedFrame = useCallback(() => {
    if (selection.kind !== 'frame') {
      return;
    }
    const drop = new Set(selection.ids);
    const frames = readLayoutFrames(document.compat?.extras as Record<string, unknown> | undefined)
      .filter((frame) => !drop.has(frame.id));
    commitExternal(writeLayoutFrames(document, frames));
    setSelection({ kind: 'none' });
  }, [commitExternal, document, selection]);

  const runTidyLayout = useCallback(() => {
    commitExternal(tidyLayoutDocument(document, selection, CANVAS_POLICY));
    window.setTimeout(() => fitView(), 40);
  }, [commitExternal, document, fitView, selection]);

  const runStandardize = useCallback(() => {
    try {
      const bundle = writeBundle(document);
      commitExternal(parseSafe(
        bundle.relation,
        document.projectName || 'LMD Project',
        CANVAS_POLICY,
        bundle.meta,
      ));
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
  const onPatchSequence = useCallback(
    (sceneId: string, patch: { title?: string }) => {
      commitInspectorPatch(updateSequenceSceneInDocument(document, sceneId, patch));
    },
    [commitInspectorPatch, document],
  );
  const onPatchSequenceActor = useCallback(
    (sceneId: string, participantId: string, patch: { title?: string }) => {
      if (!patch.title) {
        return;
      }
      commitInspectorPatch(renameSequenceParticipantInDocument(document, sceneId, participantId, patch.title));
    },
    [commitInspectorPatch, document],
  );
  const onPatchSequenceMessage = useCallback(
    (sceneId: string, messageId: string, patch: { label?: string; arrow?: 'call' | 'return' }) => {
      commitInspectorPatch(updateSequenceMessageInDocument(document, sceneId, messageId, patch));
    },
    [commitInspectorPatch, document],
  );
  const onAddSequenceActor = useCallback(
    (sceneId: string) => {
      const created = addSequenceParticipantInDocument(document, sceneId);
      commitInspectorPatch(created.document);
      if (created.participantId) {
        setSelection({ kind: 'seq-actor', sceneId, ids: [created.participantId] });
      }
    },
    [commitInspectorPatch, document],
  );
  const onAddSequenceMessage = useCallback(
    (sceneId: string) => {
      const created = addSequenceMessageInDocument(document, sceneId);
      commitInspectorPatch(created.document);
      if (created.messageId) {
        setSelection({ kind: 'seq-message', sceneId, ids: [created.messageId] });
      }
    },
    [commitInspectorPatch, document],
  );
  const onPatchMind = useCallback(
    (mapId: string, patch: { title?: string }) => {
      commitInspectorPatch(updateMindMapInDocument(document, mapId, patch));
    },
    [commitInspectorPatch, document],
  );
  const onPatchMindTopic = useCallback(
    (mapId: string, topicId: string, patch: { title?: string; comment?: string }) => {
      if (patch.title) {
        commitInspectorPatch(renameMindTopicInDocument(document, mapId, topicId, patch.title));
        return;
      }
      commitInspectorPatch(updateMindTopicInDocument(document, mapId, topicId, patch));
    },
    [commitInspectorPatch, document],
  );
  const onAddMindTopic = useCallback(
    (mapId: string, parentId?: string) => {
      const created = addMindTopicInDocument(document, mapId, parentId);
      commitInspectorPatch(created.document);
      if (created.topicId) {
        setSelection({ kind: 'mind-node', mapId, ids: [created.topicId] });
      }
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
      return [] as Array<{ kind: 'node' | 'group' | 'sequence' | 'mind'; id: string; label: string; meta: string }>;
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
    const sequences = (document.sequence?.scenes ?? []).flatMap((scene) => {
      const haystack = `${scene.id} ${scene.title}`.toLowerCase();
      if (!haystack.includes(query)) {
        return [];
      }
      return [{
        kind: 'sequence' as const,
        id: scene.id,
        label: scene.title || '时序',
        meta: '时序块',
      }];
    });
    const minds = (document.mind?.maps ?? []).flatMap((map) => {
      const haystack = `${map.id} ${map.title}`.toLowerCase();
      if (!haystack.includes(query)) {
        return [];
      }
      return [{
        kind: 'mind' as const,
        id: map.id,
        label: map.title || '思维导图',
        meta: '思维导图',
      }];
    });
    return [...groups, ...nodes, ...sequences, ...minds].slice(0, 12);
  }, [document.mind, document.nodes, document.sequence, document.subgraphs, searchQuery]);

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
      : result.kind === 'sequence'
        ? { kind: 'sequence', ids: [result.id] }
        : result.kind === 'mind'
          ? { kind: 'mind', ids: [result.id] }
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
    setSourceDraft(writeMarkdown(documentRef.current));
    setMode('source');
  }, [openHostSource]);

  const createRelatedFromSelection = useCallback((relation: 'linked' | 'sibling' | 'mirrored') => {
    if (selection.kind !== 'node' || selection.ids.length === 0) {
      return;
    }
    const { document: next, newIds } = createRelatedNodesInDocument(document, selection.ids, relation);
    commitExternal(next);
    setSelection({ kind: 'node', ids: newIds });
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('lmd-flow:focus-selection', { detail: { kind: 'node', ids: newIds } }),
      );
      window.dispatchEvent(new CustomEvent('lmd-flow:inline-edit'));
    }, 0);
  }, [commitExternal, document, selection]);

  const beginInlineEdit = useCallback(() => {
    window.dispatchEvent(new CustomEvent('lmd-flow:inline-edit'));
  }, []);

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
      const action = resolveCanvasHotkey(event, {
        typing,
        helpOpen,
        mode,
        selectionKind: selection.kind,
        selectionCount: selection.kind === 'none' ? 0 : selection.ids.length,
      });
      if (action.type === 'none') {
        return;
      }
      event.preventDefault();
      if (action.type === 'undo') {
        undo();
        return;
      }
      if (action.type === 'redo') {
        redo();
        return;
      }
      if (action.type === 'copy') {
        copySelection();
        return;
      }
      if (action.type === 'paste') {
        pasteSelection();
        return;
      }
      if (action.type === 'zoom-in') {
        window.dispatchEvent(new CustomEvent('lmd-flow:zoom-in'));
        return;
      }
      if (action.type === 'zoom-out') {
        window.dispatchEvent(new CustomEvent('lmd-flow:zoom-out'));
        return;
      }
      if (action.type === 'zoom-reset') {
        window.dispatchEvent(new CustomEvent('lmd-flow:zoom-reset'));
        return;
      }
      if (action.type === 'duplicate') {
        duplicateSelection();
        return;
      }
      if (action.type === 'group') {
        groupSelection();
        return;
      }
      if (action.type === 'select-all') {
        selectAll();
        return;
      }
      if (action.type === 'connect') {
        connectSelection();
        return;
      }
      if (action.type === 'save') {
        schedulePersist(documentRef.current, true);
        setSavePulse('saved');
        return;
      }
      if (action.type === 'toggle-help') {
        setHelpOpen((value) => !value);
        setMoreOpen(false);
        return;
      }
      if (action.type === 'toggle-inspect') {
        setDock((current) => (current === 'inspect' ? 'closed' : 'inspect'));
        return;
      }
      if (action.type === 'select-tool') {
        chooseSelectTool();
        return;
      }
      if (action.type === 'hand-tool') {
        setNodeMenuOpen(false);
        setHandMode(true);
        return;
      }
      if (action.type === 'toggle-node-menu') {
        setNodeMenuOpen((open) => !open);
        return;
      }
      if (action.type === 'create-sequence') {
        createSequence();
        return;
      }
      if (action.type === 'create-mind') {
        createMind();
        return;
      }
      if (action.type === 'toggle-outline') {
        setDock((current) => (current === 'outline' ? 'closed' : 'outline'));
        return;
      }
      if (action.type === 'search') {
        openCanvasSearch();
        return;
      }
      if (action.type === 'mode-canvas') {
        setMode('canvas');
        return;
      }
      if (action.type === 'mode-source') {
        goToSource();
        return;
      }
      if (action.type === 'related') {
        createRelatedFromSelection(action.relation);
        return;
      }
      if (action.type === 'inline-edit') {
        beginInlineEdit();
        return;
      }
      if (action.type === 'delete') {
        deleteSelection();
        return;
      }
      if (moreOpen) {
        setMoreOpen(false);
        return;
      }
      if (nodeMenuOpen) {
        setNodeMenuOpen(false);
        return;
      }
      if (helpOpen) {
        setHelpOpen(false);
        return;
      }
      if (searchOpen) {
        closeSearch(true);
        return;
      }
      if (frameTool) {
        setFrameTool(false);
        return;
      }
      if (dock !== 'closed') {
        setDock('closed');
        return;
      }
      setSelection({ kind: 'none' });
      window.dispatchEvent(
        new CustomEvent('lmd-flow:focus-selection', {
          detail: { kind: 'none' },
        }),
      );
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    beginInlineEdit,
    closeSearch,
    connectSelection,
    copySelection,
    createRelatedFromSelection,
    createMind,
    createSequence,
    deleteSelection,
    duplicateSelection,
    chooseSelectTool,
    dock,
    frameTool,
    setHandMode,
    goToSource,
    helpOpen,
    moreOpen,
    nodeMenuOpen,
    openCanvasSearch,
    pasteSelection,
    groupSelection,
    mode,
    redo,
    schedulePersist,
    searchOpen,
    selectAll,
    selection.kind,
    selection.kind === 'none' ? 0 : selection.ids.length,
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
        parseSafe(markdown, 'LMD Stress Test', CANVAS_POLICY),
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
      const meta = typeof payload.meta === 'string' ? payload.meta : '';
      const last = lastVsCodeSyncedRef.current;
      if (payload.markdown === last.markdown && meta === last.meta) {
        return;
      }
      lastVsCodeSyncedRef.current = { markdown: payload.markdown, meta };
      const fileName = typeof payload.fileName === 'string' ? payload.fileName : hostFileNameRef.current;
      hostFileNameRef.current = fileName;
      try {
        const parsed = parseSafe(
          payload.markdown,
          fallbackNameFromFile(fileName),
          CANVAS_POLICY,
          meta,
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
          loadExternalDocument(
            parseSafe(code, document.projectName || 'LMD Project', CANVAS_POLICY),
            { syncSource: false },
          );
        } catch {
          // keep draft
        }
      },
      getSource() {
        return writeMarkdown(document);
      },
      render: async () => undefined,
      getSvg: () => (
        (window as unknown as { __lmdStageExportSvg?: () => string | null }).__lmdStageExportSvg?.()
        ?? null
      ),
    };
    (window as unknown as { MermaidEditor?: typeof api }).MermaidEditor = api;
    return () => {
      delete (window as unknown as { MermaidEditor?: typeof api }).MermaidEditor;
    };
  }, [document, loadExternalDocument]);

  useEffect(() => {
    if (selection.kind === 'node') {
      setNodeMenuOpen(true);
      return;
    }
    if (selection.kind !== 'none') {
      setNodeMenuOpen(false);
    }
  }, [selection.kind]);

  useEffect(() => {
    if (!moreOpen) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [moreOpen]);

  const canEditNodes = selection.kind === 'node' && selection.ids.length > 0;
  const canGroup = selection.kind === 'node' && selection.ids.length >= 2;
  const canConnect = partsOf(selection).nodes.length + partsOf(selection).sequences.length + partsOf(selection).minds.length >= 2;
  const canUngroup = selection.kind === 'group' && selection.ids.length > 0;
  const hasSelection = selection.kind !== 'none';
  const zoomPct = Math.max(5, Math.round((viewportInfo?.scale ?? 1) * 100));
  const styleNode =
    selection.kind === 'node' && selection.ids.length === 1
      ? document.nodes.find((node) => node.id === selection.ids[0]) ?? null
      : null;
  const styleEdge =
    selection.kind === 'edge' && selection.ids.length === 1
      ? document.edges.find((edge) => edge.id === selection.ids[0]) ?? null
      : null;
  const activeTool = frameTool ? 'frame' : handTool ? 'hand' : nodeMenuOpen ? 'node' : 'select';
  const nodeAnchor = canEditNodes ? viewportInfo?.selectionView ?? null : null;
  const floatNodeMenu = Boolean(nodeMenuOpen && nodeAnchor);
  const dockNodeMenu = Boolean(nodeMenuOpen && !nodeAnchor);
  const nodeMenuPlace = nodeAnchor && viewportInfo
    ? placeMenuAroundAnchor(nodeAnchor, nodeMenuSize, viewportInfo.canvas)
    : null;

  useLayoutEffect(() => {
    if (!nodeMenuRef.current) {
      return;
    }
    const box = nodeMenuRef.current.getBoundingClientRect();
    if (
      Math.abs(box.width - nodeMenuSize.width) > 1
      || Math.abs(box.height - nodeMenuSize.height) > 1
    ) {
      setNodeMenuSize({ width: box.width, height: box.height });
    }
  }, [floatNodeMenu, dockNodeMenu, selectedSummary, styleNode?.shape, nodeMenuSize.height, nodeMenuSize.width]);

  return (
    <div
      className={[
        'flow-shell',
        isVsCodeHost ? 'flow-shell--vscode' : '',
        dock !== 'closed' ? 'has-dock' : '',
        hasSelection ? 'has-selection' : '',
        mode === 'source' ? 'is-source' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="flow-canvas-wrap">
        <StageCanvas
          document={document}
          externalRevision={revision}
          frameTool={CANVAS_POLICY.tools.frames ? frameTool : false}
          policy={CANVAS_POLICY}
          onDocumentChange={handleCanvasDocumentChange}
          onViewportCommit={handleViewportCommit}
          onSelectionChange={setSelection}
          onViewportChange={setViewportInfo}
        />
        {minimapOpen ? <StageMinimap document={document} viewport={viewportInfo} /> : null}

        <div className="flow-hud">
          <div className="tl-menu flow-glass">
            <div className="flow-more" ref={moreRef}>
              <button
                aria-label="菜单"
                className={moreOpen ? 'tl-iconbtn is-active' : 'tl-iconbtn'}
                onClick={() => setMoreOpen((value) => !value)}
                type="button"
              >
                <HudIcon name="menu" />
              </button>
              {moreOpen ? (
                <div className="flow-more__menu flow-glass">
                  {isVsCodeHost ? (
                    <button onClick={() => { setMoreOpen(false); openHostSource(); }} type="button">源码</button>
                  ) : (
                    <>
                      <button onClick={() => { setMoreOpen(false); openLocalFile(); }} type="button">打开</button>
                      <button onClick={() => { setMoreOpen(false); exportMarkdown(); }} type="button">导出 LMD + LTHS</button>
                      <button onClick={() => { setMoreOpen(false); openMermaidFile(); }} type="button">打开 Mermaid</button>
                      <button onClick={() => { setMoreOpen(false); exportMermaid(); }} type="button">导出 Mermaid</button>
                    </>
                  )}
                  {isVsCodeHost ? (
                    <button onClick={() => { setMoreOpen(false); exportMermaid(); }} type="button">导出 Mermaid</button>
                  ) : null}
                  <button onClick={() => { setMoreOpen(false); exportPng(); }} type="button">导出 PNG</button>
                  <button onClick={() => { setMoreOpen(false); exportSvg(); }} type="button">导出 SVG</button>
                  {CANVAS_POLICY.tools.organize ? (
                    <button onClick={() => { setMoreOpen(false); runAutoLayout(); }} type="button">整理</button>
                  ) : null}
                  <button onClick={() => { setMoreOpen(false); runStandardize(); }} type="button">标准化</button>
                  <button onClick={() => { setMoreOpen(false); selectAll(); }} type="button">全选</button>
                  {isVsCodeHost ? null : (
                    <button
                      onClick={() => {
                        setMoreOpen(false);
                        setSourceDraft(writeMarkdown(document));
                        setMode('source');
                      }}
                      type="button"
                    >
                      源码
                    </button>
                  )}
                  <button onClick={() => { setMoreOpen(false); loadSample(); }} type="button">加载示例</button>
                  <button onClick={() => { setMoreOpen(false); toggleDock('project'); }} type="button">工程</button>
                  <button onClick={() => { setMoreOpen(false); setHelpOpen(true); }} type="button">帮助</button>
                </div>
              ) : null}
            </div>
            <button className="tl-iconbtn" disabled={past.length === 0} onClick={undo} title="撤销 ⌘Z" type="button">
              <HudIcon name="undo" />
            </button>
            <button className="tl-iconbtn" disabled={future.length === 0} onClick={redo} title="重做 ⌘⇧Z" type="button">
              <HudIcon name="redo" />
            </button>
            <button className="tl-title" onClick={() => toggleDock('project')} title={projectLabel} type="button">
              {projectLabel}
            </button>
          </div>

          <div className="tl-share flow-glass">
            <span className={`flow-status__save flow-status__save--${savePulse} flow-hide-narrow`}>
              {savePulse === 'saving' ? '保存中' : savePulse === 'saved' ? '已保存' : ''}
            </span>
            <button
              className={searchOpen ? 'tl-iconbtn is-active' : 'tl-iconbtn'}
              onClick={openCanvasSearch}
              title="查找 ⌘F"
              type="button"
            >
              <HudIcon name="search" />
            </button>
            <button
              className={dock === 'outline' ? 'tl-iconbtn is-active' : 'tl-iconbtn'}
              onClick={() => toggleDock('outline')}
              title="大纲"
              type="button"
            >
              <HudIcon name="layers" />
            </button>
          </div>

          {styleEdge && dock === 'closed' ? (
            <div className="tl-style flow-glass">
              <input
                className="tl-style__color"
                onChange={(event) => onPatchEdge(styleEdge.id, { strokeColor: event.target.value })}
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(styleEdge.strokeColor) ? styleEdge.strokeColor : '#8a8a94'}
              />
            </div>
          ) : null}

          <div className="tl-nav flow-glass">
            <button className="tl-iconbtn" onClick={() => window.dispatchEvent(new CustomEvent('lmd-flow:zoom-out'))} title="缩小" type="button">
              <HudIcon name="minus" />
            </button>
            <button className="tl-zoom" onClick={fitView} title="适应画布" type="button">
              {zoomPct}%
            </button>
            <button className="tl-iconbtn" onClick={() => window.dispatchEvent(new CustomEvent('lmd-flow:zoom-in'))} title="放大" type="button">
              <HudIcon name="plus" />
            </button>
            <button
              className={minimapOpen ? 'tl-iconbtn is-active' : 'tl-iconbtn'}
              onClick={() => setMinimapOpen((value) => !value)}
              title="导航图"
              type="button"
            >
              <HudIcon name="map" />
            </button>
          </div>

          {nodeMenuOpen ? (
              <div
                className={`tl-node-menu flow-glass${floatNodeMenu ? ' is-float' : ' is-dock'}`}
                data-side={nodeMenuPlace?.side}
                onPointerDown={(event) => event.stopPropagation()}
                ref={nodeMenuRef}
                role="menu"
                aria-label="节点功能"
                style={floatNodeMenu && nodeMenuPlace
                  ? {
                      left: nodeMenuPlace.left,
                      top: nodeMenuPlace.top,
                      ['--caret-x' as string]: `${nodeMenuPlace.caret}px`,
                    }
                  : undefined}
              >
                <div className="tl-node-menu__head">{canEditNodes ? selectedSummary : '节点'}</div>
                <div className="tl-node-menu__row">
                  <button className="tl-node-btn" onClick={createNode} title="新建" type="button">
                    <HudIcon name="node" size={16} />
                    <span>新建</span>
                  </button>
                  <button
                    className="tl-node-btn"
                    disabled={!canEditNodes}
                    onClick={() => createRelatedFromSelection('linked')}
                    title="子节点"
                    type="button"
                  >
                    <HudIcon name="child" size={16} />
                    <span>子节点</span>
                  </button>
                  <button
                    className="tl-node-btn"
                    disabled={!canEditNodes}
                    onClick={() => createRelatedFromSelection('sibling')}
                    title="同级"
                    type="button"
                  >
                    <HudIcon name="sibling" size={16} />
                    <span>同级</span>
                  </button>
                  <button
                    className="tl-node-btn"
                    disabled={!canEditNodes}
                    onClick={() => createRelatedFromSelection('mirrored')}
                    title="镜像"
                    type="button"
                  >
                    <HudIcon name="mirror" size={16} />
                    <span>镜像</span>
                  </button>
                  <button className="tl-node-btn" disabled={!canEditNodes} onClick={beginInlineEdit} title="编辑" type="button">
                    <HudIcon name="edit" size={16} />
                    <span>编辑</span>
                  </button>
                  <button className="tl-node-btn" disabled={!canEditNodes} onClick={duplicateSelection} title="复制" type="button">
                    <HudIcon name="copy" size={16} />
                    <span>复制</span>
                  </button>
                  <button className="tl-node-btn" disabled={!canGroup} onClick={groupSelection} title="分组" type="button">
                    <HudIcon name="group" size={16} />
                    <span>分组</span>
                  </button>
                  <button className="tl-node-btn" disabled={!canUngroup} onClick={ungroupSelection} title="解组" type="button">
                    <HudIcon name="ungroup" size={16} />
                    <span>解组</span>
                  </button>
                  <button className="tl-node-btn" disabled={!canConnect} onClick={connectSelection} title="连线" type="button">
                    <HudIcon name="connect" size={16} />
                    <span>连线</span>
                  </button>
                  <button className="tl-node-btn" disabled={!hasSelection} onClick={deleteSelection} title="删除" type="button">
                    <HudIcon name="trash" size={16} />
                    <span>删除</span>
                  </button>
                </div>
                <div className="tl-node-menu__row">
                  {shapeOptions.map((option) => (
                    <button
                      className={`tl-node-chip${styleNode?.shape === option.value ? ' is-active' : ''}`}
                      disabled={!styleNode}
                      key={option.value}
                      onClick={() => {
                        if (styleNode) {
                          onPatchNode(styleNode.id, { shape: option.value });
                        }
                      }}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                  <span className="tl-node-menu__gap" />
                  {nodeStylePresets.map((preset) => (
                    <button
                      className="tl-swatch"
                      key={preset.id}
                      disabled={!styleNode}
                      onClick={() => {
                        if (styleNode) {
                          onPatchNode(styleNode.id, {
                            fill: preset.fill,
                            stroke: preset.stroke,
                            textColor: preset.textColor,
                          });
                        }
                      }}
                      style={{ background: preset.fill, boxShadow: `inset 0 0 0 1.5px ${preset.stroke}` }}
                      title={preset.label}
                      type="button"
                    />
                  ))}
                </div>
              </div>
          ) : null}

          <div className="tl-toolbar-wrap">
            <div className="tl-toolbar flow-glass" role="toolbar" aria-label="工具">
              <button
                className={activeTool === 'select' ? 'tl-tool is-active' : 'tl-tool'}
                onClick={chooseSelectTool}
                title="选择 V"
                type="button"
              >
                <HudIcon name="select" size={20} />
              </button>
              <button
                className={activeTool === 'hand' ? 'tl-tool is-active' : 'tl-tool'}
                onClick={() => {
                  setNodeMenuOpen(false);
                  setHandMode(!handTool);
                }}
                title="平移 H · 空格"
                type="button"
              >
                <HudIcon name="hand" size={20} />
              </button>
              <button
                className={activeTool === 'node' ? 'tl-tool is-active has-menu' : 'tl-tool has-menu'}
                onClick={() => {
                  if (nodeMenuOpen) {
                    setNodeMenuOpen(false);
                    return;
                  }
                  openNodeMenu();
                }}
                title="节点功能 N"
                type="button"
              >
                <HudIcon name="node" size={20} />
                <HudIcon name="chevron" size={10} />
              </button>
              <button className="tl-tool" onClick={createSequence} title="时序块 Q" type="button">
                <HudIcon name="sequence" size={20} />
              </button>
              <button className="tl-tool" onClick={createMind} title="思维导图 W" type="button">
                <HudIcon name="mind" size={20} />
              </button>
              <button className="tl-tool" disabled={!canConnect} onClick={connectSelection} title="连接选中节点" type="button">
                <HudIcon name="connect" size={20} />
              </button>
              {CANVAS_POLICY.tools.organize ? (
                <button className="tl-tool" onClick={runTidyLayout} title="整理" type="button">
                  <HudIcon name="tidy" size={20} />
                </button>
              ) : null}
              <button className="tl-tool" onClick={() => setHelpOpen(true)} title="帮助 ⌘/" type="button">
                <HudIcon name="help" size={20} />
              </button>
            </div>
          </div>
        </div>

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
                      <span>{result.kind === 'group' ? '分组' : result.kind === 'sequence' ? '时序' : result.kind === 'mind' ? '导图' : '节点'} · {result.meta}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : searchQuery.trim() ? (
              <div className="stage-search__empty">没有匹配项</div>
            ) : null}
          </div>
        ) : null}

        {dock !== 'closed' ? (
          <InspectorPanel
            document={document}
            onClose={() => setDock('closed')}
            onPaneChange={setDock}
            onPatchEdge={onPatchEdge}
            onPatchFrame={onPatchFrame}
            onPatchGroup={onPatchGroup}
            onPatchNode={onPatchNode}
            onPatchProject={onPatchProject}
            onAddSequenceActor={onAddSequenceActor}
            onAddSequenceMessage={onAddSequenceMessage}
            onAddMindTopic={onAddMindTopic}
            onPatchMind={onPatchMind}
            onPatchMindTopic={onPatchMindTopic}
            onPatchSequence={onPatchSequence}
            onPatchSequenceActor={onPatchSequenceActor}
            onPatchSequenceMessage={onPatchSequenceMessage}
            onReflowFrame={reflowSelectedFrame}
            onReleaseFrame={releaseSelectedFrame}
            onSelect={focusOutlineSelection}
            pane={dock}
            selection={selection}
          />
        ) : null}

        {helpOpen ? <HelpOverlay policy={CANVAS_POLICY} onClose={() => setHelpOpen(false)} /> : null}
      </div>

      {mode === 'source' ? (
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
      ) : null}

    </div>
  );
}
