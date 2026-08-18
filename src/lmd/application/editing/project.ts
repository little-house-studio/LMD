import {
  dispatchCommand,
  fromLegacyDocument,
  toLegacyDocument,
} from '@lths/lmd';
import {
  serializeProjectMarkdown,
  standardizeProjectMarkdown,
  type GraphDocument,
} from '@lths/lmd/legacy';
import { documentToCompat } from '../../infrastructure/compat/flowAdapter';

export function updateProjectMeta(
  document: GraphDocument,
  patch: { projectName?: string; projectSummary?: string; contentMarkdown?: string },
): GraphDocument {
  const result = dispatchCommand(fromLegacyDocument(document), {
    op: 'project.update',
    name: patch.projectName,
    summary: patch.projectSummary,
    content: patch.contentMarkdown,
  });
  const next = toLegacyDocument(result.document);
  return {
    ...document,
    projectName: next.projectName,
    projectSummary: next.projectSummary,
    contentMarkdown: next.contentMarkdown,
  };
}

export function standardizeDocument(document: GraphDocument): GraphDocument {
  const markdown = serializeProjectMarkdown({
    projectName: document.projectName || 'LMD Project',
    projectSummary: document.projectSummary || '',
    prefixMarkdown: document.prefixMarkdown,
    contentMarkdown: document.contentMarkdown ?? '',
    mermaidSource: document.source,
    compat: documentToCompat(document),
    nodes: document.nodes,
    subgraphs: document.subgraphs,
  });
  return standardizeProjectMarkdown(
    markdown,
    document.projectName || 'LMD Project',
    document.layout,
  );
}
