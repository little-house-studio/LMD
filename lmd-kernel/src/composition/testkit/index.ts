import { openLmd } from '../sdk/session';
import {
  fromLegacyDocument,
  parseProjectMarkdown,
  printLmd,
  sampleLegacyProjectMarkdown,
  sampleProjectMarkdown,
  toLegacyDocument,
} from '../../display';

export function sampleText() {
  return sampleProjectMarkdown;
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertRoundTrip(text: string) {
  const opened = openLmd(text);
  assert(opened.ok || opened.diagnostics.every((item) => item.severity !== 'error'), 'parse should not error');
  const printed = printLmd(opened.document);
  const again = openLmd(printed);
  assert(
    again.document.graph.nodes.length === opened.document.graph.nodes.length,
    'round-trip node count',
  );
  assert(
    again.document.graph.edges.length === opened.document.graph.edges.length,
    'round-trip edge count',
  );
  return { opened, printed, again };
}

export function legacySampleText() {
  return sampleLegacyProjectMarkdown;
}

export function assertLegacyBridge(text: string = sampleLegacyProjectMarkdown) {
  const legacy = parseProjectMarkdown(text, 'Bridge');
  const ir = fromLegacyDocument(legacy);
  const back = toLegacyDocument(ir);
  assert(back.nodes.length === legacy.nodes.length, 'legacy bridge node count');
  assert(back.edges.length === legacy.edges.length, 'legacy bridge edge count');
  assert(back.subgraphs.length === legacy.subgraphs.length, 'legacy bridge group count');
  return { legacy, ir, back };
}
