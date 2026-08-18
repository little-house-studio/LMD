/**
 * Editor DDD layering: domain cannot import application/infrastructure/presentation;
 * application cannot import presentation; infrastructure cannot import presentation.
 * Run: npx --yes tsx src/lmd/tests/layering.test.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = fileURLToPath(new URL('..', import.meta.url));
const LAYERS = ['shared', 'domain', 'placement', 'application', 'infrastructure', 'presentation'] as const;
type Layer = (typeof LAYERS)[number];

const ALLOWED: Record<Layer, readonly Layer[]> = {
  shared: ['shared'],
  domain: ['shared', 'domain'],
  placement: ['shared', 'domain', 'placement'],
  application: ['shared', 'domain', 'placement', 'application', 'infrastructure'],
  infrastructure: ['shared', 'domain', 'placement', 'application', 'infrastructure'],
  presentation: LAYERS,
};

function walk(dir: string, acc: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'tests') {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      acc.push(full);
    }
  }
  return acc;
}

function layerOf(file: string): Layer | null {
  const rel = relative(srcRoot, file);
  const top = rel.split(sep)[0] ?? '';
  return (LAYERS as readonly string[]).includes(top) ? (top as Layer) : null;
}

function resolveImport(fromFile: string, specifier: string): Layer | null {
  if (!specifier.startsWith('.')) {
    return null;
  }
  const resolved = join(dirname(fromFile), specifier);
  const candidates = [resolved, `${resolved}.ts`, `${resolved}.tsx`, join(resolved, 'index.ts')];
  for (const candidate of candidates) {
    const layer = layerOf(candidate);
    if (layer) {
      return layer;
    }
  }
  return layerOf(`${resolved}.ts`);
}

const importPattern = /from\s+['"]([^'"]+)['"]/g;
const files = walk(srcRoot);
const violations: string[] = [];

for (const file of files) {
  const from = layerOf(file);
  if (!from) {
    continue;
  }
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? '';
    const to = resolveImport(file, specifier);
    if (!to) {
      continue;
    }
    if (!ALLOWED[from].includes(to)) {
      violations.push(`${from} → ${to} (${relative(srcRoot, file)} imports ${specifier})`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Editor DDD layering violations:\n${violations.map((item) => `  - ${item}`).join('\n')}`);
}

console.log(`[lmd-editor] DDD layering ok · files=${files.length}`);
