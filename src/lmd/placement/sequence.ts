import type { SequenceSceneIR, SequenceStepIR } from '@lths/lmd';
import { rectIntersects, type Rect } from '../shared/geom';

export const SEQ_HEADER = 36;
export const SEQ_COL_W = 148;
export const SEQ_ROW_H = 46;
export const SEQ_PAD = 22;
export const SEQ_MIN_WIDTH = 280;
export const SEQ_MIN_HEIGHT = 188;
export const SEQ_CHIP_W = 112;
export const SEQ_CHIP_H = 24;
export const SEQ_CHIP_TOP = 6;
export const SEQ_ADD_SIZE = 22;
export const SEQ_BODY_TOP = SEQ_CHIP_TOP + SEQ_CHIP_H + 18;
export const SEQ_FOOTER = SEQ_CHIP_TOP + SEQ_CHIP_H + 10;
export const SEQ_ACT_W = 10;

export type SequenceFrame = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SequencePaintMessage = {
  id: string;
  y: number;
  fromX: number;
  toX: number;
  label: string;
  arrow: 'call' | 'return';
  self: boolean;
  hit: Rect;
};

export type SequencePaintFragment = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};

export type SequencePaintColumn = {
  id: string;
  title: string;
  x: number;
  chip: Rect;
  bottomChip: Rect;
};

export type SequencePaintActivation = {
  participantId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  stack: number;
};

export type SequencePaintModel = {
  frame: SequenceFrame;
  title: string;
  titleHit: Rect;
  addActor: Rect;
  columns: SequencePaintColumn[];
  messages: SequencePaintMessage[];
  fragments: SequencePaintFragment[];
  activations: SequencePaintActivation[];
};

export type SequenceInteriorHit =
  | { kind: 'title' }
  | { kind: 'add-actor' }
  | { kind: 'participant'; id: string }
  | { kind: 'message'; id: string }
  | { kind: 'activation'; id: string }
  | { kind: 'lifeline'; id: string }
  | { kind: 'body' };

export type SequenceConnectTarget = {
  id: string;
  x: number;
  bar?: SequencePaintActivation;
};

type FlatRow =
  | { kind: 'message'; id: string; from: string; to: string; label: string; arrow: 'call' | 'return' }
  | { kind: 'frag-start'; title: string; type: string }
  | { kind: 'frag-end' };

export function flattenSequenceSteps(steps: SequenceStepIR[]): FlatRow[] {
  const rows: FlatRow[] = [];
  const visit = (items: SequenceStepIR[]) => {
    for (const step of items) {
      if (step.kind === 'message') {
        rows.push({
          kind: 'message',
          id: step.message.id,
          from: step.message.from,
          to: step.message.to,
          label: step.message.label,
          arrow: step.message.arrow,
        });
        continue;
      }
      rows.push({ kind: 'frag-start', title: step.fragment.title, type: step.fragment.type });
      visit(step.fragment.steps);
      rows.push({ kind: 'frag-end' });
    }
  };
  visit(steps);
  return rows;
}

export function measureSequenceScene(scene: SequenceSceneIR) {
  const cols = Math.max(1, scene.participants.length);
  const rows = flattenSequenceSteps(scene.steps).filter((row) => row.kind === 'message').length;
  return {
    width: Math.max(SEQ_MIN_WIDTH, SEQ_PAD * 2 + cols * SEQ_COL_W),
    height: Math.max(SEQ_MIN_HEIGHT, SEQ_HEADER + SEQ_BODY_TOP + Math.max(rows, 1) * SEQ_ROW_H + SEQ_FOOTER),
  };
}

export function inferSequenceActivations(
  messages: Array<{ from: string; to: string; arrow: 'call' | 'return'; y: number }>,
  colX: (id: string) => number,
): SequencePaintActivation[] {
  const stacks = new Map<string, Array<{ id: string; startLine: number; stack: number }>>();
  const closed: Array<{ id: string; startLine: number; endLine: number; stack: number }> = [];
  messages.forEach((message, line) => {
    if (message.arrow === 'call') {
      const stack = stacks.get(message.to) ?? [];
      stack.push({ id: message.to, startLine: line, stack: stack.length });
      stacks.set(message.to, stack);
      return;
    }
    const stack = stacks.get(message.from) ?? [];
    const open = stack.pop();
    if (open) {
      closed.push({ ...open, endLine: line });
    }
  });
  const last = Math.max(0, messages.length - 1);
  for (const stack of stacks.values()) {
    while (stack.length > 0) {
      const open = stack.pop();
      if (open) {
        closed.push({ ...open, endLine: last });
      }
    }
  }
  return closed.map((item) => {
    const startY = messages[item.startLine]?.y ?? 0;
    const endY = messages[item.endLine]?.y ?? startY;
    const center = colX(item.id);
    return {
      participantId: item.id,
      x: center - SEQ_ACT_W / 2 + item.stack * (SEQ_ACT_W / 2),
      y: startY - 3,
      width: SEQ_ACT_W,
      height: Math.max(14, endY - startY + 6),
      stack: item.stack,
    };
  });
}

function activationEdgeX(
  activations: SequencePaintActivation[],
  participantId: string,
  y: number,
  side: 'left' | 'right',
  fallback: number,
) {
  const hits = activations.filter((item) => (
    item.participantId === participantId
    && y >= item.y - 1
    && y <= item.y + item.height + 1
  ));
  if (hits.length === 0) {
    return fallback;
  }
  const bar = hits.reduce((best, item) => (item.stack >= best.stack ? item : best));
  return side === 'left' ? bar.x : bar.x + bar.width;
}

export function layoutSequenceScene(scene: SequenceSceneIR, frame: SequenceFrame): SequencePaintModel {
  const size = measureSequenceScene(scene);
  const width = Math.max(frame.width, size.width);
  const height = Math.max(frame.height, size.height);
  const inner = width - SEQ_PAD * 2;
  const colW = scene.participants.length > 0 ? inner / scene.participants.length : inner;
  const columns = scene.participants.map((item, index) => {
    const x = frame.x + SEQ_PAD + index * colW + colW / 2;
    return {
      id: item.id,
      title: item.title,
      x,
      chip: {
        x: x - SEQ_CHIP_W / 2,
        y: frame.y + SEQ_HEADER + SEQ_CHIP_TOP,
        width: SEQ_CHIP_W,
        height: SEQ_CHIP_H,
      },
      bottomChip: {
        x: x - SEQ_CHIP_W / 2,
        y: frame.y + height - SEQ_CHIP_TOP - SEQ_CHIP_H,
        width: SEQ_CHIP_W,
        height: SEQ_CHIP_H,
      },
    };
  });
  const colX = (id: string) => columns.find((item) => item.id === id)?.x ?? frame.x + width / 2;

  const rows = flattenSequenceSteps(scene.steps);
  const draft: Array<{
    id: string;
    from: string;
    to: string;
    label: string;
    arrow: 'call' | 'return';
    y: number;
    fromX: number;
    toX: number;
    self: boolean;
  }> = [];
  const fragments: SequencePaintFragment[] = [];
  const stack: Array<{ start: number; title: string; type: string }> = [];
  let line = 0;
  for (const row of rows) {
    if (row.kind === 'message') {
      draft.push({
        id: row.id,
        from: row.from,
        to: row.to,
        label: row.label,
        arrow: row.arrow,
        y: frame.y + SEQ_HEADER + SEQ_BODY_TOP + line * SEQ_ROW_H,
        fromX: colX(row.from),
        toX: colX(row.to),
        self: row.from === row.to,
      });
      line += 1;
      continue;
    }
    if (row.kind === 'frag-start') {
      stack.push({ start: line, title: row.title, type: row.type });
      continue;
    }
    const open = stack.pop();
    if (!open) {
      continue;
    }
    const y0 = frame.y + SEQ_HEADER + SEQ_BODY_TOP - 12 + open.start * SEQ_ROW_H;
    const y1 = frame.y + SEQ_HEADER + SEQ_BODY_TOP - 12 + Math.max(line, open.start + 1) * SEQ_ROW_H;
    fragments.push({
      x: frame.x + 10,
      y: y0,
      width: width - 20,
      height: Math.max(40, y1 - y0 + 20),
      label: `${open.type}${open.title ? ` ${open.title}` : ''}`,
    });
  }

  const activations = inferSequenceActivations(draft, colX);
  const messages: SequencePaintMessage[] = draft.map((item) => {
    if (item.self) {
      return {
        ...item,
        hit: sequenceMessageHitRect(item),
      };
    }
    const goingRight = item.toX >= item.fromX;
    const fromX = activationEdgeX(activations, item.from, item.y, goingRight ? 'right' : 'left', item.fromX);
    const toX = activationEdgeX(activations, item.to, item.y, goingRight ? 'left' : 'right', item.toX);
    return {
      ...item,
      fromX,
      toX,
      hit: sequenceMessageHitRect({ ...item, fromX, toX }),
    };
  });

  const sized = { ...frame, width, height };
  return {
    frame: sized,
    title: scene.title,
    titleHit: { x: sized.x, y: sized.y, width: Math.max(80, sized.width - 40), height: SEQ_HEADER },
    addActor: {
      x: sized.x + sized.width - SEQ_ADD_SIZE - 10,
      y: sized.y + (SEQ_HEADER - SEQ_ADD_SIZE) / 2,
      width: SEQ_ADD_SIZE,
      height: SEQ_ADD_SIZE,
    },
    columns,
    messages,
    fragments,
    activations,
  };
}

export function sequenceMessageHitRect(input: {
  fromX: number;
  toX: number;
  y: number;
  label: string;
  self: boolean;
}): Rect {
  if (input.self) {
    return { x: input.fromX - 8, y: input.y - 22, width: 64, height: 40 };
  }
  const left = Math.min(input.fromX, input.toX);
  const right = Math.max(input.fromX, input.toX);
  const labelW = Math.max(56, input.label.length * 7 + 16);
  const mid = (input.fromX + input.toX) / 2;
  const x = Math.min(left, mid - labelW / 2) - 8;
  return {
    x,
    y: input.y - 20,
    width: Math.max(right - left, labelW) + 16,
    height: 32,
  };
}

export function hitSequenceInterior(
  model: SequencePaintModel,
  world: { x: number; y: number },
): SequenceInteriorHit | null {
  if (!hitSequenceFrame(model.frame, world)) {
    return null;
  }
  if (pointInRect(world, model.addActor)) {
    return { kind: 'add-actor' };
  }
  for (let i = model.columns.length - 1; i >= 0; i -= 1) {
    const column = model.columns[i];
    if (pointInRect(world, column.chip) || pointInRect(world, column.bottomChip)) {
      return { kind: 'participant', id: column.id };
    }
  }
  const activation = hitSequenceActivation(model, world);
  if (activation) {
    return { kind: 'activation', id: activation.participantId };
  }
  for (let i = model.messages.length - 1; i >= 0; i -= 1) {
    const message = model.messages[i];
    if (pointInRect(world, message.hit)) {
      return { kind: 'message', id: message.id };
    }
  }
  for (let i = model.columns.length - 1; i >= 0; i -= 1) {
    const column = model.columns[i];
    const lifeTop = column.chip.y + column.chip.height + 2;
    const lifeBottom = column.bottomChip.y - 2;
    if (Math.abs(world.x - column.x) <= 8 && world.y >= lifeTop && world.y <= lifeBottom) {
      return { kind: 'lifeline', id: column.id };
    }
  }
  if (pointInRect(world, model.titleHit) && world.y <= model.frame.y + SEQ_HEADER) {
    return { kind: 'title' };
  }
  return { kind: 'body' };
}

function pointInRect(point: { x: number; y: number }, rect: Rect) {
  return (
    point.x >= rect.x
    && point.y >= rect.y
    && point.x <= rect.x + rect.width
    && point.y <= rect.y + rect.height
  );
}

export function sequenceColumnInsertIndex(model: SequencePaintModel, worldX: number) {
  for (let i = 0; i < model.columns.length; i += 1) {
    if (worldX < (model.columns[i]?.x ?? 0)) {
      return i;
    }
  }
  return model.columns.length;
}

export function sequenceColumnIndexAt(model: SequencePaintModel, worldX: number) {
  if (model.columns.length === 0) {
    return 0;
  }
  let best = 0;
  let bestDist = Infinity;
  for (let index = 0; index < model.columns.length; index += 1) {
    const dist = Math.abs((model.columns[index]?.x ?? 0) - worldX);
    if (dist < bestDist) {
      best = index;
      bestDist = dist;
    }
  }
  return best;
}

export function hitSequenceActivation(
  model: SequencePaintModel,
  world: { x: number; y: number },
  pad = 6,
): SequencePaintActivation | null {
  for (let i = model.activations.length - 1; i >= 0; i -= 1) {
    const bar = model.activations[i];
    if (
      pointInRect(world, {
        x: bar.x - pad,
        y: bar.y,
        width: bar.width + pad * 2,
        height: bar.height,
      })
    ) {
      return bar;
    }
  }
  return null;
}

export function sequenceConnectTarget(
  model: SequencePaintModel,
  world: { x: number; y: number },
): SequenceConnectTarget | null {
  const bar = hitSequenceActivation(model, world);
  if (bar) {
    return { id: bar.participantId, x: bar.x + bar.width / 2, bar };
  }
  const inner = hitSequenceInterior(model, world);
  if (inner?.kind === 'lifeline' || inner?.kind === 'participant' || inner?.kind === 'activation') {
    const column = model.columns.find((item) => item.id === inner.id);
    return { id: inner.id, x: column?.x ?? world.x };
  }
  return null;
}

export function sequenceConnectStart(
  model: SequencePaintModel,
  world: { x: number; y: number },
): SequenceConnectTarget | null {
  const inner = hitSequenceInterior(model, world);
  if (inner?.kind !== 'lifeline' && inner?.kind !== 'activation') {
    return null;
  }
  return sequenceConnectTarget(model, world);
}

export function sequenceConnectAttachX(fromX: number, target: SequenceConnectTarget) {
  if (!target.bar) {
    return target.x;
  }
  return fromX <= target.x ? target.bar.x : target.bar.x + target.bar.width;
}

export function sequenceConnectArrow(
  fromX: number,
  toX: number,
  forceReturn = false,
): 'call' | 'return' {
  if (forceReturn) {
    return 'return';
  }
  return toX < fromX ? 'return' : 'call';
}

export function sequenceMessageInsertIndex(model: SequencePaintModel, worldY: number) {
  for (let i = 0; i < model.messages.length; i += 1) {
    if (worldY < (model.messages[i]?.y ?? 0)) {
      return i;
    }
  }
  return model.messages.length;
}

export function insertSequenceMessageAt(
  steps: SequenceStepIR[],
  item: SequenceStepIR,
  toIndex: number,
): SequenceStepIR[] {
  const ids = flattenSequenceSteps(steps)
    .filter((row) => row.kind === 'message')
    .map((row) => row.id);
  if (ids.length === 0 || toIndex >= ids.length) {
    return [...steps, item];
  }
  return insertMessageStep(steps, ids[Math.max(0, toIndex)] ?? null, item);
}

export function sequenceMessageIndexAt(model: SequencePaintModel, worldY: number) {
  if (model.messages.length === 0) {
    return 0;
  }
  let best = 0;
  let bestDist = Infinity;
  for (let index = 0; index < model.messages.length; index += 1) {
    const dist = Math.abs((model.messages[index]?.y ?? 0) - worldY);
    if (dist < bestDist) {
      best = index;
      bestDist = dist;
    }
  }
  return best;
}

function extractMessageStep(
  steps: SequenceStepIR[],
  messageId: string,
): { steps: SequenceStepIR[]; extracted: SequenceStepIR | null } {
  const next: SequenceStepIR[] = [];
  let extracted: SequenceStepIR | null = null;
  for (const step of steps) {
    if (extracted) {
      next.push(step);
      continue;
    }
    if (step.kind === 'message' && step.message.id === messageId) {
      extracted = step;
      continue;
    }
    if (step.kind === 'fragment') {
      const inner = extractMessageStep(step.fragment.steps, messageId);
      if (inner.extracted) {
        extracted = inner.extracted;
        next.push({
          kind: 'fragment',
          fragment: { ...step.fragment, steps: inner.steps },
        });
        continue;
      }
    }
    next.push(step);
  }
  return { steps: next, extracted };
}

function insertMessageStep(
  steps: SequenceStepIR[],
  beforeId: string | null,
  item: SequenceStepIR,
): SequenceStepIR[] {
  if (!beforeId) {
    return [...steps, item];
  }
  const next: SequenceStepIR[] = [];
  let inserted = false;
  for (const step of steps) {
    if (!inserted && step.kind === 'message' && step.message.id === beforeId) {
      next.push(item);
      inserted = true;
    }
    if (!inserted && step.kind === 'fragment') {
      const inner = insertMessageStep(step.fragment.steps, beforeId, item);
      if (inner !== step.fragment.steps) {
        next.push({
          kind: 'fragment',
          fragment: { ...step.fragment, steps: inner },
        });
        inserted = true;
        continue;
      }
    }
    next.push(step);
  }
  return inserted ? next : [...next, item];
}

export function reorderSequenceSteps(
  steps: SequenceStepIR[],
  messageId: string,
  toIndex: number,
): SequenceStepIR[] {
  const ids = flattenSequenceSteps(steps)
    .filter((row) => row.kind === 'message')
    .map((row) => row.id);
  const fromIndex = ids.indexOf(messageId);
  if (fromIndex < 0 || fromIndex === toIndex) {
    return steps;
  }
  const pulled = extractMessageStep(steps, messageId);
  if (!pulled.extracted) {
    return steps;
  }
  const remaining = ids.filter((id) => id !== messageId);
  const clamped = Math.max(0, Math.min(toIndex, remaining.length));
  return insertMessageStep(pulled.steps, remaining[clamped] ?? null, pulled.extracted);
}

export function hitSequenceFrame(frame: SequenceFrame, world: { x: number; y: number }) {
  return (
    world.x >= frame.x
    && world.y >= frame.y
    && world.x <= frame.x + frame.width
    && world.y <= frame.y + frame.height
  );
}

export function sequenceFrameAsRect(frame: SequenceFrame): Rect {
  return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
}

export function translateSequenceFrame(frame: SequenceFrame, dx: number, dy: number): SequenceFrame {
  return {
    ...frame,
    x: frame.x + dx,
    y: frame.y + dy,
  };
}

export function intersectingSequenceInterior(model: SequencePaintModel, box: Rect) {
  return {
    actors: model.columns
      .filter((column) => rectIntersects(box, column.chip) || rectIntersects(box, column.bottomChip))
      .map((column) => column.id),
    messages: model.messages
      .filter((message) => rectIntersects(box, message.hit))
      .map((message) => message.id),
  };
}

export function intersectingSequenceFrameIds(frames: SequenceFrame[], box: Rect): string[] {
  return frames
    .filter((frame) => (
      frame.x < box.x + box.width
      && frame.x + frame.width > box.x
      && frame.y < box.y + box.height
      && frame.y + frame.height > box.y
    ))
    .map((frame) => frame.id);
}

export function searchFreeSequenceOrigin(
  frames: SequenceFrame[],
  desired: Pick<SequenceFrame, 'x' | 'y' | 'width' | 'height'>,
  snap: (value: number) => number,
): { x: number; y: number } {
  let x = snap(desired.x);
  let y = snap(desired.y);
  const step = 32;
  for (let guard = 0; guard < 24; guard += 1) {
    const hit = frames.some((frame) => (
      x < frame.x + frame.width
      && x + desired.width > frame.x
      && y < frame.y + frame.height
      && y + desired.height > frame.y
    ));
    if (!hit) {
      return { x, y };
    }
    x = snap(x + step);
    y = snap(y + step);
  }
  return { x, y };
}

export function syncSequenceFrames(
  scenes: SequenceSceneIR[],
  stored: SequenceFrame[],
  graphBounds: Rect | null,
  snap: (value: number) => number,
): SequenceFrame[] {
  const byId = new Map(stored.map((frame) => [frame.id, frame]));
  let cursorX = snap((graphBounds ? graphBounds.x + graphBounds.width + 80 : 48));
  let cursorY = snap(graphBounds ? graphBounds.y : 48);
  const next: SequenceFrame[] = [];
  for (const scene of scenes) {
    const size = measureSequenceScene(scene);
    const prev = byId.get(scene.id);
    if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
      next.push({
        id: scene.id,
        x: prev.x,
        y: prev.y,
        width: Math.max(size.width, prev.width || 0),
        height: Math.max(size.height, prev.height || 0),
      });
      continue;
    }
    next.push({
      id: scene.id,
      x: cursorX,
      y: cursorY,
      width: size.width,
      height: size.height,
    });
    cursorY = snap(cursorY + size.height + 32);
  }
  return next;
}
