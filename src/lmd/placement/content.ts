import { layoutNodeContent } from '@lths/lmd/legacy';
import { isPlaceholderTitle, splitEntityText } from '../domain/label';
import type { Rect, Vec2 } from '../shared/geom';

type SizedLabel = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};

export type NodeContentBands = {
  parts: { title: string; description: string };
  titleLines: string[];
  descriptionLines: string[];
  title: Rect;
  description: Rect;
};

/**
 * Project Graph card split: title band on top, description band below.
 * Band heights follow wrapped line counts so the card can grow with content.
 */
export function nodeContentBands(node: SizedLabel): NodeContentBands {
  const parts = splitEntityText(node.label);
  const layout = layoutNodeContent(parts.title, parts.description, node.width);
  const titleHeight = Math.max(
    32,
    Math.min(layout.titleBandHeight, Math.max(32, node.height - 28)),
  );
  return {
    parts,
    titleLines: layout.titleLines,
    descriptionLines: layout.descriptionLines,
    title: {
      x: node.x,
      y: node.y,
      width: node.width,
      height: titleHeight,
    },
    description: {
      x: node.x,
      y: node.y + titleHeight,
      width: node.width,
      height: Math.max(24, node.height - titleHeight),
    },
  };
}

export type FitWrappedText = {
  fontPx: number;
  linePx: number;
};

/**
 * Paint size for already-wrapped node lines.
 * Caps at the design font so zoom-in does not enlarge text;
 * shrinks only when the *box* is too small — long strings clip, they do not crush the font.
 */
export function fitWrappedText(options: {
  lines: readonly string[];
  bandWidth: number;
  bandHeight: number;
  maxFontPx: number;
  lineHeightPx: number;
  padX?: number;
  minFontPx?: number;
}): FitWrappedText {
  const lines = options.lines.length > 0 ? options.lines : [''];
  const maxFontPx = Math.max(1, options.maxFontPx);
  const minFontPx = Math.min(maxFontPx, Math.max(1, options.minFontPx ?? 8));
  const lineRatio = options.lineHeightPx / maxFontPx;
  const innerW = Math.max(1, options.bandWidth - (options.padX ?? 20));
  const innerH = Math.max(1, options.bandHeight);
  const minUnits = 6;
  const fromWidth = (innerW * 1.8) / minUnits;
  const fromHeight = innerH / (lines.length * lineRatio);
  const fontPx = Math.max(minFontPx, Math.min(maxFontPx, Math.floor(Math.min(fromWidth, fromHeight))));
  return { fontPx, linePx: fontPx * lineRatio };
}

/** Which field a world-space click should edit. Placeholder titles always open title. */
export function fieldAtNodePoint(node: SizedLabel, world: Vec2): 'title' | 'description' {
  const bands = nodeContentBands(node);
  if (isPlaceholderTitle(bands.parts.title)) {
    return 'title';
  }
  return world.y >= bands.description.y ? 'description' : 'title';
}
