/**
 * Mind-map block geometry and editing.
 * Run: npx --yes tsx src/lmd/tests/mindLayout.test.ts
 */
import { parseLmd, toLegacyDocument } from '@lths/lmd';
import {
  addMindTopicInDocument,
  createMindMapInDocument,
  renameMindTopicInDocument,
} from '../application/editing/mind';
import {
  hitMindFrame,
  hitMindInterior,
  intersectingMindFrameIds,
  layoutMindMap,
  measureMindMap,
  searchFreeMindOrigin,
  syncMindFrames,
} from '../placement/mind';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const opened = parseLmd(`@project:"树"

# 思维导图
@mind:"项目路径"(
  "src"[@comment:"业务代码"]
  "core"[@comment:"核心引擎"]
    "audio"
    "video"
    "canva2d"[@comment:"画布"]
  "asset"
  "其他"
)
`, { fallbackName: '树' });
const map = opened.document.mind.maps[0];
assert(map, 'map exists');
assert(map.children.map((item) => item.title).join(',') === 'src,core,asset,其他', 'top children');
assert(map.children[1]?.children.length === 3, 'core children');

const size = measureMindMap(map);
assert(size.width >= 220, 'min width');
assert(size.height >= 140, 'min height');

const model = layoutMindMap(map, { id: map.id, x: 40, y: 80, width: size.width, height: size.height });
assert(model.root.title === '项目路径', 'root is the map title');
assert(model.nodes.length === 7, 'paint topics exclude the root');
assert(model.links.length === 7, 'every topic has a parent link');
assert(hitMindFrame(model.frame, { x: 50, y: 90 }), 'hit inside');
assert(hitMindInterior(model, { x: model.nodes[0]!.box.x + 4, y: model.nodes[0]!.box.y + 4 })?.kind === 'topic', 'hit topic');
assert(hitMindInterior(model, { x: model.addTopic.x + 2, y: model.addTopic.y + 2 })?.kind === 'add-topic', 'hit add');
assert(hitMindInterior(model, { x: model.frame.x + 16, y: model.frame.y + 10 })?.kind === 'title', 'hit title');
assert(!hitMindFrame(model.frame, { x: 0, y: 0 }), 'miss outside');

const placed = syncMindFrames([map], [], { x: 0, y: 0, width: 200, height: 100 }, (value) => value);
assert(placed[0] && placed[0].x >= 200, 'unplaced block sits to the right of the graph');
assert(
  intersectingMindFrameIds([model.frame], { x: 30, y: 70, width: 40, height: 40 })[0] === map.id,
  'box select hits the block',
);
const origin = searchFreeMindOrigin([], { x: 10, y: 10, width: 80, height: 60 }, (value) => value);
assert(origin.x === 10 && origin.y === 10, 'free origin stays put');

const emptyGraph = toLegacyDocument(parseLmd('@project:"空"\n\n# 关系\n@node:"Start"\n', { fallbackName: '空' }).document);
const created = createMindMapInDocument(emptyGraph, { x: 80, y: 40 });
assert(created.document.mind?.maps.length === 1, 'canvas create adds a map');
assert(created.document.mind?.maps[0]?.title === '思维导图', 'default title');
assert(created.document.source.includes('@mind:"思维导图"'), 'prints into # 思维导图');
assert(created.document.source.includes('"主题"'), 'starter topic');
const again = createMindMapInDocument(created.document);
assert(again.document.mind?.maps[1]?.title === '思维导图 2', 'second block is numbered');
const firstId = created.document.mind?.maps[0]?.id ?? '';
const withTopic = addMindTopicInDocument(created.document, firstId);
assert(withTopic.document.mind?.maps[0]?.children.length === 2, 'add topic under root');
const child = addMindTopicInDocument(withTopic.document, firstId, withTopic.topicId);
assert(child.document.mind?.maps[0]?.children[1]?.children.length === 1, 'add child topic');
const renamed = renameMindTopicInDocument(child.document, firstId, withTopic.topicId, 'src');
assert(renamed.mind?.maps[0]?.children.some((item) => item.title === 'src'), 'rename topic');

console.log('[mind-layout] ok');
