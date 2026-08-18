export { LMD_PROTOCOL, LMD_PROTOCOL_VERSION, LMD_DIAGNOSTIC_META } from '../../shared-kernel';
export type { LmdDiagnosticCode, Direction, EdgeKind, NodeShape } from '../../shared-kernel';

export { createEmptyDocument, analyzeDocument, documentPaths } from '../../document';
export type {
  LmdDocument,
  GraphIR,
  NodeIR,
  EdgeIR,
  GroupIR,
  PathIR,
  GraphAnalysis,
  SequenceIR,
  SequenceSceneIR,
  SequenceStepIR,
  MindIR,
  MindMapIR,
  MindNodeIR,
} from '../../document';
export { emptyMind, findMindNode, flattenMindNodes, mapMindNodes } from '../../document';

export { parseLmd, printLmd, printLmdMeta, printMermaid, fromLegacyDocument, toLegacyDocument } from '../../display';
export type { ParseResult, ParseFault } from '../../display';

export { checkLmd, fixLmd } from '../../diagnostics';
export type { Diagnostic, FixMode } from '../../diagnostics';

export { COMMAND_CATALOG, dispatchCommand } from '../../editing';
export type { LmdCommand, CommandResult, CommandOp } from '../../editing';

export { registerLayoutBackend, getLayoutBackend } from '../../layout';
export type { LayoutBackend } from '../../layout';

export { startRuntime, createDeniedRuntime } from '../../runtime';
export type { RuntimeHost, CapabilityName } from '../../runtime';

export { registerPlugin, listPlugins } from '../../plugin';
export type { PluginManifest, PluginModule } from '../../plugin';

export { createMemoryAdapter } from '../adapters';
export type { LmdAdapter } from '../adapters';

export { LmdSession, createSession, openLmd } from './session';
export type { OpenResult } from './session';
