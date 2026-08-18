import { deriveEntityTitleFromId } from '../../shared-kernel/identity';
import { isCanvasDiagramType } from '../../shared-kernel/kinds';
import { DEFAULT_EDGE_THEME, DEFAULT_GROUP_THEME, DEFAULT_NODE_THEME } from '../../shared-kernel/theme';
import { LMD_PROTOCOL } from '../../shared-kernel/protocol';
import { emptyExec } from '../../document/domain/exec';
import type { LmdDocument } from '../../document/domain/document';
import { emptySequence } from '../../document/domain/sequence';
import { emptyMind } from '../../document/domain/mind';
import type { ColorStyle, StyleIR } from '../../document/domain/style';
import type { GraphDocument } from '../infrastructure/working-model/types';

function takeUniqueTitle(preferred: string, used: Set<string>) {
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  let index = 2;
  while (used.has(`${preferred}#${index}`)) {
    index += 1;
  }
  const next = `${preferred}#${index}`;
  used.add(next);
  return next;
}

function mapUniqueTitles(nodes: GraphDocument['nodes']) {
  const used = new Set<string>();
  return nodes.map((node) => {
    const split = splitLegacyNode(node.id, node.label);
    return {
      ...node,
      title: takeUniqueTitle(split.title, used),
      description: split.description,
    };
  });
}

function splitLegacyNode(id: string, label: string) {
  const fromId = deriveEntityTitleFromId(id);
  const lines = label.replace(/\r\n/g, '\n').split('\n');
  const first = lines[0]?.trim() ?? '';
  const rest = lines.slice(1).join('\n').trim();
  const title = fromId || first || id;
  const description = rest || (fromId && first && first !== fromId ? first : '');
  return { title, description };
}

function colorStyle(fill: string, stroke: string, textColor: string, fallback: ColorStyle): ColorStyle | null {
  if (fill === fallback.fill && stroke === fallback.stroke && textColor === fallback.textColor) {
    return null;
  }
  return { fill, stroke, textColor };
}

export function fromLegacyDocument(document: GraphDocument): LmdDocument {
  const style: StyleIR = { nodes: {}, groups: {}, edges: {} };
  const frames: LmdDocument['layout']['frames'] = {};
  const collapsedGroups: Record<string, boolean> = {};

  for (const node of document.nodes) {
    const custom = colorStyle(node.fill, node.stroke, node.textColor, DEFAULT_NODE_THEME);
    if (custom) {
      style.nodes[node.id] = custom;
    }
    frames[node.id] = {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
  }

  for (const group of document.subgraphs) {
    const custom = colorStyle(group.fill, group.stroke, group.textColor, DEFAULT_GROUP_THEME);
    if (custom) {
      style.groups[group.id] = custom;
    }
    if (group.collapsed) {
      collapsedGroups[group.id] = true;
    }
  }

  for (const edge of document.edges) {
    if (
      edge.strokeColor !== DEFAULT_EDGE_THEME.strokeColor ||
      edge.strokeWidth !== DEFAULT_EDGE_THEME.strokeWidth
    ) {
      style.edges[edge.id] = {
        strokeColor: edge.strokeColor,
        strokeWidth: edge.strokeWidth,
      };
    }
  }

  return {
    protocol: { ...LMD_PROTOCOL },
    project: {
      name: document.projectName?.trim() || '',
      summary: document.projectSummary ?? '',
      content: document.contentMarkdown ?? '',
    },
    sequence: document.sequence ?? emptySequence(),
    mind: document.mind ?? emptyMind(),
    graph: {
      direction: document.direction,
      nodes: mapUniqueTitles(document.nodes).map((node) => ({
        id: node.id,
        title: node.title,
        label: node.description,
        shape: node.shape,
        groupId: node.subgraphId,
        comment: node.comment,
        todo: node.todo,
        url: node.url,
      })),
      edges: document.edges.map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        label: edge.label,
        kind: edge.type,
        comment: edge.comment,
        todo: edge.todo,
        url: edge.url,
      })),
      groups: document.subgraphs.map((group) => ({
        id: group.id,
        title: group.title,
        parentId: group.parentId,
        comment: group.comment,
        todo: group.todo,
        url: group.url,
      })),
    },
    style,
    layout: {
      version: document.layout.version,
      viewport: { ...document.layout.viewport },
      frames,
      collapsedGroups,
    },
    display: {
      lmdSource: document.source,
      mermaidSource: document.source,
      diagramType: document.diagramType || 'flowchart',
      direction: document.direction,
    },
    plugins: [],
    exec: emptyExec(),
    extras: {
      unsupportedLines: [
        ...document.unsupportedLines,
        ...(!isCanvasDiagramType(document.diagramType) && document.source.trim()
          ? [document.source.trim()]
          : []),
      ],
      prefixMarkdown: document.prefixMarkdown,
      suffixMarkdown: document.suffixMarkdown,
      compat: document.compat,
    },
  };
}
