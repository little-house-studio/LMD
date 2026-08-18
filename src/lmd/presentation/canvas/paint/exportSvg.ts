import type { GraphDocument, GraphNode, GraphSubgraph } from '../../..';
import { DEFAULT_EDGE_STYLE, DEFAULT_NODE_STYLE } from '../../../domain/style';
import { isSubgraphHiddenByCollapsedAncestor } from '../../../application/layout/graphLayout';
import { cubicToSvgPath, labelHitRect, nodeContentBands, subgraphDepth, type EdgeGeometry } from '../../../placement';
import { groupChrome } from '../groupChrome';
import type { Rect } from '../math';
import { groupTitleLabel } from '../labelChips';

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportSceneSvg(input: {
  world: Rect;
  doc: GraphDocument;
  subgraphMap: Map<string, GraphSubgraph>;
  groupRectCache: Map<string, Rect>;
  edgeRoutes: Map<string, EdgeGeometry>;
  isNodeHidden: (node: GraphNode) => boolean;
}): string {
  const pad = 48;
  const { world } = input;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${world.x - pad} ${world.y - pad} ${world.width + pad * 2} ${world.height + pad * 2}" width="${Math.round(world.width + pad * 2)}" height="${Math.round(world.height + pad * 2)}">`);
  parts.push(`<rect x="${world.x - pad}" y="${world.y - pad}" width="${world.width + pad * 2}" height="${world.height + pad * 2}" fill="#070708"/>`);

  const groupsByDepth = [...input.doc.subgraphs].sort(
    (left, right) => subgraphDepth(left.id, input.subgraphMap) - subgraphDepth(right.id, input.subgraphMap),
  );
  for (const sg of groupsByDepth) {
    if (isSubgraphHiddenByCollapsedAncestor(sg, input.subgraphMap)) {
      continue;
    }
    const rect = input.groupRectCache.get(sg.id);
    if (!rect) {
      continue;
    }
    const chrome = groupChrome(subgraphDepth(sg.id, input.subgraphMap), false, sg);
    parts.push(`<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="10" fill="${chrome.fill}" stroke="${chrome.stroke}" stroke-width="${chrome.lineWidth}"/>`);
    parts.push(`<text x="${rect.x + 14}" y="${rect.y + 20}" fill="${chrome.text}" font-size="13" font-family="ui-monospace, SF Mono, Consolas, monospace">${escapeXml(groupTitleLabel(Boolean(sg.collapsed), sg.title))}</text>`);
  }

  for (const edge of input.doc.edges) {
    const geometry = input.edgeRoutes.get(edge.id);
    if (!geometry) {
      continue;
    }
    const stroke = edge.strokeColor || DEFAULT_EDGE_STYLE.strokeColor;
    const dash = edge.type === 'dotted' ? ' stroke-dasharray="6 5"' : '';
    const width = edge.type === 'thick' ? 2.8 : 1.6;
    parts.push(`<path d="${cubicToSvgPath(geometry)}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"${dash}/>`);
    if (edge.label.trim() && geometry.labelSize.width > 0) {
      const chip = labelHitRect(geometry, 0);
      if (chip) {
        parts.push(`<rect x="${chip.x.toFixed(1)}" y="${chip.y.toFixed(1)}" width="${chip.width.toFixed(1)}" height="${chip.height.toFixed(1)}" rx="6" fill="rgba(7,7,8,0.9)" stroke="rgba(255,255,255,0.1)"/>`);
        parts.push(`<text x="${geometry.label.x.toFixed(1)}" y="${(geometry.label.y + 4).toFixed(1)}" fill="#d4d4d8" font-size="11" text-anchor="middle" font-family="ui-monospace, monospace">${escapeXml(edge.label.trim())}</text>`);
      }
    }
  }

  for (const node of input.doc.nodes) {
    if (input.isNodeHidden(node)) {
      continue;
    }
    const bands = nodeContentBands(node);
    const fill = node.fill || DEFAULT_NODE_STYLE.fill;
    const stroke = node.stroke || DEFAULT_NODE_STYLE.stroke;
    const text = node.textColor || DEFAULT_NODE_STYLE.textColor;
    parts.push(`<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
    parts.push(`<rect x="${bands.title.x}" y="${bands.title.y}" width="${bands.title.width}" height="${bands.title.height}" fill="${stroke}" fill-opacity="0.14"/>`);
    parts.push(`<line x1="${bands.title.x}" y1="${bands.title.y + bands.title.height}" x2="${bands.title.x + bands.title.width}" y2="${bands.title.y + bands.title.height}" stroke="${stroke}" stroke-opacity="0.28"/>`);
    const titleLines = bands.titleLines.length > 0 ? bands.titleLines : [bands.parts.title || node.id];
    const descLines = bands.descriptionLines.length > 0 ? bands.descriptionLines : ['（空）'];
    const titleBlock = titleLines.length * 16;
    const descBlock = descLines.length * 14;
    titleLines.forEach((line, index) => {
      const y = bands.title.y + (bands.title.height - titleBlock) / 2 + 12 + index * 16;
      parts.push(`<text x="${node.x + node.width / 2}" y="${y}" fill="${text}" font-size="13" font-weight="700" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif">${escapeXml(line)}</text>`);
    });
    descLines.forEach((line, index) => {
      const y = bands.description.y + (bands.description.height - descBlock) / 2 + 11 + index * 14;
      parts.push(`<text x="${node.x + node.width / 2}" y="${y}" fill="${bands.parts.description ? text : '#8a8a94'}" font-size="11" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif">${escapeXml(line)}</text>`);
    });
  }

  parts.push('</svg>');
  return parts.join('');
}
