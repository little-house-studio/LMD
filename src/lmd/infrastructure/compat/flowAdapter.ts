import { toSidecar } from './mermaid';
import type { GraphDocument, ProjectCompatLayer } from './types';

export function documentToCompat(document: GraphDocument): ProjectCompatLayer {
  return {
    version: document.compat?.version ?? 1,
    layout: toSidecar(document),
    editor: document.compat?.editor ?? { localFileActions: { enabled: true } },
    extras: document.compat?.extras,
  };
}
