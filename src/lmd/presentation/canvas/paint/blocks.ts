import { isCanvasIdSelected, mindMapIdOf, sequenceSceneIdOf } from '../../../domain/selection';
import {
  layoutMindMap,
  layoutSequenceScene,
  mindFrameAsRect,
  sequenceConnectArrow,
  sequenceConnectAttachX,
  sequenceConnectTarget,
  sequenceFrameAsRect,
} from '../../../placement';
import { paintMindBlock } from '../mindPaint';
import { paintSequenceActivationHighlight, paintSequenceBlock, paintSequenceConnectPreview } from '../sequencePaint';
import { rectIntersects, type Rect } from '../math';
import type { SceneContext } from './context';
import { screenPx } from './context';

function isOverView(view: Rect, r: Rect) {
  return !rectIntersects(view, r);
}

export function paintSequenceBlocks(
  ctx: CanvasRenderingContext2D,
  scene: SceneContext,
  cullView: Rect,
  interactive: boolean,
) {
  const sceneId = sequenceSceneIdOf(scene.selection);
  const selectedActorId = scene.selection.kind === 'seq-actor' ? scene.selection.ids[0] ?? null : null;
  const selectedMessageId = scene.selection.kind === 'seq-message' ? scene.selection.ids[0] ?? null : null;
  for (const frame of scene.seqFrames) {
    if (isOverView(cullView, sequenceFrameAsRect(frame))) {
      continue;
    }
    const seq = scene.doc.sequence?.scenes.find((item) => item.id === frame.id);
    if (!seq) {
      continue;
    }
    paintSequenceBlock(ctx, layoutSequenceScene(seq, frame), {
      selected: interactive && (sceneId === frame.id || isCanvasIdSelected(scene.selection, 'sequence', frame.id)),
      selectedActorId: sceneId === frame.id ? selectedActorId : null,
      selectedMessageId: sceneId === frame.id ? selectedMessageId : null,
      screenPx: (value) => screenPx(scene, value),
    });
  }
}

export function paintMindBlocks(
  ctx: CanvasRenderingContext2D,
  scene: SceneContext,
  cullView: Rect,
  interactive: boolean,
) {
  const mapId = mindMapIdOf(scene.selection);
  const selectedTopicId = scene.selection.kind === 'mind-node' ? scene.selection.ids[0] ?? null : null;
  for (const frame of scene.mindFrames) {
    if (isOverView(cullView, mindFrameAsRect(frame))) {
      continue;
    }
    const map = scene.doc.mind?.maps.find((item) => item.id === frame.id);
    if (!map) {
      continue;
    }
    paintMindBlock(ctx, layoutMindMap(map, frame), {
      selected: interactive && (mapId === frame.id || isCanvasIdSelected(scene.selection, 'mind', frame.id)),
      selectedTopicId: mapId === frame.id ? selectedTopicId : null,
      screenPx: (value) => screenPx(scene, value),
    });
  }
}

export function paintSequenceConnect(ctx: CanvasRenderingContext2D, scene: SceneContext) {
  if (scene.drag.type !== 'seq-connect') {
    return;
  }
  const drag = scene.drag;
  const model = scene.sequenceModel(drag.sceneId);
  const from = model?.columns.find((item) => item.id === drag.fromId);
  if (!from || !model) {
    return;
  }
  const target = sequenceConnectTarget(model, drag.currentWorld);
  const toX = target ? sequenceConnectAttachX(from.x, target) : drag.currentWorld.x;
  const arrow = sequenceConnectArrow(from.x, toX, drag.arrow === 'return');
  if (target?.bar) {
    paintSequenceActivationHighlight(ctx, target.bar, (value) => screenPx(scene, value));
  }
  paintSequenceConnectPreview(
    ctx,
    from.x,
    drag.currentWorld.y,
    toX,
    drag.currentWorld.y,
    (value) => screenPx(scene, value),
    { snapped: Boolean(target && target.id !== drag.fromId), arrow },
  );
}
