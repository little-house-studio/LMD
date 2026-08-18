import { readFileSync } from 'node:fs';
import { COMMAND_CATALOG } from '../editing/domain/catalog';
import type { LmdCommand } from '../editing/domain/command';
import { createSession, openLmd } from './sdk/session';

function readInput(path?: string) {
  if (!path || path === '-') {
    return readFileSync(0, 'utf8');
  }
  return readFileSync(path, 'utf8');
}

function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  process.stderr.write(`lmd <check|parse|print|mermaid|from-mermaid|cmd|catalog|analyze> [file] [op] [json-args]\n`);
}

const [verb = '', file, op, ...rest] = process.argv.slice(2);

if (!verb || verb === 'help' || verb === '--help') {
  usage();
  process.exit(verb ? 0 : 1);
}

if (verb === 'catalog') {
  printJson(COMMAND_CATALOG);
  process.exit(0);
}

const text = ['check', 'parse', 'print', 'mermaid', 'from-mermaid', 'cmd', 'analyze'].includes(verb)
  ? readInput(file)
  : '';

if (verb === 'check') {
  const opened = openLmd(text);
  printJson({ ok: opened.ok, diagnostics: opened.diagnostics });
  process.exit(opened.ok ? 0 : 2);
}

if (verb === 'parse') {
  const opened = openLmd(text);
  printJson({
    ok: opened.ok,
    diagnostics: opened.diagnostics,
    project: opened.document.project,
    nodes: opened.document.graph.nodes.length,
    edges: opened.document.graph.edges.length,
    groups: opened.document.graph.groups.length,
  });
  process.exit(opened.ok ? 0 : 2);
}

if (verb === 'print') {
  const session = createSession(text);
  process.stdout.write(session.print());
  process.exit(0);
}

if (verb === 'mermaid') {
  const session = createSession(text);
  process.stdout.write(`${session.printMermaid()}\n`);
  process.exit(0);
}

if (verb === 'from-mermaid') {
  const session = createSession(text);
  process.stdout.write(session.print());
  process.exit(0);
}

if (verb === 'analyze') {
  const session = createSession(text);
  printJson(session.analyze());
  process.exit(0);
}

if (verb === 'cmd') {
  if (!op) {
    usage();
    process.exit(1);
  }
  const args = rest.join(' ').trim();
  const parsedArgs = args ? JSON.parse(args) as Record<string, unknown> : {};
  const session = createSession(text);
  const result = session.apply({ op, ...parsedArgs } as LmdCommand);
  printJson({
    diagnostics: result.diagnostics,
    createdIds: result.createdIds,
    project: session.document.project,
    print: session.print(),
  });
  process.exit(result.diagnostics.some((item) => item.severity === 'error') ? 2 : 0);
}

usage();
process.exit(1);
