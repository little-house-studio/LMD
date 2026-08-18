/**
 * Lightweight test-phase perf probes for the Canvas2D stage + shell.
 * Intentionally thin: rAF FPS loop + manual marks for hot paths.
 */

export type FlowPerfLane = {
  name: string;
  label: string;
  count: number;
  totalMs: number;
  lastMs: number;
  maxMs: number;
  /** calls in the last ~1s window */
  recentCount: number;
  /** ms sum in the last ~1s window */
  recentMs: number;
};

type LaneInternal = {
  label: string;
  count: number;
  totalMs: number;
  lastMs: number;
  maxMs: number;
  recent: Array<{ t: number; ms: number }>;
};

const lanes = new Map<string, LaneInternal>();

let monitoring = false;
let rafId = 0;
let frameCount = 0;
let lastFpsTick = 0;
let fps = 0;
let fpsMin = 999;
let fpsMax = 0;
let lastFrameAt = 0;
let frameTimeMs = 0;
let frameTimeEma = 0;

let nodeCount = 0;
let edgeCount = 0;
let selectedCount = 0;

function ensureLane(name: string, label: string): LaneInternal {
  let lane = lanes.get(name);
  if (!lane) {
    lane = {
      label,
      count: 0,
      totalMs: 0,
      lastMs: 0,
      maxMs: 0,
      recent: [],
    };
    lanes.set(name, lane);
  }
  return lane;
}

function pruneRecent(lane: LaneInternal, now: number) {
  const cutoff = now - 1000;
  while (lane.recent.length > 0 && lane.recent[0].t < cutoff) {
    lane.recent.shift();
  }
}

export function flowPerfMark(name: string, label: string, durationMs: number) {
  const lane = ensureLane(name, label);
  const ms = Math.max(0, durationMs);
  const now = performance.now();
  lane.count += 1;
  lane.totalMs += ms;
  lane.lastMs = ms;
  lane.maxMs = Math.max(lane.maxMs, ms);
  lane.recent.push({ t: now, ms });
  pruneRecent(lane, now);
}

export function flowPerfMeasure<T>(name: string, label: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    flowPerfMark(name, label, performance.now() - start);
  }
}

export function flowPerfCount(name: string, label: string, n = 1) {
  // Count-only event with 0 duration (still shows rate).
  for (let i = 0; i < n; i += 1) {
    flowPerfMark(name, label, 0);
  }
}

export function flowPerfSetGraphStats(stats: {
  nodes: number;
  edges: number;
  selected?: number;
}) {
  nodeCount = stats.nodes;
  edgeCount = stats.edges;
  if (typeof stats.selected === 'number') {
    selectedCount = stats.selected;
  }
}

function fpsLoop(now: number) {
  if (!monitoring) {
    return;
  }

  if (lastFrameAt > 0) {
    frameTimeMs = now - lastFrameAt;
    frameTimeEma =
      frameTimeEma === 0 ? frameTimeMs : frameTimeEma * 0.9 + frameTimeMs * 0.1;
  }
  lastFrameAt = now;

  frameCount += 1;
  if (lastFpsTick === 0) {
    lastFpsTick = now;
  }
  const elapsed = now - lastFpsTick;
  if (elapsed >= 500) {
    fps = Math.round((frameCount * 1000) / elapsed);
    fpsMin = Math.min(fpsMin, fps);
    fpsMax = Math.max(fpsMax, fps);
    frameCount = 0;
    lastFpsTick = now;
  }

  rafId = requestAnimationFrame(fpsLoop);
}

export function startFlowPerf() {
  if (monitoring) {
    return;
  }
  monitoring = true;
  frameCount = 0;
  lastFpsTick = 0;
  fps = 0;
  fpsMin = 999;
  fpsMax = 0;
  lastFrameAt = 0;
  frameTimeMs = 0;
  frameTimeEma = 0;
  rafId = requestAnimationFrame(fpsLoop);
}

export function stopFlowPerf() {
  monitoring = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

export function resetFlowPerf() {
  lanes.clear();
  fpsMin = 999;
  fpsMax = 0;
  frameTimeEma = 0;
}

export type FlowPerfSnapshot = {
  fps: number;
  fpsMin: number;
  fpsMax: number;
  frameTimeMs: number;
  frameTimeEma: number;
  nodes: number;
  edges: number;
  selected: number;
  memoryMB: number;
  lanes: FlowPerfLane[];
};

export function getFlowPerfSnapshot(): FlowPerfSnapshot {
  const now = performance.now();
  const list: FlowPerfLane[] = [];

  lanes.forEach((lane, name) => {
    pruneRecent(lane, now);
    const recentCount = lane.recent.length;
    const recentMs = lane.recent.reduce((sum, entry) => sum + entry.ms, 0);
    list.push({
      name,
      label: lane.label,
      count: lane.count,
      totalMs: lane.totalMs,
      lastMs: lane.lastMs,
      maxMs: lane.maxMs,
      recentCount,
      recentMs,
    });
  });

  // Sort: hottest last-1s total first, then total time.
  list.sort((a, b) => b.recentMs - a.recentMs || b.totalMs - a.totalMs);

  let memoryMB = 0;
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize: number };
  }).memory;
  if (memory) {
    memoryMB = Math.round((memory.usedJSHeapSize / 1048576) * 10) / 10;
  }

  return {
    fps,
    fpsMin: fpsMin === 999 ? 0 : fpsMin,
    fpsMax,
    frameTimeMs,
    frameTimeEma,
    nodes: nodeCount,
    edges: edgeCount,
    selected: selectedCount,
    memoryMB,
    lanes: list,
  };
}
