import { frameAsRect } from '../../../infrastructure/layout';
import { mindFrameAsRect, sequenceFrameAsRect } from '../../../placement';
import { unionRects, type Rect } from '../math';
import type { SceneContext } from '../paint/context';

export function selectionWorldBounds(scene: SceneContext): Rect | null {
  const { selection } = scene;
  if (selection.kind === 'none' || selection.ids.length === 0) {
    return null;
  }
  const rects: Rect[] = [];
  if (selection.kind === 'mixed') {
    for (const id of selection.nodes) {
      const node = scene.nodeMap.get(id);
      if (node) {
        rects.push({ x: node.x, y: node.y, width: node.width, height: node.height });
      }
    }
    for (const id of selection.groups) {
      const rect = scene.groupRectCache.get(id);
      if (rect) {
        rects.push(rect);
      }
    }
    for (const id of selection.sequences) {
      const frame = scene.seqFrames.find((item) => item.id === id);
      if (frame) {
        rects.push(sequenceFrameAsRect(frame));
      }
    }
    for (const id of selection.minds) {
      const frame = scene.mindFrames.find((item) => item.id === id);
      if (frame) {
        rects.push(mindFrameAsRect(frame));
      }
    }
    for (const id of selection.frames) {
      const frame = scene.frameById(id);
      if (frame) {
        rects.push(frameAsRect(frame));
      }
    }
    return unionRects(rects);
  }
  if (selection.kind === 'node') {
    for (const id of selection.ids) {
      const n = scene.nodeMap.get(id);
      if (n) {
        rects.push({ x: n.x, y: n.y, width: n.width, height: n.height });
      }
    }
  } else if (selection.kind === 'group') {
    for (const id of selection.ids) {
      const r = scene.groupRectCache.get(id);
      if (r) {
        rects.push(r);
      }
    }
  } else if (selection.kind === 'frame') {
    for (const id of selection.ids) {
      const frame = scene.frameById(id);
      if (frame) {
        rects.push(frameAsRect(frame));
      }
    }
  } else if (selection.kind === 'sequence') {
    for (const id of selection.ids) {
      const frame = scene.seqFrames.find((item) => item.id === id);
      if (frame) {
        rects.push(sequenceFrameAsRect(frame));
      }
    }
  } else if (selection.kind === 'seq-actor' || selection.kind === 'seq-message') {
    const model = scene.sequenceModel(selection.sceneId);
    if (model) {
      for (const id of selection.ids) {
        if (selection.kind === 'seq-actor') {
          const column = model.columns.find((item) => item.id === id);
          if (column) {
            rects.push(column.chip);
          }
        } else {
          const message = model.messages.find((item) => item.id === id);
          if (message) {
            rects.push(message.hit);
          }
        }
      }
    }
  } else if (selection.kind === 'mind') {
    for (const id of selection.ids) {
      const frame = scene.mindFrames.find((item) => item.id === id);
      if (frame) {
        rects.push(mindFrameAsRect(frame));
      }
    }
  } else if (selection.kind === 'mind-node') {
    const model = scene.mindModel(selection.mapId);
    if (model) {
      for (const id of selection.ids) {
        const topic = model.nodes.find((item) => item.id === id) ?? (model.root.id === id ? model.root : null);
        if (topic) {
          rects.push(topic.box);
        }
      }
    }
  } else if (selection.kind === 'edge') {
    for (const id of selection.ids) {
      const e = scene.doc.edges.find((edge) => edge.id === id);
      if (!e) {
        continue;
      }
      const from = scene.nodeMap.get(e.from);
      const to = scene.nodeMap.get(e.to);
      if (from) {
        rects.push({ x: from.x, y: from.y, width: from.width, height: from.height });
      }
      if (to) {
        rects.push({ x: to.x, y: to.y, width: to.width, height: to.height });
      }
    }
  }
  return unionRects(rects);
}
