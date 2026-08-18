import { LMD_DIAGNOSTIC_META } from '../../shared-kernel/codes';
import { analyzeDocument, createEmptyDocument, type LmdDocument } from '../../document/domain/document';
import type { GraphAnalysis } from '../../document/domain/analyze';
import { parseLmd, type ParseOptions } from '../../display/application/parseLmd';
import { printLmd, printLmdMeta, printMermaid } from '../../display/application/printLmd';
import { checkLmd } from '../../diagnostics/domain/check';
import { fixLmd } from '../../diagnostics/application/fix';
import type { FixMode } from '../../diagnostics/domain/diagnostic';
import type { Diagnostic } from '../../diagnostics/domain/diagnostic';
import { dispatchCommand } from '../../editing/application/dispatch';
import type { CommandContext, CommandResult, LmdCommand } from '../../editing/domain/command';
import { getLayoutBackend } from '../../layout';

export interface OpenResult {
  ok: boolean;
  document: LmdDocument;
  diagnostics: Diagnostic[];
}

export function openLmd(text: string, options?: ParseOptions): OpenResult {
  const parsed = parseLmd(text, options);
  const diagnostics: Diagnostic[] = [];
  if (parsed.fault) {
    diagnostics.push({
      code: parsed.fault.code,
      severity: LMD_DIAGNOSTIC_META[parsed.fault.code].severity,
      message: parsed.fault.message,
    });
  }
  diagnostics.push(...checkLmd(parsed.document));
  return {
    ok: diagnostics.every((item) => item.severity !== 'error'),
    document: parsed.document,
    diagnostics,
  };
}

export class LmdSession {
  document: LmdDocument;
  diagnostics: Diagnostic[];
  context: CommandContext;

  constructor(document: LmdDocument = createEmptyDocument(), context: CommandContext = {}) {
    this.document = document;
    this.diagnostics = checkLmd(document);
    this.context = context;
  }

  static fromText(text: string, options?: ParseOptions) {
    const opened = openLmd(text, options);
    const session = new LmdSession(opened.document);
    session.diagnostics = opened.diagnostics;
    return session;
  }

  apply(command: LmdCommand): CommandResult {
    const layout = getLayoutBackend();
    const context: CommandContext = {
      ...this.context,
      layout: this.context.layout ?? (layout
        ? { auto: layout.auto, tidy: layout.tidy }
        : undefined),
    };
    const result = dispatchCommand(this.document, command, context);
    this.document = result.document;
    this.diagnostics = command.op === 'doc.check' ? result.diagnostics : checkLmd(result.document);
    return { ...result, diagnostics: this.diagnostics };
  }

  check() {
    this.diagnostics = checkLmd(this.document);
    return this.diagnostics;
  }

  fix(mode: FixMode = 'safe') {
    const result = fixLmd(this.document, mode);
    this.document = result.document;
    this.diagnostics = result.diagnostics;
    return result;
  }

  print() {
    return printLmd(this.document);
  }

  printMeta() {
    return printLmdMeta(this.document);
  }

  printMermaid() {
    return printMermaid(this.document);
  }

  analyze(): GraphAnalysis {
    return analyzeDocument(this.document);
  }
}

export function createSession(text?: string, options?: ParseOptions) {
  return text === undefined ? new LmdSession() : LmdSession.fromText(text, options);
}
