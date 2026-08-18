import { buildEntityIdFromTitle, type GraphDocument } from '@lths/lmd/legacy';
import type { SequenceSceneIR, SequenceStepIR } from '@lths/lmd/legacy';
import { insertSequenceMessageAt, measureSequenceScene, reorderSequenceSteps } from '../../placement/sequence';
import { readSequenceFrames, writeSequenceFrames } from '../../infrastructure/layout/sequenceFrames';
import { refreshSource } from './source';

type SequenceMessage = Extract<SequenceStepIR, { kind: 'message' }>['message'];

function collectUsedIds(document: GraphDocument) {
  const used = new Set<string>();
  for (const node of document.nodes) {
    used.add(node.id);
  }
  for (const group of document.subgraphs) {
    used.add(group.id);
  }
  for (const scene of document.sequence?.scenes ?? []) {
    used.add(scene.id);
    for (const participant of scene.participants) {
      used.add(participant.id);
    }
  }
  for (const map of document.mind?.maps ?? []) {
    used.add(map.id);
  }
  return used;
}

function nextNamed(taken: Set<string>, base: string) {
  if (!taken.has(base)) {
    return base;
  }
  let index = 2;
  while (taken.has(`${base} ${index}`)) {
    index += 1;
  }
  return `${base} ${index}`;
}

function nextSequenceTitle(document: GraphDocument, preferred?: string) {
  return nextNamed(
    new Set((document.sequence?.scenes ?? []).map((scene) => scene.title)),
    preferred?.trim() || '新建时序',
  );
}

function mapScenes(
  document: GraphDocument,
  sceneId: string,
  update: (scene: SequenceSceneIR) => SequenceSceneIR,
): GraphDocument {
  const scenes = document.sequence?.scenes ?? [];
  if (!scenes.some((scene) => scene.id === sceneId)) {
    return document;
  }
  return refreshSource({
    ...document,
    sequence: {
      scenes: scenes.map((scene) => (scene.id === sceneId ? update(scene) : scene)),
    },
  });
}

function mapSteps(
  steps: SequenceStepIR[],
  update: (step: SequenceStepIR) => SequenceStepIR | null,
): SequenceStepIR[] {
  const next: SequenceStepIR[] = [];
  for (const step of steps) {
    if (step.kind === 'fragment') {
      const mapped = update({
        kind: 'fragment',
        fragment: { ...step.fragment, steps: mapSteps(step.fragment.steps, update) },
      });
      if (mapped) {
        next.push(mapped);
      }
      continue;
    }
    const mapped = update(step);
    if (mapped) {
      next.push(mapped);
    }
  }
  return next;
}

function findMessage(steps: SequenceStepIR[], messageId: string): SequenceMessage | null {
  for (const step of steps) {
    if (step.kind === 'message' && step.message.id === messageId) {
      return step.message;
    }
    if (step.kind === 'fragment') {
      const nested = findMessage(step.fragment.steps, messageId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

export function createSequenceSceneInDocument(
  document: GraphDocument,
  options?: { title?: string; x?: number; y?: number },
): { document: GraphDocument; sceneId: string } {
  const title = nextSequenceTitle(document, options?.title);
  const used = collectUsedIds(document);
  const sceneId = buildEntityIdFromTitle(title, used);
  used.add(sceneId);
  const fromId = buildEntityIdFromTitle('A', used);
  used.add(fromId);
  const toId = buildEntityIdFromTitle('B', used);
  const scene: SequenceSceneIR = {
    id: sceneId,
    title,
    participants: [
      { id: fromId, title: 'A' },
      { id: toId, title: 'B' },
    ],
    steps: [{
      kind: 'message',
      message: {
        id: `m_${fromId}_${toId}`,
        from: fromId,
        to: toId,
        label: '消息',
        arrow: 'call',
      },
    }],
  };
  const size = measureSequenceScene(scene);
  const next = refreshSource({
    ...document,
    sequence: {
      scenes: [...(document.sequence?.scenes ?? []), scene],
    },
  });
  if (options?.x === undefined || options?.y === undefined) {
    return { document: next, sceneId };
  }
  return {
    sceneId,
    document: writeSequenceFrames(next, [
      ...readSequenceFrames(next.compat?.extras as Record<string, unknown> | undefined),
      {
        id: sceneId,
        x: options.x,
        y: options.y,
        width: size.width,
        height: size.height,
      },
    ]),
  };
}

export function updateSequenceSceneInDocument(
  document: GraphDocument,
  sceneId: string,
  patch: { title?: string },
): GraphDocument {
  return mapScenes(document, sceneId, (scene) => ({
    ...scene,
    title: patch.title ?? scene.title,
  }));
}

export function renameSequenceParticipantInDocument(
  document: GraphDocument,
  sceneId: string,
  participantId: string,
  title: string,
): GraphDocument {
  const nextTitle = title.trim();
  if (!nextTitle) {
    return document;
  }
  return mapScenes(document, sceneId, (scene) => ({
    ...scene,
    participants: scene.participants.map((item) => (
      item.id === participantId ? { ...item, title: nextTitle } : item
    )),
  }));
}

export function addSequenceParticipantInDocument(
  document: GraphDocument,
  sceneId: string,
  title?: string,
  atIndex?: number,
): { document: GraphDocument; participantId: string } {
  const scene = document.sequence?.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    return { document, participantId: '' };
  }
  const used = collectUsedIds(document);
  const nextTitle = nextNamed(new Set(scene.participants.map((item) => item.title)), title?.trim() || '参与者');
  const participantId = buildEntityIdFromTitle(nextTitle, used);
  return {
    participantId,
    document: mapScenes(document, sceneId, (current) => {
      const item = { id: participantId, title: nextTitle };
      if (atIndex === undefined || atIndex >= current.participants.length) {
        return { ...current, participants: [...current.participants, item] };
      }
      const participants = [...current.participants];
      participants.splice(Math.max(0, atIndex), 0, item);
      return { ...current, participants };
    }),
  };
}

export function removeSequenceParticipantInDocument(
  document: GraphDocument,
  sceneId: string,
  participantId: string,
): GraphDocument {
  return mapScenes(document, sceneId, (scene) => ({
    ...scene,
    participants: scene.participants.filter((item) => item.id !== participantId),
    steps: mapSteps(scene.steps, (step) => {
      if (step.kind === 'message' && (step.message.from === participantId || step.message.to === participantId)) {
        return null;
      }
      return step;
    }),
  }));
}

export function reorderSequenceParticipantsInDocument(
  document: GraphDocument,
  sceneId: string,
  participantId: string,
  toIndex: number,
): GraphDocument {
  return mapScenes(document, sceneId, (scene) => {
    const fromIndex = scene.participants.findIndex((item) => item.id === participantId);
    if (fromIndex < 0 || fromIndex === toIndex) {
      return scene;
    }
    const next = [...scene.participants];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) {
      return scene;
    }
    next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved);
    return { ...scene, participants: next };
  });
}

export function reorderSequenceMessagesInDocument(
  document: GraphDocument,
  sceneId: string,
  messageId: string,
  toIndex: number,
): GraphDocument {
  return mapScenes(document, sceneId, (scene) => ({
    ...scene,
    steps: reorderSequenceSteps(scene.steps, messageId, toIndex),
  }));
}

export function updateSequenceMessageInDocument(
  document: GraphDocument,
  sceneId: string,
  messageId: string,
  patch: { label?: string; arrow?: 'call' | 'return'; from?: string; to?: string },
): GraphDocument {
  return mapScenes(document, sceneId, (scene) => ({
    ...scene,
    steps: mapSteps(scene.steps, (step) => {
      if (step.kind !== 'message' || step.message.id !== messageId) {
        return step;
      }
      return {
        kind: 'message',
        message: {
          ...step.message,
          label: patch.label ?? step.message.label,
          arrow: patch.arrow ?? step.message.arrow,
          from: patch.from ?? step.message.from,
          to: patch.to ?? step.message.to,
        },
      };
    }),
  }));
}

export function addSequenceMessageInDocument(
  document: GraphDocument,
  sceneId: string,
  options?: { from?: string; to?: string; label?: string; arrow?: 'call' | 'return'; atIndex?: number },
): { document: GraphDocument; messageId: string } {
  const scene = document.sequence?.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    return { document, messageId: '' };
  }
  const from = options?.from ?? scene.participants[0]?.id ?? '';
  const to = options?.to ?? scene.participants[1]?.id ?? scene.participants[0]?.id ?? from;
  if (!from || !to) {
    const created = addSequenceParticipantInDocument(document, sceneId);
    const second = created.participantId
      ? addSequenceParticipantInDocument(created.document, sceneId)
      : created;
    return addSequenceMessageInDocument(second.document, sceneId, options);
  }
  const messageId = `m_${from}_${to}_${Math.random().toString(36).slice(2, 7)}`;
  const step: SequenceStepIR = {
    kind: 'message',
    message: {
      id: messageId,
      from,
      to,
      label: options?.label?.trim() || '消息',
      arrow: options?.arrow ?? 'call',
    },
  };
  return {
    messageId,
    document: mapScenes(document, sceneId, (current) => ({
      ...current,
      steps: options?.atIndex === undefined
        ? [...current.steps, step]
        : insertSequenceMessageAt(current.steps, step, options.atIndex),
    })),
  };
}

export function removeSequenceMessageInDocument(
  document: GraphDocument,
  sceneId: string,
  messageId: string,
): GraphDocument {
  return mapScenes(document, sceneId, (scene) => ({
    ...scene,
    steps: mapSteps(scene.steps, (step) => (
      step.kind === 'message' && step.message.id === messageId ? null : step
    )),
  }));
}

export function findSequenceMessage(document: GraphDocument, sceneId: string, messageId: string) {
  const scene = document.sequence?.scenes.find((item) => item.id === sceneId);
  return scene ? findMessage(scene.steps, messageId) : null;
}
