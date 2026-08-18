/**
 * Canvas policy: free persist + organize-on-open, derived strips coords.
 * Run: npx --yes tsx src/lmd/tests/canvasPolicy.test.ts
 */
import { metaHasNodeLayout, parseLmdMeta } from '..';
import { parseSafe, printProjectBundle } from '../application/io/documentIo';
import {
  hydrateViewDocument,
  markdownPersistsNodeLayout,
  organizeDocument,
} from '../application/layout/organize';
import { DEFAULT_CANVAS_POLICY, resolveCanvasPolicy } from '../domain/canvasPolicy';
import { snapScalar } from '../placement/grid';
import { KITCHEN_SINK_MARKDOWN } from './fixtures/kitchenSink';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

assert(!markdownPersistsNodeLayout(KITCHEN_SINK_MARKDOWN), 'kitchen sink fixture has no n= dump');

const opened = parseSafe(KITCHEN_SINK_MARKDOWN, 'Sink', DEFAULT_CANVAS_POLICY);
assert(opened.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)), 'open organizes empty graphs');
assert(opened.nodes.some((node) => node.x !== 0 || node.y !== 0), 'organized nodes leave the origin');

const bundle = printProjectBundle(opened, DEFAULT_CANVAS_POLICY);
assert(bundle.relation.includes('# 关系') || bundle.relation.includes('@project:'), 'relation is instruction language');
assert(!/```lths-compat\b/.test(bundle.relation), 'relation file has no embedded compat fence');
assert(!markdownPersistsNodeLayout(bundle.relation), 'relation file has no n= dump');
assert(metaHasNodeLayout(parseLmdMeta(bundle.meta)), 'free mode persists node coordinates in .lths');

const reopened = parseSafe(bundle.relation, 'Sink', DEFAULT_CANVAS_POLICY, bundle.meta);
assert(reopened.nodes[0]?.x === opened.nodes[0]?.x, 'reopen keeps persisted positions');
assert(reopened.nodes[0]?.y === opened.nodes[0]?.y, 'reopen keeps persisted y');

const moved = {
  ...opened,
  nodes: opened.nodes.map((node, index) => (index === 0 ? { ...node, x: 640, y: 480 } : node)),
};
const kept = hydrateViewDocument(moved, DEFAULT_CANVAS_POLICY);
assert(kept.nodes[0]?.x === 640 && kept.nodes[0]?.y === 480, 'free in-memory hydrate does not re-solve');

const organized = organizeDocument(moved, undefined, DEFAULT_CANVAS_POLICY);
assert(organized.nodes[0]?.x !== 640, 'organize rebuilds positions');
assert(
  organized.nodes.every((node) => node.x === snapScalar(node.x, 16) && node.y === snapScalar(node.y, 16)),
  'organize snaps to the tile grid',
);

const derived = resolveCanvasPolicy({ mode: 'derived' });
const stripped = printProjectBundle(opened, derived);
assert(!metaHasNodeLayout(parseLmdMeta(stripped.meta)), 'derived mode omits node coordinates');

const legacy = `# Legacy
## Summary

## Diagram
\`\`\`mermaid
flowchart LR
  A["a"]
\`\`\`

## Content

\`\`\`lths-compat
v1;vp=0,0,1;n=A,640,480,120,48
\`\`\`
`;
const fromLegacy = parseSafe(legacy, 'Legacy', DEFAULT_CANVAS_POLICY, '{\n  "v": 1\n}\n');
assert(fromLegacy.nodes[0]?.x === 640 && fromLegacy.nodes[0]?.y === 480, 'empty .lths still honors legacy n=');

const raw = parseSafe(KITCHEN_SINK_MARKDOWN, 'Sink', DEFAULT_CANVAS_POLICY);
assert(raw.nodes.length === opened.nodes.length, 'parse keeps node count');

console.log('[canvasPolicy] ok');
