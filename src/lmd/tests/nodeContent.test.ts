/**
 * Title / description hit split for Project Graph-style inline edit.
 * Run: npx --yes tsx src/lmd/tests/nodeContent.test.ts
 */
import { layoutNodeContent, wrapNodeText } from '@lths/lmd/legacy';
import { fieldAtNodePoint, fitWrappedText, nodeContentBands } from '../placement';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log('nodeContent tests');

const named = {
  x: 100,
  y: 200,
  width: 180,
  height: 98,
  label: '评审完成\n通过',
};

const emptyDesc = {
  x: 0,
  y: 0,
  width: 180,
  height: 98,
  label: '产品说明',
};

const placeholder = {
  x: 0,
  y: 0,
  width: 180,
  height: 98,
  label: '新建节点',
};

test('named node always has a description band, even below a short title', () => {
  const bands = nodeContentBands(named);
  assert(bands.title.height >= 32, 'title band tall enough to click');
  assert(bands.description.height >= 24, 'description band tall enough to click');
  assertEqual(bands.title.y + bands.title.height, bands.description.y, 'bands share the split');
  assertEqual(bands.title.height + bands.description.height, named.height, 'bands fill the node');
});

test('empty description still reserves a clickable lower band', () => {
  const bands = nodeContentBands(emptyDesc);
  assertEqual(bands.parts.description, '', 'no description text');
  assert(bands.description.height >= 28, 'empty description is still a target');
});

test('click position picks the painted field', () => {
  const bands = nodeContentBands(named);
  assertEqual(
    fieldAtNodePoint(named, { x: named.x + 10, y: named.y + 8 }),
    'title',
    'upper band',
  );
  assertEqual(
    fieldAtNodePoint(named, { x: named.x + 10, y: bands.description.y + 4 }),
    'description',
    'lower band',
  );
});

test('long CJK title wraps and the card grows', () => {
  const title = '超长标题需要折行观察量宽';
  const description = '这是一段故意写得很长的描述，用来压测自动量高：包含接口契约、失败重试、以及跨分区一致性说明，避免短标签把所有盒子压成同一高度。';
  const wrapped = wrapNodeText(title, 13);
  assert(wrapped.length >= 2, `expected title wrap, got ${wrapped.length}`);
  const compact = layoutNodeContent('短标题', '一行说明');
  const tall = layoutNodeContent(title, description);
  assert(tall.width <= 240, `card width stays bounded, got ${tall.width}`);
  assert(tall.height > compact.height, `wrapped card ${tall.height} should be taller than ${compact.height}`);
  assert(tall.titleLines.length > 1, 'title occupies more than one line');
  assert(tall.descriptionLines.length > 1, 'description occupies more than one line');
  const bands = nodeContentBands({
    x: 0,
    y: 0,
    width: tall.width,
    height: tall.height,
    label: `${title}\n${description}`,
  });
  assert(bands.titleLines.length === tall.titleLines.length, 'band title lines match layout');
  assert(bands.title.height >= 32, 'wrapped title band stays clickable');
  assert(bands.title.height + bands.description.height === tall.height, 'bands fill the grown card');
});

test('title paint size caps when the view band grows', () => {
  const lines = ['超长标题需要折行观察量宽'];
  const zoomed = fitWrappedText({
    lines,
    bandWidth: 720,
    bandHeight: 294,
    maxFontPx: 13,
    lineHeightPx: 17,
  });
  assertEqual(zoomed.fontPx, 13, 'zoom-in keeps the design font');
});

test('title paint size shrinks so wrapped lines stay inside the node', () => {
  const lines = ['超长标题需要折行', '观察量宽'];
  const compact = fitWrappedText({
    lines,
    bandWidth: 80,
    bandHeight: 28,
    maxFontPx: 13,
    lineHeightPx: 17,
  });
  assert(compact.fontPx < 13, `expected shrink, got ${compact.fontPx}`);
  assert(compact.linePx * lines.length <= 28 + 0.01, 'block fits the band height');
});

test('long title keeps a readable size when the card is still tall', () => {
  const lines = ['超长标题需要折行观察量', '宽'];
  const namesLod = fitWrappedText({
    lines,
    bandWidth: 72,
    bandHeight: 73,
    maxFontPx: 13,
    lineHeightPx: 17,
  });
  assert(namesLod.fontPx >= 10, `long title must not crush to ${namesLod.fontPx}px`);
});

test('placeholder title always opens title, even on the lower half', () => {
  assertEqual(
    fieldAtNodePoint(placeholder, { x: 20, y: 80 }),
    'title',
    'placeholder',
  );
});

console.log(`nodeContent: ${passed} passed`);
