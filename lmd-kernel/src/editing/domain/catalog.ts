import type { CommandOp, CommandSpec } from './command';

export const COMMAND_CATALOG: CommandSpec[] = [
  { op: 'project.update', title: '更新项目元数据', category: 'project', mutates: true },
  { op: 'node.create', title: '新建节点', category: 'node', mutates: true },
  { op: 'node.update', title: '更新节点', category: 'node', mutates: true },
  { op: 'node.delete', title: '删除节点', category: 'node', mutates: true },
  { op: 'node.duplicate', title: '复制节点', category: 'node', mutates: true },
  { op: 'edge.create', title: '新建边', category: 'edge', mutates: true },
  { op: 'edge.update', title: '更新边', category: 'edge', mutates: true },
  { op: 'edge.delete', title: '删除边', category: 'edge', mutates: true },
  { op: 'edge.insertNode', title: '在边上插入节点', category: 'edge', mutates: true },
  { op: 'group.create', title: '成组', category: 'group', mutates: true },
  { op: 'group.update', title: '更新分组', category: 'group', mutates: true },
  { op: 'group.dissolve', title: '解散分组', category: 'group', mutates: true },
  { op: 'doc.check', title: '检查文档', category: 'doc', mutates: false },
  { op: 'doc.standardize', title: '标准化文档', category: 'doc', mutates: true },
  { op: 'doc.fix', title: '应用修复', category: 'doc', mutates: true },
  { op: 'layout.auto', title: '自动布局', category: 'layout', mutates: true },
  { op: 'layout.tidy', title: '整理布局', category: 'layout', mutates: true },
];

export function commandSpec(op: CommandOp) {
  return COMMAND_CATALOG.find((item) => item.op === op) ?? null;
}
