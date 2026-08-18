import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import type { LmdGroupData } from './types';

type GroupNode = Node<LmdGroupData, 'lmdGroup'>;

function LmdGroupNodeComponent({ data, selected }: NodeProps<GroupNode>) {
  return (
    <div
      className={`lmd-group${selected ? ' is-selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        ['--group-fill' as string]: data.fill,
        ['--group-stroke' as string]: data.stroke,
        ['--group-text' as string]: data.textColor,
        borderColor: data.stroke,
        color: data.textColor,
      }}
    >
      <div
        className="lmd-group__header"
        style={{ background: data.fill, borderColor: data.stroke }}
      >
        <strong>{data.title || '分组'}</strong>
      </div>
    </div>
  );
}

export const LmdGroupNode = memo(LmdGroupNodeComponent);
