import { useEffect, useRef, useState } from 'react';
import type { GraphDocument } from '../..';
import {
  flowPerfCount,
  flowPerfMark,
  flowPerfSetGraphStats,
} from '../inspector/flowPerf';
import { DEFAULT_CANVAS_POLICY, positionsLocked, type CanvasPolicy } from '../../domain/canvasPolicy';
import { StageEngine, type StageInlineEdit, type StageSelection } from './engine';
import { StageInlineEditor } from './StageInlineEditor';
import './stage.css';

export type { StageInlineEdit, StageSelection };

type StageCanvasProps = {
  document: GraphDocument;
  /** Bumps only for external loads (open / sample / apply source / undo / inspector). */
  externalRevision: number;
  onDocumentChange: (next: GraphDocument) => void;
  /** Pan/zoom persist — must not hydrate or remount the stage. */
  onViewportCommit?: (viewport: { x: number; y: number; zoom: number }) => void;
  onSelectionChange?: (selection: StageSelection) => void;
  /** Live viewport for minimap (world rect + camera). */
  onViewportChange?: (info: {
    world: { x: number; y: number; width: number; height: number };
    view: { x: number; y: number; width: number; height: number };
    scale: number;
    canvas: { width: number; height: number };
    selectionView: { x: number; y: number; width: number; height: number } | null;
  }) => void;
  /** Draw a persistent layout frame instead of a one-shot box select. */
  frameTool?: boolean;
  /** Host canvas contract. Default is free + tile snap. */
  policy?: CanvasPolicy;
};

/**
 * Project-Graph style host:
 * React owns shell only. StageEngine owns canvas, camera, hit-test, rAF paint.
 */
export function StageCanvas({
  document,
  externalRevision,
  onDocumentChange,
  onViewportCommit,
  onSelectionChange,
  onViewportChange,
  frameTool = false,
  policy = DEFAULT_CANVAS_POLICY,
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
  const onViewportCommitRef = useRef(onViewportCommit);
  onViewportCommitRef.current = onViewportCommit;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const viewportSigRef = useRef('');
  const [inlineEdit, setInlineEdit] = useState<StageInlineEdit | null>(null);
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
      const selectionView = eng.selectionViewRect();
      const sig = `${eng.camera.offsetX.toFixed(1)},${eng.camera.offsetY.toFixed(1)},${eng.camera.scale.toFixed(3)},${selectionView?.x ?? 0},${selectionView?.y ?? 0}`;
      if (sig === viewportSigRef.current) {
        return;
      }
      viewportSigRef.current = sig;
      onViewportChangeRef.current?.({
        world,
        view: eng.getViewportRect(),
        scale: eng.camera.scale,
        canvas: eng.getCanvasSize(),
        selectionView,
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
      onViewportCommit: (viewport) => {
        onViewportCommitRef.current?.(viewport);
        pushViewport(engine);
      },
      onSelectionChange: (sel) => {
        onSelectionChangeRef.current?.(sel);
        pushViewport(engine);
        const selected = sel.kind === 'none' ? 0 : sel.ids.length;
        flowPerfSetGraphStats({
          nodes: engine.getPerfStats().totalNodes,
          edges: engine.getPerfStats().totalEdges,
          selected,
        });
      },
      onInlineEdit: (edit) => setInlineEdit(edit),
    });
    engine.attach(canvas);
    engine.setPolicy(policy);
    engine.setFrameTool(positionsLocked(policy) ? false : frameTool);

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
      const live = engine.peekInlineEditView();
      if (live) {
        setInlineEdit((current) => (
          current
            ? {
                ...current,
                viewRect: live.viewRect,
                fontSize: live.fontSize,
                companion: current.companion && live.companion
                  ? {
                      ...current.companion,
                      viewRect: live.companion.viewRect,
                      fontSize: live.companion.fontSize,
                    }
                  : current.companion,
              }
            : current
        ));
      }
    }, 250);

    const onCreate = () => engine.createNodeAtViewCenter();
    const onCreateSequence = () => engine.createSequenceAtViewCenter();
    const onCreateMind = () => engine.createMindAtViewCenter();
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
    const onExportSvg = () => {
      const markup = engine.exportSvg();
      if (!markup) return;
      const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
      const a = window.document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'lmd-canvas.svg';
      a.click();
      URL.revokeObjectURL(a.href);
    };
    const stageDebug = window as unknown as {
      __lmdStageExportSvg?: () => string | null;
      __lmdStageNodeViews?: () => ReturnType<StageEngine['nodeViewBands']>;
    };
    stageDebug.__lmdStageExportSvg = () => engine.exportSvg();
    stageDebug.__lmdStageNodeViews = () => engine.nodeViewBands();
    const onZoomIn = () => engine.zoomAtViewCenter(1.5);
    const onZoomOut = () => engine.zoomAtViewCenter(1 / 1.5);
    const onZoomReset = () => engine.resetViewport();
    const onSetViewport = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number; zoom: number }>).detail;
      if (detail) {
        engine.setViewportState(detail);
      }
    };
    const onWrapFrame = () => engine.wrapSelectionInFrame();
    const onReflowFrame = () => engine.reflowSelectedFrame();
    const onInlineEdit = () => engine.startInlineEditForSelection();
    const onHandTool = (event: Event) => {
      const on = Boolean((event as CustomEvent<{ on?: boolean }>).detail?.on);
      engine.setPanLocked(on);
    };

    window.addEventListener('lmd-flow:create-node', onCreate);
    window.addEventListener('lmd-flow:create-sequence', onCreateSequence);
    window.addEventListener('lmd-flow:create-mind', onCreateMind);
    window.addEventListener('lmd-flow:delete-selection', onDelete);
    window.addEventListener('lmd-flow:fit-view', onFit);
    window.addEventListener('lmd-flow:export-png', onExportPng);
    window.addEventListener('lmd-flow:export-svg', onExportSvg);
    window.addEventListener('lmd-flow:select-all', onSelectAll);
    window.addEventListener('lmd-flow:connect-selection', onConnect);
    window.addEventListener('lmd-flow:focus-selection', onFocus as EventListener);
    window.addEventListener('lmd-flow:center-world', onCenterWorld as EventListener);
    window.addEventListener('lmd-flow:zoom-in', onZoomIn);
    window.addEventListener('lmd-flow:zoom-out', onZoomOut);
    window.addEventListener('lmd-flow:zoom-reset', onZoomReset);
    window.addEventListener('lmd-flow:set-viewport', onSetViewport as EventListener);
    window.addEventListener('lmd-flow:wrap-frame', onWrapFrame);
    window.addEventListener('lmd-flow:reflow-frame', onReflowFrame);
    window.addEventListener('lmd-flow:inline-edit', onInlineEdit);
    window.addEventListener('lmd-flow:hand-tool', onHandTool as EventListener);

    pushViewport(engine);

    return () => {
      window.clearInterval(hudTimer);
      window.removeEventListener('lmd-flow:create-node', onCreate);
      window.removeEventListener('lmd-flow:create-sequence', onCreateSequence);
      window.removeEventListener('lmd-flow:create-mind', onCreateMind);
      window.removeEventListener('lmd-flow:delete-selection', onDelete);
      window.removeEventListener('lmd-flow:fit-view', onFit);
      window.removeEventListener('lmd-flow:export-png', onExportPng);
      window.removeEventListener('lmd-flow:export-svg', onExportSvg);
      delete (window as unknown as { __lmdStageExportSvg?: () => string | null }).__lmdStageExportSvg;
      delete (window as unknown as { __lmdStageNodeViews?: () => unknown }).__lmdStageNodeViews;
      window.removeEventListener('lmd-flow:select-all', onSelectAll);
      window.removeEventListener('lmd-flow:connect-selection', onConnect);
      window.removeEventListener('lmd-flow:focus-selection', onFocus as EventListener);
      window.removeEventListener('lmd-flow:center-world', onCenterWorld as EventListener);
      window.removeEventListener('lmd-flow:zoom-in', onZoomIn);
      window.removeEventListener('lmd-flow:zoom-out', onZoomOut);
      window.removeEventListener('lmd-flow:zoom-reset', onZoomReset);
      window.removeEventListener('lmd-flow:set-viewport', onSetViewport as EventListener);
      window.removeEventListener('lmd-flow:wrap-frame', onWrapFrame);
      window.removeEventListener('lmd-flow:reflow-frame', onReflowFrame);
      window.removeEventListener('lmd-flow:inline-edit', onInlineEdit);
      window.removeEventListener('lmd-flow:hand-tool', onHandTool as EventListener);
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

  useEffect(() => {
    engineRef.current?.setPolicy(policy);
    engineRef.current?.setFrameTool(positionsLocked(policy) ? false : frameTool);
  }, [frameTool, policy]);

  return (
    <div className="stage-root">
      <canvas className="stage-canvas" ref={canvasRef} />
      {inlineEdit ? (
        <StageInlineEditor
          key={`${inlineEdit.kind}:${inlineEdit.id}`}
          edit={inlineEdit}
          onActivateField={(field) => engineRef.current?.setInlineField(field)}
          onCancel={() => engineRef.current?.cancelInlineEdit()}
          onCommit={(value, pair) => engineRef.current?.applyInlineEdit(value, pair)}
        />
      ) : null}
      {frameTool ? (
        <div className="stage-hint" aria-hidden>
          拖出区域放置形状框 · Esc 退出
        </div>
      ) : null}
    </div>
  );
}
