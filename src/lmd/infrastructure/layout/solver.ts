import type { Direction, GraphDocument, GraphNode } from '../compat/types';
import { estimateEdgeLabelSize } from '../../domain/label';
import type { Rect } from '../../shared/geom';
import { placeCompoundComponent, type PlaceFlowFn } from './compound';
import { resolveOverlaps } from './overlap';
import { buildLayoutPlan, partitionLayoutComponents } from './topology';
import type { LayoutPlan, LayoutSolveOptions, LayoutSolveResult } from './types';

const UNBOUNDED_PRIMARY_GAP = { LR: 120, RL: 120, TD: 100, BT: 100 };
const UNBOUNDED_MINOR_GAP = { LR: 56, RL: 56, TD: 60, BT: 60 };
const COMPACT_PRIMARY_GAP = { LR: 52, RL: 52, TD: 44, BT: 44 };
const COMPACT_MINOR_GAP = { LR: 36, RL: 36, TD: 36, BT: 36 };
const MIN_GAP = 10;

function isVertical(direction: Direction) {
  return direction === 'TD' || direction === 'BT';
}

function isReversed(direction: Direction) {
  return direction === 'RL' || direction === 'BT';
}

function primarySize(node: GraphNode, direction: Direction) {
  return isVertical(direction) ? node.height : node.width;
}

function minorSize(node: GraphNode, direction: Direction) {
  return isVertical(direction) ? node.width : node.height;
}

function withPosition(node: GraphNode, direction: Direction, primary: number, minor: number): GraphNode {
  return isVertical(direction)
    ? { ...node, x: Math.round(minor), y: Math.round(primary) }
    : { ...node, x: Math.round(primary), y: Math.round(minor) };
}

function scopedNodes(document: GraphDocument, nodeIds?: Iterable<string>) {
  if (!nodeIds) {
    return document.nodes.map((node) => ({ ...node }));
  }
  const allow = new Set(nodeIds);
  return document.nodes.filter((node) => allow.has(node.id)).map((node) => ({ ...node }));
}

function chipCorridor(label: string) {
  const size = estimateEdgeLabelSize(label);
  if (size.width <= 0) {
    return 0;
  }
  return size.width + 28;
}

function clearanceBetweenRanks(
  document: GraphDocument,
  leftIds: string[],
  rightIds: string[],
) {
  const left = new Set(leftIds);
  const right = new Set(rightIds);
  let needed = 0;
  document.edges.forEach((edge) => {
    const crosses = (left.has(edge.from) && right.has(edge.to)) || (right.has(edge.from) && left.has(edge.to));
    if (crosses) {
      needed = Math.max(needed, chipCorridor(edge.label));
    }
  });
  return needed;
}

function placeUnbounded(
  nodes: GraphNode[],
  plan: LayoutPlan,
  keepCentroid: { x: number; y: number } | null,
  document?: GraphDocument,
  compact = false,
): GraphNode[] {
  const direction = plan.direction;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ranks = isReversed(direction) ? [...plan.slots].reverse() : plan.slots;
  const primaryGap = (compact ? COMPACT_PRIMARY_GAP : UNBOUNDED_PRIMARY_GAP)[direction];
  const minorGap = (compact ? COMPACT_MINOR_GAP : UNBOUNDED_MINOR_GAP)[direction];

  let primaryCursor = 0;
  const placed: GraphNode[] = [];
  ranks.forEach((slot, index) => {
    const rankNodes = slot.nodeIds.map((id) => byId.get(id)).filter((node): node is GraphNode => Boolean(node));
    const thickness = rankNodes.reduce((max, node) => Math.max(max, primarySize(node, direction)), 0);
    const packGap = minorGap;
    const totalMinor = rankNodes.reduce(
      (sum, node, index) => sum + minorSize(node, direction) + (index === rankNodes.length - 1 ? 0 : packGap),
      0,
    );
    let minorCursor = -totalMinor / 2;
    rankNodes.forEach((node) => {
      placed.push(withPosition(node, direction, primaryCursor, minorCursor));
      minorCursor += minorSize(node, direction) + packGap;
    });
    const next = ranks[index + 1];
    const extra = document && next
      ? Math.max(0, clearanceBetweenRanks(document, slot.nodeIds, next.nodeIds) - primaryGap)
      : 0;
    primaryCursor += thickness + primaryGap + extra;
  });

  if (!keepCentroid || placed.length === 0) {
    return mergePlaced(nodes, placed);
  }
  const cx = placed.reduce((sum, node) => sum + node.x + node.width / 2, 0) / placed.length;
  const cy = placed.reduce((sum, node) => sum + node.y + node.height / 2, 0) / placed.length;
  const dx = keepCentroid.x - cx;
  const dy = keepCentroid.y - cy;
  return mergePlaced(
    nodes,
    placed.map((node) => ({ ...node, x: Math.round(node.x + dx), y: Math.round(node.y + dy) })),
  );
}

/**
 * Fill `bounds` by distributing leftover space as gaps between ranks and
 * along each rank. If the packed minimum exceeds the box, scale uniformly.
 */
function placeInBounds(nodes: GraphNode[], plan: LayoutPlan, bounds: Rect): GraphNode[] {
  const direction = plan.direction;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ranks = isReversed(direction) ? [...plan.slots].reverse() : plan.slots;
  if (ranks.length === 0) {
    return nodes;
  }

  const rankThickness = ranks.map((slot) => {
    const rankNodes = slot.nodeIds.map((id) => byId.get(id)).filter((node): node is GraphNode => Boolean(node));
    return rankNodes.reduce((max, node) => Math.max(max, primarySize(node, direction)), 0);
  });
  const rankMinors = ranks.map((slot) => {
    const rankNodes = slot.nodeIds.map((id) => byId.get(id)).filter((node): node is GraphNode => Boolean(node));
    return rankNodes.reduce((sum, node) => sum + minorSize(node, direction), 0);
  });

  const primarySpan = isVertical(direction) ? bounds.height : bounds.width;
  const minorSpan = isVertical(direction) ? bounds.width : bounds.height;
  const primaryOrigin = isVertical(direction) ? bounds.y : bounds.x;
  const minorOrigin = isVertical(direction) ? bounds.x : bounds.y;

  const minPrimary = rankThickness.reduce((sum, value) => sum + value, 0);
  const leftoverPrimary = primarySpan - minPrimary;
  const primaryGaps = ranks.length + 1;
  let gapPrimary = leftoverPrimary / primaryGaps;
  let primaryScale = 1;
  if (gapPrimary < MIN_GAP) {
    gapPrimary = MIN_GAP;
    const needed = minPrimary + MIN_GAP * (ranks.length + 1);
    if (needed > primarySpan && needed > 0) {
      primaryScale = primarySpan / needed;
      gapPrimary = MIN_GAP * primaryScale;
    }
  }

  const placed: GraphNode[] = [];
  let primaryCursor = primaryOrigin + gapPrimary;
  ranks.forEach((slot, rankIndex) => {
    const rankNodes = slot.nodeIds.map((id) => byId.get(id)).filter((node): node is GraphNode => Boolean(node));
    const thickness = rankThickness[rankIndex] * primaryScale;
    const leftoverMinor = minorSpan - rankMinors[rankIndex];
    const minorGaps = Math.max(1, rankNodes.length + 1);
    let gapMinor = leftoverMinor / minorGaps;
    let minorScale = 1;
    if (gapMinor < MIN_GAP) {
      gapMinor = MIN_GAP;
      const needed = rankMinors[rankIndex] + MIN_GAP * minorGaps;
      if (needed > minorSpan && needed > 0) {
        minorScale = minorSpan / needed;
        gapMinor = MIN_GAP * minorScale;
      }
    }

    let minorCursor = minorOrigin + gapMinor;
    rankNodes.forEach((node) => {
      const pSize = primarySize(node, direction) * primaryScale;
      const mSize = minorSize(node, direction) * minorScale;
      const primary = primaryCursor + (thickness - pSize) / 2;
      placed.push(withPosition(node, direction, primary, minorCursor));
      minorCursor += mSize + gapMinor;
    });
    primaryCursor += thickness + gapPrimary;
  });

  return mergePlaced(nodes, placed);
}

/** Keep a corridor between A⇄B so the return edge and its label have room. */
function separateReciprocalPairs(
  document: GraphDocument,
  nodes: GraphNode[],
  bounds?: Rect,
): GraphNode[] {
  const byId = new Map(nodes.map((node) => [node.id, { ...node }]));
  const seen = new Set<string>();
  document.edges.forEach((edge) => {
    const back = document.edges.find((candidate) => (
      candidate.from === edge.to && candidate.to === edge.from
    ));
    if (!back) {
      return;
    }
    const key = [edge.from, edge.to].sort().join('::');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const left = byId.get(edge.from);
    const right = byId.get(edge.to);
    if (!left || !right) {
      return;
    }
    const dx = (right.x + right.width / 2) - (left.x + left.width / 2);
    const dy = (right.y + right.height / 2) - (left.y + left.height / 2);
    const minGap = 64 + (edge.label.trim() || back.label.trim() ? 16 : 0);
    if (Math.abs(dx) >= Math.abs(dy)) {
      const gap = dx >= 0
        ? right.x - (left.x + left.width)
        : left.x - (right.x + right.width);
      if (gap >= minGap) {
        return;
      }
      const push = (minGap - gap) / 2;
      const dir = dx >= 0 ? 1 : -1;
      left.x = Math.round(left.x - dir * push);
      right.x = Math.round(right.x + dir * push);
    } else {
      const gap = dy >= 0
        ? right.y - (left.y + left.height)
        : left.y - (right.y + right.height);
      if (gap >= minGap) {
        return;
      }
      const push = (minGap - gap) / 2;
      const dir = dy >= 0 ? 1 : -1;
      left.y = Math.round(left.y - dir * push);
      right.y = Math.round(right.y + dir * push);
    }
  });
  const next = nodes.map((node) => byId.get(node.id) ?? node);
  return bounds ? resolveOverlaps(next, bounds, { padding: 10, iterations: 6 }) : next;
}

function nodeBounds(nodes: GraphNode[]) {
  return {
    minX: Math.min(...nodes.map((node) => node.x)),
    minY: Math.min(...nodes.map((node) => node.y)),
    maxX: Math.max(...nodes.map((node) => node.x + node.width)),
    maxY: Math.max(...nodes.map((node) => node.y + node.height)),
  };
}

function placeIsolatedGrid(nodes: GraphNode[]): GraphNode[] {
  const sorted = [...nodes].sort((left, right) => left.id.localeCompare(right.id));
  const columns = sorted.length <= 2 ? Math.max(1, sorted.length) : 2;
  const gapX = 28;
  const gapY = 24;
  const placed: GraphNode[] = [];
  let rowY = 0;
  for (let start = 0; start < sorted.length; start += columns) {
    const row = sorted.slice(start, start + columns);
    let x = 0;
    let rowHeight = 0;
    row.forEach((node) => {
      placed.push({ ...node, x: Math.round(x), y: Math.round(rowY) });
      x += node.width + gapX;
      rowHeight = Math.max(rowHeight, node.height);
    });
    rowY += rowHeight + gapY;
  }
  return mergePlaced(nodes, placed);
}

const COMPONENT_GAP = 88;

function packBlocks(direction: Direction, blocks: GraphNode[][]): GraphNode[] {
  const vertical = isVertical(direction);
  let cursor = 0;
  const packed: GraphNode[] = [];
  blocks.forEach((block) => {
    if (block.length === 0) {
      return;
    }
    const box = nodeBounds(block);
    const dx = vertical ? cursor - box.minX : -box.minX;
    const dy = vertical ? -box.minY : cursor - box.minY;
    block.forEach((node) => {
      packed.push({
        ...node,
        x: Math.round(node.x + dx),
        y: Math.round(node.y + dy),
      });
    });
    cursor += (vertical ? box.maxX - box.minX : box.maxY - box.minY) + COMPONENT_GAP;
  });
  return packed;
}

function alignSlotsToPredecessors(
  nodes: GraphNode[],
  plan: LayoutPlan,
  document: GraphDocument,
): GraphNode[] {
  const byId = new Map(nodes.map((node) => [node.id, { ...node }]));
  const direction = plan.direction;
  const gap = isVertical(direction) ? UNBOUNDED_MINOR_GAP.TD : UNBOUNDED_MINOR_GAP.LR;
  plan.slots.forEach((slot) => {
    const allow = new Set(slot.nodeIds);
    const members = slot.nodeIds
      .map((id) => byId.get(id))
      .filter((entry): entry is GraphNode => Boolean(entry));
    if (members.length === 0) {
      return;
    }
    const targets = new Map<string, number>();
    members.forEach((node) => {
      const preds = document.edges
        .filter((edge) => edge.to === node.id && !allow.has(edge.from))
        .map((edge) => byId.get(edge.from))
        .filter((entry): entry is GraphNode => Boolean(entry));
      if (preds.length === 0) {
        return;
      }
      targets.set(
        node.id,
        preds.reduce((sum, entry) => (
          sum + (isVertical(direction) ? entry.x + entry.width / 2 : entry.y + entry.height / 2)
        ), 0) / preds.length,
      );
    });
    if (targets.size === 0) {
      return;
    }
    const ordered = [...members].sort((left, right) => (
      (targets.get(left.id) ?? (isVertical(direction) ? left.x : left.y))
      - (targets.get(right.id) ?? (isVertical(direction) ? right.x : right.y))
    ));
    const total = ordered.reduce((sum, node, index) => (
      sum + minorSize(node, direction) + (index === ordered.length - 1 ? 0 : gap)
    ), 0);
    const focus = [...targets.values()].reduce((sum, value) => sum + value, 0) / targets.size;
    let cursor = focus - total / 2;
    ordered.forEach((node) => {
      if (isVertical(direction)) {
        node.x = Math.round(cursor);
        cursor += node.width + gap;
      } else {
        node.y = Math.round(cursor);
        cursor += node.height + gap;
      }
      byId.set(node.id, node);
    });
  });
  return nodes.map((node) => byId.get(node.id) ?? node);
}

function mergePlaced(original: GraphNode[], placed: GraphNode[]) {
  const map = new Map(placed.map((node) => [node.id, node]));
  return original.map((node) => {
    const next = map.get(node.id);
    return next ? { ...node, x: next.x, y: next.y } : node;
  });
}

function tidyTowardNeighbors(document: GraphDocument, nodes: GraphNode[]): GraphNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const allow = new Set(nodes.map((node) => node.id));
  document.edges.forEach((edge) => {
    if (!allow.has(edge.from) || !allow.has(edge.to)) {
      return;
    }
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
  });
  const direction = document.direction;
  const vertical = isVertical(direction);
  return nodes.map((node) => {
    const targets: { x: number; y: number }[] = [];
    const pull = (neighborId: string, toward: 1 | -1) => {
      const neighbor = byId.get(neighborId);
      if (!neighbor) {
        return;
      }
      if (vertical) {
        targets.push({
          x: neighbor.x,
          y: neighbor.y + toward * (toward > 0 ? neighbor.height + 72 : node.height + 72),
        });
      } else {
        targets.push({
          x: neighbor.x + toward * (toward > 0 ? neighbor.width + 84 : node.width + 84),
          y: neighbor.y,
        });
      }
    };
    (incoming.get(node.id) ?? []).forEach((id) => pull(id, 1));
    (outgoing.get(node.id) ?? []).forEach((id) => pull(id, -1));
    if (targets.length === 0) {
      return node;
    }
    const nx = targets.reduce((sum, value) => sum + value.x, 0) / targets.length;
    const ny = targets.reduce((sum, value) => sum + value.y, 0) / targets.length;
    const minGap = 36;
    let dx = nx - node.x;
    let dy = ny - node.y;
    // Reciprocal / already-tight pairs must not crawl closer.
    if (vertical) {
      const tooClose = (incoming.get(node.id) ?? []).concat(outgoing.get(node.id) ?? []).some((id) => {
        const neighbor = byId.get(id);
        if (!neighbor) return false;
        const gap = node.y >= neighbor.y
          ? node.y - (neighbor.y + neighbor.height)
          : neighbor.y - (node.y + node.height);
        return gap < minGap && Math.sign(dy) === Math.sign(neighbor.y - node.y);
      });
      if (tooClose) {
        dy = 0;
      }
    } else {
      const tooClose = (incoming.get(node.id) ?? []).concat(outgoing.get(node.id) ?? []).some((id) => {
        const neighbor = byId.get(id);
        if (!neighbor) return false;
        const gap = node.x >= neighbor.x
          ? node.x - (neighbor.x + neighbor.width)
          : neighbor.x - (node.x + node.width);
        return gap < minGap && Math.sign(dx) === Math.sign(neighbor.x - node.x);
      });
      if (tooClose) {
        dx = 0;
      }
    }
    const limit = 28;
    return {
      ...node,
      x: Math.round(node.x + Math.max(-limit, Math.min(limit, dx))),
      y: Math.round(node.y + Math.max(-limit, Math.min(limit, dy))),
    };
  });
}

/**
 * Complete layout solve: topology ranks → place (unbounded or inside a shape)
 * → unpack overlaps. This is the single entry the editor should call.
 */
export function solveOptimalLayout(
  document: GraphDocument,
  options: LayoutSolveOptions = {},
): LayoutSolveResult {
  const scoped = scopedNodes(document, options.nodeIds);
  const plan = buildLayoutPlan(document, scoped);
  if (scoped.length === 0) {
    return { nodes: document.nodes, plan };
  }

  const finish = (placedNodes: GraphNode[], nextPlan: LayoutPlan): LayoutSolveResult => {
    const byId = new Map(placedNodes.map((node) => [node.id, node]));
    return {
      plan: nextPlan,
      nodes: document.nodes.map((node) => {
        const next = byId.get(node.id);
        return next ? { ...node, x: next.x, y: next.y } : node;
      }),
    };
  };

  const placeFlow: PlaceFlowFn = (nodes, keepCentroid, style) => {
    const graph = style?.graph ?? { ...document, nodes };
    const directed = {
      ...graph,
      direction: style?.direction ?? graph.direction,
      nodes,
    };
    const nextPlan = buildLayoutPlan(directed, nodes);
    let placed = options.mode === 'tidy' && !options.bounds
      ? tidyTowardNeighbors(directed, nodes)
      : options.bounds
        ? placeInBounds(nodes, nextPlan, options.bounds)
        : alignSlotsToPredecessors(
          placeUnbounded(nodes, nextPlan, keepCentroid, directed, style?.compact),
          nextPlan,
          directed,
        );
    placed = resolveOverlaps(placed, options.bounds, {
      padding: options.mode === 'tidy' ? 26 : 14,
      iterations: 14,
    });
    return separateReciprocalPairs({ ...directed, nodes: placed }, placed, options.bounds);
  };

  if (!options.bounds && !options.nodeIds && options.mode !== 'tidy') {
    const parts = partitionLayoutComponents(document, scoped);
    const blocks = parts.map((part) => (
      part.kind === 'notes'
        ? placeIsolatedGrid(part.nodes)
        : document.subgraphs.length > 0
          ? placeCompoundComponent(document, part.nodes, placeFlow)
          : placeFlow(part.nodes, null)
    ));
    return finish(packBlocks(document.direction, blocks), plan);
  }

  const keepCentroid = options.anchor === 'origin'
    ? null
    : {
        x: scoped.reduce((sum, node) => sum + node.x + node.width / 2, 0) / scoped.length,
        y: scoped.reduce((sum, node) => sum + node.y + node.height / 2, 0) / scoped.length,
      };
  return finish(placeFlow(scoped, keepCentroid), plan);
}

export function innerRect(bounds: Rect, padding: number): Rect {
  return {
    x: bounds.x + padding,
    y: bounds.y + padding,
    width: Math.max(40, bounds.width - padding * 2),
    height: Math.max(40, bounds.height - padding * 2),
  };
}
