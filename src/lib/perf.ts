/**
 * Lightweight performance monitoring module for LMD Editor
 * Only tracks FPS - minimal overhead
 */

export interface PerfMetric {
  name: string;
  count: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

export interface PerfSnapshot {
  fps: number;
  fpsMin: number;
  fpsMax: number;
  memoryMB: number;
  memoryLimitMB: number;
  domNodes: number;
  timestamp: number;
  metrics: PerfMetric[];
}

// Global performance tracking state
let isMonitoring = false;
let frameCount = 0;
let lastFpsUpdate = 0;
let currentFps = 0;
let fpsHistory: number[] = [];
let minFps = 999;
let maxFps = 0;
let lastFps = 0;
let lastWarningTime = 0;

// Metrics storage
const metricStorage = new Map<string, { count: number; totalMs: number; minMs: number; maxMs: number }>();

// Send log to terminal via Vite server
function logToTerminal(level: 'info' | 'warn' | 'error', message: string, value?: number) {
  if (typeof fetch !== 'undefined') {
    fetch('/__perf_log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message, value }),
    }).catch(() => {});
  }
}

/**
 * Start monitoring performance
 */
export function startMonitoring(): void {
  if (isMonitoring) return;
  isMonitoring = true;
  frameCount = 0;
  lastFpsUpdate = performance.now();
  currentFps = 0;
  fpsHistory = [];
  minFps = 999;
  maxFps = 0;
  lastFps = 0;

  console.log('\x1b[32m[PERF]\x1b[0m Performance monitoring started (F8 to toggle overlay)');
  logToTerminal('info', 'Monitoring started');

  // Start the FPS tracking loop
  requestAnimationFrame(fpsLoop);
}

/**
 * Stop monitoring performance
 */
export function stopMonitoring(): void {
  isMonitoring = false;
  logToTerminal('info', 'Monitoring stopped');
}

/**
 * FPS tracking loop using requestAnimationFrame
 */
function fpsLoop(timestamp: number): void {
  if (!isMonitoring) return;

  frameCount++;
  const elapsed = timestamp - lastFpsUpdate;

  if (elapsed >= 1000) {
    currentFps = Math.round((frameCount * 1000) / elapsed);
    fpsHistory.push(currentFps);
    if (fpsHistory.length > 60) fpsHistory.shift();
    minFps = Math.min(minFps, currentFps);
    maxFps = Math.max(maxFps, currentFps);
    frameCount = 0;
    lastFpsUpdate = timestamp;

    // Log FPS warnings to terminal (throttled to once per 5 seconds)
    const now = Date.now();
    if (currentFps < 30 && lastFps >= 30 && now - lastWarningTime > 5000) {
      console.warn(`\x1b[33m[PERF]\x1b[0m FPS DROP: ${currentFps} FPS (was ${lastFps})`);
      logToTerminal('warn', `FPS DROP: ${currentFps}`, currentFps);
      lastWarningTime = now;
    }
    lastFps = currentFps;
  }

  requestAnimationFrame(fpsLoop);
}

/**
 * Get memory info (Chrome only)
 */
function getMemoryInfo(): { usedMB: number; limitMB: number } {
  // @ts-expect-error - performance.memory is Chrome-specific
  const memory = performance.memory;
  if (memory) {
    return {
      usedMB: Math.round(memory.usedJSHeapSize / 1048576 * 100) / 100,
      limitMB: Math.round(memory.jsHeapSizeLimit / 1048576 * 100) / 100,
    };
  }
  return { usedMB: 0, limitMB: 0 };
}

/**
 * Get DOM node count
 */
function getDomNodeCount(): number {
  return document.getElementsByTagName('*').length;
}

/**
 * Record a metric (manual tracking only)
 */
export function recordMetric(name: string, durationMs: number): void {
  const existing = metricStorage.get(name);
  if (existing) {
    existing.count++;
    existing.totalMs += durationMs;
    existing.minMs = Math.min(existing.minMs, durationMs);
    existing.maxMs = Math.max(existing.maxMs, durationMs);
  } else {
    metricStorage.set(name, {
      count: 1,
      totalMs: durationMs,
      minMs: durationMs,
      maxMs: durationMs,
    });
  }

  // Only log slow operations (>50ms to reduce noise)
  if (durationMs > 50) {
    console.log(`\x1b[33m[PERF]\x1b[0m Slow: ${name} took ${durationMs.toFixed(2)}ms`);
    logToTerminal('warn', `Slow: ${name}`, durationMs);
  }
}

/**
 * Start a performance mark
 */
export function markStart(name: string): number {
  return performance.now();
}

/**
 * End a performance mark and record the metric
 */
export function markEnd(name: string, startTime: number): number {
  const duration = performance.now() - startTime;
  recordMetric(name, duration);
  return duration;
}

/**
 * Get all metrics as an array
 */
export function getMetrics(): PerfMetric[] {
  return Array.from(metricStorage.entries()).map(([name, data]) => ({
    name,
    count: data.count,
    totalMs: Math.round(data.totalMs * 100) / 100,
    avgMs: Math.round((data.totalMs / data.count) * 100) / 100,
    minMs: Math.round(data.minMs * 100) / 100,
    maxMs: Math.round(data.maxMs * 100) / 100,
  }));
}

/**
 * Get a complete performance snapshot
 */
export function getSnapshot(): PerfSnapshot {
  const memory = getMemoryInfo();
  const metrics = getMetrics();

  return {
    fps: currentFps,
    fpsMin: minFps === 999 ? 0 : minFps,
    fpsMax: maxFps,
    memoryMB: memory.usedMB,
    memoryLimitMB: memory.limitMB,
    domNodes: getDomNodeCount(),
    timestamp: Date.now(),
    metrics,
  };
}

/**
 * Clear all recorded metrics
 */
export function clearMetrics(): void {
  metricStorage.clear();
  minFps = 999;
  maxFps = 0;
  fpsHistory = [];
}

/**
 * Check if monitoring is active
 */
export function isPerfMonitoring(): boolean {
  return isMonitoring;
}
