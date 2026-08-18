export interface ViewportIR {
  x: number;
  y: number;
  zoom: number;
}

export interface FrameIR {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutIR {
  version: number;
  viewport: ViewportIR;
  frames: Record<string, FrameIR>;
  collapsedGroups: Record<string, boolean>;
}

export function emptyLayout(): LayoutIR {
  return {
    version: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    frames: {},
    collapsedGroups: {},
  };
}
