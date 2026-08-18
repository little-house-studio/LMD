/**
 * Editor-facing format re-exports (compat).
 * Canonical kernel: `@lths/lmd` in `lmd-kernel/`.
 *
 * | Layer | Module | Responsibility |
 * |-------|--------|----------------|
 * | Types | `types` | GraphDocument (legacy, via `@lths/lmd/legacy`) |
 * | Entity IDs | `entityId` | Stable title-derived Mermaid node IDs |
 * | Mermaid | `mermaid` | flowchart parse / serialize |
 * | Project MD | `projectMarkdown` | 旧 Markdown 兼容；新关系文件走 `@lths/lmd` `printLmd` |
 * | Samples | `sample` | Demo & stress fixtures |
 *
 * Protocol: `lmd-kernel/ARCHITECTURE.md` + `skills/lmd-protocol/`.
 *
 * @example
 * ```ts
 * import { parseLmd, printLmd } from '@lths/lmd';
 *
 * const opened = parseLmd(raw, { fallbackName: 'My Project' });
 * const out = printLmd(opened.document);
 * ```
 */

// —— Types ——
export type {
  Direction,
  NodeShape,
  EdgeType,
  ViewportState,
  GraphNode,
  GraphEdge,
  GraphSubgraph,
  LayoutSidecar,
  ProjectCompatExtras,
  ProjectCompatLayer,
  GraphDocument,
  ParsedDocument,
} from './infrastructure/compat/types';

// —— Entity IDs ——
export {
  normalizeEntityIdBase,
  extractEntityIdCode,
  deriveEntityTitleFromId,
  buildEntityIdFromTitle,
} from './infrastructure/compat/entityId';

// —— Mermaid flowchart ——
export {
  defaultSubgraphStyle,
  defaultEdgeStyle,
  normalizeEdgeStyle,
  measureNodeContentSize,
  layoutNodeContent,
  wrapNodeText,
  textUnits,
  isFlowchartSource,
  detectMermaidDiagramType,
  looksLikeStandaloneMermaidSource,
  parseMermaidDocument,
  serializeMermaidDocument,
  syncDocument,
  createDefaultLayout,
  toSidecar,
} from './infrastructure/compat/mermaid';

// —— Full .lmd project Markdown ——
export type { LmdInterpreterHooks, LmdMetaFile } from './infrastructure/compat/projectMarkdown';
export {
  setLmdInterpreterHooks,
  buildProjectSuffixMarkdown,
  extractMermaidFromProjectMarkdown,
  parseProjectMarkdown,
  standardizeProjectMarkdown,
  serializeProjectMarkdown,
  createProjectMarkdownTemplate,
  applyMetaToGraph,
  emptyLmdMeta,
  extractMetaFromGraph,
  metaHasNodeLayout,
  parseLmdMeta,
  printLmdMeta,
  siblingMetaPath,
} from './infrastructure/compat/projectMarkdown';

// —— Fixtures ——
export {
  sampleMermaidSource,
  sampleProjectMarkdown,
  sampleLegacyProjectMarkdown,
  defaultStressTestProjectOptions,
  defaultStressTestProjectLabel,
  createStressTestProjectMarkdown,
} from './infrastructure/compat/sample';
