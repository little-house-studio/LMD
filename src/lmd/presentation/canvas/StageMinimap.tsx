import { useMemo, type MouseEvent } from 'react';
import type { GraphDocument } from '../..';
import { readSequenceFrames } from '../../infrastructure/layout/sequenceFrames';
import { computeGroupRects, sequenceFrameAsRect, syncSequenceFrames } from '../../placement';
import type { Rect } from './math';
import './stage.css';

type ViewportInfo = {
  world: Rect;
  view: Rect;
  scale?: number;
};

type StageMinimapProps = {
  document: GraphDocument;
  viewport: ViewportInfo | null;
};

/**
 * Navigation map (README: 导航图). Click to center main camera.
 */
export function StageMinimap({ document, viewport }: StageMinimapProps) {
  const { world, nodes, groups, sequences } = useMemo(() => {
    const lookup = new Map(document.subgraphs.map((subgraph) => [subgraph.id, subgraph]));
    const nested = computeGroupRects(document.subgraphs, document.nodes, lookup);
    const groupRects = document.subgraphs.map((sg) => ({
      id: sg.id,
      title: sg.title,
      rect: nested.get(sg.id) ?? { x: 0, y: 0, width: 0, height: 0 },
      stroke: sg.stroke || '#4aa8b4',
    }));
    const nodeRects = document.nodes.map((n) => ({
      id: n.id,
      rect: { x: n.x, y: n.y, width: n.width, height: n.height },
      stroke: n.stroke || '#d6ff3a',
    }));
    const graphBounds = (() => {
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      const take = (r: Rect) => {
        x1 = Math.min(x1, r.x);
        y1 = Math.min(y1, r.y);
        x2 = Math.max(x2, r.x + r.width);
        y2 = Math.max(y2, r.y + r.height);
      };
      nodeRects.forEach((n) => take(n.rect));
      groupRects.forEach((g) => take(g.rect));
      if (!Number.isFinite(x1)) {
        return null;
      }
      return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    })();
    const sequenceRects = syncSequenceFrames(
      document.sequence?.scenes ?? [],
      readSequenceFrames(document.compat?.extras as Record<string, unknown> | undefined),
      graphBounds,
      (value) => value,
    ).map((frame) => ({
      id: frame.id,
      rect: sequenceFrameAsRect(frame),
    }));

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const absorb = (r: Rect) => {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    };
    nodeRects.forEach((n) => absorb(n.rect));
    groupRects.forEach((g) => absorb(g.rect));
    sequenceRects.forEach((item) => absorb(item.rect));
    if (!Number.isFinite(minX)) {
      return {
        world: { x: 0, y: 0, width: 400, height: 300 },
        nodes: nodeRects,
        groups: groupRects,
        sequences: sequenceRects,
      };
    }
    const pad = 40;
    return {
      world: {
        x: minX - pad,
        y: minY - pad,
        width: Math.max(100, maxX - minX + pad * 2),
        height: Math.max(80, maxY - minY + pad * 2),
      },
      nodes: nodeRects,
      groups: groupRects,
      sequences: sequenceRects,
    };
  }, [document.compat?.extras, document.nodes, document.sequence, document.subgraphs]);

  const mapW = 104;
  const mapH = 66;
  const sx = mapW / world.width;
  const sy = mapH / world.height;
  const s = Math.min(sx, sy);
  const ox = (mapW - world.width * s) / 2;
  const oy = (mapH - world.height * s) / 2;

  const toMap = (r: Rect) => ({
    x: ox + (r.x - world.x) * s,
    y: oy + (r.y - world.y) * s,
    w: Math.max(2, r.width * s),
    h: Math.max(2, r.height * s),
  });

  const viewBox = viewport?.view
    ? toMap(viewport.view)
    : null;

  const onClick = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const wx = world.x + (mx - ox) / s;
    const wy = world.y + (my - oy) / s;
    window.dispatchEvent(
      new CustomEvent('lmd-flow:center-world', { detail: { x: wx, y: wy } }),
    );
  };

  return (
    <div className="stage-minimap" title="导航图 · 点击跳转">
      <div className="stage-minimap__label">导航</div>
      <svg
        className="stage-minimap__svg"
        height={mapH}
        onClick={onClick}
        role="img"
        viewBox={`0 0 ${mapW} ${mapH}`}
        width={mapW}
      >
        <rect fill="#0a0a0c" height={mapH} width={mapW} x={0} y={0} />
        {groups.map((g) => {
          const m = toMap(g.rect);
          return (
            <rect
              fill="rgba(0,240,255,0.08)"
              height={m.h}
              key={g.id}
              stroke={g.stroke}
              strokeWidth={0.8}
              width={m.w}
              x={m.x}
              y={m.y}
            />
          );
        })}
        {sequences.map((item) => {
          const m = toMap(item.rect);
          return (
            <rect
              fill="rgba(199,125,255,0.18)"
              height={m.h}
              key={item.id}
              stroke="#c77dff"
              strokeWidth={0.8}
              width={m.w}
              x={m.x}
              y={m.y}
            />
          );
        })}
        {nodes.map((n) => {
          const m = toMap(n.rect);
          return (
            <rect
              fill="rgba(214,255,58,0.25)"
              height={m.h}
              key={n.id}
              stroke={n.stroke}
              strokeWidth={0.6}
              width={m.w}
              x={m.x}
              y={m.y}
            />
          );
        })}
        {viewBox ? (
          <rect
            fill="rgba(214,255,58,0.06)"
            height={viewBox.h}
            stroke="#2f80ff"
            strokeDasharray="3 2"
            strokeWidth={1}
            width={viewBox.w}
            x={viewBox.x}
            y={viewBox.y}
          />
        ) : null}
      </svg>
    </div>
  );
}
