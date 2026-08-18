import { measureNodeContentSize, type GraphDocument } from '@lths/lmd/legacy';
import {
  DEFAULT_CANVAS_POLICY,
  type CanvasPolicy,
} from '../../domain/canvasPolicy';
import { splitEntityText } from '../../domain/label';
import type { ProjectCompatLayer } from '../../infrastructure/compat/types';
import { solveOptimalLayout } from '../../infrastructure/layout/solver';
import { snapNodesToGrid } from '../../placement/grid';
import { applyScopedNodeLayout, type LayoutSelection } from './graphLayout';
import { refreshSource } from '../editing/source';

const STRIP_EXTRA_KEYS = new Set(['layoutFrames', 'contentBox']);

function remasureNodes(document: GraphDocument) {
  return document.nodes.map((node) => {
    const parts = splitEntityText(node.label);
    const size = measureNodeContentSize(parts.title, parts.description);
    return { ...node, width: size.width, height: size.height };
  });
}

/** Topology + content-size solve. Used by organize; not applied on every hydrate. */
export function applyStructuralLayout(document: GraphDocument): GraphDocument {
  if (document.nodes.length === 0) {
    return document;
  }
  const nodes = remasureNodes(document);
  const laid = solveOptimalLayout({ ...document, nodes }, { anchor: 'origin' });
  return { ...document, nodes: laid.nodes };
}

/**
 * 整理: remasure, structural solve (compound groups), optional tile snap.
 * Selection scopes the move; omitted selection organizes the whole graph.
 */
export function organizeDocument(
  document: GraphDocument,
  selection?: LayoutSelection,
  policy: CanvasPolicy = DEFAULT_CANVAS_POLICY,
): GraphDocument {
  if (document.nodes.length === 0) {
    return document;
  }
  const sized = { ...document, nodes: remasureNodes(document) };
  const laid = applyScopedNodeLayout(sized, selection, (scoped) => (
    solveOptimalLayout(scoped, { anchor: 'origin' }).nodes
  ));
  const nodes = policy.snap.enabled ? snapNodesToGrid(laid, policy.snap.size) : laid;
  return refreshSource({ ...sized, nodes });
}

/** True when the file's `lths-compat` already recorded node coordinates. */
export function markdownPersistsNodeLayout(markdown: string) {
  const fence = markdown.match(/```lths-compat\s*\n([\s\S]*?)\n```/i);
  return Boolean(fence?.[1] && /(?:^|[\s;])n=/.test(fence[1]));
}

/**
 * In-memory reload (undo / inspector / canvas commit).
 * Free keeps positions. Derived re-solves. Opening text goes through `parseSafe`.
 */
export function hydrateViewDocument(
  document: GraphDocument,
  policy: CanvasPolicy = DEFAULT_CANVAS_POLICY,
): GraphDocument {
  return policy.mode === 'derived' ? organizeDocument(document, undefined, policy) : document;
}

export function stripPersistedLayout(compat: ProjectCompatLayer): ProjectCompatLayer {
  const extras = compat.extras
    ? Object.fromEntries(
        Object.entries(compat.extras).filter(([key]) => !STRIP_EXTRA_KEYS.has(key)),
      )
    : undefined;
  return {
    version: compat.version,
    layout: {
      version: compat.layout.version,
      viewport: { ...compat.layout.viewport },
      nodes: {},
      subgraphs: { ...compat.layout.subgraphs },
    },
    editor: compat.editor,
    extras: extras && Object.keys(extras).length > 0 ? extras : undefined,
  };
}

export function persistCompatLayout(
  compat: ProjectCompatLayer,
  policy: CanvasPolicy = DEFAULT_CANVAS_POLICY,
): ProjectCompatLayer {
  return policy.mode === 'derived' ? stripPersistedLayout(compat) : compat;
}
