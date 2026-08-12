import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { LmdNodeData } from './types';

type FlowNode = Node<LmdNodeData, 'lmdNode'>;

function shapeClass(shape: LmdNodeData['shape']) {
  switch (shape) {
    case 'round':
      return 'lmd-node--round';
    case 'circle':
      return 'lmd-node--circle';
    case 'diamond':
      return 'lmd-node--diamond';
    case 'hexagon':
      return 'lmd-node--hexagon';
    case 'database':
      return 'lmd-node--database';
    case 'subroutine':
      return 'lmd-node--subroutine';
    default:
      return 'lmd-node--rect';
  }
}

function LmdNodeComponent({ data, selected, width, height }: NodeProps<FlowNode>) {
  // Prefer dimensions RF measured / assigned on the node wrapper.
  const w = width ?? data.width;
  const h = height ?? data.height;

  return (
    <div
      className={`lmd-node ${shapeClass(data.shape)}${selected ? ' is-selected' : ''}`}
      style={{
        ['--node-fill' as string]: data.fill,
        ['--node-stroke' as string]: data.stroke,
        ['--node-text' as string]: data.textColor,
        width: '100%',
        height: '100%',
        minWidth: w,
        minHeight: h,
        background: data.fill,
        borderColor: data.stroke,
        color: data.textColor,
      }}
    >
      <Handle
        className="lmd-handle lmd-handle--target"
        isConnectable
        position={Position.Left}
        type="target"
      />
      <div className="lmd-node__body">
        <div className="lmd-node__title">{data.title || '未命名内容'}</div>
        {data.description ? (
          <div className="lmd-node__description">{data.description}</div>
        ) : (
          <div className="lmd-node__description lmd-node__description--empty">（空）</div>
        )}
      </div>
      <Handle
        className="lmd-handle lmd-handle--source"
        isConnectable
        position={Position.Right}
        type="source"
      />
    </div>
  );
}

export const LmdNode = memo(LmdNodeComponent);
