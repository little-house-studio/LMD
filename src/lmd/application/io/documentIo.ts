import { parseLmd, toLegacyDocument } from '@lths/lmd';
import { sampleProjectMarkdown, type GraphDocument } from '@lths/lmd/legacy';
import { fallbackNameFromFile, type HostConfig } from '../../infrastructure/host/config';
import { storageKeys } from '../../infrastructure/persistence/storage';
import { DEFAULT_CANVAS_POLICY, resolveCanvasPolicy, type CanvasPolicy } from '../../domain/canvasPolicy';
import { hydrateViewDocument, organizeDocument } from '../layout/organize';
import { KITCHEN_SINK_MARKDOWN } from '../../tests/fixtures/kitchenSink';
import { SEQUENCE_DEMO_MARKDOWN } from '../../tests/fixtures/sequenceDemo';
import {
  bundlePersistsNodeLayout,
  documentToMeta,
  documentToRelation,
  printProjectBundle,
} from './projectBundle';

export { documentToMermaid, documentToMeta, documentToRelation, printProjectBundle } from './projectBundle';
export type { ProjectBundle } from './projectBundle';

function markdownFromQuery() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const query = new URLSearchParams(window.location.search);
    if (query.has('seq')) {
      return SEQUENCE_DEMO_MARKDOWN;
    }
    return query.has('sink') ? KITCHEN_SINK_MARKDOWN : null;
  } catch {
    return null;
  }
}

export function loadInitialMarkdown(host: HostConfig) {
  const fromQuery = markdownFromQuery();
  if (fromQuery) {
    return { relation: fromQuery, meta: host.initialMeta ?? '' };
  }
  if (host.platform === 'vscode' && host.initialMarkdown?.trim()) {
    return { relation: host.initialMarkdown, meta: host.initialMeta ?? '' };
  }
  try {
    const saved = localStorage.getItem(storageKeys.project);
    if (saved?.trim()) {
      return { relation: saved, meta: localStorage.getItem(storageKeys.projectMeta) ?? '' };
    }
  } catch {
    // ignore
  }
  return { relation: sampleProjectMarkdown, meta: '' };
}

function openParsed(
  markdown: string,
  fallbackName: string,
  policy: CanvasPolicy,
  metaText?: string,
): GraphDocument {
  const parsed = toLegacyDocument(parseLmd(markdown, {
    fallbackName,
    meta: metaText,
  }).document);
  if (policy.mode === 'derived' || !bundlePersistsNodeLayout(metaText, markdown)) {
    return organizeDocument(parsed, undefined, policy);
  }
  return hydrateViewDocument(parsed, policy);
}

export function parseSafe(
  markdown: string,
  fallbackName = 'LMD Project',
  policy: CanvasPolicy = DEFAULT_CANVAS_POLICY,
  metaText?: string,
): GraphDocument {
  try {
    return openParsed(markdown, fallbackName, policy, metaText);
  } catch (error) {
    console.warn('[FlowApp] parse failed, using empty graph', error);
    return openParsed(
      `@project:${JSON.stringify(fallbackName)}\n\n# 关系\n@node:"Start"\n`,
      fallbackName,
      policy,
      metaText,
    );
  }
}

/** @deprecated Prefer `documentToRelation`. */
export function documentToMarkdown(
  document: GraphDocument,
  policy: CanvasPolicy = DEFAULT_CANVAS_POLICY,
) {
  return printProjectBundle(document, policy).relation;
}

export function initialDocument(host: HostConfig) {
  const loaded = loadInitialMarkdown(host);
  return parseSafe(
    loaded.relation,
    fallbackNameFromFile(host.fileName),
    resolveCanvasPolicy(host.canvas),
    loaded.meta,
  );
}
