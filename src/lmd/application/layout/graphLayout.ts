import type { Direction, GraphDocument, GraphNode, GraphSubgraph } from '../..';
import { expandRect, rectIntersects, type Rect, type Vec2 } from '../../shared/geom';

export type LayoutSelection = { kind: string; ids?: string[] };

export function subgraphLookup(subgraphs: GraphSubgraph[]) {
  return new Map(subgraphs.map((subgraph) => [subgraph.id, subgraph]));
}

export function belongsToSubgraph(
  node: GraphNode,
  subgraphId: string,
  lookup: Map<string, GraphSubgraph>,
) {
  let current = node.subgraphId;
  while (current) {
    if (current === subgraphId) {
      return true;
    }
    current = lookup.get(current)?.parentId ?? null;
  }
  return false;
}

export function getTopVisibleCollapsedAncestorId(
  subgraphId: string | null | undefined,
  lookup: Map<string, GraphSubgraph>,
) {
  let current = subgraphId ?? null;
  let visibleCollapsed: string | null = null;
  while (current) {
    const owner = lookup.get(current);
    if (!owner) {
      break;
    }
    if (owner.collapsed) {
      visibleCollapsed = owner.id;
    }
    current = owner.parentId;
  }
  return visibleCollapsed;
}

export function isInsideCollapsedSubgraph(
  node: GraphNode,
  lookup: Map<string, GraphSubgraph>,
) {
  return Boolean(getTopVisibleCollapsedAncestorId(node.subgraphId, lookup));
}

export function isSubgraphHiddenByCollapsedAncestor(
  subgraph: GraphSubgraph,
  lookup: Map<string, GraphSubgraph>,
) {
  let current = subgraph.parentId;
  while (current) {
    const owner = lookup.get(current);
    if (!owner) {
      return false;
    }
    if (owner.collapsed) {
      return true;
    }
    current = owner.parentId;
  }
  return false;
}

export function membersOfSubgraph(
  nodes: GraphNode[],
  subgraphId: string,
  lookup: Map<string, GraphSubgraph>,
) {
  return nodes.filter((node) => belongsToSubgraph(node, subgraphId, lookup));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeVector(vector: Vec2): Vec2 {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 0.001) {
    return { x: 1, y: 0 };
  }
  return { x: vector.x / length, y: vector.y / length };
}

export function searchFreeRect(
  desired: Rect,
  obstacles: Rect[],
  directionHint: Vec2,
  bounds?: Rect | null,
): Rect {
  const direction = normalizeVector(directionHint);
  const perpendicular = { x: -direction.y, y: direction.x };

  const fits = (rect: Rect) => {
    if (bounds) {
      const within =
        rect.x >= bounds.x &&
        rect.y >= bounds.y &&
        rect.x + rect.width <= bounds.x + bounds.width &&
        rect.y + rect.height <= bounds.y + bounds.height;
      if (!within) {
        return false;
      }
    }
    return obstacles.every((obstacle) => !rectIntersects(rect, obstacle));
  };

  if (fits(desired)) {
    return desired;
  }

  for (let step = 1; step <= 64; step += 1) {
    const travel = step * 18;
    const fan = Math.ceil(step / 2) * 12;
    const candidates = [
      { x: desired.x + direction.x * travel, y: desired.y + direction.y * travel },
      {
        x: desired.x + direction.x * travel + perpendicular.x * fan,
        y: desired.y + direction.y * travel + perpendicular.y * fan,
      },
      {
        x: desired.x + direction.x * travel - perpendicular.x * fan,
        y: desired.y + direction.y * travel - perpendicular.y * fan,
      },
      { x: desired.x + perpendicular.x * travel, y: desired.y + perpendicular.y * travel },
      { x: desired.x - perpendicular.x * travel, y: desired.y - perpendicular.y * travel },
    ];
    for (const candidate of candidates) {
      const rect = { ...desired, x: Math.round(candidate.x), y: Math.round(candidate.y) };
      if (fits(rect)) {
        return rect;
      }
    }
  }

  return desired;
}

export function nodeCollisionObstacles(
  nodes: GraphNode[],
  ignoredIds: ReadonlySet<string> = new Set(),
  padding = 16,
): Rect[] {
  return nodes
    .filter((node) => !ignoredIds.has(node.id))
    .map((node) => expandRect({
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    }, padding));
}

function isPrimaryVertical(direction: Direction) {
  return direction === 'TD' || direction === 'BT';
}

function isPrimaryReversed(direction: Direction) {
  return direction === 'RL' || direction === 'BT';
}

function getNodePrimaryStart(node: GraphNode, direction: Direction) {
  return isPrimaryVertical(direction) ? node.y : node.x;
}

function getNodeMinorStart(node: GraphNode, direction: Direction) {
  return isPrimaryVertical(direction) ? node.x : node.y;
}

function getNodePrimarySize(node: GraphNode, direction: Direction) {
  return isPrimaryVertical(direction) ? node.height : node.width;
}

function getNodeMinorSize(node: GraphNode, direction: Direction) {
  return isPrimaryVertical(direction) ? node.width : node.height;
}

function withNodeAxisPosition(
  node: GraphNode,
  direction: Direction,
  primary: number,
  minor: number,
): GraphNode {
  return isPrimaryVertical(direction)
    ? { ...node, x: Math.round(minor), y: Math.round(primary) }
    : { ...node, x: Math.round(primary), y: Math.round(minor) };
}

function buildSelectionBounds(nodes: GraphNode[]): Rect | null {
  if (nodes.length === 0) {
    return null;
  }
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function buildSubgraphPathKey(
  subgraphId: string | null,
  lookup: Map<string, GraphSubgraph>,
) {
  const path: string[] = [];
  let current = subgraphId;
  while (current) {
    const subgraph = lookup.get(current);
    if (!subgraph) {
      break;
    }
    path.unshift(subgraph.title || subgraph.id);
    current = subgraph.parentId;
  }
  return path.join(' / ');
}

function buildNodeDegreeMap(document: GraphDocument) {
  const degrees = new Map(document.nodes.map((node) => [node.id, 0]));
  const nodeIdSet = new Set(document.nodes.map((node) => node.id));
  document.edges.forEach((edge) => {
    if (nodeIdSet.has(edge.from)) {
      degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1);
    }
    if (nodeIdSet.has(edge.to)) {
      degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1);
    }
  });
  return degrees;
}

function buildSemanticLayoutEdges(document: GraphDocument) {
  const nodeIdSet = new Set(document.nodes.map((node) => node.id));
  const lookup = subgraphLookup(document.subgraphs);
  const degreeMap = buildNodeDegreeMap(document);
  const representativeCache = new Map<string, string | null>();
  const direction = document.direction;

  const resolveEndpointNode = (endpointId: string) => {
    if (nodeIdSet.has(endpointId)) {
      return endpointId;
    }
    if (representativeCache.has(endpointId)) {
      return representativeCache.get(endpointId) ?? null;
    }
    const candidates = document.nodes
      .filter((node) => belongsToSubgraph(node, endpointId, lookup))
      .sort((left, right) => {
        const degreeDelta = (degreeMap.get(right.id) ?? 0) - (degreeMap.get(left.id) ?? 0);
        if (degreeDelta !== 0) {
          return degreeDelta;
        }
        const primaryDelta = getNodePrimaryStart(left, direction) - getNodePrimaryStart(right, direction);
        if (primaryDelta !== 0) {
          return primaryDelta;
        }
        const minorDelta = getNodeMinorStart(left, direction) - getNodeMinorStart(right, direction);
        if (minorDelta !== 0) {
          return minorDelta;
        }
        return left.id.localeCompare(right.id);
      });
    const representative = candidates[0]?.id ?? null;
    representativeCache.set(endpointId, representative);
    return representative;
  };

  const deduped = new Map<string, { from: string; to: string }>();
  document.edges.forEach((edge) => {
    const from = resolveEndpointNode(edge.from);
    const to = resolveEndpointNode(edge.to);
    if (!from || !to || from === to) {
      return;
    }
    deduped.set(`${from}->${to}`, { from, to });
  });
  return [...deduped.values()];
}

function computeStronglyConnectedComponents(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
) {
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
  edges.forEach((edge) => {
    adjacency.get(edge.from)?.push(edge.to);
  });

  const indexMap = new Map<string, number>();
  const lowLinkMap = new Map<string, number>();
  const stack: string[] = [];
  const stackMembers = new Set<string>();
  const components: string[][] = [];
  let index = 0;

  const visit = (nodeId: string) => {
    indexMap.set(nodeId, index);
    lowLinkMap.set(nodeId, index);
    index += 1;
    stack.push(nodeId);
    stackMembers.add(nodeId);

    (adjacency.get(nodeId) ?? []).forEach((nextId) => {
      if (!indexMap.has(nextId)) {
        visit(nextId);
        lowLinkMap.set(
          nodeId,
          Math.min(lowLinkMap.get(nodeId) ?? Number.POSITIVE_INFINITY, lowLinkMap.get(nextId) ?? Number.POSITIVE_INFINITY),
        );
        return;
      }
      if (stackMembers.has(nextId)) {
        lowLinkMap.set(
          nodeId,
          Math.min(lowLinkMap.get(nodeId) ?? Number.POSITIVE_INFINITY, indexMap.get(nextId) ?? Number.POSITIVE_INFINITY),
        );
      }
    });

    if (lowLinkMap.get(nodeId) !== indexMap.get(nodeId)) {
      return;
    }

    const component: string[] = [];
    let current: string | undefined;
    do {
      current = stack.pop();
      if (!current) {
        break;
      }
      stackMembers.delete(current);
      component.push(current);
    } while (current !== nodeId);
    components.push(component);
  };

  nodeIds.forEach((nodeId) => {
    if (!indexMap.has(nodeId)) {
      visit(nodeId);
    }
  });

  const componentOf = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    component.forEach((nodeId) => componentOf.set(nodeId, componentIndex));
  });
  return { components, componentOf };
}

function buildTopologicalRankMap(
  document: GraphDocument,
  semanticEdges: Array<{ from: string; to: string }>,
) {
  const sortedNodes = [...document.nodes].sort((left, right) => {
    const primaryDelta = getNodePrimaryStart(left, document.direction) - getNodePrimaryStart(right, document.direction);
    if (primaryDelta !== 0) {
      return primaryDelta;
    }
    return getNodeMinorStart(left, document.direction) - getNodeMinorStart(right, document.direction);
  });
  const nodeIds = sortedNodes.map((node) => node.id);
  const { components, componentOf } = computeStronglyConnectedComponents(nodeIds, semanticEdges);
  const componentPrimaryAnchor = new Map<number, number>();

  components.forEach((component, componentIndex) => {
    const anchor = Math.min(
      ...component.map((nodeId) =>
        getNodePrimaryStart(
          document.nodes.find((node) => node.id === nodeId) ?? document.nodes[0],
          document.direction,
        ),
      ),
    );
    componentPrimaryAnchor.set(componentIndex, anchor);
  });

  const outgoing = new Map<number, Set<number>>();
  const incomingCount = new Map<number, number>();
  components.forEach((_, index) => {
    outgoing.set(index, new Set());
    incomingCount.set(index, 0);
  });

  semanticEdges.forEach((edge) => {
    const fromComponent = componentOf.get(edge.from);
    const toComponent = componentOf.get(edge.to);
    if (
      fromComponent === undefined ||
      toComponent === undefined ||
      fromComponent === toComponent ||
      outgoing.get(fromComponent)?.has(toComponent)
    ) {
      return;
    }
    outgoing.get(fromComponent)?.add(toComponent);
    incomingCount.set(toComponent, (incomingCount.get(toComponent) ?? 0) + 1);
  });

  const componentRank = new Map<number, number>();
  const ready = [...components.keys()]
    .filter((componentIndex) => (incomingCount.get(componentIndex) ?? 0) === 0)
    .sort((left, right) => (componentPrimaryAnchor.get(left) ?? 0) - (componentPrimaryAnchor.get(right) ?? 0));

  while (ready.length > 0) {
    const componentIndex = ready.shift();
    if (componentIndex === undefined) {
      break;
    }
    const nextRank = componentRank.get(componentIndex) ?? 0;
    (outgoing.get(componentIndex) ?? new Set()).forEach((nextComponent) => {
      componentRank.set(nextComponent, Math.max(componentRank.get(nextComponent) ?? 0, nextRank + 1));
      incomingCount.set(nextComponent, (incomingCount.get(nextComponent) ?? 1) - 1);
      if ((incomingCount.get(nextComponent) ?? 0) === 0) {
        ready.push(nextComponent);
        ready.sort((left, right) => (componentPrimaryAnchor.get(left) ?? 0) - (componentPrimaryAnchor.get(right) ?? 0));
      }
    });
  }

  const rankMap = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    component.forEach((nodeId) => {
      rankMap.set(nodeId, componentRank.get(componentIndex) ?? 0);
    });
  });

  const incidentNodeIds = new Set<string>();
  semanticEdges.forEach((edge) => {
    incidentNodeIds.add(edge.from);
    incidentNodeIds.add(edge.to);
  });
  const isolatedNodes = document.nodes
    .filter((node) => !incidentNodeIds.has(node.id))
    .sort((left, right) => getNodePrimaryStart(left, document.direction) - getNodePrimaryStart(right, document.direction));
  let isolatedRank = Math.max(0, ...rankMap.values()) + 1;
  isolatedNodes.forEach((node) => {
    rankMap.set(node.id, isolatedRank);
    isolatedRank += 1;
  });

  return rankMap;
}

function layoutDisconnectedNodes(document: GraphDocument) {
  const sortedNodes = [...document.nodes].sort((left, right) => {
    const primaryDelta = getNodePrimaryStart(left, document.direction) - getNodePrimaryStart(right, document.direction);
    if (primaryDelta !== 0) {
      return primaryDelta;
    }
    return getNodeMinorStart(left, document.direction) - getNodeMinorStart(right, document.direction);
  });
  const laneCount = Math.max(1, Math.ceil(Math.sqrt(sortedNodes.length || 1)));
  const primaryGap = isPrimaryVertical(document.direction) ? 104 : 124;
  const minorGap = isPrimaryVertical(document.direction) ? 88 : 82;
  const bounds = buildSelectionBounds(document.nodes);
  const center = bounds
    ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    : { x: 0, y: 0 };
  const nextPositions = new Map<string, Vec2>();

  sortedNodes.forEach((node, index) => {
    const laneIndex = index % laneCount;
    const laneStep = Math.floor(index / laneCount);
    const primary = laneStep * (getNodePrimarySize(node, document.direction) + primaryGap);
    const minor = laneIndex * (getNodeMinorSize(node, document.direction) + minorGap);
    nextPositions.set(
      node.id,
      isPrimaryVertical(document.direction) ? { x: minor, y: primary } : { x: primary, y: minor },
    );
  });

  const rawNodes = sortedNodes.map((node) => {
    const position = nextPositions.get(node.id) ?? { x: node.x, y: node.y };
    return { ...node, ...position };
  });
  const rawBounds = buildSelectionBounds(rawNodes);
  if (!rawBounds) {
    return document.nodes;
  }
  const offset = {
    x: Math.round(center.x - (rawBounds.x + rawBounds.width / 2)),
    y: Math.round(center.y - (rawBounds.y + rawBounds.height / 2)),
  };
  return document.nodes.map((node) => {
    const position = nextPositions.get(node.id);
    if (!position) {
      return node;
    }
    return {
      ...node,
      x: Math.round(position.x + offset.x),
      y: Math.round(position.y + offset.y),
    };
  });
}

function barycenterForNode(
  nodeId: string,
  neighbors: Map<string, string[]>,
  orderIndex: Map<string, number>,
) {
  const linked = neighbors.get(nodeId) ?? [];
  if (linked.length === 0) {
    return Number.NaN;
  }
  const values = linked
    .map((neighborId) => orderIndex.get(neighborId))
    .filter((value): value is number => typeof value === 'number');
  if (values.length === 0) {
    return Number.NaN;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Direction-aware layered layout with Tarjan SCC + barycenter sweeps. */
export function layoutDocumentNodes(document: GraphDocument): GraphNode[] {
  const semanticEdges = buildSemanticLayoutEdges(document);
  if (semanticEdges.length === 0) {
    return layoutDisconnectedNodes(document);
  }

  const direction = document.direction;
  const rankMap = buildTopologicalRankMap(document, semanticEdges);
  const lookup = subgraphLookup(document.subgraphs);
  const incomingNeighbors = new Map<string, string[]>();
  const outgoingNeighbors = new Map<string, string[]>();

  document.nodes.forEach((node) => {
    incomingNeighbors.set(node.id, []);
    outgoingNeighbors.set(node.id, []);
  });
  semanticEdges.forEach((edge) => {
    incomingNeighbors.get(edge.to)?.push(edge.from);
    outgoingNeighbors.get(edge.from)?.push(edge.to);
  });

  const groups = new Map<number, GraphNode[]>();
  document.nodes.forEach((node) => {
    const rank = rankMap.get(node.id) ?? 0;
    groups.set(rank, [...(groups.get(rank) ?? []), node]);
  });

  const sortedRanks = [...groups.keys()].sort((left, right) => left - right);
  const orderIndex = new Map<string, number>();

  sortedRanks.forEach((rank) => {
    const group = [...(groups.get(rank) ?? [])].sort((left, right) => {
      const leftSubgraph = buildSubgraphPathKey(left.subgraphId, lookup);
      const rightSubgraph = buildSubgraphPathKey(right.subgraphId, lookup);
      if (leftSubgraph !== rightSubgraph) {
        return leftSubgraph.localeCompare(rightSubgraph);
      }
      const minorDelta = getNodeMinorStart(left, direction) - getNodeMinorStart(right, direction);
      if (minorDelta !== 0) {
        return minorDelta;
      }
      return left.id.localeCompare(right.id);
    });
    groups.set(rank, group);
    group.forEach((node, index) => orderIndex.set(node.id, index));
  });

  for (let sweep = 0; sweep < 4; sweep += 1) {
    const ascending = sweep % 2 === 0;
    const ranks = ascending ? sortedRanks : [...sortedRanks].reverse();
    ranks.forEach((rank) => {
      const group = [...(groups.get(rank) ?? [])];
      group.sort((left, right) => {
        const leftBarycenter = barycenterForNode(
          left.id,
          ascending ? incomingNeighbors : outgoingNeighbors,
          orderIndex,
        );
        const rightBarycenter = barycenterForNode(
          right.id,
          ascending ? incomingNeighbors : outgoingNeighbors,
          orderIndex,
        );
        if (Number.isFinite(leftBarycenter) && Number.isFinite(rightBarycenter) && leftBarycenter !== rightBarycenter) {
          return leftBarycenter - rightBarycenter;
        }
        if (Number.isFinite(leftBarycenter) && !Number.isFinite(rightBarycenter)) {
          return -1;
        }
        if (!Number.isFinite(leftBarycenter) && Number.isFinite(rightBarycenter)) {
          return 1;
        }
        const leftSubgraph = buildSubgraphPathKey(left.subgraphId, lookup);
        const rightSubgraph = buildSubgraphPathKey(right.subgraphId, lookup);
        if (leftSubgraph !== rightSubgraph) {
          return leftSubgraph.localeCompare(rightSubgraph);
        }
        const currentMinorDelta = getNodeMinorStart(left, direction) - getNodeMinorStart(right, direction);
        if (currentMinorDelta !== 0) {
          return currentMinorDelta;
        }
        return left.id.localeCompare(right.id);
      });
      groups.set(rank, group);
      group.forEach((node, index) => orderIndex.set(node.id, index));
    });
  }

  const primaryGap = isPrimaryVertical(direction) ? 110 : 124;
  const minorGap = isPrimaryVertical(direction) ? 82 : 76;
  const physicalRanks = isPrimaryReversed(direction) ? [...sortedRanks].reverse() : sortedRanks;
  const rankPrimaryStart = new Map<number, number>();
  let primaryCursor = 0;
  physicalRanks.forEach((rank) => {
    rankPrimaryStart.set(rank, primaryCursor);
    const group = groups.get(rank) ?? [];
    const majorSize = group.length > 0
      ? Math.max(...group.map((node) => getNodePrimarySize(node, direction)))
      : 0;
    primaryCursor += majorSize + primaryGap;
  });

  const rawPositions = new Map<string, Vec2>();
  sortedRanks.forEach((rank) => {
    const group = groups.get(rank) ?? [];
    const totalMinorSpan = group.reduce((sum, node, index) => (
      sum + getNodeMinorSize(node, direction) + (index === group.length - 1 ? 0 : minorGap)
    ), 0);
    let minorCursor = -totalMinorSpan / 2;
    group.forEach((node) => {
      const primary = rankPrimaryStart.get(rank) ?? 0;
      rawPositions.set(
        node.id,
        isPrimaryVertical(direction)
          ? { x: minorCursor, y: primary }
          : { x: primary, y: minorCursor },
      );
      minorCursor += getNodeMinorSize(node, direction) + minorGap;
    });
  });

  const rawNodes = document.nodes.map((node) => ({
    ...node,
    ...(rawPositions.get(node.id) ?? { x: node.x, y: node.y }),
  }));
  const rawBounds = buildSelectionBounds(rawNodes);
  const currentBounds = buildSelectionBounds(document.nodes);
  if (!rawBounds || !currentBounds) {
    return rawNodes;
  }
  const offset = {
    x: Math.round(currentBounds.x + currentBounds.width / 2 - (rawBounds.x + rawBounds.width / 2)),
    y: Math.round(currentBounds.y + currentBounds.height / 2 - (rawBounds.y + rawBounds.height / 2)),
  };
  return document.nodes.map((node) => {
    const raw = rawPositions.get(node.id);
    if (!raw) {
      return node;
    }
    return {
      ...node,
      x: Math.round(raw.x + offset.x),
      y: Math.round(raw.y + offset.y),
    };
  });
}

function compactDocumentNodes(document: GraphDocument): GraphNode[] {
  const primaryIsVertical = document.direction === 'TD' || document.direction === 'BT';
  const clusterThreshold = primaryIsVertical ? 210 : 172;
  const maxTrackGap = primaryIsVertical ? 132 : 116;
  const minTrackGap = primaryIsVertical ? 80 : 72;
  const preferredTrackGap = primaryIsVertical ? 104 : 92;
  const maxPrimaryGap = primaryIsVertical ? 116 : 124;
  const minPrimaryGap = primaryIsVertical ? 56 : 62;
  const preferredPrimaryGap = primaryIsVertical ? 82 : 88;
  const maxTrackShift = primaryIsVertical ? 44 : 38;
  const maxNodeShift = primaryIsVertical ? 52 : 56;
  const orderedNodes = [...document.nodes].sort((left, right) => {
    const leftMinor = primaryIsVertical ? left.x : left.y;
    const rightMinor = primaryIsVertical ? right.x : right.y;
    if (leftMinor !== rightMinor) {
      return leftMinor - rightMinor;
    }
    const leftPrimary = primaryIsVertical ? left.y : left.x;
    const rightPrimary = primaryIsVertical ? right.y : right.x;
    return leftPrimary - rightPrimary;
  });
  const tracks: Array<{ axis: number; nodes: GraphNode[] }> = [];

  orderedNodes.forEach((node) => {
    const axis = primaryIsVertical ? node.x : node.y;
    const track = tracks.find((entry) => Math.abs(entry.axis - axis) <= clusterThreshold);
    if (track) {
      track.nodes.push(node);
      track.axis = (track.axis * (track.nodes.length - 1) + axis) / track.nodes.length;
      return;
    }
    tracks.push({ axis, nodes: [node] });
  });

  tracks.sort((left, right) => left.axis - right.axis);
  const nextPositions = new Map<string, Vec2>();
  let previousTrackEnd: number | null = null;
  let previousTrackAxis: number | null = null;

  tracks.forEach((track, trackIndex) => {
    const sortedTrackNodes = [...track.nodes].sort((left, right) => {
      const leftPrimary = primaryIsVertical ? left.y : left.x;
      const rightPrimary = primaryIsVertical ? right.y : right.x;
      return leftPrimary - rightPrimary;
    });
    const trackMin = Math.min(...sortedTrackNodes.map((node) => (primaryIsVertical ? node.x : node.y)));
    const trackMax = Math.max(...sortedTrackNodes.map((node) => (
      primaryIsVertical ? node.x + node.width : node.y + node.height
    )));
    let trackShift = 0;

    if (trackIndex > 0 && previousTrackEnd !== null && previousTrackAxis !== null) {
      const currentGap = trackMin - previousTrackEnd;
      if (currentGap > maxTrackGap) {
        trackShift = -Math.min(maxTrackShift, Math.round((currentGap - preferredTrackGap) * 0.42));
      } else if (currentGap < minTrackGap) {
        trackShift = Math.min(maxTrackShift, minTrackGap - currentGap);
      }
      const axisGap = track.axis + trackShift - previousTrackAxis;
      if (axisGap > maxTrackGap) {
        trackShift -= Math.min(maxTrackShift, Math.round((axisGap - preferredTrackGap) * 0.35));
      } else if (axisGap < minTrackGap) {
        trackShift += Math.min(maxTrackShift, Math.round((minTrackGap - axisGap) * 0.7));
      }
    }

    let previousPlacedEnd: number | null = null;
    sortedTrackNodes.forEach((node) => {
      const originalMinor = primaryIsVertical ? node.x : node.y;
      const originalPrimary = primaryIsVertical ? node.y : node.x;
      let nextPrimary = originalPrimary;
      if (previousPlacedEnd !== null) {
        const originalGap = nextPrimary - previousPlacedEnd;
        if (originalGap > maxPrimaryGap) {
          nextPrimary -= Math.min(maxNodeShift, Math.round((originalGap - preferredPrimaryGap) * 0.45));
        } else if (originalGap < minPrimaryGap) {
          nextPrimary += Math.min(maxNodeShift, Math.round((minPrimaryGap - originalGap) * 0.85));
        }
      }
      const nextMinor = originalMinor + trackShift;
      nextPositions.set(
        node.id,
        primaryIsVertical
          ? { x: Math.round(nextMinor), y: Math.round(nextPrimary) }
          : { x: Math.round(nextPrimary), y: Math.round(nextMinor) },
      );
      previousPlacedEnd = nextPrimary + (primaryIsVertical ? node.height : node.width);
    });

    previousTrackEnd = trackMax + trackShift;
    previousTrackAxis = track.axis + trackShift;
  });

  return document.nodes.map((node) => {
    const nextPosition = nextPositions.get(node.id);
    return nextPosition
      ? { ...node, x: Math.round(nextPosition.x), y: Math.round(nextPosition.y) }
      : node;
  });
}

/** Compact tracks, then relax along edges and resolve overlaps. */
export function tidyDocumentNodes(document: GraphDocument): GraphNode[] {
  const compactedNodes = compactDocumentNodes(document);
  const baseDocument = { ...document, nodes: compactedNodes };
  const semanticEdges = buildSemanticLayoutEdges(baseDocument);
  if (semanticEdges.length === 0) {
    return compactedNodes;
  }

  const direction = document.direction;
  const nodeMap = new Map(compactedNodes.map((node) => [node.id, node]));
  const incoming = new Map(compactedNodes.map((node) => [node.id, [] as string[]]));
  const outgoing = new Map(compactedNodes.map((node) => [node.id, [] as string[]]));
  const allNeighbors = new Map(compactedNodes.map((node) => [node.id, [] as string[]]));
  semanticEdges.forEach((edge) => {
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
    allNeighbors.set(edge.from, [...(allNeighbors.get(edge.from) ?? []), edge.to]);
    allNeighbors.set(edge.to, [...(allNeighbors.get(edge.to) ?? []), edge.from]);
  });

  const primaryGap = isPrimaryVertical(direction) ? 92 : 104;
  const primaryShiftLimit = isPrimaryVertical(direction) ? 44 : 52;
  const minorShiftLimit = isPrimaryVertical(direction) ? 34 : 28;
  const relaxedNodes = compactedNodes.map((node) => {
    const currentPrimary = getNodePrimaryStart(node, direction);
    const currentMinor = getNodeMinorStart(node, direction);
    const primaryTargets: number[] = [];
    const minorTargets: number[] = [];
    (incoming.get(node.id) ?? []).forEach((neighborId) => {
      const neighbor = nodeMap.get(neighborId);
      if (!neighbor) {
        return;
      }
      primaryTargets.push(getNodePrimaryStart(neighbor, direction) + getNodePrimarySize(neighbor, direction) + primaryGap);
      minorTargets.push(getNodeMinorStart(neighbor, direction));
    });
    (outgoing.get(node.id) ?? []).forEach((neighborId) => {
      const neighbor = nodeMap.get(neighborId);
      if (!neighbor) {
        return;
      }
      primaryTargets.push(getNodePrimaryStart(neighbor, direction) - getNodePrimarySize(node, direction) - primaryGap);
      minorTargets.push(getNodeMinorStart(neighbor, direction));
    });
    const nextPrimary = primaryTargets.length > 0
      ? currentPrimary + clamp(
        Math.round(primaryTargets.reduce((sum, value) => sum + value, 0) / primaryTargets.length - currentPrimary),
        -primaryShiftLimit,
        primaryShiftLimit,
      )
      : currentPrimary;
    const nextMinor = minorTargets.length > 0
      ? currentMinor + clamp(
        Math.round(minorTargets.reduce((sum, value) => sum + value, 0) / minorTargets.length - currentMinor),
        -minorShiftLimit,
        minorShiftLimit,
      )
      : currentMinor;
    return withNodeAxisPosition(node, direction, nextPrimary, nextMinor);
  });

  const orderedNodes = [...relaxedNodes].sort((left, right) => {
    const primaryDelta = getNodePrimaryStart(left, direction) - getNodePrimaryStart(right, direction);
    if (primaryDelta !== 0) {
      return primaryDelta;
    }
    const degreeDelta = (allNeighbors.get(right.id)?.length ?? 0) - (allNeighbors.get(left.id)?.length ?? 0);
    if (degreeDelta !== 0) {
      return degreeDelta;
    }
    return getNodeMinorStart(left, direction) - getNodeMinorStart(right, direction);
  });

  const placed = new Map<string, GraphNode>();
  const obstacles: Rect[] = [];
  orderedNodes.forEach((node) => {
    const original = nodeMap.get(node.id) ?? node;
    const resolvedRect = searchFreeRect(
      { x: node.x, y: node.y, width: node.width, height: node.height },
      obstacles,
      {
        x: node.x - original.x || (isPrimaryVertical(direction) ? 0 : 1),
        y: node.y - original.y || (isPrimaryVertical(direction) ? 1 : 0),
      },
    );
    const placedNode = { ...node, x: resolvedRect.x, y: resolvedRect.y };
    placed.set(node.id, placedNode);
    obstacles.push(expandRect(resolvedRect, 16));
  });

  return document.nodes.map((node) => placed.get(node.id) ?? node);
}

export function collectLayoutScopeNodeIds(
  document: GraphDocument,
  selection?: LayoutSelection,
) {
  if (!selection || selection.kind === 'none' || !selection.ids || selection.ids.length <= 1) {
    return null;
  }
  const selectedIds = selection.ids;
  const nodeIds = new Set<string>();
  const lookup = subgraphLookup(document.subgraphs);

  if (selection.kind === 'node') {
    selectedIds.forEach((id) => {
      if (document.nodes.some((node) => node.id === id)) {
        nodeIds.add(id);
      }
    });
  } else if (selection.kind === 'group' || selection.kind === 'subgraph') {
    selectedIds.forEach((subgraphId) => {
      membersOfSubgraph(document.nodes, subgraphId, lookup).forEach((node) => {
        nodeIds.add(node.id);
      });
    });
  } else if (selection.kind === 'edge') {
    document.edges
      .filter((edge) => selectedIds.includes(edge.id))
      .forEach((edge) => {
        if (document.nodes.some((node) => node.id === edge.from)) {
          nodeIds.add(edge.from);
        } else if (lookup.has(edge.from)) {
          membersOfSubgraph(document.nodes, edge.from, lookup).forEach((node) => nodeIds.add(node.id));
        }
        if (document.nodes.some((node) => node.id === edge.to)) {
          nodeIds.add(edge.to);
        } else if (lookup.has(edge.to)) {
          membersOfSubgraph(document.nodes, edge.to, lookup).forEach((node) => nodeIds.add(node.id));
        }
      });
  }

  return nodeIds.size > 1 ? nodeIds : null;
}

export function applyScopedNodeLayout(
  document: GraphDocument,
  selection: LayoutSelection | undefined,
  layoutNodes: (scoped: GraphDocument) => GraphNode[],
): GraphNode[] {
  const scope = collectLayoutScopeNodeIds(document, selection);
  if (!scope) {
    return layoutNodes(document);
  }

  const lookup = subgraphLookup(document.subgraphs);
  const scopedSubgraphIds = new Set<string>(
    selection && (selection.kind === 'group' || selection.kind === 'subgraph')
      ? (selection.ids ?? []).filter((id) => lookup.has(id))
      : [],
  );
  document.nodes.forEach((node) => {
    if (!scope.has(node.id)) {
      return;
    }
    let current = node.subgraphId;
    while (current) {
      scopedSubgraphIds.add(current);
      current = lookup.get(current)?.parentId ?? null;
    }
  });

  const scoped: GraphDocument = {
    ...document,
    nodes: document.nodes.filter((node) => scope.has(node.id)).map((node) => ({ ...node })),
    subgraphs: document.subgraphs.filter((subgraph) => scopedSubgraphIds.has(subgraph.id)),
    edges: document.edges.filter((edge) => {
      const fromIncluded = scope.has(edge.from) || scopedSubgraphIds.has(edge.from);
      const toIncluded = scope.has(edge.to) || scopedSubgraphIds.has(edge.to);
      return fromIncluded && toIncluded;
    }),
  };
  const laid = layoutNodes(scoped);
  const laidMap = new Map(laid.map((node) => [node.id, node]));
  return document.nodes.map((node) => {
    const next = laidMap.get(node.id);
    return next ? { ...node, x: next.x, y: next.y, width: next.width, height: next.height } : node;
  });
}
