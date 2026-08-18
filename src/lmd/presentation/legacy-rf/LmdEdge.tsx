import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import type { LmdEdgeData } from './types';
import { DEFAULT_EDGE_STYLE } from './types';

/** Single-path cubic Bezier — RF updates geometry while nodes drag. */
function LmdEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
  data,
  label,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.25,
  });

  const edgeData = data as LmdEdgeData | undefined;
  const stroke =
    (typeof style?.stroke === 'string' && style.stroke) || DEFAULT_EDGE_STYLE.strokeColor;
  const baseWidth =
    typeof style?.strokeWidth === 'number'
      ? style.strokeWidth
      : DEFAULT_EDGE_STYLE.strokeWidth;
  const edgeType = edgeData?.edgeType ?? 'solid';
  const labelText =
    edgeData?.labelText || (typeof label === 'string' ? label : '') || '';
  const dash = edgeType === 'dotted' ? '3 7' : undefined;
  const strokeWidth =
    edgeType === 'thick'
      ? Math.max(baseWidth, 3.2)
      : selected
        ? baseWidth + 0.5
        : baseWidth;

  return (
    <>
      <BaseEdge
        id={id}
        interactionWidth={24}
        markerEnd={markerEnd}
        path={path}
        style={{
          stroke,
          strokeWidth,
          strokeDasharray: dash,
        }}
      />
      {labelText ? (
        <EdgeLabelRenderer>
          <div
            className={`lmd-edge-label${selected ? ' is-selected' : ''}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              borderColor: stroke,
            }}
          >
            {labelText}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const LmdEdge = memo(LmdEdgeComponent);
