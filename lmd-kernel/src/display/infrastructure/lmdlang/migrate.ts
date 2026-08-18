import { parseProjectMarkdown } from '../markdown/project';
import {
  createDefaultLayout,
  looksLikeStandaloneMermaidSource,
  parseMermaidDocument,
} from '../mermaid/interpreter';
import type { GraphDocument } from '../working-model/types';

export function looksLikeLmdLang(text: string) {
  return /(?:^|\n)\s*(?:@project:|@node:|@group:|@groud:|#\s*(?:关系|graph)\b)/i.test(text)
    || /(?:^|\n)\s*["\u201c]/.test(text);
}

export function looksLikeLegacyLmd(text: string) {
  const source = text.replace(/^\uFEFF/, '');
  if (looksLikeLmdLang(source) && !/(?:^|\n)##\s+Diagram\b/i.test(source)) {
    return false;
  }
  if (/(?:^|\n)##\s+Diagram\b/i.test(source) && /```mermaid\b/i.test(source)) {
    return true;
  }
  return looksLikeStandaloneMermaidSource(source) && !looksLikeLmdLang(source);
}

export function parseLegacyRelation(text: string, fallbackName = 'Untitled Project'): GraphDocument {
  const source = text.replace(/^\uFEFF/, '');
  if (/(?:^|\n)##\s+Diagram\b/i.test(source) || /```mermaid\b/i.test(source) || source.includes('# ')) {
    return parseProjectMarkdown(source, fallbackName, createDefaultLayout());
  }
  const parsed = parseMermaidDocument(source, createDefaultLayout());
  return {
    ...parsed,
    source,
    projectName: fallbackName,
    projectSummary: '',
    contentMarkdown: '',
    warnings: parsed.warnings,
  };
}
