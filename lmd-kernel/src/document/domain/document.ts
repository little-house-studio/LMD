import { LMD_PROTOCOL, type LmdProtocolStamp } from '../../shared-kernel/protocol';
import { analyzeGraph, type GraphAnalysis, type PathIR } from './analyze';
import { emptyGraph, type GraphIR } from './graph';
import { emptySequence, type SequenceIR } from './sequence';
import { emptyMind, type MindIR } from './mind';
import { emptyLayout, type LayoutIR } from './layout';
import { emptyStyle, type StyleIR } from './style';
import { emptyExec, type ExecIR } from './exec';

export interface ProjectIR {
  name: string;
  summary: string;
  content: string;
}

export interface DisplayIR {
  /** Canonical instruction-language source. */
  lmdSource?: string;
  /** Mermaid export cache — not the on-disk relation truth. */
  mermaidSource: string;
  diagramType: string;
  direction: GraphIR['direction'];
}

export interface PluginRefIR {
  name: string;
  version?: string;
  url?: string;
}

export interface DocumentExtrasIR {
  unsupportedLines: string[];
  prefixMarkdown?: string;
  suffixMarkdown?: string;
  /** Opaque editor sidecar. Semantic content must not live here. */
  compat?: unknown;
}

export interface LmdDocument {
  protocol: LmdProtocolStamp;
  project: ProjectIR;
  graph: GraphIR;
  sequence: SequenceIR;
  mind: MindIR;
  style: StyleIR;
  layout: LayoutIR;
  display: DisplayIR;
  plugins: PluginRefIR[];
  exec: ExecIR;
  extras: DocumentExtrasIR;
}

export const EMPTY_MERMAID = `flowchart LR
  Start[Start]`;

export function createEmptyDocument(name = 'Untitled Project'): LmdDocument {
  const graph = emptyGraph('LR');
  return {
    protocol: { ...LMD_PROTOCOL },
    project: { name, summary: '', content: '' },
    graph,
    sequence: emptySequence(),
    mind: emptyMind(),
    style: emptyStyle(),
    layout: emptyLayout(),
    display: {
      lmdSource: `@project:"${name}"\n\n# 关系\n`,
      mermaidSource: EMPTY_MERMAID,
      diagramType: 'flowchart',
      direction: 'LR',
    },
    plugins: [],
    exec: emptyExec(),
    extras: { unsupportedLines: [] },
  };
}

export function analyzeDocument(document: LmdDocument): GraphAnalysis {
  return analyzeGraph(document.graph);
}

export function documentPaths(document: LmdDocument): PathIR[] {
  return analyzeGraph(document.graph).paths;
}
