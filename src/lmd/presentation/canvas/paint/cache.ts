import type { GraphNode } from '../../..';
import { fitWrappedText, nodeContentBands, type EdgeGeometry } from '../../../placement';
import { createEdgePath, createNodePath } from '../shapePath';
import { NODE_RADIUS } from './theme';
import type { Rect } from '../math';

export class PaintCache {
  measureCache = new Map<string, number>();
  bandCache = new Map<string, { sig: string; bands: ReturnType<typeof nodeContentBands> }>();
  textFitCache = new Map<string, { fontPx: number; linePx: number }>();
  nodePaths = new Map<string, Path2D>();
  edgePaths = new Map<string, Path2D>();
  paintLabelAvoid: Rect[] | null = null;

  clearStructural() {
    this.bandCache.clear();
    this.textFitCache.clear();
  }

  measureScreenWidth(ctx: CanvasRenderingContext2D | null, text: string, font: string): number {
    const key = `${font}\0${text}`;
    const cached = this.measureCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const width = ctx ? (ctx.font = font, ctx.measureText(text).width) : text.length * 7;
    if (this.measureCache.size > 400) {
      this.measureCache.clear();
    }
    this.measureCache.set(key, width);
    return width;
  }

  nodeBands(node: GraphNode) {
    const sig = `${node.label}\0${node.x}\0${node.y}\0${node.width}\0${node.height}`;
    const cached = this.bandCache.get(node.id);
    if (cached && cached.sig === sig) {
      return cached.bands;
    }
    const bands = nodeContentBands(node);
    this.bandCache.set(node.id, { sig, bands });
    return bands;
  }

  fitNodeText(
    id: string,
    field: string,
    lines: readonly string[],
    band: Rect,
    maxFontPx: number,
    lineHeightPx: number,
    lod: string,
  ) {
    const key = `${id}:${field}:${lod}:${band.width | 0}x${band.height | 0}`;
    const cached = this.textFitCache.get(key);
    if (cached) {
      return cached;
    }
    const fitted = fitWrappedText({
      lines,
      bandWidth: band.width,
      bandHeight: band.height,
      maxFontPx,
      lineHeightPx,
    });
    if (this.textFitCache.size > 600) {
      this.textFitCache.clear();
    }
    this.textFitCache.set(key, fitted);
    return fitted;
  }

  rebuildShapePaths(nodes: readonly GraphNode[], edgeRoutes: Map<string, EdgeGeometry>) {
    this.nodePaths.clear();
    this.edgePaths.clear();
    if (typeof Path2D === 'undefined') {
      return;
    }
    for (const node of nodes) {
      this.nodePaths.set(
        node.id,
        createNodePath(node.shape, node.x, node.y, node.width, node.height, NODE_RADIUS),
      );
    }
    for (const [id, geometry] of edgeRoutes) {
      this.edgePaths.set(id, createEdgePath(geometry));
    }
  }
}
