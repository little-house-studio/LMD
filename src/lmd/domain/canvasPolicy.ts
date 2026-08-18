/**
 * Host-facing canvas contract. Embedders pass this in; the shell/engine
 * must not invent a second set of layout flags.
 *
 * - `free`: user positions persist; drag + grid snap.
 * - `derived`: positions are recomputed; drag locked; coords omitted on write.
 * Organize (`layout.tidy`) always runs the structural solver — it is not a mode.
 */
export type LayoutMode = 'free' | 'derived';

export type GridSnapPolicy = {
  enabled: boolean;
  /** Tile cell in world px. Drag, nudge, and organize snap to this. */
  size: number;
  /** Shift+arrow step. */
  major: number;
};

export type CanvasToolsPolicy = {
  frames: boolean;
  organize: boolean;
};

export type CanvasPolicy = {
  mode: LayoutMode;
  snap: GridSnapPolicy;
  tools: CanvasToolsPolicy;
};

export const DEFAULT_CANVAS_POLICY: CanvasPolicy = {
  mode: 'free',
  snap: { enabled: true, size: 16, major: 48 },
  tools: { frames: false, organize: true },
};

export function resolveCanvasPolicy(partial?: Partial<CanvasPolicy>): CanvasPolicy {
  return {
    mode: partial?.mode === 'derived' ? 'derived' : 'free',
    snap: {
      enabled: partial?.snap?.enabled ?? DEFAULT_CANVAS_POLICY.snap.enabled,
      size: Math.max(1, partial?.snap?.size ?? DEFAULT_CANVAS_POLICY.snap.size),
      major: Math.max(1, partial?.snap?.major ?? DEFAULT_CANVAS_POLICY.snap.major),
    },
    tools: {
      frames: partial?.tools?.frames ?? DEFAULT_CANVAS_POLICY.tools.frames,
      organize: partial?.tools?.organize ?? DEFAULT_CANVAS_POLICY.tools.organize,
    },
  };
}

export function positionsLocked(policy: CanvasPolicy) {
  return policy.mode === 'derived';
}
