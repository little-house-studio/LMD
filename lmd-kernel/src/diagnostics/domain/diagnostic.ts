import type { FixSafety, LmdDiagnosticCode, DiagnosticSeverity } from '../../shared-kernel/codes';
import type { SourceSpan } from '../../document/domain/span';
import type { LmdDocument } from '../../document/domain/document';

export interface DiagnosticRelated {
  path?: string;
  message: string;
}

export interface DiagnosticFix {
  title: string;
  safety: FixSafety;
  apply: (document: LmdDocument) => LmdDocument;
}

export interface Diagnostic {
  code: LmdDiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  span?: SourceSpan;
  path?: string;
  related?: DiagnosticRelated[];
  fix?: DiagnosticFix;
}

export type FixMode = 'safe' | 'suggest';
