import { fromLegacyDocument, printLmd, printMermaid } from '@lths/lmd';
import {
  applyMetaToGraph,
  extractMetaFromGraph,
  metaHasNodeLayout,
  parseLmdMeta,
  printLmdMeta,
  type GraphDocument,
} from '@lths/lmd/legacy';
import { documentToCompat } from '../../infrastructure/compat/flowAdapter';
import { DEFAULT_CANVAS_POLICY, type CanvasPolicy } from '../../domain/canvasPolicy';
import { persistCompatLayout } from '../layout/organize';

export type ProjectBundle = {
  relation: string;
  meta: string;
};

export function documentToRelation(document: GraphDocument) {
  return printLmd(fromLegacyDocument(document));
}

export function documentToMermaid(document: GraphDocument) {
  return printMermaid(fromLegacyDocument(document));
}

export function documentToMeta(document: GraphDocument, policy: CanvasPolicy = DEFAULT_CANVAS_POLICY) {
  const graph = persistCompatLayout(documentToCompat(document), policy);
  const meta = extractMetaFromGraph({
    ...document,
    compat: graph,
    layout: graph.layout,
  });
  if (policy.mode !== 'derived') {
    return printLmdMeta(meta);
  }
  const nodes = Object.fromEntries(
    Object.entries(meta.nodes ?? {}).map(([id, node]) => {
      const { x: _x, y: _y, ...rest } = node;
      return [id, rest];
    }),
  );
  return printLmdMeta({ ...meta, nodes });
}

export function printProjectBundle(
  document: GraphDocument,
  policy: CanvasPolicy = DEFAULT_CANVAS_POLICY,
): ProjectBundle {
  return {
    relation: documentToRelation(document),
    meta: documentToMeta(document, policy),
  };
}

export function applyProjectMeta(document: GraphDocument, metaText?: string) {
  if (metaText === undefined || !metaText.trim()) {
    return document;
  }
  return applyMetaToGraph(document, parseLmdMeta(metaText));
}

export function bundlePersistsNodeLayout(metaText: string | undefined, relationMarkdown: string) {
  if (metaText?.trim() && metaHasNodeLayout(parseLmdMeta(metaText))) {
    return true;
  }
  return /```lths-compat\s*\n[\s\S]*?(?:^|[\s;])n=/.test(relationMarkdown);
}
