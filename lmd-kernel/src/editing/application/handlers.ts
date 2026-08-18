import { diagnosticMessage, LMD_DIAGNOSTIC_META } from '../../shared-kernel/codes';
import { buildEntityIdFromTitle } from '../../shared-kernel/identity';
import { DEFAULT_NODE_THEME } from '../../shared-kernel/theme';
import type { LmdDocument } from '../../document/domain/document';
import { usedGroupIds, usedNodeIds } from '../../document/domain/graph';
import { checkLmd } from '../../diagnostics/domain/check';
import { fixLmd } from '../../diagnostics/application/fix';
import type { Diagnostic } from '../../diagnostics/domain/diagnostic';
import { parseLmd } from '../../display/application/parseLmd';
import { printLmd, syncDisplaySource } from '../../display/application/printLmd';
import { measureNodeContentSize } from '../../display';
import type { CommandContext, CommandResult, LmdCommand } from '../domain/command';

function ok(document: LmdDocument, extra?: Partial<CommandResult>): CommandResult {
  return {
    document: syncDisplaySource(document),
    diagnostics: [],
    ...extra,
  };
}

function fail(document: LmdDocument, diagnostic: Diagnostic): CommandResult {
  return { document, diagnostics: [diagnostic] };
}

function invalid(document: LmdDocument, detail: string): CommandResult {
  return fail(document, {
    code: 'LMD901',
    severity: LMD_DIAGNOSTIC_META.LMD901.severity,
    message: diagnosticMessage('LMD901', detail),
  });
}

function nextEdgeId(document: LmdDocument, from: string, to: string) {
  const used = new Set(document.graph.edges.map((edge) => edge.id));
  let salt = 0;
  while (salt < 10000) {
    const id = salt === 0 ? `e_${from}_${to}` : `e_${from}_${to}_${salt}`;
    if (!used.has(id)) {
      return id;
    }
    salt += 1;
  }
  return `e_${from}_${to}_${Date.now()}`;
}

function withFrame(
  document: LmdDocument,
  id: string,
  title: string,
  label: string,
  x: number,
  y: number,
): LmdDocument {
  const size = measureNodeContentSize(title, label === title ? '' : label);
  return {
    ...document,
    layout: {
      ...document.layout,
      frames: {
        ...document.layout.frames,
        [id]: { x, y, width: size.width, height: size.height },
      },
    },
  };
}

export function handleCommand(
  document: LmdDocument,
  command: LmdCommand,
  context: CommandContext = {},
): CommandResult {
  switch (command.op) {
    case 'project.update': {
      const previous = { ...document.project };
      return ok(
        {
          ...document,
          project: {
            name: command.name ?? document.project.name,
            summary: command.summary ?? document.project.summary,
            content: command.content ?? document.project.content,
          },
        },
        {
          inverse: {
            op: 'project.update',
            name: previous.name,
            summary: previous.summary,
            content: previous.content,
          },
        },
      );
    }
    case 'node.create': {
      const title = command.title?.trim() || '新建节点';
      const label = command.label?.trim() || title;
      const id = buildEntityIdFromTitle(title, usedNodeIds(document.graph));
      const x = command.x ?? 120;
      const y = command.y ?? 120;
      const next = withFrame(
        {
          ...document,
          graph: {
            ...document.graph,
            nodes: [
              ...document.graph.nodes,
              {
                id,
                title,
                label,
                shape: 'rect',
                groupId: command.groupId ?? null,
              },
            ],
          },
        },
        id,
        title,
        label,
        x,
        y,
      );
      return ok(next, {
        createdIds: [id],
        inverse: { op: 'node.delete', ids: [id] },
      });
    }
    case 'node.update': {
      const current = document.graph.nodes.find((node) => node.id === command.id);
      if (!current) {
        return invalid(document, `节点不存在：${command.id}`);
      }
      const title = command.title ?? current.title;
      const label = command.label ?? current.label;
      let id = current.id;
      let nodes = document.graph.nodes;
      let edges = document.graph.edges;
      const frames = { ...document.layout.frames };
      const styles = { ...document.style.nodes };

      if (command.title !== undefined && command.title !== current.title) {
        const used = usedNodeIds(document.graph);
        used.delete(current.id);
        id = buildEntityIdFromTitle(title, used, current.id);
        if (id !== current.id) {
          edges = edges.map((edge) => ({
            ...edge,
            from: edge.from === current.id ? id : edge.from,
            to: edge.to === current.id ? id : edge.to,
          }));
          if (frames[current.id]) {
            frames[id] = frames[current.id]!;
            delete frames[current.id];
          }
          if (styles[current.id]) {
            styles[id] = styles[current.id]!;
            delete styles[current.id];
          }
        }
      }

      nodes = nodes.map((node) =>
        node.id === current.id
          ? { ...node, id, title, label, shape: command.shape ?? node.shape }
          : node,
      );

      if (command.fill || command.stroke || command.textColor) {
        styles[id] = {
          ...(styles[id] ?? DEFAULT_NODE_THEME),
          ...(command.fill ? { fill: command.fill } : {}),
          ...(command.stroke ? { stroke: command.stroke } : {}),
          ...(command.textColor ? { textColor: command.textColor } : {}),
        };
      }

      const sized = measureNodeContentSize(title, label === title ? '' : label);
      if (frames[id]) {
        frames[id] = { ...frames[id]!, width: sized.width, height: sized.height };
      }

      return ok({
        ...document,
        graph: { ...document.graph, nodes, edges },
        layout: { ...document.layout, frames },
        style: { ...document.style, nodes: styles },
      });
    }
    case 'node.delete': {
      const ids = new Set(command.ids);
      if (ids.size === 0) {
        return ok(document);
      }
      return ok({
        ...document,
        graph: {
          ...document.graph,
          nodes: document.graph.nodes.filter((node) => !ids.has(node.id)),
          edges: document.graph.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)),
        },
      });
    }
    case 'node.duplicate': {
      const selected = document.graph.nodes.filter((node) => command.ids.includes(node.id));
      if (selected.length === 0) {
        return ok(document);
      }
      const used = usedNodeIds(document.graph);
      const idMap = new Map<string, string>();
      const created: LmdDocument['graph']['nodes'] = [];
      const frames = { ...document.layout.frames };
      const styles = { ...document.style.nodes };

      for (const node of selected) {
        const nextId = buildEntityIdFromTitle(node.title || '未命名内容', used);
        used.add(nextId);
        idMap.set(node.id, nextId);
        created.push({ ...node, id: nextId });
        const frame = frames[node.id];
        if (frame) {
          frames[nextId] = { ...frame, x: frame.x + 48, y: frame.y + 48 };
        }
        if (styles[node.id]) {
          styles[nextId] = styles[node.id]!;
        }
      }

      const newEdges = document.graph.edges
        .filter((edge) => idMap.has(edge.from) && idMap.has(edge.to))
        .map((edge) => ({
          ...edge,
          id: nextEdgeId(document, idMap.get(edge.from)!, idMap.get(edge.to)!),
          from: idMap.get(edge.from)!,
          to: idMap.get(edge.to)!,
        }));

      return ok(
        {
          ...document,
          graph: {
            ...document.graph,
            nodes: [...document.graph.nodes, ...created],
            edges: [...document.graph.edges, ...newEdges],
          },
          layout: { ...document.layout, frames },
          style: { ...document.style, nodes: styles },
        },
        { createdIds: [...idMap.values()], inverse: { op: 'node.delete', ids: [...idMap.values()] } },
      );
    }
    case 'edge.create': {
      if (command.from === command.to) {
        return invalid(document, '不允许自环（当前规范）');
      }
      const endpoints = new Set([
        ...document.graph.nodes.map((node) => node.id),
        ...document.graph.groups.map((group) => group.id),
      ]);
      if (!endpoints.has(command.from) || !endpoints.has(command.to)) {
        return invalid(document, '边的端点不存在');
      }
      const id = nextEdgeId(document, command.from, command.to);
      return ok(
        {
          ...document,
          graph: {
            ...document.graph,
            edges: [
              ...document.graph.edges,
              {
                id,
                from: command.from,
                to: command.to,
                label: command.label ?? '',
                kind: command.kind ?? 'solid',
              },
            ],
          },
        },
        { createdIds: [id], inverse: { op: 'edge.delete', ids: [id] } },
      );
    }
    case 'edge.update': {
      if (!document.graph.edges.some((edge) => edge.id === command.id)) {
        return invalid(document, `边不存在：${command.id}`);
      }
      const styles = { ...document.style.edges };
      if (command.strokeColor || command.strokeWidth) {
        const current = styles[command.id] ?? { strokeColor: '#8a8a94', strokeWidth: 1.5 };
        styles[command.id] = {
          strokeColor: command.strokeColor ?? current.strokeColor,
          strokeWidth: command.strokeWidth ?? current.strokeWidth,
        };
      }
      return ok({
        ...document,
        graph: {
          ...document.graph,
          edges: document.graph.edges.map((edge) =>
            edge.id === command.id
              ? {
                  ...edge,
                  label: command.label ?? edge.label,
                  kind: command.kind ?? edge.kind,
                }
              : edge,
          ),
        },
        style: { ...document.style, edges: styles },
      });
    }
    case 'edge.delete': {
      const ids = new Set(command.ids);
      return ok({
        ...document,
        graph: {
          ...document.graph,
          edges: document.graph.edges.filter((edge) => !ids.has(edge.id)),
        },
      });
    }
    case 'edge.insertNode': {
      const target = document.graph.edges.find((edge) => edge.id === command.edgeId);
      if (!target || target.from === command.nodeId || target.to === command.nodeId) {
        return invalid(document, '无法在该边上插入节点');
      }
      const newId = nextEdgeId(document, command.nodeId, target.to);
      return ok({
        ...document,
        graph: {
          ...document.graph,
          edges: document.graph.edges.flatMap((edge) => {
            if (edge.id !== command.edgeId) {
              return [edge];
            }
            return [
              { ...edge, to: command.nodeId },
              { ...edge, id: newId, from: command.nodeId, to: edge.to, label: '' },
            ];
          }),
        },
      });
    }
    case 'group.create': {
      if (command.nodeIds.length === 0) {
        return invalid(document, '成组至少需要一个节点');
      }
      const title = command.title?.trim() || '新建分组';
      const id = buildEntityIdFromTitle(title, usedGroupIds(document.graph));
      const selected = new Set(command.nodeIds);
      return ok(
        {
          ...document,
          graph: {
            ...document.graph,
            groups: [...document.graph.groups, { id, title, parentId: null }],
            nodes: document.graph.nodes.map((node) =>
              selected.has(node.id) ? { ...node, groupId: id } : node,
            ),
          },
        },
        { createdIds: [id], inverse: { op: 'group.dissolve', ids: [id] } },
      );
    }
    case 'group.update': {
      if (!document.graph.groups.some((group) => group.id === command.id)) {
        return invalid(document, `分组不存在：${command.id}`);
      }
      const styles = { ...document.style.groups };
      if (command.fill || command.stroke || command.textColor) {
        const current = styles[command.id] ?? {
          fill: '#141418',
          stroke: '#00f0ff',
          textColor: '#f4f4f5',
        };
        styles[command.id] = {
          fill: command.fill ?? current.fill,
          stroke: command.stroke ?? current.stroke,
          textColor: command.textColor ?? current.textColor,
        };
      }
      return ok({
        ...document,
        graph: {
          ...document.graph,
          groups: document.graph.groups.map((group) =>
            group.id === command.id ? { ...group, title: command.title ?? group.title } : group,
          ),
        },
        style: { ...document.style, groups: styles },
      });
    }
    case 'group.dissolve': {
      const ids = new Set(command.ids);
      return ok({
        ...document,
        graph: {
          ...document.graph,
          groups: document.graph.groups.filter((group) => !ids.has(group.id)),
          nodes: document.graph.nodes.map((node) =>
            node.groupId && ids.has(node.groupId) ? { ...node, groupId: null } : node,
          ),
        },
      });
    }
    case 'doc.check':
      return { document, diagnostics: checkLmd(document) };
    case 'doc.standardize': {
      const printed = printLmd(document);
      const parsed = parseLmd(printed, { fallbackName: document.project.name || 'Untitled Project' });
      if (parsed.fault) {
        return fail(document, {
          code: parsed.fault.code,
          severity: 'error',
          message: parsed.fault.message,
        });
      }
      return { document: parsed.document, diagnostics: checkLmd(parsed.document) };
    }
    case 'doc.fix': {
      const result = fixLmd(document, command.mode ?? 'safe');
      return ok(result.document, { diagnostics: result.diagnostics });
    }
    case 'layout.auto':
    case 'layout.tidy': {
      const backend = command.op === 'layout.auto' ? context.layout?.auto : context.layout?.tidy;
      if (!backend) {
        return fail(document, {
          code: 'LMD801',
          severity: LMD_DIAGNOSTIC_META.LMD801.severity,
          message: diagnosticMessage('LMD801', command.op),
        });
      }
      return ok(backend(document));
    }
    default: {
      const neverCommand: never = command;
      return fail(document, {
        code: 'LMD900',
        severity: LMD_DIAGNOSTIC_META.LMD900.severity,
        message: diagnosticMessage('LMD900', JSON.stringify(neverCommand)),
      });
    }
  }
}
