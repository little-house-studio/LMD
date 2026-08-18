import { clampLabelToViewport, type EdgeGeometry } from '../../placement';
import type { Camera } from './camera';
import { insetRect, type Rect, type Vec2 } from './math';
import { SCREEN_EDGE_FONT, SCREEN_EDGE_PX, SCREEN_GROUP_PX } from './paint/theme';

export function edgeLabelChipSize(
  text: string,
  measure: (text: string, font: string) => number,
): { width: number; height: number } {
  const font = `600 ${SCREEN_EDGE_PX}px ${SCREEN_EDGE_FONT}`;
  return {
    width: Math.max(8, measure(text, font) + 12),
    height: 18,
  };
}

export function labelViewInset(
  camera: Camera,
  cssW: number,
  cssH: number,
  chip: { width: number; height: number },
): Rect | null {
  if (cssW < 8 || cssH < 8) {
    return null;
  }
  const view = camera.getCoverWorldRectangle(cssW, cssH);
  const scale = Math.max(camera.scale, 0.001);
  const pad = 8;
  return insetRect(view, (pad + chip.width / 2) / scale, (pad + chip.height / 2) / scale)
    ?? insetRect(view, pad / scale, pad / scale);
}

export function visibleEdgeLabel(
  geometry: EdgeGeometry,
  text: string,
  input: {
    camera: Camera;
    cssW: number;
    cssH: number;
    showsDetails: boolean;
    measure: (text: string, font: string) => number;
    avoid: Rect[];
  },
): Vec2 | null {
  if (!input.showsDetails) {
    return null;
  }
  const chip = edgeLabelChipSize(text, input.measure);
  const inset = labelViewInset(input.camera, input.cssW, input.cssH, chip);
  if (!inset) {
    return null;
  }
  const scale = Math.max(input.camera.scale, 0.001);
  return clampLabelToViewport(geometry, inset, {
    avoid: input.avoid,
    chip: { width: chip.width / scale, height: chip.height / scale },
    pad: 4 / scale,
  });
}

export function groupTitleViewChip(
  camera: Camera,
  rect: Rect,
  title: string,
  measure: (text: string, font: string) => number,
): Rect {
  const view = camera.worldRectToView(rect);
  const font = `700 ${SCREEN_GROUP_PX}px ${SCREEN_EDGE_FONT}`;
  const textW = measure(title, font);
  const height = 20;
  return {
    x: view.x + 8,
    y: view.y + 6,
    width: Math.max(24, Math.min(view.width - 10, textW + 14)),
    height,
  };
}

export function groupTitleWorldChip(
  camera: Camera,
  rect: Rect,
  title: string,
  measure: (text: string, font: string) => number,
): Rect {
  return camera.viewRectToWorld(groupTitleViewChip(camera, rect, title, measure));
}

export function edgeLabelWorldChip(
  camera: Camera,
  text: string,
  center: Vec2,
  measure: (text: string, font: string) => number,
): Rect {
  const chip = edgeLabelChipSize(text, measure);
  const view = camera.worldToView(center);
  return camera.viewRectToWorld({
    x: view.x - chip.width / 2,
    y: view.y - chip.height / 2,
    width: chip.width,
    height: chip.height,
  });
}

export function groupTitleLabel(collapsed: boolean, title: string) {
  return `${collapsed ? '▸' : '▾'} ${title}`;
}
