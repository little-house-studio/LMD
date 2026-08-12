/**
 * Smoke checks for the standalone LMD interpreter.
 * Run: npx tsx src/lmd/lmd.smoke.test.ts
 */
import {
  createDefaultLayout,
  parseProjectMarkdown,
  sampleProjectMarkdown,
  serializeProjectMarkdown,
  standardizeProjectMarkdown,
} from './index';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(msg);
  }
}

const doc = parseProjectMarkdown(
  sampleProjectMarkdown,
  'Smoke',
  createDefaultLayout(),
);

assert(doc.nodes.length >= 1, 'sample should parse nodes');
assert(doc.edges.length >= 1, 'sample should parse edges');
assert(doc.projectName, 'project name present');
assert(doc.source.includes('flowchart'), 'mermaid source kept');

const markdown = serializeProjectMarkdown({
  projectName: doc.projectName || 'Smoke',
  projectSummary: doc.projectSummary || '',
  contentMarkdown: doc.contentMarkdown ?? '',
  mermaidSource: doc.source,
  compat: doc.compat,
  nodes: doc.nodes,
  subgraphs: doc.subgraphs,
});

assert(markdown.includes('## Diagram'), 'serialized has Diagram');
assert(markdown.includes('```mermaid'), 'serialized has mermaid fence');
assert(markdown.includes('lths-compat'), 'serialized has compat');

const again = parseProjectMarkdown(markdown, 'Smoke', doc.layout);
assert(again.nodes.length === doc.nodes.length, 'round-trip node count');
assert(again.edges.length === doc.edges.length, 'round-trip edge count');

const std = standardizeProjectMarkdown(markdown, 'Smoke', doc.layout);
assert(std.nodes.length === doc.nodes.length, 'standardize keeps nodes');

console.log(
  `[lmd.smoke] ok · nodes=${doc.nodes.length} edges=${doc.edges.length} groups=${doc.subgraphs.length}`,
);
