export type ExecNodeKind = 'doc' | 'action' | 'decision' | 'wait' | 'human';

export interface ExecNodeIR {
  nodeId: string;
  kind: ExecNodeKind;
  capabilities: string[];
}

export interface ExecGuardIR {
  edgeId: string;
  expression: string;
}

export interface ExecIR {
  enabled: boolean;
  entryNodeId: string | null;
  nodes: ExecNodeIR[];
  guards: ExecGuardIR[];
}

export function emptyExec(): ExecIR {
  return {
    enabled: false,
    entryNodeId: null,
    nodes: [],
    guards: [],
  };
}
