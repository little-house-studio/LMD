export type MixedSelection = {
  kind: 'mixed';
  ids: string[];
  nodes: string[];
  groups: string[];
  sequences: string[];
  minds: string[];
  frames: string[];
  edges: string[];
};

export type StageSelection =
  | { kind: 'none' }
  | { kind: 'node'; ids: string[] }
  | { kind: 'edge'; ids: string[] }
  | { kind: 'group'; ids: string[] }
  | { kind: 'frame'; ids: string[] }
  | { kind: 'sequence'; ids: string[] }
  | { kind: 'seq-actor'; sceneId: string; ids: string[] }
  | { kind: 'seq-message'; sceneId: string; ids: string[] }
  | { kind: 'mind'; ids: string[] }
  | { kind: 'mind-node'; mapId: string; ids: string[] }
  | MixedSelection;

export type CanvasSelectionKind = 'node' | 'group' | 'sequence' | 'mind' | 'frame' | 'edge';

export type SelectionParts = {
  nodes: string[];
  groups: string[];
  sequences: string[];
  minds: string[];
  frames: string[];
  edges: string[];
};

function uniq(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

export function emptySelectionParts(): SelectionParts {
  return { nodes: [], groups: [], sequences: [], minds: [], frames: [], edges: [] };
}

export function partsOf(selection: StageSelection): SelectionParts {
  if (selection.kind === 'mixed') {
    return {
      nodes: selection.nodes,
      groups: selection.groups,
      sequences: selection.sequences,
      minds: selection.minds,
      frames: selection.frames,
      edges: selection.edges,
    };
  }
  if (selection.kind === 'node') {
    return { ...emptySelectionParts(), nodes: selection.ids };
  }
  if (selection.kind === 'group') {
    return { ...emptySelectionParts(), groups: selection.ids };
  }
  if (selection.kind === 'sequence') {
    return { ...emptySelectionParts(), sequences: selection.ids };
  }
  if (selection.kind === 'mind') {
    return { ...emptySelectionParts(), minds: selection.ids };
  }
  if (selection.kind === 'frame') {
    return { ...emptySelectionParts(), frames: selection.ids };
  }
  if (selection.kind === 'edge') {
    return { ...emptySelectionParts(), edges: selection.ids };
  }
  return emptySelectionParts();
}

export function collectSelection(parts: Partial<SelectionParts>): StageSelection {
  const nodes = uniq(parts.nodes ?? []);
  const groups = uniq(parts.groups ?? []);
  const sequences = uniq(parts.sequences ?? []);
  const minds = uniq(parts.minds ?? []);
  const frames = uniq(parts.frames ?? []);
  const edges = uniq(parts.edges ?? []);
  const filled = [nodes, groups, sequences, minds, frames, edges].filter((ids) => ids.length > 0).length;
  if (filled === 0) {
    return { kind: 'none' };
  }
  if (filled === 1) {
    if (nodes.length) {
      return { kind: 'node', ids: nodes };
    }
    if (groups.length) {
      return { kind: 'group', ids: groups };
    }
    if (sequences.length) {
      return { kind: 'sequence', ids: sequences };
    }
    if (minds.length) {
      return { kind: 'mind', ids: minds };
    }
    if (frames.length) {
      return { kind: 'frame', ids: frames };
    }
    return { kind: 'edge', ids: edges };
  }
  return {
    kind: 'mixed',
    ids: [...nodes, ...groups, ...sequences, ...minds, ...frames, ...edges],
    nodes,
    groups,
    sequences,
    minds,
    frames,
    edges,
  };
}

export function isCanvasIdSelected(
  selection: StageSelection,
  kind: CanvasSelectionKind,
  id: string,
): boolean {
  const parts = partsOf(selection);
  if (kind === 'node') {
    return parts.nodes.includes(id);
  }
  if (kind === 'group') {
    return parts.groups.includes(id);
  }
  if (kind === 'sequence') {
    return parts.sequences.includes(id);
  }
  if (kind === 'mind') {
    return parts.minds.includes(id);
  }
  if (kind === 'frame') {
    return parts.frames.includes(id);
  }
  return parts.edges.includes(id);
}

export function toggleCanvasIds(
  selection: StageSelection,
  kind: CanvasSelectionKind,
  ids: string[],
): StageSelection {
  const parts = partsOf(selection);
  const key = kind === 'node'
    ? 'nodes'
    : kind === 'group'
      ? 'groups'
      : kind === 'sequence'
        ? 'sequences'
        : kind === 'mind'
          ? 'minds'
          : kind === 'frame'
            ? 'frames'
            : 'edges';
  const next = new Set(parts[key]);
  for (const id of ids) {
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
  }
  return collectSelection({ ...parts, [key]: [...next] });
}

export function sequenceSceneIdOf(selection: StageSelection): string | null {
  if (selection.kind === 'sequence') {
    return selection.ids[0] ?? null;
  }
  if (selection.kind === 'seq-actor' || selection.kind === 'seq-message') {
    return selection.sceneId;
  }
  return null;
}

export function mindMapIdOf(selection: StageSelection): string | null {
  if (selection.kind === 'mind') {
    return selection.ids[0] ?? null;
  }
  if (selection.kind === 'mind-node') {
    return selection.mapId;
  }
  return null;
}
