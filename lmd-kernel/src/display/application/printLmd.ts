import type { LmdDocument } from '../../document/domain/document';
import { serializeMermaidDocument } from '../infrastructure/mermaid/interpreter';
import { extractMetaFromGraph, printLmdMeta as printMetaJson } from '../infrastructure/markdown/meta';
import { printLmdLang } from '../infrastructure/lmdlang/print';
import { toLegacyDocument } from './toLegacy';

export function printMermaid(document: LmdDocument): string {
  const legacy = toLegacyDocument(document);
  return serializeMermaidDocument(
    legacy.direction,
    legacy.nodes,
    legacy.edges,
    legacy.subgraphs,
    legacy.unsupportedLines,
    { presentation: false },
  );
}

export function syncDisplaySource(document: LmdDocument): LmdDocument {
  const lmdSource = printLmdLang(document);
  const mermaidSource = printMermaid(document);
  return {
    ...document,
    display: {
      ...document.display,
      lmdSource,
      mermaidSource,
      diagramType: 'flowchart',
      direction: document.graph.direction,
    },
  };
}

export function printLmd(document: LmdDocument): string {
  return printLmdLang(document);
}

export function printLmdMeta(document: LmdDocument): string {
  return printMetaJson(extractMetaFromGraph(toLegacyDocument(syncDisplaySource(document))));
}
