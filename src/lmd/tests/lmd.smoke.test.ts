/**
 * Smoke checks for the LMD instruction language.
 * Run: npx tsx src/lmd/tests/lmd.smoke.test.ts
 */
import { parseLmd, printLmd, printMermaid } from '@lths/lmd';
import {
  parseProjectMarkdown,
  sampleLegacyProjectMarkdown,
  sampleProjectMarkdown,
  createDefaultLayout,
} from '..';
import { KITCHEN_SINK_LEGACY_MARKDOWN, KITCHEN_SINK_MARKDOWN } from './fixtures/kitchenSink';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(msg);
  }
}

const opened = parseLmd(sampleProjectMarkdown, { fallbackName: 'Smoke' });
assert(!opened.fault, 'sample parses');
assert(opened.document.graph.nodes.length >= 1, 'sample should parse nodes');
assert(opened.document.graph.edges.length >= 1, 'sample should parse edges');
assert(opened.document.project.name, 'project name present');

const printed = printLmd(opened.document);
assert(printed.includes('@project:'), 'printed has @project');
assert(printed.includes('# 关系'), 'printed has 关系 section');
assert((opened.document.mind?.maps.length ?? 0) >= 1, 'sample has a mind map');
assert(printed.includes('# 思维导图'), 'printed has 思维导图 section');
assert(!printed.includes('```mermaid'), 'relation is not mermaid');
assert(!printed.includes('lths-compat'), 'relation omits compat');

const again = parseLmd(printed, { fallbackName: 'Smoke' });
assert(again.document.graph.nodes.length === opened.document.graph.nodes.length, 'round-trip node count');
assert(again.document.graph.edges.length === opened.document.graph.edges.length, 'round-trip edge count');

const mermaid = printMermaid(opened.document);
assert(mermaid.includes('flowchart'), 'mermaid export');

const legacy = parseProjectMarkdown(sampleLegacyProjectMarkdown, 'Legacy', createDefaultLayout());
assert(legacy.nodes.length >= 1, 'legacy mermaid still parses');

const migrated = parseLmd(sampleLegacyProjectMarkdown, { fallbackName: 'Legacy' });
assert(migrated.document.graph.nodes.length === legacy.nodes.length, 'legacy migrates node count');

const sink = parseLmd(KITCHEN_SINK_MARKDOWN, { fallbackName: 'Sink' });
assert(sink.document.graph.nodes.length === 33, 'kitchen sink nodes');
assert(sink.document.graph.groups.length === 3, 'kitchen sink groups');
const sinkMigrated = parseLmd(KITCHEN_SINK_LEGACY_MARKDOWN, { fallbackName: 'Sink' });
assert(sinkMigrated.document.graph.nodes.length === sink.document.graph.nodes.length, 'kitchen sink migrates');

console.log(
  `[lmd.smoke] ok · nodes=${opened.document.graph.nodes.length} edges=${opened.document.graph.edges.length} groups=${opened.document.graph.groups.length}`,
);
