import type { NodeShape } from '../..';

export const shapeOptions: Array<{ label: string; value: NodeShape }> = [
  { label: '矩形', value: 'rect' },
  { label: '圆角', value: 'round' },
  { label: '菱形', value: 'diamond' },
  { label: '圆形', value: 'circle' },
  { label: '六边形', value: 'hexagon' },
  { label: '数据库', value: 'database' },
  { label: '子程序', value: 'subroutine' },
];

export const nodeStylePresets = [
  { id: 'void', label: '虚空', fill: '#121214', stroke: '#d6ff3a', textColor: '#f4f4f5' },
  { id: 'acid', label: '酸青', fill: '#0e1a14', stroke: '#00f0ff', textColor: '#e8fffb' },
  { id: 'signal', label: '信号', fill: '#1a1808', stroke: '#ffe600', textColor: '#fff8c8' },
  { id: 'hotzone', label: '热区', fill: '#1a0a12', stroke: '#ff2a6d', textColor: '#ffe0ea' },
  { id: 'matrix', label: '矩阵', fill: '#10160c', stroke: '#7cff6b', textColor: '#e8ffe4' },
  { id: 'plasma', label: '等离子', fill: '#140e1c', stroke: '#c77dff', textColor: '#f3e8ff' },
  { id: 'ember', label: '燃核', fill: '#1a100a', stroke: '#ff6b2c', textColor: '#ffe8d8' },
  { id: 'mono', label: '单色', fill: '#0a0a0c', stroke: '#f4f4f5', textColor: '#f4f4f5' },
  { id: 'invert', label: '反相', fill: '#f4f4f5', stroke: '#0a0a0c', textColor: '#0a0a0c' },
  { id: 'runner', label: 'Runner', fill: '#0c0c10', stroke: '#d6ff3a', textColor: '#d6ff3a' },
] as const;

export const edgeTypeOptions = [
  { label: '实线', value: 'solid' as const },
  { label: '虚线', value: 'dotted' as const },
  { label: '粗线', value: 'thick' as const },
  { label: '无箭头', value: 'line' as const },
];
