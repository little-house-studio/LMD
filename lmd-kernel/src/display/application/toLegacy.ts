import { DEFAULT_EDGE_THEME, DEFAULT_GROUP_THEME, DEFAULT_NODE_THEME } from '../../shared-kernel/theme';
import type { LmdDocument } from '../../document/domain/document';
import { createDefaultLayout } from '../infrastructure/mermaid/interpreter';
import type { GraphDocument, GraphEdge, GraphNode, GraphSubgraph, ProjectCompatLayer } from '../infrastructure/working-model/types';

export function toLegacyDocument(document: LmdDocument): GraphDocument {
  const nodes: GraphNode[] = document.graph.nodes.map((node) => {
    const frame = document.layout.frames[node.id];
    const theme = document.style.nodes[node.id] ?? DEFAULT_NODE_THEME;
    return {
      id: node.id,
      label: node.label && node.label !== node.title ? `${node.title}\n${node.label}` : node.title,
      shape: node.shape,
      x: frame?.x ?? 0,
      y: frame?.y ?? 0,
      width: frame?.width ?? 156,
      height: frame?.height ?? 98,
      fill: theme.fill,
      stroke: theme.stroke,
      textColor: theme.textColor,
      subgraphId: node.groupId,
      comment: node.comment,
      todo: node.todo,
      url: node.url,
    };
  });

  const edges: GraphEdge[] = document.graph.edges.map((edge) => {
    const theme = document.style.edges[edge.id] ?? DEFAULT_EDGE_THEME;
    return {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      type: edge.kind,
      strokeColor: theme.strokeColor,
      strokeWidth: theme.strokeWidth,
      comment: edge.comment,
      todo: edge.todo,
      url: edge.url,
    };
  });

  const subgraphs: GraphSubgraph[] = document.graph.groups.map((group) => {
    const theme = document.style.groups[group.id] ?? DEFAULT_GROUP_THEME;
    return {
      id: group.id,
      title: group.title,
      parentId: group.parentId,
      collapsed: document.layout.collapsedGroups[group.id] ?? false,
      fill: theme.fill,
      stroke: theme.stroke,
      textColor: theme.textColor,
      comment: group.comment,
      todo: group.todo,
      url: group.url,
    };
  });

  const layout = {
    version: document.layout.version,
    viewport: { ...document.layout.viewport },
    nodes: { ...document.layout.frames },
    subgraphs: Object.fromEntries(
      document.graph.groups.map((group) => [
        group.id,
        { collapsed: document.layout.collapsedGroups[group.id] ?? false },
      ]),
    ),
  };

  const previousCompat = document.extras.compat as ProjectCompatLayer | undefined;
  const compat: ProjectCompatLayer = {
    version: previousCompat?.version ?? 1,
    layout,
    editor: previousCompat?.editor,
    extras: previousCompat?.extras,
  };

  return {
    diagramType: document.display.diagramType,
    direction: document.graph.direction,
    nodes,
    edges,
    subgraphs,
    sequence: document.sequence,
    mind: document.mind,
    warnings: [],
    unsupportedLines: [...document.extras.unsupportedLines],
    source: document.display.lmdSource || document.display.mermaidSource,
    layout: layout.nodes ? layout : createDefaultLayout(document.layout.viewport),
    projectName: document.project.name,
    projectSummary: document.project.summary,
    contentMarkdown: document.project.content,
    prefixMarkdown: document.extras.prefixMarkdown,
    suffixMarkdown: document.extras.suffixMarkdown,
    compat,
  };
}
