import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canImportLayer,
  DDD_LAYERS,
  LMD_CONTEXT_IMPORTS,
  LMD_CONTEXTS,
  type DddLayer,
  type LmdContext,
} from './shared-kernel/contexts';

const srcRoot = fileURLToPath(new URL('.', import.meta.url));
const FACADE_DIRS = new Set([
  'compat',
  'spec',
  'ir',
  'parse',
  'commands',
  'adapters',
  'sdk',
  'testkit',
  'legacy',
]);
const SKIP_FILES = new Set(['kernel.test.ts', 'layering.test.ts', 'index.ts']);

function walk(dir: string, acc: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

function locate(file: string): { context: LmdContext; layer: DddLayer | null } | null {
  const rel = relative(srcRoot, file);
  const parts = rel.split(sep);
  const top = parts[0] ?? '';
  if (FACADE_DIRS.has(top) || top.endsWith('.ts')) {
    return null;
  }
  if (!(LMD_CONTEXTS as readonly string[]).includes(top)) {
    return null;
  }
  const context = top as LmdContext;
  const maybeLayer = parts[1];
  const layer = (DDD_LAYERS as readonly string[]).includes(maybeLayer ?? '')
    ? (maybeLayer as DddLayer)
    : null;
  return { context, layer };
}

function resolveImport(fromFile: string, specifier: string): { context: LmdContext; layer: DddLayer | null } | null {
  if (specifier === '@lths/lmd') {
    return { context: 'composition', layer: null };
  }
  if (specifier.startsWith('@lths/lmd/')) {
    const sub = specifier.slice('@lths/lmd/'.length).split('/')[0] ?? '';
    const mapped: Record<string, LmdContext> = {
      spec: 'shared-kernel',
      shared: 'shared-kernel',
      ir: 'document',
      document: 'document',
      parse: 'display',
      display: 'display',
      commands: 'editing',
      editing: 'editing',
      sdk: 'composition',
      testkit: 'composition',
      adapters: 'composition',
      legacy: 'display',
    };
    const context = mapped[sub] ?? ((LMD_CONTEXTS as readonly string[]).includes(sub) ? (sub as LmdContext) : 'composition');
    return { context, layer: null };
  }
  if (!specifier.startsWith('.')) {
    return null;
  }
  const resolved = join(dirname(fromFile), specifier);
  const candidates = [resolved, `${resolved}.ts`, join(resolved, 'index.ts')];
  for (const candidate of candidates) {
    const located = locate(candidate);
    if (located) {
      return located;
    }
  }
  return locate(`${resolved}.ts`);
}

const importPattern = /from\s+['"]([^'"]+)['"]/g;
const files = walk(srcRoot).filter((file) => {
  const rel = relative(srcRoot, file);
  const top = rel.split(sep)[0] ?? '';
  if (FACADE_DIRS.has(top)) {
    return false;
  }
  return !SKIP_FILES.has(rel.split(sep).pop() ?? '');
});

const violations: string[] = [];

for (const file of files) {
  const from = locate(file);
  if (!from) {
    continue;
  }
  const allowed = LMD_CONTEXT_IMPORTS[from.context];
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? '';
    const to = resolveImport(file, specifier);
    if (!to) {
      continue;
    }
    if (to.context === from.context) {
      if (!canImportLayer(from.layer, to.layer)) {
        violations.push(
          `${from.context}/${from.layer ?? 'root'} → ${to.context}/${to.layer ?? 'root'} (${relative(srcRoot, file)} imports ${specifier})`,
        );
      }
      continue;
    }
    if (allowed === '*') {
      continue;
    }
    if (!allowed.includes(to.context)) {
      violations.push(
        `${from.context} → ${to.context} (${relative(srcRoot, file)} imports ${specifier})`,
      );
    }
  }
}

if (violations.length > 0) {
  throw new Error(`DDD layering violations:\n${violations.map((item) => `  - ${item}`).join('\n')}`);
}

console.log(`[lmd-kernel] DDD layering ok · files=${files.length}`);
