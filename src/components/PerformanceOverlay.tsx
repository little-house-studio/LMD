import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearMetrics,
  getSnapshot,
  startMonitoring,
  stopMonitoring,
  type PerfSnapshot,
} from '../lib/perf';

interface PerformanceOverlayProps {
  isVisible: boolean;
  onClose: () => void;
  defaultCollapsed?: boolean;
}

function FpsGauge({ fps, fpsMin, fpsMax }: { fps: number; fpsMin: number; fpsMax: number }) {
  const color = fps >= 50 ? '#22c55e' : fps >= 30 ? '#eab308' : '#ef4444';
  const percentage = Math.min(100, (fps / 60) * 100);

  return (
    <div className="perf-fps-gauge">
      <div className="perf-fps-bar" style={{ width: `${percentage}%`, backgroundColor: color }} />
      <span className="perf-fps-value" style={{ color }}>
        {fps} FPS
      </span>
      <span className="perf-fps-range">
        min:{fpsMin} max:{fpsMax}
      </span>
    </div>
  );
}

export function PerformanceOverlay({ isVisible, onClose, defaultCollapsed = false }: PerformanceOverlayProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [snapshot, setSnapshot] = useState<PerfSnapshot | null>(null);
  const [fpsHistory, setFpsHistory] = useState<number[]>([]);
  const updateIntervalRef = useRef<number | null>(null);
  const isMonitoringRef = useRef(false);

  // Start/stop monitoring based on visibility
  useEffect(() => {
    if (isVisible) {
      if (!isMonitoringRef.current) {
        startMonitoring();
        isMonitoringRef.current = true;
      }

      // Update snapshot every 500ms
      updateIntervalRef.current = window.setInterval(() => {
        const newSnapshot = getSnapshot();
        setSnapshot(newSnapshot);
        setFpsHistory((prev) => {
          const next = [...prev, newSnapshot.fps];
          return next.slice(-60);
        });
      }, 500);
    } else {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }
    }

    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }
    };
  }, [isVisible]);

  const handleClearMetrics = useCallback(() => {
    clearMetrics();
    setSnapshot(null);
    setFpsHistory([]);
  }, []);

  const toggleMonitoring = useCallback(() => {
    if (isMonitoringRef.current) {
      stopMonitoring();
      isMonitoringRef.current = false;
    } else {
      startMonitoring();
      isMonitoringRef.current = true;
    }
    // Force re-render to update status
    setSnapshot((s) => s ? { ...s } : null);
  }, []);

  if (!isVisible) return null;

  const fpsColor = snapshot ? (snapshot.fps < 30 ? '#ef4444' : snapshot.fps < 50 ? '#eab308' : '#22c55e') : undefined;
  const domColor = snapshot ? (snapshot.domNodes > 1000 ? '#ef4444' : snapshot.domNodes > 500 ? '#eab308' : '#94a3b8') : undefined;

  const summary = snapshot ? (
    <div className="perf-summary">
      <div className="perf-summary-item">
        <span className="perf-summary-label">FPS</span>
        <FpsGauge fps={snapshot.fps} fpsMin={snapshot.fpsMin} fpsMax={snapshot.fpsMax} />
      </div>
      <div className="perf-summary-item">
        <span className="perf-summary-label">Memory</span>
        <div className="perf-memory-info">
          {snapshot.memoryMB > 0 ? (
            <span>{snapshot.memoryMB}MB / {snapshot.memoryLimitMB}MB</span>
          ) : (
            <span style={{ color: '#64748b' }}>N/A</span>
          )}
        </div>
      </div>
      <div className="perf-summary-item">
        <span className="perf-summary-label">DOM</span>
        <span className="perf-dom-count" style={{ color: domColor }}>
          {snapshot.domNodes.toLocaleString()}
        </span>
      </div>
    </div>
  ) : null;

  const fpsChart = fpsHistory.length > 0 && (
    <div className="perf-fps-chart">
      <div className="perf-fps-chart-label">FPS (60 max)</div>
      <div className="perf-fps-chart-bars">
        {fpsHistory.map((fps, i) => (
          <div
            key={i}
            className="perf-fps-chart-bar"
            style={{
              height: `${Math.min(100, (fps / 60) * 100)}%`,
              backgroundColor: fps >= 50 ? '#22c55e' : fps >= 30 ? '#eab308' : '#ef4444',
            }}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className={`perf-overlay ${collapsed ? 'perf-overlay--collapsed' : ''}`}>
      <div className="perf-header">
        <div className="perf-title">
          <span className="perf-icon">⚡</span>
          <span>Perf</span>
          <span className="perf-status perf-status--active">●</span>
        </div>
        <div className="perf-controls">
          <button
            className="perf-btn perf-btn--clear"
            onClick={handleClearMetrics}
            title="Clear"
          >
            CLR
          </button>
          <button
            className="perf-btn perf-btn--collapse"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? '▼' : '▲'}
          </button>
          <button
            className="perf-btn perf-btn--close"
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {summary}
          {fpsChart}
        </>
      )}
    </div>
  );
}

export default PerformanceOverlay;
