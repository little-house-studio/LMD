/** @deprecated Use `import { ... } from '../lmd'` or `./lmd`. */
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
} from '../lmd/mermaid';
