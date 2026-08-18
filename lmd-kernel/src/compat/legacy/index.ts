/**
 * Compatibility facade for the editor working model + current interpreters.
 * Prefer `@lths/lmd/display` for new code.
 */
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
} from '../../display/infrastructure/working-model';
export type { SequenceIR, SequenceSceneIR, SequenceStepIR } from '../../document';
export type { MindIR, MindMapIR, MindNodeIR } from '../../document';
export { emptyMind, findMindNode, flattenMindNodes, mapMindNodes } from '../../document';

export {
  normalizeEntityIdBase,
  extractEntityIdCode,
  deriveEntityTitleFromId,
  buildEntityIdFromTitle,
} from '../../shared-kernel';

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
} from '../../display/infrastructure/mermaid';

export type { LmdInterpreterHooks, LmdMetaFile } from '../../display/infrastructure/markdown';
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
  sampleMermaidSource,
  sampleLegacyProjectMarkdown,
  sampleProjectMarkdown,
  defaultStressTestProjectOptions,
  defaultStressTestProjectLabel,
  createStressTestProjectMarkdown,
} from '../../display/infrastructure/markdown';
