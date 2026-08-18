/**
 * Structural organize: compound groups, deterministic, used by 整理.
 * Run: npx --yes tsx src/lmd/tests/structuralLayout.test.ts
 */
import { sampleProjectMarkdown } from '..';
import { parseSafe } from '../application/io/documentIo';
import { applyStructuralLayout } from '../application/layout/organize';
import { DEFAULT_CANVAS_POLICY } from '../domain/canvasPolicy';
import { nodesOverlap } from '../infrastructure/layout/overlap';
import { KITCHEN_SINK_MARKDOWN } from './fixtures/kitchenSink';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const parsed = parseSafe(sampleProjectMarkdown, 'Structural', DEFAULT_CANVAS_POLICY);
const laid = applyStructuralLayout(parsed);

assert(laid.nodes.length === parsed.nodes.length, 'layout keeps node count');
assert(
  laid.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)),
  'every node gets a finite coordinate',
);

const again = applyStructuralLayout(laid);
assert(
  again.nodes.every((node, index) => node.x === laid.nodes[index]?.x && node.y === laid.nodes[index]?.y),
  'structural layout is deterministic',
);

const sink = applyStructuralLayout(
  parseSafe(KITCHEN_SINK_MARKDOWN, 'Sink', DEFAULT_CANVAS_POLICY),
);
const minX = Math.min(...sink.nodes.map((node) => node.x));
const minY = Math.min(...sink.nodes.map((node) => node.y));
const maxX = Math.max(...sink.nodes.map((node) => node.x + node.width));
const maxY = Math.max(...sink.nodes.map((node) => node.y + node.height));
assert(sink.edges.every((edge) => edge.label.trim().length > 0), 'every kitchen-sink edge has a label');
assert(!nodesOverlap(sink.nodes, 8), 'kitchen sink has no overlaps');
assert(maxX - minX < 3200, `kitchen sink width should stay compact, got ${maxX - minX}`);
assert(maxY - minY < 2400, `kitchen sink height should stay compact, got ${maxY - minY}`);

const platform = sink.nodes.filter((node) => node.subgraphId);
const control = platform.filter((node) => node.subgraphId?.includes('控制面'));
const controlSpanX = Math.max(...control.map((node) => node.x + node.width)) - Math.min(...control.map((node) => node.x));
const platformSpanX = Math.max(...platform.map((node) => node.x + node.width)) - Math.min(...platform.map((node) => node.x));
assert(control.length === 2, 'control plane has two nodes');
assert(controlSpanX < 280, `control plane should stack, not stretch, got ${controlSpanX}`);
assert(platformSpanX < 720, `platform domain should not be a long sausage, got ${platformSpanX}`);

console.log(`[structuralLayout] ok · nodes=${laid.nodes.length} sink=${Math.round(maxX - minX)}x${Math.round(maxY - minY)}`);
