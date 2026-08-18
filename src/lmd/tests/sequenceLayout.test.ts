/**
 * Sequence block geometry.
 * Run: npx --yes tsx src/lmd/tests/sequenceLayout.test.ts
 */
import { parseLmd, toLegacyDocument } from '@lths/lmd';
import {
  addSequenceMessageInDocument,
  addSequenceParticipantInDocument,
  createSequenceSceneInDocument,
  renameSequenceParticipantInDocument,
} from '../application/editing/sequence';
import {
  hitSequenceFrame,
  hitSequenceInterior,
  insertSequenceMessageAt,
  intersectingSequenceFrameIds,
  intersectingSequenceInterior,
  layoutSequenceScene,
  measureSequenceScene,
  reorderSequenceSteps,
  searchFreeSequenceOrigin,
  sequenceColumnInsertIndex,
  sequenceConnectArrow,
  sequenceConnectStart,
  sequenceConnectTarget,
  sequenceMessageIndexAt,
  sequenceMessageInsertIndex,
  syncSequenceFrames,
} from '../placement/sequence';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const opened = parseLmd(`@project:"登录"

# 时序
@seq:"密码登录"(
  "用户" >> |"POST /login"| "网关"
  "网关" >> |"校验"| "鉴权"
  "鉴权" << |"ok"| "网关"
)
`, { fallbackName: '登录' });
const scene = opened.document.sequence.scenes[0];
assert(scene, 'scene exists');
assert(scene.participants.length === 3, 'auto columns');

const size = measureSequenceScene(scene);
assert(size.width >= 280, 'min width');
assert(size.height >= 160, 'min height');

const model = layoutSequenceScene(scene, { id: scene.id, x: 40, y: 80, width: size.width, height: size.height });
assert(model.columns.length === 3, 'paint columns');
assert(model.messages.length === 3, 'paint messages');
assert(model.columns[0]?.title === '用户', 'first appearance order');
assert(model.messages[0]?.id, 'message ids exist for hit');
const user = scene.participants.find((item) => item.title === '用户');
const gateway = scene.participants.find((item) => item.title === '网关');
const auth = scene.participants.find((item) => item.title === '鉴权');
assert(user && gateway && auth, 'named columns');
assert(model.columns.every((column) => (
  column.bottomChip.x === column.chip.x
  && column.bottomChip.width === column.chip.width
  && column.bottomChip.height === column.chip.height
  && Math.abs(column.x - (column.chip.x + column.chip.width / 2)) < 0.01
  && Math.abs(column.x - (column.bottomChip.x + column.bottomChip.width / 2)) < 0.01
  && column.bottomChip.y > column.chip.y
)), 'top and bottom chips stay aligned');
assert(model.activations.filter((item) => item.participantId === user.id).length === 0, 'sender has no activation bar');
const gatewayBar = model.activations.find((item) => item.participantId === gateway.id);
const authBar = model.activations.find((item) => item.participantId === auth.id);
assert(gatewayBar, 'callee gets an activation bar');
assert(authBar, 'nested callee gets an activation bar');
assert(gatewayBar.y <= model.messages[0]!.y && gatewayBar.y + gatewayBar.height >= model.messages[2]!.y, 'gateway bar spans call to return');
assert(authBar.y <= model.messages[1]!.y && authBar.y + authBar.height >= model.messages[2]!.y, 'auth bar spans nested call');
assert(hitSequenceFrame(model.frame, { x: 50, y: 90 }), 'hit inside');
assert(hitSequenceInterior(model, { x: model.columns[0]!.chip.x + 4, y: model.columns[0]!.chip.y + 4 })?.kind === 'participant', 'hit column chip');
assert(hitSequenceInterior(model, {
  x: model.columns[0]!.bottomChip.x + 4,
  y: model.columns[0]!.bottomChip.y + 4,
})?.kind === 'participant', 'hit mirrored bottom chip');
assert(hitSequenceInterior(model, {
  x: (model.messages[0]!.fromX + model.messages[0]!.toX) / 2,
  y: model.messages[0]!.y,
})?.kind === 'message', 'hit message');
assert(hitSequenceInterior(model, { x: model.addActor.x + 2, y: model.addActor.y + 2 })?.kind === 'add-actor', 'hit add column');
assert(gatewayBar && hitSequenceInterior(model, {
  x: gatewayBar.x + gatewayBar.width / 2,
  y: gatewayBar.y + gatewayBar.height / 2,
})?.kind === 'activation', 'hit activation bar');
assert(gatewayBar && sequenceConnectTarget(model, {
  x: gatewayBar.x + gatewayBar.width / 2,
  y: gatewayBar.y + 8,
})?.id === gateway.id, 'connect target prefers the activation bar');
assert(sequenceConnectStart(model, {
  x: model.columns[0]!.x,
  y: model.messages[2]!.y + 24,
})?.id === user.id, 'connect can start from a lifeline');
assert(sequenceConnectArrow(model.columns[0]!.x, model.columns[1]!.x) === 'call', 'drag right is a call');
assert(sequenceConnectArrow(model.columns[1]!.x, model.columns[0]!.x) === 'return', 'drag left is a return');
assert(sequenceColumnInsertIndex(model, model.columns[0]!.x - 10) === 0, 'click left of first column inserts first');
assert(sequenceColumnInsertIndex(model, (model.columns[0]!.x + model.columns[1]!.x) / 2) === 1, 'click between columns inserts in the gap');
assert(sequenceColumnInsertIndex(model, model.columns[2]!.x + 10) === 3, 'click right of last column appends');
assert(sequenceMessageInsertIndex(model, model.messages[0]!.y - 4) === 0, 'drop above first message inserts first');
assert(sequenceMessageInsertIndex(model, model.messages[2]!.y + 8) === 3, 'drop below last message appends');
assert(sequenceMessageIndexAt(model, model.messages[2]!.y) === 2, 'message index follows y');
const reordered = reorderSequenceSteps(scene.steps, model.messages[0]!.id, 2);
const reorderedIds = reordered
  .filter((step) => step.kind === 'message')
  .map((step) => step.kind === 'message' ? step.message.id : '');
assert(reorderedIds[0] === model.messages[1]!.id, 'first message moved down');
assert(reorderedIds[2] === model.messages[0]!.id, 'moved message sits last');
assert(!hitSequenceFrame(model.frame, { x: 0, y: 0 }), 'miss outside');

const placed = syncSequenceFrames([scene], [], { x: 0, y: 0, width: 200, height: 100 }, (value) => value);
assert(placed[0] && placed[0].x >= 200, 'unplaced block sits to the right of the graph');
assert(
  intersectingSequenceFrameIds([model.frame], { x: 30, y: 70, width: 40, height: 40 })[0] === scene.id,
  'box select hits the block',
);
assert(
  intersectingSequenceFrameIds([model.frame], { x: 0, y: 0, width: 10, height: 10 }).length === 0,
  'box select misses empty space',
);
const interior = intersectingSequenceInterior(model, {
  x: model.messages[0]!.hit.x,
  y: model.messages[0]!.hit.y,
  width: model.messages[0]!.hit.width,
  height: model.messages[0]!.hit.height,
});
assert(interior.messages[0] === model.messages[0]!.id, 'interior box hits a message');
assert(intersectingSequenceInterior(model, { x: 0, y: 0, width: 8, height: 8 }).messages.length === 0, 'interior box misses empty');

const emptyGraph = toLegacyDocument(parseLmd('@project:"空"\n\n# 关系\n@node:"Start"\n', { fallbackName: '空' }).document);
const created = createSequenceSceneInDocument(emptyGraph, { x: 80, y: 40 });
assert(created.document.sequence?.scenes.length === 1, 'canvas create adds a scene');
assert(created.document.sequence?.scenes[0]?.title === '新建时序', 'default title');
assert(created.document.source.includes('@seq:"新建时序"'), 'prints into # 时序');
assert(created.document.source.includes('"A" >> |"消息"| "B"'), 'starter message');
const again = createSequenceSceneInDocument(created.document);
assert(again.document.sequence?.scenes[1]?.title === '新建时序 2', 'second block is numbered');
const firstId = created.document.sequence?.scenes[0]?.id ?? '';
const withActor = addSequenceParticipantInDocument(created.document, firstId);
assert(withActor.document.sequence?.scenes[0]?.participants.length === 3, 'add column');
const insertedActor = addSequenceParticipantInDocument(created.document, firstId, undefined, 0);
assert(insertedActor.document.sequence?.scenes[0]?.participants[0]?.title === '参与者', 'add column at click index');
assert(withActor.document.source.includes('"参与者"'), 'unused column prints');
const renamed = renameSequenceParticipantInDocument(withActor.document, firstId, withActor.participantId, '网关');
assert(renamed.sequence?.scenes[0]?.participants.some((item) => item.title === '网关'), 'rename column');
const withMsg = addSequenceMessageInDocument(renamed, firstId);
assert(withMsg.document.sequence?.scenes[0]?.steps.length === 2, 'add message');
const inserted = addSequenceMessageInDocument(withMsg.document, firstId, { atIndex: 0, label: '插到前面' });
const insertedLabels = (inserted.document.sequence?.scenes[0]?.steps ?? [])
  .filter((step) => step.kind === 'message')
  .map((step) => step.message.label);
assert(insertedLabels[0] === '插到前面', 'add message at index');
const placedStep = insertSequenceMessageAt(
  withMsg.document.sequence?.scenes[0]?.steps ?? [],
  { kind: 'message', message: { id: 'm_mid', from: 'a', to: 'b', label: '中间', arrow: 'call' } },
  1,
);
const placedLabels = placedStep
  .filter((step) => step.kind === 'message')
  .map((step) => step.message.label);
assert(placedLabels[1] === '中间', 'insert message at index');
const nudged = searchFreeSequenceOrigin(
  [{ id: 'a', x: 0, y: 0, width: 100, height: 80 }],
  { x: 0, y: 0, width: 100, height: 80 },
  (value) => value,
);
assert(nudged.x !== 0 || nudged.y !== 0, 'new block does not sit on an existing one');

console.log('[sequenceLayout] ok');
