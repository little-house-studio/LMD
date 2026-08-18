import type { GroupIR, NodeIR, TodoIR } from '../../../document/domain/graph';
import type { LmdDocument } from '../../../document/domain/document';
import type { SequenceStepIR } from '../../../document/domain/sequence';
import type { MindNodeIR } from '../../../document/domain/mind';

export function printLmdLang(document: LmdDocument): string {
  const lines: string[] = [];
  const projectAttrs = formatAttrs({
    comment: document.project.summary || undefined,
  });
  lines.push(`@project:${quote(document.project.name || 'Untitled Project')}${projectAttrs}`);
  lines.push('');
  lines.push('# 关系');

  const nodesById = new Map(document.graph.nodes.map((node) => [node.id, node]));
  const groupsById = new Map(document.graph.groups.map((group) => [group.id, group]));
  const scenesById = new Map((document.sequence?.scenes ?? []).map((scene) => [scene.id, scene]));
  const mindsById = new Map((document.mind?.maps ?? []).map((map) => [map.id, map]));
  const children = new Map<string, GroupIR[]>();
  for (const group of document.graph.groups) {
    if (!group.parentId) {
      continue;
    }
    const list = children.get(group.parentId) ?? [];
    list.push(group);
    children.set(group.parentId, list);
  }

  const roots = document.graph.groups
    .filter((group) => !group.parentId)
    .sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  for (const group of roots) {
    lines.push(printGroup(group, groupsById, children, document.graph.nodes));
  }

  const groupedIds = new Set(
    document.graph.nodes.filter((node) => node.groupId).map((node) => node.id),
  );
  const connected = new Set<string>();
  const edges = [...document.graph.edges].sort((a, b) => {
    const left = `${titleOfEndpoint(a.from, nodesById, groupsById, scenesById, mindsById)}\0${titleOfEndpoint(a.to, nodesById, groupsById, scenesById, mindsById)}`;
    const right = `${titleOfEndpoint(b.from, nodesById, groupsById, scenesById, mindsById)}\0${titleOfEndpoint(b.to, nodesById, groupsById, scenesById, mindsById)}`;
    return left.localeCompare(right, 'zh');
  });

  for (const edge of edges) {
    const from = titleOfEndpoint(edge.from, nodesById, groupsById, scenesById, mindsById);
    const to = titleOfEndpoint(edge.to, nodesById, groupsById, scenesById, mindsById);
    connected.add(edge.from);
    connected.add(edge.to);
    const arrow = edge.kind === 'line' ? '--' : '->';
    const label = edge.label.trim() ? ` |${quote(edge.label)}|` : '';
    const attrs = formatAttrs({
      comment: edge.comment,
      todo: edge.todo,
      url: edge.url,
    });
    lines.push(`${quote(from)} ${arrow}${label} ${quote(to)}${attrs}`);
  }

  const extraNodes = document.graph.nodes
    .filter((node) => !groupedIds.has(node.id) && (!connected.has(node.id) || hasNodeExtras(node)))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  for (const node of extraNodes) {
    lines.push(`@node:${quote(node.title)}${formatAttrs({
      comment: node.comment || (node.label && node.label !== node.title ? node.label : undefined),
      todo: node.todo,
      url: node.url,
    })}`);
  }

  const seqLines = printSequence(document);
  if (seqLines.length > 0) {
    lines.push('');
    lines.push(...seqLines);
  }

  const mindLines = printMind(document);
  if (mindLines.length > 0) {
    lines.push('');
    lines.push(...mindLines);
  }

  if (document.project.content.trim()) {
    lines.push('');
    lines.push('# 笔记');
    lines.push(document.project.content.replace(/\s+$/, ''));
  }

  if (document.extras.unsupportedLines.length > 0) {
    lines.push('');
    for (const line of document.extras.unsupportedLines) {
      lines.push(line);
    }
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function printSequence(document: LmdDocument): string[] {
  const scenes = document.sequence?.scenes ?? [];
  if (scenes.length === 0) {
    return [];
  }
  const lines = ['# 时序'];
  for (const scene of scenes) {
    const titleById = new Map(scene.participants.map((item) => [item.id, item.title]));
    const header = scene.title && scene.title !== '时序'
      ? `@seq:${quote(scene.title)}(`
      : '@seq(';
    lines.push(header);
    const used = participantIdsInSteps(scene.steps);
    for (const participant of scene.participants) {
      if (!used.has(participant.id)) {
        lines.push(`  ${quote(participant.title)}`);
      }
    }
    lines.push(...printSeqSteps(scene.steps, titleById, 1));
    lines.push(')');
  }
  return lines;
}

function participantIdsInSteps(steps: SequenceStepIR[]): Set<string> {
  const ids = new Set<string>();
  const visit = (items: SequenceStepIR[]) => {
    for (const step of items) {
      if (step.kind === 'message') {
        ids.add(step.message.from);
        ids.add(step.message.to);
        continue;
      }
      visit(step.fragment.steps);
    }
  };
  visit(steps);
  return ids;
}

function printSeqSteps(
  steps: SequenceStepIR[],
  titleById: Map<string, string>,
  depth: number,
): string[] {
  const pad = '  '.repeat(depth);
  const lines: string[] = [];
  for (const step of steps) {
    if (step.kind === 'message') {
      const from = titleById.get(step.message.from) ?? step.message.from;
      const to = titleById.get(step.message.to) ?? step.message.to;
      const arrow = step.message.arrow === 'return' ? '<<' : '>>';
      const label = step.message.label.trim() ? ` |${quote(step.message.label)}|` : '';
      const comment = step.message.comment?.trim()
        ? `[@comment:${quote(step.message.comment)}]`
        : '';
      lines.push(`${pad}${quote(from)} ${arrow}${label} ${quote(to)}${comment}`);
      continue;
    }
    const title = step.fragment.title.trim()
      ? `:${quote(step.fragment.title)}`
      : '';
    lines.push(`${pad}@${step.fragment.type}${title}(`);
    lines.push(...printSeqSteps(step.fragment.steps, titleById, depth + 1));
    lines.push(`${pad})`);
  }
  return lines;
}

function printGroup(
  group: GroupIR,
  groupsById: Map<string, GroupIR>,
  children: Map<string, GroupIR[]>,
  nodes: NodeIR[],
): string {
  const memberNodes = nodes
    .filter((node) => node.groupId === group.id)
    .sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  const childGroups = (children.get(group.id) ?? []).sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  const memberBits = [
    ...memberNodes.map((node) => (
      hasNodeExtras(node)
        ? `@node:${quote(node.title)}${formatAttrs({
          comment: node.comment || (node.label && node.label !== node.title ? node.label : undefined),
          todo: node.todo,
          url: node.url,
        })}`
        : quote(node.title)
    )),
    ...childGroups.map((child) => printGroup(child, groupsById, children, nodes)),
  ];
  const attrs: string[] = [];
  if (memberBits.length > 0) {
    attrs.push(`@members:(${memberBits.join(',')})`);
  }
  const extra = formatAttrList({
    comment: group.comment,
    todo: group.todo,
    url: group.url,
  });
  attrs.push(...extra);
  const suffix = attrs.length > 0 ? `[${attrs.join(',')}]` : '';
  return `@group:${quote(group.title)}${suffix}`;
}

function hasNodeExtras(node: NodeIR) {
  return Boolean(
    node.comment
    || node.todo
    || node.url
    || (node.label && node.label !== node.title),
  );
}

function titleOf(node?: NodeIR) {
  return node?.title || node?.id || '未命名内容';
}

function printMind(document: LmdDocument): string[] {
  const maps = document.mind?.maps ?? [];
  if (maps.length === 0) {
    return [];
  }
  const lines = ['# 思维导图'];
  for (const map of maps) {
    const header = map.title
      ? `@mind:${quote(map.title)}(`
      : '@mind(';
    lines.push(header);
    lines.push(...printMindNodes(map.children, 1));
    lines.push(')');
  }
  return lines;
}

function printMindNodes(nodes: MindNodeIR[], depth: number): string[] {
  const pad = '  '.repeat(depth);
  const lines: string[] = [];
  for (const node of nodes) {
    const comment = node.comment?.trim()
      ? `[@comment:${quote(node.comment)}]`
      : '';
    lines.push(`${pad}${quote(node.title)}${comment}`);
    lines.push(...printMindNodes(node.children, depth + 1));
  }
  return lines;
}

function titleOfEndpoint(
  id: string,
  nodesById: Map<string, NodeIR>,
  groupsById: Map<string, GroupIR>,
  scenesById: Map<string, { title: string }>,
  mindsById: Map<string, { title: string }>,
) {
  return nodesById.get(id)?.title
    || scenesById.get(id)?.title
    || mindsById.get(id)?.title
    || groupsById.get(id)?.title
    || titleOf(nodesById.get(id));
}

function formatAttrs(input: { comment?: string; todo?: TodoIR; url?: string }) {
  const parts = formatAttrList(input);
  return parts.length > 0 ? `[${parts.join(',')}]` : '';
}

function formatAttrList(input: { comment?: string; todo?: TodoIR; url?: string }) {
  const parts: string[] = [];
  if (input.comment?.trim()) {
    parts.push(`@comment:${quote(input.comment)}`);
  }
  if (input.url?.trim()) {
    parts.push(`@url:${quote(input.url)}`);
  }
  if (input.todo?.message?.trim()) {
    parts.push(`@todo.message:${quote(input.todo.message)}`);
  }
  if (input.todo?.prio?.trim()) {
    parts.push(`@todo.prio:${quote(input.todo.prio)}`);
  }
  if (input.todo?.status?.trim()) {
    parts.push(`@todo.status:${quote(input.todo.status)}`);
  }
  return parts;
}

export function quote(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}
