import { fromLegacyDocument, printLmd } from '@lths/lmd';
import type { GraphDocument } from '@lths/lmd/legacy';

export function refreshSource(document: GraphDocument): GraphDocument {
  return {
    ...document,
    source: printLmd(fromLegacyDocument(document)),
  };
}
