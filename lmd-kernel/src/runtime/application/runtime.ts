import { diagnosticMessage, LMD_DIAGNOSTIC_META } from '../../shared-kernel';
import type { LmdDocument } from '../../document';
import type { Diagnostic } from '../../diagnostics';

export type CapabilityName = 'fs' | 'net' | 'shell' | 'llm' | 'clock' | 'workspace';

export interface CapabilityRequest {
  name: CapabilityName;
  reason: string;
}

export interface RuntimeHost {
  authorized: ReadonlySet<CapabilityName>;
  invoke?: (name: CapabilityName, input: unknown) => unknown;
}

export type RuntimeStatus = 'idle' | 'running' | 'paused' | 'denied';

export interface RuntimeSnapshot {
  status: RuntimeStatus;
  currentNodeId: string | null;
  diagnostics: Diagnostic[];
}

export function createDeniedRuntime(detail: string): RuntimeSnapshot {
  return {
    status: 'denied',
    currentNodeId: null,
    diagnostics: [
      {
        code: 'LMD700',
        severity: LMD_DIAGNOSTIC_META.LMD700.severity,
        message: diagnosticMessage('LMD700', detail),
      },
    ],
  };
}

export function startRuntime(document: LmdDocument, host: RuntimeHost): RuntimeSnapshot {
  if (!document.exec.enabled) {
    return createDeniedRuntime('ExecIR.enabled 为 false；打开文件不等于同意执行');
  }
  if (host.authorized.size === 0) {
    return createDeniedRuntime('未授权任何 capability');
  }
  return {
    status: 'paused',
    currentNodeId: document.exec.entryNodeId ?? document.graph.nodes[0]?.id ?? null,
    diagnostics: [],
  };
}

export function isCapabilityAllowed(host: RuntimeHost, name: CapabilityName) {
  return host.authorized.has(name);
}
