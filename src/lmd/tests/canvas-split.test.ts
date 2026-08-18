/**
 * Canvas / shell split: paint, hit, clone, and hotkeys stay engine-free.
 * Run: npx --yes tsx src/lmd/tests/canvas-split.test.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloneWorkingDocument } from '../application/editing/clone';
import { resolveCanvasHotkey } from '../presentation/shell/canvasHotkeys';
import { createDefaultLayout, type GraphDocument } from '..';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const srcRoot = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string, acc: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

const engineImport = /from\s+['"][^'"]*engine['"]/;
for (const dir of [
  join(srcRoot, 'presentation', 'canvas', 'paint'),
  join(srcRoot, 'presentation', 'canvas', 'interact'),
]) {
  for (const file of walk(dir)) {
    const source = readFileSync(file, 'utf8');
    assert(!engineImport.test(source), `${file} must not import engine.ts`);
  }
}

const clone = readFileSync(join(srcRoot, 'application', 'editing', 'clone.ts'), 'utf8');
assert(!clone.includes('presentation'), 'cloneWorkingDocument must stay presentation-free');

const hotkeys = readFileSync(join(srcRoot, 'presentation', 'shell', 'canvasHotkeys.ts'), 'utf8');
assert(!hotkeys.includes('from \'react\''), 'hotkey table must stay React-free');
assert(!engineImport.test(hotkeys), 'hotkey table must not import engine');

const parsed: GraphDocument = {
  diagramType: 'flowchart',
  direction: 'LR',
  nodes: [{
    id: 'a',
    label: 'A',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 120,
    height: 56,
    fill: '#111',
    stroke: '#fff',
    textColor: '#fff',
    subgraphId: null,
  }],
  edges: [],
  subgraphs: [],
  warnings: [],
  unsupportedLines: [],
  source: '',
  layout: createDefaultLayout(),
};
const copied = cloneWorkingDocument(parsed);
assert(copied.nodes.length === parsed.nodes.length, 'clone keeps nodes');
assert(copied.nodes[0] !== parsed.nodes[0], 'clone copies node objects');
copied.nodes[0]!.x += 10;
assert(copied.nodes[0]!.x !== parsed.nodes[0]!.x, 'clone is detached');

const undo = resolveCanvasHotkey(
  { key: 'z', metaKey: true, ctrlKey: false, shiftKey: false, code: 'KeyZ' } as KeyboardEvent,
  { typing: false, helpOpen: false, mode: 'canvas', selectionKind: 'none', selectionCount: 0 },
);
assert(undo.type === 'undo', '⌘Z is undo');

const createMind = resolveCanvasHotkey(
  { key: 'w', metaKey: false, ctrlKey: false, shiftKey: false, code: 'KeyW' } as KeyboardEvent,
  { typing: false, helpOpen: false, mode: 'canvas', selectionKind: 'none', selectionCount: 0 },
);
assert(createMind.type === 'create-mind', 'W creates a mind map');

const blocked = resolveCanvasHotkey(
  { key: 'w', metaKey: false, ctrlKey: false, shiftKey: false, code: 'KeyW' } as KeyboardEvent,
  { typing: false, helpOpen: true, mode: 'canvas', selectionKind: 'none', selectionCount: 0 },
);
assert(blocked.type === 'none', 'help overlay swallows keys except Escape');

console.log('[canvas-split] ok');
