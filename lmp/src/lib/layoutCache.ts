/**
 * LMP layout memoization: recompute mind-map layout only when outline
 * topology / text / mode that affects layout changes — never on pan/zoom.
 */

import {
  computeMindMapLayout,
  serializeOutline,
  type LayoutMode,
  type NodeBox,
  type OutlineNode,
} from './outline';

export const lmpHotPathCounters = {
  computeMindMapLayout: 0,
  serializeOutline: 0,
  layoutCacheHits: 0,
  layoutCacheMisses: 0,
  serializeCacheHits: 0,
  serializeCacheMisses: 0,
};

export function resetLmpHotPathCounters() {
  lmpHotPathCounters.computeMindMapLayout = 0;
  lmpHotPathCounters.serializeOutline = 0;
  lmpHotPathCounters.layoutCacheHits = 0;
  lmpHotPathCounters.layoutCacheMisses = 0;
  lmpHotPathCounters.serializeCacheHits = 0;
  lmpHotPathCounters.serializeCacheMisses = 0;
}

/** Structural signature for layout invalidation (includes text & color for box metrics). */
export function buildOutlineLayoutSignature(
  roots: readonly OutlineNode[],
  layoutMode: LayoutMode,
): string {
  const parts: string[] = [layoutMode];
  const walk = (nodes: readonly OutlineNode[], depth: number) => {
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      parts.push(
        `${depth}:${node.id}:${node.text}:${node.color ?? ''}:${node.children.length}`,
      );
      if (node.children.length > 0) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(roots, 0);
  return parts.join('|');
}

export type LayoutCacheSnapshot = {
  signature: string;
  layout: NodeBox[];
};

export type SerializeCacheSnapshot = {
  signature: string;
  text: string;
};

/**
 * Memoized layout: calls real `computeMindMapLayout` only on signature miss.
 */
export class MindMapLayoutCache {
  private snapshot: LayoutCacheSnapshot | null = null;
  /** Fast path: same roots array + mode → skip signature walk entirely. */
  private lastRoots: OutlineNode[] | null = null;
  private lastMode: LayoutMode | null = null;

  get(roots: OutlineNode[], layoutMode: LayoutMode): NodeBox[] {
    if (
      this.snapshot &&
      this.lastRoots === roots &&
      this.lastMode === layoutMode
    ) {
      lmpHotPathCounters.layoutCacheHits += 1;
      return this.snapshot.layout;
    }

    const signature = buildOutlineLayoutSignature(roots, layoutMode);
    if (this.snapshot && this.snapshot.signature === signature) {
      this.lastRoots = roots;
      this.lastMode = layoutMode;
      lmpHotPathCounters.layoutCacheHits += 1;
      return this.snapshot.layout;
    }
    lmpHotPathCounters.layoutCacheMisses += 1;
    lmpHotPathCounters.computeMindMapLayout += 1;
    const layout = computeMindMapLayout(roots, layoutMode);
    this.snapshot = { signature, layout };
    this.lastRoots = roots;
    this.lastMode = layoutMode;
    return layout;
  }

  peek() {
    return this.snapshot;
  }

  clear() {
    this.snapshot = null;
    this.lastRoots = null;
    this.lastMode = null;
  }
}

/**
 * Memoized serialize: real `serializeOutline` only when outline/mode change.
 */
export class OutlineSerializeCache {
  private snapshot: SerializeCacheSnapshot | null = null;
  private lastRoots: OutlineNode[] | null = null;
  private lastMode: LayoutMode | null = null;

  get(roots: OutlineNode[], layoutMode: LayoutMode): string {
    // Serialize does not depend on live edit text overlay the same way layout does;
    // callers pass committed roots.
    if (
      this.snapshot &&
      this.lastRoots === roots &&
      this.lastMode === layoutMode
    ) {
      lmpHotPathCounters.serializeCacheHits += 1;
      return this.snapshot.text;
    }

    const signature = buildOutlineLayoutSignature(roots, layoutMode);
    if (this.snapshot && this.snapshot.signature === signature) {
      this.lastRoots = roots;
      this.lastMode = layoutMode;
      lmpHotPathCounters.serializeCacheHits += 1;
      return this.snapshot.text;
    }
    lmpHotPathCounters.serializeCacheMisses += 1;
    lmpHotPathCounters.serializeOutline += 1;
    const text = serializeOutline(roots, { layoutMode });
    this.snapshot = { signature, text };
    this.lastRoots = roots;
    this.lastMode = layoutMode;
    return text;
  }

  clear() {
    this.snapshot = null;
    this.lastRoots = null;
    this.lastMode = null;
  }
}

/** Shared module-level caches for the app instance (reset on demand in tests). */
export const sharedLayoutCache = new MindMapLayoutCache();
export const sharedSerializeCache = new OutlineSerializeCache();

/**
 * Stress: pan/selection frames must not re-layout; topology edit must layout once.
 */
export function runLmpInteractionStress(options: {
  rootCount: number;
  childrenPerRoot: number;
  panFrames?: number;
  selectionFrames?: number;
}): {
  panFrames: number;
  selectionFrames: number;
  layoutMissesDuringPan: number;
  layoutMissesDuringSelection: number;
  layoutMissesOnTopologyEdit: number;
  serializeMissesDuringPan: number;
  totalLayoutMisses: number;
} {
  resetLmpHotPathCounters();
  const cache = new MindMapLayoutCache();
  const ser = new OutlineSerializeCache();

  const makeRoots = (labelPrefix: string): OutlineNode[] => {
    const roots: OutlineNode[] = [];
    for (let r = 0; r < options.rootCount; r += 1) {
      const children: OutlineNode[] = [];
      for (let c = 0; c < options.childrenPerRoot; c += 1) {
        children.push({
          id: `${labelPrefix}-r${r}-c${c}`,
          text: `${labelPrefix} child ${r}.${c}`,
          color: null,
          children: [],
        });
      }
      roots.push({
        id: `${labelPrefix}-r${r}`,
        text: `${labelPrefix} root ${r}`,
        color: null,
        children,
      });
    }
    return roots;
  };

  let roots = makeRoots('a');
  const mode: LayoutMode = 'balanced';

  // Initial layout
  cache.get(roots, mode);
  ser.get(roots, mode);

  const layoutMissesBeforePan = lmpHotPathCounters.layoutCacheMisses;
  const serializeMissesBeforePan = lmpHotPathCounters.serializeCacheMisses;
  const panFrames = options.panFrames ?? 60;

  // Simulate pan/zoom frames: same roots/mode, only viewport would change in UI
  for (let i = 0; i < panFrames; i += 1) {
    cache.get(roots, mode);
    ser.get(roots, mode);
  }
  const layoutMissesDuringPan = lmpHotPathCounters.layoutCacheMisses - layoutMissesBeforePan;
  const serializeMissesDuringPan =
    lmpHotPathCounters.serializeCacheMisses - serializeMissesBeforePan;

  const layoutMissesBeforeSel = lmpHotPathCounters.layoutCacheMisses;
  const selectionFrames = options.selectionFrames ?? 30;
  for (let i = 0; i < selectionFrames; i += 1) {
    // Selection does not change outline signature
    cache.get(roots, mode);
  }
  const layoutMissesDuringSelection =
    lmpHotPathCounters.layoutCacheMisses - layoutMissesBeforeSel;

  const layoutMissesBeforeEdit = lmpHotPathCounters.layoutCacheMisses;
  roots = makeRoots('b'); // topology + text change
  cache.get(roots, mode);
  ser.get(roots, mode);
  const layoutMissesOnTopologyEdit =
    lmpHotPathCounters.layoutCacheMisses - layoutMissesBeforeEdit;

  return {
    panFrames,
    selectionFrames,
    layoutMissesDuringPan,
    layoutMissesDuringSelection,
    layoutMissesOnTopologyEdit,
    serializeMissesDuringPan,
    totalLayoutMisses: lmpHotPathCounters.layoutCacheMisses,
  };
}
