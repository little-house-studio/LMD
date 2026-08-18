import { diagnosticMessage, LMD_DIAGNOSTIC_META } from '../../shared-kernel/codes';
import { isCanvasDiagramType } from '../../shared-kernel/kinds';
import { isStableEntityId } from '../../shared-kernel/identity';
import { endpointIds } from '../../document/domain/graph';
import type { LmdDocument } from '../../document/domain/document';
import type { Diagnostic } from './diagnostic';

function groupParentCycle(document: LmdDocument) {
  const byId = new Map(document.graph.groups.map((group) => [group.id, group]));
  const cycles: string[][] = [];

  for (const group of document.graph.groups) {
    const seen = new Set<string>();
    let cursor: string | null = group.id;
    while (cursor) {
      if (seen.has(cursor)) {
        cycles.push([...seen, cursor]);
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }

  return cycles;
}

export function checkLmd(document: LmdDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const nodesById = new Map<string, number>();

  for (const node of document.graph.nodes) {
    nodesById.set(node.id, (nodesById.get(node.id) ?? 0) + 1);
  }
  for (const [id, count] of nodesById) {
    if (count > 1) {
      diagnostics.push({
        code: 'LMD101',
        severity: LMD_DIAGNOSTIC_META.LMD101.severity,
        message: diagnosticMessage('LMD101', id),
        path: `graph.nodes.${id}`,
      });
    }
  }

  const endpoints = endpointIds(document.graph);
  for (const edge of document.graph.edges) {
    if (!endpoints.has(edge.from) || !endpoints.has(edge.to)) {
      const missing = [edge.from, edge.to].filter((id) => !endpoints.has(id)).join(', ');
      diagnostics.push({
        code: 'LMD110',
        severity: LMD_DIAGNOSTIC_META.LMD110.severity,
        message: diagnosticMessage('LMD110', `${edge.id} → ${missing}`),
        path: `graph.edges.${edge.id}`,
        fix: {
          title: '删除悬空边',
          safety: 'suggest',
          apply: (next) => ({
            ...next,
            graph: {
              ...next.graph,
              edges: next.graph.edges.filter((item) => item.id !== edge.id),
            },
          }),
        },
      });
    }
  }

  const groupIds = new Set(document.graph.groups.map((group) => group.id));
  for (const group of document.graph.groups) {
    if (group.parentId && !groupIds.has(group.parentId)) {
      diagnostics.push({
        code: 'LMD130',
        severity: LMD_DIAGNOSTIC_META.LMD130.severity,
        message: diagnosticMessage('LMD130', `${group.id} → ${group.parentId}`),
        path: `graph.groups.${group.id}`,
      });
    }
  }

  if (groupParentCycle(document).length > 0) {
    diagnostics.push({
      code: 'LMD120',
      severity: LMD_DIAGNOSTIC_META.LMD120.severity,
      message: diagnosticMessage('LMD120'),
      path: 'graph.groups',
    });
  }

  if (document.extras.unsupportedLines.length > 0) {
    diagnostics.push({
      code: 'LMD201',
      severity: LMD_DIAGNOSTIC_META.LMD201.severity,
      message: diagnosticMessage(
        'LMD201',
        `${document.extras.unsupportedLines.length} 行`,
      ),
    });
  }

  if (!isCanvasDiagramType(document.display.diagramType)) {
    diagnostics.push({
      code: 'LMD202',
      severity: LMD_DIAGNOSTIC_META.LMD202.severity,
      message: diagnosticMessage('LMD202', document.display.diagramType),
    });
  }

  if (!document.project.name.trim()) {
    diagnostics.push({
      code: 'LMD301',
      severity: LMD_DIAGNOSTIC_META.LMD301.severity,
      message: diagnosticMessage('LMD301'),
      path: 'project.name',
      fix: {
        title: '使用 Untitled Project',
        safety: 'safe',
        apply: (next) => ({
          ...next,
          project: { ...next.project, name: 'Untitled Project' },
        }),
      },
    });
  }

  for (const node of document.graph.nodes) {
    if (!isStableEntityId(node.id)) {
      diagnostics.push({
        code: 'LMD310',
        severity: LMD_DIAGNOSTIC_META.LMD310.severity,
        message: diagnosticMessage('LMD310', node.id),
        path: `graph.nodes.${node.id}`,
      });
    }
  }

  return diagnostics;
}
