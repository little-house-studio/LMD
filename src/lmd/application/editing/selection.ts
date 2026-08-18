import type { GraphDocument } from '@lths/lmd/legacy';
import type { StageSelection } from '../../domain/selection';
import { refreshSource } from './source';
import { removeMindTopicInDocument } from './mind';
import {
  removeSequenceMessageInDocument,
  removeSequenceParticipantInDocument,
} from './sequence';

export function deleteIdsFromDocument(
  document: GraphDocument,
  selection: StageSelection | { kind: string; ids: string[]; sceneId?: string; mapId?: string },
): GraphDocument {
  if (selection.kind === 'none' || !('ids' in selection) || selection.ids.length === 0) {
    return document;
  }
  if (selection.kind === 'mixed' && 'nodes' in selection) {
    let next = document;
    if (selection.edges.length) {
      next = deleteIdsFromDocument(next, { kind: 'edge', ids: selection.edges });
    }
    if (selection.sequences.length) {
      next = deleteIdsFromDocument(next, { kind: 'sequence', ids: selection.sequences });
    }
    if (selection.minds.length) {
      next = deleteIdsFromDocument(next, { kind: 'mind', ids: selection.minds });
    }
    if (selection.nodes.length) {
      next = deleteIdsFromDocument(next, { kind: 'node', ids: selection.nodes });
    }
    if (selection.groups.length) {
      next = deleteIdsFromDocument(next, { kind: 'group', ids: selection.groups });
    }
    return next;
  }
  const ids = new Set(selection.ids);

  if (selection.kind === 'edge') {
    return refreshSource({
      ...document,
      edges: document.edges.filter((edge) => !ids.has(edge.id)),
    });
  }

  if (selection.kind === 'sequence') {
    return refreshSource({
      ...document,
      sequence: {
        scenes: (document.sequence?.scenes ?? []).filter((scene) => !ids.has(scene.id)),
      },
      edges: document.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)),
    });
  }

  if (selection.kind === 'mind') {
    return refreshSource({
      ...document,
      mind: {
        maps: (document.mind?.maps ?? []).filter((map) => !ids.has(map.id)),
      },
      edges: document.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)),
    });
  }

  if (selection.kind === 'mind-node') {
    const mapId = 'mapId' in selection ? selection.mapId : undefined;
    if (!mapId) {
      return document;
    }
    return [...ids].reduce(
      (current, id) => removeMindTopicInDocument(current, mapId, id),
      document,
    );
  }

  if (selection.kind === 'seq-actor') {
    const sceneId = 'sceneId' in selection ? selection.sceneId : undefined;
    if (!sceneId) {
      return document;
    }
    return [...ids].reduce(
      (current, id) => removeSequenceParticipantInDocument(current, sceneId, id),
      document,
    );
  }

  if (selection.kind === 'seq-message') {
    const sceneId = 'sceneId' in selection ? selection.sceneId : undefined;
    if (!sceneId) {
      return document;
    }
    return [...ids].reduce(
      (current, id) => removeSequenceMessageInDocument(current, sceneId, id),
      document,
    );
  }

  if (selection.kind === 'group' || selection.kind === 'subgraph') {
    return refreshSource({
      ...document,
      subgraphs: document.subgraphs.filter((subgraph) => !ids.has(subgraph.id)),
      nodes: document.nodes.map((node) =>
        node.subgraphId && ids.has(node.subgraphId)
          ? { ...node, subgraphId: null }
          : node,
      ),
    });
  }

  return refreshSource({
    ...document,
    nodes: document.nodes.filter((node) => !ids.has(node.id)),
    edges: document.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)),
  });
}
