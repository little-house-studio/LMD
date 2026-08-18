/**
 * Layout quality report for the kitchen-sink fixture.
 * Run: npx --yes tsx scripts/diagnose-kitchen-sink.ts
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSafe } from '../src/lmd/application/io/documentIo.ts';
import { applyStructuralLayout } from '../src/lmd/application/layout/structuralLayout.ts';
import { DEFAULT_CANVAS_POLICY } from '../src/lmd/domain/canvasPolicy.ts';
import { nodesOverlap } from '../src/lmd/infrastructure/layout/overlap.ts';
import { cubicToSvgPath, routeSceneEdges } from '../src/lmd/placement/edges.ts';
import { KITCHEN_SINK_MARKDOWN } from '../src/lmd/tests/fixtures/kitchenSink.ts';

const parsed = parseSafe(KITCHEN_SINK_MARKDOWN, 'Sink', DEFAULT_CANVAS_POLICY);
const laid = applyStructuralLayout(parsed);

function bounds(nodes: typeof laid.nodes) {
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function segmentCross(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
) {
  const side = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const ab = side(a, b, c) * side(a, b, d);
  const cd = side(c, d, a) * side(c, d, b);
  return ab < 0 && cd < 0;
}

function rectsOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

const byId = new Map(laid.nodes.map((node) => [node.id, node]));
const centers = (id: string) => {
  const node = byId.get(id);
  if (!node) {
    return null;
  }
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
};

let crossings = 0;
for (let i = 0; i < laid.edges.length; i += 1) {
  for (let j = i + 1; j < laid.edges.length; j += 1) {
    const left = laid.edges[i];
    const right = laid.edges[j];
    if (!left || !right) {
      continue;
    }
    const shared = new Set([left.from, left.to, right.from, right.to]);
    if (shared.size < 4) {
      continue;
    }
    const a = centers(left.from);
    const b = centers(left.to);
    const c = centers(right.from);
    const d = centers(right.to);
    if (a && b && c && d && segmentCross(a, b, c, d)) {
      crossings += 1;
    }
  }
}

const isolated = laid.nodes.filter((node) => (
  !laid.edges.some((edge) => edge.from === node.id || edge.to === node.id)
));
const isolatedXs = new Set(isolated.map((node) => Math.round(node.x / 20)));
const isolatedYs = new Set(isolated.map((node) => Math.round(node.y / 20)));

const groupSpread = laid.subgraphs.map((subgraph) => {
  const members = laid.nodes.filter((node) => {
    let current = node.subgraphId;
    while (current) {
      if (current === subgraph.id) {
        return true;
      }
      current = laid.subgraphs.find((entry) => entry.id === current)?.parentId ?? null;
    }
    return false;
  });
  if (members.length === 0) {
    return { id: subgraph.id, members: 0, width: 0, height: 0 };
  }
  const box = bounds(members);
  return { id: subgraph.id, members: members.length, width: Math.round(box.width), height: Math.round(box.height) };
});

const obstacles = laid.nodes.map((node) => ({
  x: node.x,
  y: node.y,
  width: node.width,
  height: node.height,
}));
const boxes = new Map(laid.nodes.map((node) => [node.id, {
  id: node.id,
  x: node.x,
  y: node.y,
  width: node.width,
  height: node.height,
}]));
const routes = routeSceneEdges(laid.edges, boxes, { resolveLabels: 'full', obstacles });

const unlabeled = laid.edges.filter((edge) => !edge.label.trim()).map((edge) => edge.id);
const labeled = laid.edges.filter((edge) => edge.label.trim());
const labelBoxes = labeled.flatMap((edge) => {
  const geometry = routes.get(edge.id);
  if (!geometry || geometry.labelSize.width <= 0) {
    return [];
  }
  return [{
    id: edge.id,
    label: edge.label.trim(),
    x: geometry.label.x - geometry.labelSize.width / 2,
    y: geometry.label.y - geometry.labelSize.height / 2,
    width: geometry.labelSize.width,
    height: geometry.labelSize.height,
  }];
});

let labelNodeHits = 0;
const labelNodeHitsDetail: string[] = [];
for (const chip of labelBoxes) {
  for (const node of laid.nodes) {
    if (rectsOverlap(chip, node)) {
      labelNodeHits += 1;
      labelNodeHitsDetail.push(`${chip.label} ∩ ${node.id.split('_')[0]}`);
    }
  }
}

let labelLabelHits = 0;
const labelLabelHitsDetail: string[] = [];
for (let i = 0; i < labelBoxes.length; i += 1) {
  for (let j = i + 1; j < labelBoxes.length; j += 1) {
    const left = labelBoxes[i];
    const right = labelBoxes[j];
    if (left && right && rectsOverlap(left, right)) {
      labelLabelHits += 1;
      labelLabelHitsDetail.push(`${left.label} ∩ ${right.label}`);
    }
  }
}

const box = bounds(laid.nodes);
const report = {
  nodes: laid.nodes.length,
  edges: laid.edges.length,
  labeledEdges: labeled.length,
  unlabeled,
  groups: laid.subgraphs.length,
  overlaps: nodesOverlap(laid.nodes, 8),
  crossings,
  labelNodeHits,
  labelNodeHitsDetail,
  labelLabelHits,
  labelLabelHitsDetail,
  world: { width: Math.round(box.width), height: Math.round(box.height) },
  isolated: isolated.map((node) => ({ id: node.id, x: node.x, y: node.y })),
  isolatedAxisBins: { x: isolatedXs.size, y: isolatedYs.size },
  groupSpread,
};

console.log(JSON.stringify(report, null, 2));

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const pad = 40;
const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width + pad * 2}" height="${box.height + pad * 2}" viewBox="${box.minX - pad} ${box.minY - pad} ${box.width + pad * 2} ${box.height + pad * 2}" fill="none">`,
  `<rect x="${box.minX - pad}" y="${box.minY - pad}" width="${box.width + pad * 2}" height="${box.height + pad * 2}" fill="#0c0c0e"/>`,
  ...laid.edges.map((edge) => {
    const geometry = routes.get(edge.id);
    if (!geometry) {
      return '';
    }
    return `<path d="${cubicToSvgPath(geometry)}" stroke="#8a8a94" stroke-width="1.4" fill="none"/>`;
  }),
  ...laid.nodes.map((node) => (
    `<g>
      <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="#121214" stroke="#d6ff3a"/>
      <text x="${node.x + 10}" y="${node.y + 18}" fill="#f4f4f5" font-size="11" font-family="sans-serif">${escapeXml(node.id.split('_')[0] ?? node.id)}</text>
    </g>`
  )),
  ...labelBoxes.map((chip) => (
    `<g>
      <rect x="${chip.x}" y="${chip.y}" width="${chip.width}" height="${chip.height}" rx="4" fill="#141418" stroke="#d4d4d8"/>
      <text x="${chip.x + chip.width / 2}" y="${chip.y + chip.height / 2 + 4}" fill="#d4d4d8" font-size="11" text-anchor="middle" font-family="ui-monospace, monospace">${escapeXml(chip.label)}</text>
    </g>`
  )),
  '</svg>',
].join('\n');

const out = fileURLToPath(new URL('../src/lmd/tests/fixtures/kitchen-sink-preview.svg', import.meta.url));
writeFileSync(out, svg);
console.log(`wrote ${out}`);
