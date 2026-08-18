import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  addEdge,
  getNodesBounds,
  getViewportForBounds,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
  type OnSelectionChangeParams,
  type Viewport,
} from '@xyflow/react';
import { toPng } from 'html-to-image';
import '@xyflow/react/dist/style.css';

import {
  buildEntityIdFromTitle,
  measureNodeContentSize,
  type GraphDocument,
} from '../..';
import { documentToFlow, flowToDocument } from './flowAdapter';
import {
  flowPerfCount,
  flowPerfMark,
  flowPerfMeasure,
  flowPerfSetGraphStats,
} from '../inspector/flowPerf';
import { LmdEdge } from './LmdEdge';
import { LmdGroupNode } from './LmdGroupNode';
import { LmdNode } from './LmdNode';
import {
  DEFAULT_EDGE_STYLE,
  DEFAULT_NODE_STYLE,
  type LmdFlowEdge,
  type LmdFlowNode,
  type LmdNodeData,
} from './types';
import '../inspector/flowStyles.css';

const nodeTypes = {
  lmdNode: LmdNode,
  lmdGroup: LmdGroupNode,
};

const edgeTypes = {
  lmdEdge: LmdEdge,
};

const defaultEdgeOptions = {
  type: 'lmdEdge' as const,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color: DEFAULT_EDGE_STYLE.strokeColor,
  },
  style: {
    stroke: DEFAULT_EDGE_STYLE.strokeColor,
    strokeWidth: DEFAULT_EDGE_STYLE.strokeWidth,
  },
  data: {
    edgeType: 'solid' as const,
    labelText: '',
  },
};

export type FlowSelection =
  | { kind: 'none' }
  | { kind: 'node'; ids: string[] }
  | { kind: 'edge'; ids: string[] }
  | { kind: 'group'; ids: string[] };

type LmdFlowCanvasProps = {
  document: GraphDocument;
  /** Bumps only for external loads (open file / sample / apply source). Canvas commits never bump this. */
  externalRevision: number;
  onDocumentChange: (next: GraphDocument) => void;
  onSelectionChange?: (selection: FlowSelection) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
};

/**
 * Idiomatic React Flow usage:
 * - RF owns interactive nodes/edges state
 * - expandParent handles group growth while dragging children
 * - domain document is a sink (serialize on stop), not a per-frame source
 * - externalRevision is the only full remount/hydrate signal
 */
function LmdFlowCanvasInner({
  document,
  externalRevision,
  onDocumentChange,
  onSelectionChange: reportSelection,
  onNodeDoubleClick,
}: LmdFlowCanvasProps) {
  const {
    fitView,
    getViewport,
    getNodes,
    getEdges,
    screenToFlowPosition,
    setViewport,
    deleteElements,
  } = useReactFlow<LmdFlowNode, LmdFlowEdge>();

  const lastExternalRevisionRef = useRef(-1);
  const documentRef = useRef(document);
  documentRef.current = document;
  const viewportSaveTimerRef = useRef<number | null>(null);

  const seed = flowPerfMeasure('hydrate.documentToFlow', 'hydrate/documentToFlow', () =>
    documentToFlow(document),
  );
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<LmdFlowNode>(seed.nodes);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<LmdFlowEdge>(seed.edges);

  // Keep HUD graph counters in sync with RF state.
  useEffect(() => {
    flowPerfSetGraphStats({
      nodes: nodes.length,
      edges: edges.length,
      selected:
        nodes.filter((node) => node.selected).length +
        edges.filter((edge) => edge.selected).length,
    });
  }, [edges, nodes]);

  // Hydrate ONLY when parent says data came from outside the canvas.
  useEffect(() => {
    if (lastExternalRevisionRef.current === externalRevision) {
      return;
    }
    lastExternalRevisionRef.current = externalRevision;

    const next = flowPerfMeasure('hydrate.documentToFlow', 'hydrate/documentToFlow', () =>
      documentToFlow(document),
    );
    flowPerfMeasure('hydrate.setState', 'hydrate/setNodes+Edges', () => {
      setNodes(next.nodes);
      setEdges(next.edges);
      setViewport(
        {
          x: next.viewport.x,
          y: next.viewport.y,
          zoom: next.viewport.zoom || 1,
        },
        { duration: 0 },
      );
    });

    if (externalRevision <= 1) {
      requestAnimationFrame(() => {
        flowPerfMeasure('hydrate.fitView', 'hydrate/fitView', () => {
          fitView({ padding: 0.18, duration: 200 });
        });
      });
    }
  }, [document, externalRevision, fitView, setEdges, setNodes, setViewport]);

  /** Serialize current RF store → domain. Never reshapes RF state first. */
  const persistStore = useCallback(
    (viewport?: Viewport) => {
      flowPerfMeasure('persist.total', 'persist/total', () => {
        const doc = flowPerfMeasure('persist.flowToDocument', 'persist/flowToDocument', () =>
          flowToDocument(
            getNodes(),
            getEdges(),
            documentRef.current,
            viewport ?? getViewport(),
          ),
        );
        flowPerfMeasure('persist.onDocumentChange', 'persist/onDocumentChange', () => {
          onDocumentChange(doc);
        });
      });
    },
    [getEdges, getNodes, getViewport, onDocumentChange],
  );

  const onNodesChange = useCallback<OnNodesChange<LmdFlowNode>>(
    (changes) => {
      const start = performance.now();
      onNodesChangeBase(changes);
      flowPerfMark('rf.onNodesChange', 'rf/onNodesChange', performance.now() - start);
      flowPerfCount('rf.nodesChange.events', 'rf/nodesChange events', changes.length);
    },
    [onNodesChangeBase],
  );

  const onEdgesChange = useCallback<OnEdgesChange<LmdFlowEdge>>(
    (changes) => {
      const start = performance.now();
      onEdgesChangeBase(changes);
      flowPerfMark('rf.onEdgesChange', 'rf/onEdgesChange', performance.now() - start);
      flowPerfCount('rf.edgesChange.events', 'rf/edgesChange events', changes.length);
    },
    [onEdgesChangeBase],
  );

  const onNodeDragStop = useCallback(() => {
    flowPerfCount('rf.nodeDragStop', 'rf/nodeDragStop');
    // expandParent already updated parent size during drag (library-native).
    persistStore();
  }, [persistStore]);

  const onSelectionDragStop = useCallback(() => {
    flowPerfCount('rf.selectionDragStop', 'rf/selectionDragStop');
    persistStore();
  }, [persistStore]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      flowPerfMeasure('rf.onConnect', 'rf/onConnect', () => {
        const sourceNode = getNodes().find((node) => node.id === connection.source);
        const stroke =
          sourceNode?.type === 'lmdNode'
            ? (sourceNode.data as LmdNodeData).stroke
            : DEFAULT_EDGE_STYLE.strokeColor;

        setEdges((eds) =>
          addEdge(
            {
              id: `edge_${connection.source}_${connection.target}_${Math.random().toString(36).slice(2, 7)}`,
              source: connection.source!,
              target: connection.target!,
              sourceHandle: connection.sourceHandle ?? undefined,
              targetHandle: connection.targetHandle ?? undefined,
              type: 'lmdEdge',
              data: { edgeType: 'solid', labelText: '' },
              style: { stroke, strokeWidth: DEFAULT_EDGE_STYLE.strokeWidth },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 16,
                height: 16,
                color: stroke,
              },
            },
            eds,
          ),
        );
      });

      // Persist after React applies the edge add.
      queueMicrotask(() => persistStore());
    },
    [getNodes, persistStore, setEdges],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
      const start = performance.now();
      flowPerfSetGraphStats({
        nodes: getNodes().length,
        edges: getEdges().length,
        selected: selectedNodes.length + selectedEdges.length,
      });
      if (!reportSelection) {
        flowPerfMark('rf.onSelectionChange', 'rf/onSelectionChange', performance.now() - start);
        return;
      }
      if (selectedEdges.length > 0 && selectedNodes.length === 0) {
        reportSelection({ kind: 'edge', ids: selectedEdges.map((edge) => edge.id) });
      } else if (selectedNodes.length === 0) {
        reportSelection({ kind: 'none' });
      } else {
        const groups = selectedNodes.filter((node) => node.type === 'lmdGroup');
        if (groups.length === selectedNodes.length) {
          reportSelection({ kind: 'group', ids: groups.map((node) => node.id) });
        } else {
          reportSelection({
            kind: 'node',
            ids: selectedNodes.filter((node) => node.type === 'lmdNode').map((node) => node.id),
          });
        }
      }
      flowPerfMark('rf.onSelectionChange', 'rf/onSelectionChange', performance.now() - start);
    },
    [getEdges, getNodes, reportSelection],
  );

  const onNodesDelete = useCallback(() => {
    flowPerfCount('rf.onNodesDelete', 'rf/onNodesDelete');
    queueMicrotask(() => persistStore());
  }, [persistStore]);

  const onEdgesDelete = useCallback(() => {
    flowPerfCount('rf.onEdgesDelete', 'rf/onEdgesDelete');
    queueMicrotask(() => persistStore());
  }, [persistStore]);

  // Viewport lives in RF; only sink to LMD after pan/zoom settles.
  const onMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      flowPerfCount('rf.onMoveEnd', 'rf/onMoveEnd');
      if (viewportSaveTimerRef.current !== null) {
        window.clearTimeout(viewportSaveTimerRef.current);
      }
      viewportSaveTimerRef.current = window.setTimeout(() => {
        persistStore(viewport);
      }, 300);
    },
    [persistStore],
  );

  useEffect(() => {
    const onExportPng = async () => {
      const viewport = window.document.querySelector(
        '.lmd-flow .react-flow__viewport',
      ) as HTMLElement | null;
      if (!viewport) {
        return;
      }
      const nodesBounds = getNodesBounds(getNodes());
      const imageWidth = Math.max(1, Math.ceil(nodesBounds.width + 80));
      const imageHeight = Math.max(1, Math.ceil(nodesBounds.height + 80));
      const transform = getViewportForBounds(
        nodesBounds,
        imageWidth,
        imageHeight,
        0.5,
        2,
        0.12,
      );
      try {
        const dataUrl = await toPng(viewport, {
          backgroundColor: '#050506',
          width: imageWidth,
          height: imageHeight,
          style: {
            width: `${imageWidth}px`,
            height: `${imageHeight}px`,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
          },
        });
        const anchor = window.document.createElement('a');
        anchor.download = `${documentRef.current.projectName || 'lmd-canvas'}.png`;
        anchor.href = dataUrl;
        anchor.click();
      } catch (error) {
        console.warn('[LmdFlow] export PNG failed', error);
        window.alert('导出 PNG 失败，请重试。');
      }
    };

    const onCreateNode = (event: Event) => {
      const detail = (event as CustomEvent<{ label?: string }>).detail ?? {};
      const current = getNodes();
      const used = new Set(current.map((node) => node.id));
      const title = detail.label?.trim() || '新建节点';
      const id = buildEntityIdFromTitle(title, used);
      const size = measureNodeContentSize(title, '');
      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });

      const nextNode: LmdFlowNode = {
        id,
        type: 'lmdNode',
        position: {
          x: center.x - size.width / 2,
          y: center.y - size.height / 2,
        },
        data: {
          kind: 'node',
          title,
          description: '',
          shape: 'rect',
          fill: DEFAULT_NODE_STYLE.fill,
          stroke: DEFAULT_NODE_STYLE.stroke,
          textColor: DEFAULT_NODE_STYLE.textColor,
          width: size.width,
          height: size.height,
        },
        style: { width: size.width, height: size.height },
        width: size.width,
        height: size.height,
        draggable: true,
        selectable: true,
        connectable: true,
      };

      setNodes((currentNodes) => [...currentNodes, nextNode]);
      queueMicrotask(() => persistStore());
    };

    const onFit = () => {
      fitView({ padding: 0.18, duration: 220 });
    };

    const onDeleteSelection = () => {
      const selectedNodes = getNodes().filter((node) => node.selected);
      const selectedEdges = getEdges().filter((edge) => edge.selected);
      if (selectedNodes.length === 0 && selectedEdges.length === 0) {
        return;
      }
      flowPerfMeasure('rf.deleteElements', 'rf/deleteElements', () => {
        void deleteElements({ nodes: selectedNodes, edges: selectedEdges }).then(() => {
          persistStore();
        });
      });
    };

    window.addEventListener('lmd-flow:create-node', onCreateNode as EventListener);
    window.addEventListener('lmd-flow:fit-view', onFit);
    window.addEventListener('lmd-flow:delete-selection', onDeleteSelection);
    window.addEventListener('lmd-flow:export-png', onExportPng);
    return () => {
      window.removeEventListener('lmd-flow:create-node', onCreateNode as EventListener);
      window.removeEventListener('lmd-flow:fit-view', onFit);
      window.removeEventListener('lmd-flow:delete-selection', onDeleteSelection);
      window.removeEventListener('lmd-flow:export-png', onExportPng);
      if (viewportSaveTimerRef.current !== null) {
        window.clearTimeout(viewportSaveTimerRef.current);
      }
    };
  }, [
    deleteElements,
    fitView,
    getEdges,
    getNodes,
    persistStore,
    screenToFlowPosition,
    setNodes,
  ]);

  const handleNodeDoubleClick = useCallback(
    (_event: ReactMouseEvent, node: Node) => {
      if (node.type === 'lmdNode') {
        onNodeDoubleClick?.(node.id);
      }
    },
    [onNodeDoubleClick],
  );

  return (
    <ReactFlow
      className="lmd-flow"
      connectionLineType={ConnectionLineType.Bezier}
      connectionMode={ConnectionMode.Loose}
      defaultEdgeOptions={defaultEdgeOptions}
      deleteKeyCode={['Backspace', 'Delete']}
      edges={edges}
      edgeTypes={edgeTypes}
      elementsSelectable
      fitView
      fitViewOptions={{ padding: 0.18 }}
      maxZoom={2.5}
      minZoom={0.15}
      multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
      nodes={nodes}
      nodesConnectable
      nodesDraggable
      nodeTypes={nodeTypes}
      onConnect={onConnect}
      onEdgesChange={onEdgesChange}
      onEdgesDelete={onEdgesDelete}
      onMoveEnd={onMoveEnd}
      onNodeDoubleClick={handleNodeDoubleClick}
      onNodeDragStop={onNodeDragStop}
      onNodesChange={onNodesChange}
      onNodesDelete={onNodesDelete}
      onSelectionChange={handleSelectionChange}
      onSelectionDragStop={onSelectionDragStop}
      panOnDrag={[1, 2]}
      panOnScroll
      proOptions={{ hideAttribution: true }}
      selectNodesOnDrag={false}
      selectionMode={SelectionMode.Partial}
      selectionOnDrag
    >
      <Background
        color="rgba(255,255,255,0.08)"
        gap={16}
        size={1}
        variant={BackgroundVariant.Dots}
      />
      <Controls className="lmd-flow-controls" showInteractive={false} />
      <MiniMap
        className="lmd-flow-minimap"
        maskColor="rgba(0,0,0,0.55)"
        nodeColor={(node) => {
          if (node.type === 'lmdGroup') {
            return (node.data as { stroke?: string }).stroke || '#00f0ff';
          }
          return (node.data as { stroke?: string }).stroke || '#d6ff3a';
        }}
        pannable
        zoomable
      />
    </ReactFlow>
  );
}

export type { LmdFlowCanvasProps };

export function LmdFlowCanvas(props: LmdFlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <LmdFlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
