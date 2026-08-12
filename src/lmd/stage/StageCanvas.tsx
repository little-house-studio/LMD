import { useEffect, useRef } from 'react';
import type { GraphDocument } from '..';
import {
  flowPerfCount,
  flowPerfMark,
  flowPerfSetGraphStats,
} from '../flow/flowPerf';
import { StageEngine, type StageSelection } from './engine';
import './stage.css';

export type { StageSelection };

type StageCanvasProps = {
  document: GraphDocument;
  /** Bumps only for external loads (open / sample / apply source / undo / inspector). */
  externalRevision: number;
  onDocumentChange: (next: GraphDocument) => void;
  onSelectionChange?: (selection: StageSelection) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  /** Live viewport for minimap (world rect + camera). */
  onViewportChange?: (info: {
    world: { x: number; y: number; width: number; height: number };
    view: { x: number; y: number; width: number; height: number };
  }) => void;
};

/**
 * Project-Graph style host:
 * React owns shell only. StageEngine owns canvas, camera, hit-test, rAF paint.
 */
export function StageCanvas({
  document,
  externalRevision,
  onDocumentChange,
  onSelectionChange,
  onNodeDoubleClick,
  onViewportChange,
}: StageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<StageEngine | null>(null);
  const lastRevisionRef = useRef(-1);
  const skipApplyRef = useRef(false);
  const documentRef = useRef(document);
  documentRef.current = document;
  const revisionRef = useRef(externalRevision);
  revisionRef.current = externalRevision;

  const onDocumentChangeRef = useRef(onDocumentChange);
  onDocumentChangeRef.current = onDocumentChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onNodeDoubleClickRef = useRef(onNodeDoubleClick);
  onNodeDoubleClickRef.current = onNodeDoubleClick;
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  // Mount engine once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new StageEngine(documentRef.current);
    engineRef.current = engine;

    const pushViewport = (eng: StageEngine) => {
      const world = eng.contentBounds();
      if (!world) return;
      onViewportChangeRef.current?.({
        world,
        view: eng.getViewportRect(),
      });
    };

    engine.setHandlers({
      onDocumentCommit: (doc) => {
        const t0 = performance.now();
        skipApplyRef.current = true;
        onDocumentChangeRef.current(doc);
        flowPerfMark('stage.commit', 'stage/documentCommit', performance.now() - t0);
        flowPerfCount('stage.commit.events', 'stage/commit events');
        pushViewport(engine);
      },
      onSelectionChange: (sel) => {
        onSelectionChangeRef.current?.(sel);
        const selected = sel.kind === 'none' ? 0 : sel.ids.length;
        flowPerfSetGraphStats({
          nodes: engine.getPerfStats().totalNodes,
          edges: engine.getPerfStats().totalEdges,
          selected,
        });
      },
      onNodeDoubleClick: (id) => onNodeDoubleClickRef.current?.(id),
    });
    engine.attach(canvas);

    lastRevisionRef.current = revisionRef.current;
    engine.ensureContentInView();

    const hudTimer = window.setInterval(() => {
      const s = engine.getPerfStats();
      const sel = engine.getSelection();
      flowPerfSetGraphStats({
        nodes: s.totalNodes,
        edges: s.totalEdges,
        selected: sel.kind === 'none' ? 0 : sel.ids.length,
      });
      if (s.paintMs > 0) {
        flowPerfMark('stage.paint', 'stage/paintMs', s.paintMs);
      }
      flowPerfMark('stage.frame', 'stage/frameInterval', s.frameMs);
      pushViewport(engine);
    }, 250);

    const onCreate = () => engine.createNodeAtViewCenter();
    const onDelete = () => engine.deleteSelection();
    const onFit = () => engine.fitView();
    const onSelectAll = () => engine.selectAll();
    const onConnect = () => engine.connectSelection();
    const onFocus = (event: Event) => {
      const detail = (event as CustomEvent<StageSelection>).detail;
      if (detail) {
        engine.applySelection(detail, { focus: true });
      } else {
        engine.focusSelection();
      }
    };
    const onCenterWorld = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number }>).detail;
      if (detail) {
        engine.centerOnWorld(detail);
      }
    };
    const onExportPng = () => {
      const url = engine.exportPng();
      if (!url) return;
      const a = window.document.createElement('a');
      a.href = url;
      a.download = 'lmd-canvas.png';
      a.click();
    };
    const onZoomIn = () => engine.zoomAtViewCenter(1.5);
    const onZoomOut = () => engine.zoomAtViewCenter(1 / 1.5);
    const onZoomReset = () => engine.resetViewport();
    const onSetViewport = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number; zoom: number }>).detail;
      if (detail) {
        engine.setViewportState(detail);
      }
    };

    window.addEventListener('lmd-flow:create-node', onCreate);
    window.addEventListener('lmd-flow:delete-selection', onDelete);
    window.addEventListener('lmd-flow:fit-view', onFit);
    window.addEventListener('lmd-flow:export-png', onExportPng);
    window.addEventListener('lmd-flow:select-all', onSelectAll);
    window.addEventListener('lmd-flow:connect-selection', onConnect);
    window.addEventListener('lmd-flow:focus-selection', onFocus as EventListener);
    window.addEventListener('lmd-flow:center-world', onCenterWorld as EventListener);
    window.addEventListener('lmd-flow:zoom-in', onZoomIn);
    window.addEventListener('lmd-flow:zoom-out', onZoomOut);
    window.addEventListener('lmd-flow:zoom-reset', onZoomReset);
    window.addEventListener('lmd-flow:set-viewport', onSetViewport as EventListener);

    pushViewport(engine);

    return () => {
      window.clearInterval(hudTimer);
      window.removeEventListener('lmd-flow:create-node', onCreate);
      window.removeEventListener('lmd-flow:delete-selection', onDelete);
      window.removeEventListener('lmd-flow:fit-view', onFit);
      window.removeEventListener('lmd-flow:export-png', onExportPng);
      window.removeEventListener('lmd-flow:select-all', onSelectAll);
      window.removeEventListener('lmd-flow:connect-selection', onConnect);
      window.removeEventListener('lmd-flow:focus-selection', onFocus as EventListener);
      window.removeEventListener('lmd-flow:center-world', onCenterWorld as EventListener);
      window.removeEventListener('lmd-flow:zoom-in', onZoomIn);
      window.removeEventListener('lmd-flow:zoom-out', onZoomOut);
      window.removeEventListener('lmd-flow:zoom-reset', onZoomReset);
      window.removeEventListener('lmd-flow:set-viewport', onSetViewport as EventListener);
      engine.detach();
      engineRef.current = null;
    };
  }, []);

  // Hydrate only on external revision bump. Same-revision shell patches
  // (inspector) update the working doc without remounting the camera.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (lastRevisionRef.current === externalRevision) {
      if (skipApplyRef.current) {
        skipApplyRef.current = false;
        return;
      }
      engine.applyWorkingDocument(document);
      return;
    }
    lastRevisionRef.current = externalRevision;
    const t0 = performance.now();
    engine.loadDocument(document, {
      restoreViewport: true,
      fit: 'if-needed',
    });
    flowPerfMark('stage.hydrate', 'stage/loadDocument', performance.now() - t0);
    flowPerfSetGraphStats({
      nodes: document.nodes.length,
      edges: document.edges.length,
      selected: 0,
    });
  }, [document, externalRevision]);

  return (
    <div className="stage-root">
      <canvas className="stage-canvas" ref={canvasRef} />
      <div className="stage-hint" aria-hidden>
        双指平移 · 捏合缩放 · 中键/空格平移 · Shift加减选 · Alt拖复制 · 端口/右键连线 · Tab建节点
      </div>
    </div>
  );
}
