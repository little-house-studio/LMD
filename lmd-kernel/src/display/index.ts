/**
 * Display bounded context — Mermaid / Markdown serialization.
 * Other contexts should import this barrel, not infrastructure.
 */
export {
  fromLegacyDocument,
  toLegacyDocument,
  parseLmd,
  printLmd,
  printLmdMeta,
  printMermaid,
  syncDisplaySource,
} from './application';
export type { ParseFault, ParseOptions, ParseResult } from './application';

export {
  measureNodeContentSize,
  layoutNodeContent,
  wrapNodeText,
  textUnits,
  createDefaultLayout,
  serializeMermaidDocument,
} from './infrastructure/mermaid';
export {
  parseProjectMarkdown,
  serializeProjectMarkdown,
  standardizeProjectMarkdown,
  sampleProjectMarkdown,
  sampleLegacyProjectMarkdown,
} from './infrastructure/markdown';
export {
  applyMetaToGraph,
  emptyLmdMeta,
  extractMetaFromGraph,
  metaHasNodeLayout,
  parseLmdMeta,
  printLmdMeta as printLmdMetaJson,
  siblingMetaPath,
} from './infrastructure/markdown/meta';
export type { LmdMetaFile } from './infrastructure/markdown/meta';
