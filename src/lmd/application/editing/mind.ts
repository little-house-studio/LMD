import {
  buildEntityIdFromTitle,
  flattenMindNodes,
  mapMindNodes,
  type GraphDocument,
  type MindMapIR,
  type MindNodeIR,
} from '@lths/lmd/legacy';
import { measureMindMap } from '../../placement/mind';
import { readMindFrames, writeMindFrames } from '../../infrastructure/layout/mindFrames';
import { refreshSource } from './source';

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
    for (const node of flattenMindNodes(map.children)) {
      used.add(node.id);
    }
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

function mapMaps(
  document: GraphDocument,
  mapId: string,
  update: (map: MindMapIR) => MindMapIR,
): GraphDocument {
  const maps = document.mind?.maps ?? [];
  if (!maps.some((map) => map.id === mapId)) {
    return document;
  }
  return refreshSource({
    ...document,
    mind: {
      maps: maps.map((map) => (map.id === mapId ? update(map) : map)),
    },
  });
}


function appendChild(nodes: MindNodeIR[], parentId: string, child: MindNodeIR, mapId: string): MindNodeIR[] {
  if (parentId === mapId) {
    return [...nodes, child];
  }
  return nodes.map((node) => (
    node.id === parentId
      ? { ...node, children: [...node.children, child] }
      : { ...node, children: appendChild(node.children, parentId, child, mapId) }
  ));
}

export function createMindMapInDocument(
  document: GraphDocument,
  options?: { title?: string; x?: number; y?: number },
): { document: GraphDocument; mapId: string } {
  const title = nextNamed(
    new Set((document.mind?.maps ?? []).map((map) => map.title)),
    options?.title?.trim() || '思维导图',
  );
  const used = collectUsedIds(document);
  const mapId = buildEntityIdFromTitle(title, used);
  used.add(mapId);
  const firstId = buildEntityIdFromTitle('主题', used);
  const map: MindMapIR = {
    id: mapId,
    title,
    children: [{ id: firstId, title: '主题', children: [] }],
  };
  const size = measureMindMap(map);
  const next = refreshSource({
    ...document,
    mind: {
      maps: [...(document.mind?.maps ?? []), map],
    },
  });
  if (options?.x === undefined || options?.y === undefined) {
    return { document: next, mapId };
  }
  return {
    mapId,
    document: writeMindFrames(next, [
      ...readMindFrames(next.compat?.extras as Record<string, unknown> | undefined),
      {
        id: mapId,
        x: options.x,
        y: options.y,
        width: size.width,
        height: size.height,
      },
    ]),
  };
}

export function updateMindMapInDocument(
  document: GraphDocument,
  mapId: string,
  patch: { title?: string },
): GraphDocument {
  return mapMaps(document, mapId, (map) => ({
    ...map,
    title: patch.title ?? map.title,
  }));
}

export function addMindTopicInDocument(
  document: GraphDocument,
  mapId: string,
  parentId?: string,
  title?: string,
): { document: GraphDocument; topicId: string } {
  const map = document.mind?.maps.find((item) => item.id === mapId);
  if (!map) {
    return { document, topicId: '' };
  }
  const used = collectUsedIds(document);
  const nextTitle = nextNamed(
    new Set(flattenMindNodes(map.children).map((item) => item.title)),
    title?.trim() || '主题',
  );
  const topicId = buildEntityIdFromTitle(nextTitle, used);
  const child: MindNodeIR = { id: topicId, title: nextTitle, children: [] };
  return {
    topicId,
    document: mapMaps(document, mapId, (current) => ({
      ...current,
      children: appendChild(current.children, parentId ?? current.id, child, current.id),
    })),
  };
}

export function renameMindTopicInDocument(
  document: GraphDocument,
  mapId: string,
  topicId: string,
  title: string,
): GraphDocument {
  const nextTitle = title.trim();
  if (!nextTitle) {
    return document;
  }
  return mapMaps(document, mapId, (map) => ({
    ...map,
    children: mapMindNodes(map.children, (node) => (
      node.id === topicId ? { ...node, title: nextTitle } : node
    )),
  }));
}

export function updateMindTopicInDocument(
  document: GraphDocument,
  mapId: string,
  topicId: string,
  patch: { title?: string; comment?: string },
): GraphDocument {
  return mapMaps(document, mapId, (map) => ({
    ...map,
    children: mapMindNodes(map.children, (node) => (
      node.id === topicId
        ? {
            ...node,
            title: patch.title ?? node.title,
            comment: patch.comment ?? node.comment,
          }
        : node
    )),
  }));
}

export function removeMindTopicInDocument(
  document: GraphDocument,
  mapId: string,
  topicId: string,
): GraphDocument {
  return mapMaps(document, mapId, (map) => ({
    ...map,
    children: mapMindNodes(map.children, (node) => (node.id === topicId ? null : node)),
  }));
}

export function findMindTopic(document: GraphDocument, mapId: string, topicId: string) {
  const map = document.mind?.maps.find((item) => item.id === mapId);
  return map ? flattenMindNodes(map.children).find((item) => item.id === topicId) ?? null : null;
}
