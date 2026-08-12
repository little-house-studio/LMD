import { useEffect, useState } from 'react';
import {
  getFlowPerfSnapshot,
  resetFlowPerf,
  startFlowPerf,
  stopFlowPerf,
  type FlowPerfSnapshot,
} from './flowPerf';
import './flowStyles.css';

export type StressTestPreset = {
  id: string;
  label: string;
  groupCount: number;
  nodesPerGroup: number;
};

/** Presets for one-click load from the perf HUD. */
export const STRESS_PRESETS: StressTestPreset[] = [
  { id: 's', label: 'S · 100', groupCount: 10, nodesPerGroup: 10 },
  { id: 'm', label: 'M · 500', groupCount: 50, nodesPerGroup: 10 },
  { id: 'l', label: 'L · 1k', groupCount: 100, nodesPerGroup: 10 },
  { id: 'xl', label: 'XL · 2k', groupCount: 100, nodesPerGroup: 20 },
];

function fpsColor(fps: number) {
  if (fps >= 55) return '#7cff6b';
  if (fps >= 40) return '#d6ff3a';
  if (fps >= 25) return '#ffe600';
  return '#ff2a6d';
}

function msColor(ms: number) {
  if (ms <= 4) return '#9ae6b4';
  if (ms <= 12) return '#d6ff3a';
  if (ms <= 24) return '#ffe600';
  return '#ff2a6d';
}

function runStressPreset(preset: StressTestPreset) {
  resetFlowPerf();
  window.dispatchEvent(
    new CustomEvent('lmd-flow:stress-test', {
      detail: {
        groupCount: preset.groupCount,
        nodesPerGroup: preset.nodesPerGroup,
        label: preset.label,
      },
    }),
  );
}

/**
 * Bottom-right test HUD: FPS + per-path cost + stress loaders.
 * Always on in this test phase; click header to collapse.
 */
export function FlowPerfHud() {
  // Default collapsed — expanded body used to cover a large chunk of the canvas.
  const [collapsed, setCollapsed] = useState(true);
  const [snap, setSnap] = useState<FlowPerfSnapshot | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    startFlowPerf();
    const id = window.setInterval(() => {
      setSnap(getFlowPerfSnapshot());
    }, 250);
    return () => {
      window.clearInterval(id);
      stopFlowPerf();
    };
  }, []);

  if (!snap) {
    return (
      <div className="flow-perf-hud">
        <div className="flow-perf-hud__header">PERF · starting…</div>
      </div>
    );
  }

  return (
    <div className={`flow-perf-hud${collapsed ? ' is-collapsed' : ''}`}>
      <button
        className="flow-perf-hud__header"
        onClick={() => setCollapsed((value) => !value)}
        type="button"
      >
        <span>
          PERF
          <strong style={{ color: fpsColor(snap.fps) }}> {snap.fps} FPS</strong>
        </span>
        <span className="flow-perf-hud__meta">
          {snap.frameTimeEma.toFixed(1)}ms · n{snap.nodes}/e{snap.edges}
          {collapsed ? ' · ▸' : ' · ▾'}
        </span>
      </button>

      {!collapsed ? (
        <div className="flow-perf-hud__body">
          <div className="flow-perf-hud__row">
            <span>FPS range</span>
            <span>
              min {snap.fpsMin} / max {snap.fpsMax}
            </span>
          </div>
          <div className="flow-perf-hud__row">
            <span>Frame (EMA)</span>
            <span style={{ color: msColor(snap.frameTimeEma) }}>
              {snap.frameTimeEma.toFixed(2)} ms
            </span>
          </div>
          <div className="flow-perf-hud__row">
            <span>Graph</span>
            <span>
              {snap.nodes} nodes · {snap.edges} edges · sel {snap.selected}
            </span>
          </div>
          {snap.memoryMB > 0 ? (
            <div className="flow-perf-hud__row">
              <span>Heap</span>
              <span>{snap.memoryMB} MB</span>
            </div>
          ) : null}

          <div className="flow-perf-hud__section">Stress load</div>
          <div className="flow-perf-hud__stress">
            {STRESS_PRESETS.map((preset) => (
              <button
                className="flow-perf-hud__stress-btn"
                disabled={busyId !== null}
                key={preset.id}
                onClick={() => {
                  setBusyId(preset.id);
                  // Yield so the button can paint "loading" before heavy parse.
                  window.setTimeout(() => {
                    runStressPreset(preset);
                    window.setTimeout(() => {
                      setBusyId(null);
                      setSnap(getFlowPerfSnapshot());
                    }, 50);
                  }, 0);
                }}
                type="button"
              >
                {busyId === preset.id ? '…' : preset.label}
              </button>
            ))}
          </div>
          <div className="flow-perf-hud__hint">
            加载后拖动画布 / 节点，观察 FPS 与 path cost
          </div>

          <div className="flow-perf-hud__section">Path cost (last 1s / total)</div>
          {snap.lanes.length === 0 ? (
            <div className="flow-perf-hud__empty">交互后显示各路径耗时</div>
          ) : (
            <ul className="flow-perf-hud__lanes">
              {snap.lanes.map((lane) => {
                const avg =
                  lane.count > 0 ? lane.totalMs / lane.count : 0;
                const recentAvg =
                  lane.recentCount > 0 ? lane.recentMs / lane.recentCount : 0;
                return (
                  <li key={lane.name}>
                    <div className="flow-perf-hud__lane-top">
                      <span className="flow-perf-hud__lane-name">{lane.label}</span>
                      <span style={{ color: msColor(lane.lastMs || recentAvg) }}>
                        {lane.lastMs.toFixed(2)}ms
                      </span>
                    </div>
                    <div className="flow-perf-hud__lane-sub">
                      1s: {lane.recentCount}× / {lane.recentMs.toFixed(1)}ms
                      {' · '}
                      tot: {lane.count}× avg {avg.toFixed(2)} max {lane.maxMs.toFixed(2)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            className="flow-perf-hud__reset"
            onClick={() => {
              resetFlowPerf();
              setSnap(getFlowPerfSnapshot());
            }}
            type="button"
          >
            Reset metrics
          </button>
        </div>
      ) : null}
    </div>
  );
}
