import { diagnosticMessage } from '../../shared-kernel/codes';
import type { LmdDiagnosticCode } from '../../shared-kernel/codes';
import { createEmptyDocument, type LmdDocument } from '../../document/domain/document';
import { applyMetaToGraph, parseLmdMeta } from '../infrastructure/markdown/meta';
import { looksLikeLegacyLmd, parseLegacyRelation, parseLmdLang } from '../infrastructure/lmdlang';
import { printLmd, printMermaid } from './printLmd';
import { fromLegacyDocument } from './fromLegacy';
import { toLegacyDocument } from './toLegacy';

export interface ParseOptions {
  fallbackName?: string;
  /** Sibling `.lths` text. Overrides embedded legacy `lths-compat`. */
  meta?: string;
}

export interface ParseFault {
  code: Extract<LmdDiagnosticCode, 'LMD001' | 'LMD002'>;
  message: string;
}

export interface ParseResult {
  document: LmdDocument;
  fault?: ParseFault;
}

export function parseLmd(text: string, options: ParseOptions = {}): ParseResult {
  const fallbackName = options.fallbackName?.trim() || 'Untitled Project';
  const trimmed = text.replace(/^\uFEFF/, '');

  if (!trimmed.trim()) {
    return {
      document: createEmptyDocument(fallbackName),
      fault: { code: 'LMD002', message: diagnosticMessage('LMD002', '输入为空') },
    };
  }

  try {
    let document = looksLikeLegacyLmd(trimmed)
      ? fromLegacyDocument(parseLegacyRelation(trimmed, fallbackName))
      : parseLmdLang(trimmed, fallbackName);
    if (options.meta !== undefined) {
      document = fromLegacyDocument(
        applyMetaToGraph(toLegacyDocument(document), parseLmdMeta(options.meta)),
      );
    }
    return {
      document: {
        ...document,
        display: {
          ...document.display,
          lmdSource: printLmd(document),
          mermaidSource: printMermaid(document),
          diagramType: document.display.diagramType || 'flowchart',
          direction: document.graph.direction,
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /mermaid/i.test(message) ? 'LMD002' : 'LMD001';
    return {
      document: createEmptyDocument(fallbackName),
      fault: { code, message: diagnosticMessage(code, message) },
    };
  }
}
