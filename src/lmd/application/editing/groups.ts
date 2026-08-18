import { buildEntityIdFromTitle, type GraphDocument, type GraphSubgraph } from '@lths/lmd/legacy';
import { DEFAULT_GROUP_STYLE } from '../../domain/style';
import { usedSubgraphIds } from '../../domain/ids';
import { refreshSource } from './source';

export function groupNodesInDocument(
  document: GraphDocument,
  nodeIds: string[],
  title = '新建分组',
): { document: GraphDocument; subgraphId: string } {
  if (nodeIds.length === 0) {
    return { document, subgraphId: '' };
  }
  const used = usedSubgraphIds(document);
  const subgraphId = buildEntityIdFromTitle(title, used);
  const selected = new Set(nodeIds);
  const subgraph: GraphSubgraph = {
    id: subgraphId,
    title,
    parentId: null,
    collapsed: false,
    fill: DEFAULT_GROUP_STYLE.fill,
    stroke: DEFAULT_GROUP_STYLE.stroke,
    textColor: DEFAULT_GROUP_STYLE.textColor,
  };

  return {
    subgraphId,
    document: refreshSource({
      ...document,
      subgraphs: [...document.subgraphs, subgraph],
      nodes: document.nodes.map((node) =>
        selected.has(node.id) ? { ...node, subgraphId } : node,
      ),
    }),
  };
}

export function ungroupNodesInDocument(
  document: GraphDocument,
  subgraphIds: string[],
): GraphDocument {
  if (subgraphIds.length === 0) {
    return document;
  }
  const ids = new Set(subgraphIds);
  return refreshSource({
    ...document,
    subgraphs: document.subgraphs.filter((subgraph) => !ids.has(subgraph.id)),
    nodes: document.nodes.map((node) =>
      node.subgraphId && ids.has(node.subgraphId)
        ? { ...node, subgraphId: null }
        : node,
    ),
  });
}

export function updateSubgraphInDocument(
  document: GraphDocument,
  subgraphId: string,
  patch: {
    title?: string;
    fill?: string;
    stroke?: string;
    textColor?: string;
  },
): GraphDocument {
  return refreshSource({
    ...document,
    subgraphs: document.subgraphs.map((subgraph) =>
      subgraph.id === subgraphId
        ? {
            ...subgraph,
            title: patch.title ?? subgraph.title,
            fill: patch.fill ?? subgraph.fill,
            stroke: patch.stroke ?? subgraph.stroke,
            textColor: patch.textColor ?? subgraph.textColor,
          }
        : subgraph,
    ),
  });
}
