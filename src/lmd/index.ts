/**
 * # LMD Format Interpreter
 *
 * Independent module for reading / writing `.lmd` project files:
 *
 * | Layer | Module | Responsibility |
 * |-------|--------|----------------|
 * | Types | `types` | GraphDocument, nodes/edges/subgraphs, layout sidecar |
 * | Entity IDs | `entityId` | Stable title-derived Mermaid node IDs |
 * | Mermaid | `mermaid` | flowchart parse / serialize / measure / layout defaults |
 * | Project MD | `projectMarkdown` | Full LMD shell: Summary / Diagram / Content / lths-compat |
 * | Samples | `sample` | Demo & stress fixtures |
 *
 * Protocol docs: `skills/lmd-protocol/`.
 *
 * @example
 * ```ts
 * import { parseProjectMarkdown, serializeProjectMarkdown, createDefaultLayout } from './lmd';
 *
 * const doc = parseProjectMarkdown(raw, 'My Project', createDefaultLayout());
 * const out = serializeProjectMarkdown({ ... });
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
} from './types';

// —— Entity IDs ——
export {
  normalizeEntityIdBase,
  extractEntityIdCode,
  deriveEntityTitleFromId,
  buildEntityIdFromTitle,
} from './entityId';

// —— Mermaid flowchart ——
export {
  defaultSubgraphStyle,
  defaultEdgeStyle,
  normalizeEdgeStyle,
  measureNodeContentSize,
  isFlowchartSource,
  detectMermaidDiagramType,
  looksLikeStandaloneMermaidSource,
  parseMermaidDocument,
  serializeMermaidDocument,
  syncDocument,
  createDefaultLayout,
  toSidecar,
} from './mermaid';

// —— Full .lmd project Markdown ——
export type { LmdInterpreterHooks } from './projectMarkdown';
export {
  setLmdInterpreterHooks,
  buildProjectSuffixMarkdown,
  extractMermaidFromProjectMarkdown,
  parseProjectMarkdown,
  standardizeProjectMarkdown,
  serializeProjectMarkdown,
  createProjectMarkdownTemplate,
} from './projectMarkdown';

// —— Fixtures ——
export {
  sampleMermaidSource,
  sampleProjectMarkdown,
  defaultStressTestProjectOptions,
  defaultStressTestProjectLabel,
  createStressTestProjectMarkdown,
} from './sample';
