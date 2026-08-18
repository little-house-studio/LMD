import { LMD_PROTOCOL, LMD_PROTOCOL_VERSION } from './shared-kernel';
import { COMMAND_CATALOG } from './editing';
import { sampleProjectMarkdown } from './display';
import { createDeniedRuntime, startRuntime } from './runtime';
import { listPlugins, registerPlugin, unregisterPlugin } from './plugin';
import { createMemoryAdapter } from './composition/adapters';
import { createSession, openLmd } from './composition/sdk';
import { assert, assertLegacyBridge, assertRoundTrip } from './composition/testkit';

assert(LMD_PROTOCOL.name === 'lmd', 'protocol name');
assert(LMD_PROTOCOL_VERSION === 1, 'protocol version');
assert(COMMAND_CATALOG.length >= 16, 'command catalog covers GUI ops');

const opened = openLmd(sampleProjectMarkdown);
assert(opened.document.graph.nodes.length >= 1, 'sample nodes');
assert(opened.document.graph.edges.length >= 1, 'sample edges');
assert(
  opened.document.display.mermaidSource.includes('flowchart')
    || (opened.document.display.lmdSource ?? '').includes('# 关系'),
  'display source present',
);
assert(
  opened.diagnostics.every((item) => item.severity !== 'error'),
  `sample should be error-free: ${opened.diagnostics.map((item) => item.code).join(',')}`,
);

assertRoundTrip(sampleProjectMarkdown);
assertLegacyBridge();

const empty = openLmd('');
assert(empty.ok === false, 'empty text is not ok');
assert(empty.diagnostics.some((item) => item.code === 'LMD002'), 'empty text → LMD002');

const session = createSession(sampleProjectMarkdown);
const created = session.apply({ op: 'node.create', title: '内核节点' });
assert(created.createdIds?.length === 1, 'node.create returns id');
assert(
  session.document.graph.nodes.some((node) => node.title === '内核节点'),
  'created node in IR',
);
assert(session.print().includes('内核节点'), 'print contains created node');
assert(session.print().includes('@project:'), 'print is instruction language');
assert(!session.print().includes('```mermaid'), 'print is not mermaid');
assert(!session.print().includes('lths-compat'), 'print is relation-only');
const printedMeta = JSON.parse(session.printMeta()) as { v?: number };
assert(printedMeta.v === 1, 'printMeta writes sibling json');

session.apply({ op: 'project.update', name: 'Kernel Title', summary: 'from command' });
assert(session.document.project.name === 'Kernel Title', 'project.update name');

session.document = {
  ...session.document,
  project: { ...session.document.project, name: '' },
  graph: {
    ...session.document.graph,
    edges: [
      ...session.document.graph.edges,
      { id: 'dangling_test', from: 'missing_a', to: 'missing_b', label: '', kind: 'solid' },
    ],
  },
};
const checked = session.check();
assert(checked.some((item) => item.code === 'LMD301'), 'empty name → LMD301');
assert(checked.some((item) => item.code === 'LMD110'), 'dangling edge → LMD110');
session.apply({ op: 'doc.fix', mode: 'suggest' });
assert(session.document.project.name === 'Untitled Project', 'safe fix fills name');
assert(
  !session.document.graph.edges.some((edge) => edge.id === 'dangling_test'),
  'suggest fix drops dangling edge',
);

const analysis = session.analyze();
assert(analysis.components.length >= 1, 'analyze components');
assert(Array.isArray(analysis.paths), 'analyze paths');

const runtime = startRuntime(session.document, { authorized: new Set() });
assert(runtime.status === 'denied', 'runtime denied by default');
assert(createDeniedRuntime('x').diagnostics[0]?.code === 'LMD700', 'LMD700');

registerPlugin({
  manifest: {
    name: 'kernel-smoke',
    version: '0.0.0',
    engineRange: '1',
    contributions: ['command'],
  },
});
assert(listPlugins().some((item) => item.name === 'kernel-smoke'), 'plugin registry');
unregisterPlugin('kernel-smoke');

const adapter = createMemoryAdapter();
const applied = adapter.invoke({
  document: createSession(sampleProjectMarkdown).document,
  command: { op: 'project.update', name: 'Adapter' },
});
assert(applied.document.project.name === 'Adapter', 'memory adapter dispatch');

console.log(
  `[lmd-kernel] ok · nodes=${opened.document.graph.nodes.length} edges=${opened.document.graph.edges.length} commands=${COMMAND_CATALOG.length}`,
);
