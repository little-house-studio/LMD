/**
 * Project Graph paint-path helpers: cull overscan, screen-constant strokes,
 * and topology-gated derived-scene rebuilds.
 *
 * Display / LOD rules stay in `src/lmd/placement/lod.ts`. This file must not
 * decide what is visible — only how expensive a frame is.
 */
import { hotPathCounters } from './sceneHotPath';

export type CullRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Screen-space overscan so pan does not pop items at the edge. */
export const CULL_MARGIN_PX = 260;
export const STROKE_MIN_PX = 1.25;
export const ARROW_MIN_PX = 6;

export function expandCoverForCull(
  cover: CullRect,
  scale: number,
  marginPx = CULL_MARGIN_PX,
): CullRect {
  const pad = marginPx / Math.max(scale, 0.001);
  return {
    x: cover.x - pad,
    y: cover.y - pad,
    width: cover.width + pad * 2,
    height: cover.height + pad * 2,
  };
}

/** View-space stroke that does not vanish when zoomed out. */
export function screenStrokeWidth(baseWidth: number, scale: number, minPx = STROKE_MIN_PX): number {
  return Math.max(minPx, baseWidth * Math.min(1.5, Math.max(scale, 0)));
}

export function screenArrowSize(baseSize: number, scale: number, minPx = ARROW_MIN_PX): number {
  return Math.max(minPx, baseSize * Math.min(1.4, Math.max(scale, 0)));
}

/** Stroke/dash/arrow length in world units so a screen-pixel size survives `ctx.scale`. */
export function worldStrokeWidth(screenPx: number, scale: number): number {
  return screenPx / Math.max(scale, 0.001);
}

export function sameViewport(
  left: { x: number; y: number; zoom: number },
  right: { x: number; y: number; zoom: number },
  epsilon = 0.05,
): boolean {
  return (
    Math.abs(left.x - right.x) < epsilon
    && Math.abs(left.y - right.y) < epsilon
    && Math.abs(left.zoom - right.zoom) < 0.0005
  );
}

export function derivedSceneRevision(graph: {
  nodes: ReadonlyArray<{ id: string; x: number; y: number; width: number; height: number }>;
  edges: ReadonlyArray<{ id: string; from: string; to: string; label?: string }>;
  subgraphs: ReadonlyArray<{ id: string; collapsed?: boolean; title?: string }>;
}): string {
  let out = `${graph.nodes.length}|${graph.edges.length}|${graph.subgraphs.length}|`;
  for (const node of graph.nodes) {
    out += `${node.id}:${node.x | 0},${node.y | 0},${node.width | 0},${node.height | 0};`;
  }
  out += '|';
  for (const edge of graph.edges) {
    out += `${edge.id}:${edge.from}>${edge.to}:${edge.label ?? ''};`;
  }
  out += '|';
  for (const subgraph of graph.subgraphs) {
    out += `${subgraph.id}:${subgraph.collapsed ? 1 : 0}:${subgraph.title ?? ''};`;
  }
  return out;
}

export function shouldRebuildDerivedScene(
  prevRevision: string,
  nextRevision: string,
  force = false,
): boolean {
  return force || prevRevision !== nextRevision;
}

export function markDerivedSceneRebuild() {
  hotPathCounters.rebuildDerivedScene += 1;
}
