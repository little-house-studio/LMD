export { LMD_COMPAT_FENCE, LMD_FILE_SUFFIX, LMD_MEDIA_TYPE, LMD_META_SUFFIX, LMD_PROTOCOL, LMD_PROTOCOL_NAME, LMD_PROTOCOL_VERSION, siblingMetaPath } from './protocol';
export type { LmdProtocolStamp, LmdProtocolVersion } from './protocol';

export { CANVAS_DIAGRAM_TYPES, isCanvasDiagramType } from './kinds';
export type { CanvasDiagramType, Direction, EdgeKind, NodeShape } from './kinds';

export { LMD_DIAGNOSTIC_META, diagnosticMessage } from './codes';
export type { DiagnosticCodeMeta, DiagnosticSeverity, FixSafety, LmdDiagnosticCode } from './codes';

export { LMD_CONTEXTS, LMD_CONTEXT_IMPORTS, DDD_LAYERS, canImportLayer } from './contexts';
export type { DddLayer, LmdContext } from './contexts';

export { DEFAULT_EDGE_THEME, DEFAULT_GROUP_THEME, DEFAULT_NODE_THEME } from './theme';

export {
  buildEntityIdFromTitle,
  deriveEntityTitleFromId,
  extractEntityIdCode,
  isStableEntityId,
  normalizeEntityIdBase,
} from './identity';
