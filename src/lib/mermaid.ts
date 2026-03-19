import type {
  Direction,
  EdgeType,
  GraphDocument,
  GraphEdge,
  GraphNode,
  GraphSubgraph,
  LayoutSidecar,
  NodeShape,
  ParsedDocument,
} from './types';

const defaultNodeStyle = {
  fill: '#fff8ef',
  stroke: '#24404f',
  textColor: '#12212c',
};

const defaultLayout: LayoutSidecar = {
  version: 1,
  viewport: {
    x: 120,
    y: 90,
    zoom: 1,
  },
  nodes: {},
  subgraphs: {},
};

const edgePatterns: Array<{ token: string; type: EdgeType }> = [
  { token: '-.->', type: 'dotted' },
  { token: '==>', type: 'thick' },
  { token: '-->', type: 'solid' },
  { token: '---', type: 'line' },
];

const shapeMatchers: Array<{
  shape: NodeShape;
  regex: RegExp;
}> = [
  { shape: 'database', regex: /^([A-Za-z0-9_:-]+)\[\((.*)\)\]$/ },
  { shape: 'circle', regex: /^([A-Za-z0-9_:-]+)\(\((.*)\)\)$/ },
  { shape: 'round', regex: /^([A-Za-z0-9_:-]+)\(\[(.*)\]\)$/ },
  { shape: 'subroutine', regex: /^([A-Za-z0-9_:-]+)\[\[(.*)\]\]$/ },
  { shape: 'hexagon', regex: /^([A-Za-z0-9_:-]+)\{\{(.*)\}\}$/ },
  { shape: 'diamond', regex: /^([A-Za-z0-9_:-]+)\{(.*)\}$/ },
  { shape: 'rect', regex: /^([A-Za-z0-9_:-]+)\[(.*)\]$/ },
];

function cloneLayout(layout?: LayoutSidecar): LayoutSidecar {
  if (!layout) {
    return structuredClone(defaultLayout);
  }

  return {
    version: layout.version ?? 1,
    viewport: { ...layout.viewport },
    nodes: { ...layout.nodes },
    subgraphs: { ...layout.subgraphs },
  };
}

function sanitizeId(input: string) {
  return input
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/[^A-Za-z0-9_:-]+/g, '_')
    .replace(/^_+|_+$/g, '') || `node_${Math.random().toString(36).slice(2, 8)}`;
}

export function measureNodeContentSize(content: string) {
  const lines = content.split(/\r?\n/);
  const unitsPerLine = lines.map((line) =>
    Array.from(line).reduce((total, char) => total + (char.charCodeAt(0) > 255 ? 1.8 : 1), 0),
  );
  const maxUnits = Math.max(6, ...unitsPerLine);
  const width = Math.max(132, Math.min(320, 52 + maxUnits * 9));
  const wrapCapacity = Math.max(8, Math.floor((width - 40) / 9));
  const wrappedLineCount = Math.max(
    1,
    unitsPerLine.reduce((total, units) => total + Math.max(1, Math.ceil(units / wrapCapacity)), 0),
  );
  const height = Math.max(58, Math.min(240, 26 + wrappedLineCount * 24));

  return { width, height };
}

function inferNode(raw: string) {
  const trimmed = raw.trim();

  for (const matcher of shapeMatchers) {
    const match = trimmed.match(matcher.regex);
    if (match) {
      return {
        id: match[1],
        label: match[2].trim().replace(/^["']|["']$/g, ''),
        shape: matcher.shape,
      };
    }
  }

  const bareMatch = trimmed.match(/^([A-Za-z0-9_:-]+)$/);
  if (bareMatch) {
    return {
      id: bareMatch[1],
      label: bareMatch[1],
      shape: 'rect' as NodeShape,
    };
  }

  return null;
}

function inferDirection(line: string): Direction | null {
  const match = line.match(/^(?:flowchart|graph)\s+(TD|LR|RL|BT)\b/i);
  if (!match) {
    return null;
  }

  return match[1].toUpperCase() as Direction;
}

function inferSubgraph(raw: string) {
  const content = raw.replace(/^subgraph\s+/i, '').trim();
  const explicit = inferNode(content);
  if (explicit) {
    return {
      id: sanitizeId(explicit.id),
      title: explicit.label,
    };
  }

  const quoted = content.match(/^["'](.+)["']$/);
  if (quoted) {
    return {
      id: sanitizeId(quoted[1]),
      title: quoted[1],
    };
  }

  return {
    id: sanitizeId(content),
    title: content,
  };
}

function parseStyleLine(raw: string) {
  const match = raw.match(/^style\s+([A-Za-z0-9_:-]+)\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const styleParts = match[2].split(',').map((part) => part.trim());
  const styleMap: Record<string, string> = {};

  for (const part of styleParts) {
    const [key, value] = part.split(':').map((entry) => entry.trim());
    if (key && value) {
      styleMap[key] = value;
    }
  }

  return {
    id: match[1],
    fill: styleMap.fill,
    stroke: styleMap.stroke,
    color: styleMap.color,
  };
}

function parseEdgeLine(raw: string) {
  for (const pattern of edgePatterns) {
    const regex = new RegExp(
      `^(.*?)\\s*(${pattern.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?:\\|([^|]+)\\|)?\\s*(.*)$`,
    );
    const match = raw.match(regex);
    if (!match) {
      continue;
    }

    const from = inferNode(match[1]);
    const to = inferNode(match[4]);
    if (!from || !to) {
      return null;
    }

    return {
      from,
      to,
      type: pattern.type,
      label: match[3]?.trim() ?? '',
    };
  }

  return null;
}

function buildAutoLayout(
  direction: Direction,
  nodes: GraphNode[],
  edges: GraphEdge[],
  layout: LayoutSidecar,
) {
  const incoming = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    incoming.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }

  const roots = nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const levels = new Map<string, number>();
  const remaining = new Set(nodes.map((node) => node.id));

  // Mermaid flowcharts frequently contain feedback edges. The previous
  // "longest path" walk kept increasing levels forever on cycles such as A -> B -> A.
  // This layout pass visits each node at most once per component instead.
  while (remaining.size > 0) {
    const start =
      roots.find((id) => remaining.has(id)) ??
      remaining.values().next().value;

    if (!start) {
      break;
    }

    const queue = [start];
    const visited = new Set<string>([start]);
    const baseLevel = levels.size > 0 ? Math.max(...levels.values()) + 1 : 0;

    levels.set(start, levels.get(start) ?? baseLevel);
    remaining.delete(start);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      const currentLevel = levels.get(current) ?? baseLevel;
      for (const target of adjacency.get(current) ?? []) {
        if (visited.has(target)) {
          continue;
        }

        visited.add(target);
        queue.push(target);
        levels.set(target, currentLevel + 1);
        remaining.delete(target);
      }
    }
  }

  const lanes = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const lane = levels.get(node.id) ?? 0;
    const bucket = lanes.get(lane) ?? [];
    bucket.push(node);
    lanes.set(lane, bucket);
  }

  const laneKeys = [...lanes.keys()].sort((a, b) => a - b);
  const maxLane = laneKeys[laneKeys.length - 1] ?? 0;

  for (const lane of laneKeys) {
    const bucket = lanes.get(lane) ?? [];
    bucket.sort((left, right) => left.id.localeCompare(right.id));

    bucket.forEach((node, index) => {
      const existing = layout.nodes[node.id];
      if (existing) {
        node.x = existing.x;
        node.y = existing.y;
        node.width = existing.width;
        node.height = existing.height;
        return;
      }

      const secondary = index * 160;
      const laneValue = direction === 'RL' || direction === 'BT' ? maxLane - lane : lane;

      if (direction === 'LR' || direction === 'RL') {
        node.x = 120 + laneValue * 260;
        node.y = 120 + secondary;
      } else {
        node.x = 120 + secondary;
        node.y = 120 + laneValue * 180;
      }

      layout.nodes[node.id] = {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      };
    });
  }
}

export function parseMermaidDocument(
  source: string,
  previousLayout?: LayoutSidecar,
): ParsedDocument {
  const lines = source.split('\n');
  const layout = cloneLayout(previousLayout);
  const warnings: string[] = [];
  const unsupportedLines: string[] = [];
  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const subgraphs: GraphSubgraph[] = [];
  const subgraphStack: string[] = [];
  let direction: Direction = 'LR';

  function ensureNode(inferred: ReturnType<typeof inferNode>) {
    if (!inferred) {
      return null;
    }

    const existing = nodeMap.get(inferred.id);
    if (existing) {
      if (existing.label === existing.id && inferred.label !== inferred.id) {
        existing.label = inferred.label;
      }
      existing.shape = inferred.shape ?? existing.shape;
      if (subgraphStack.length > 0) {
        existing.subgraphId = subgraphStack[subgraphStack.length - 1] ?? null;
      }
      return existing;
    }

    const size = measureNodeContentSize(inferred.label);
    const stored = layout.nodes[inferred.id];
    const nextNode: GraphNode = {
      id: inferred.id,
      label: inferred.label,
      shape: inferred.shape,
      x: stored?.x ?? 0,
      y: stored?.y ?? 0,
      width: stored?.width ?? size.width,
      height: stored?.height ?? size.height,
      fill: defaultNodeStyle.fill,
      stroke: defaultNodeStyle.stroke,
      textColor: defaultNodeStyle.textColor,
      subgraphId: subgraphStack[subgraphStack.length - 1] ?? null,
    };
    nodeMap.set(inferred.id, nextNode);
    return nextNode;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith('%%')) {
      continue;
    }

    const nextDirection = inferDirection(line);
    if (nextDirection) {
      direction = nextDirection;
      continue;
    }

    if (/^subgraph\s+/i.test(line)) {
      const parsed = inferSubgraph(line);
      const nextSubgraph: GraphSubgraph = {
        id: parsed.id,
        title: parsed.title,
        parentId: subgraphStack[subgraphStack.length - 1] ?? null,
        collapsed: layout.subgraphs[parsed.id]?.collapsed ?? false,
      };
      subgraphs.push(nextSubgraph);
      subgraphStack.push(nextSubgraph.id);
      continue;
    }

    if (/^end$/i.test(line)) {
      subgraphStack.pop();
      continue;
    }

    const parsedStyle = parseStyleLine(line);
    if (parsedStyle) {
      const target = ensureNode({ id: parsedStyle.id, label: parsedStyle.id, shape: 'rect' });
      if (target) {
        target.fill = parsedStyle.fill ?? target.fill;
        target.stroke = parsedStyle.stroke ?? target.stroke;
        target.textColor = parsedStyle.color ?? target.textColor;
      }
      continue;
    }

    const parsedEdge = parseEdgeLine(line);
    if (parsedEdge) {
      const from = ensureNode(parsedEdge.from);
      const to = ensureNode(parsedEdge.to);
      if (from && to) {
        edges.push({
          id: crypto.randomUUID(),
          from: from.id,
          to: to.id,
          label: parsedEdge.label,
          type: parsedEdge.type,
        });
      }
      continue;
    }

    const parsedNode = inferNode(line);
    if (parsedNode) {
      ensureNode(parsedNode);
      continue;
    }

    unsupportedLines.push(line);
  }

  const nodes = [...nodeMap.values()];
  if (unsupportedLines.length > 0) {
    warnings.push(
      `${unsupportedLines.length} line(s) are preserved in source mode only and do not currently render on the canvas.`,
    );
  }

  buildAutoLayout(direction, nodes, edges, layout);

  return {
    direction,
    nodes,
    edges,
    subgraphs,
    warnings,
    unsupportedLines,
    layout,
  };
}

function edgeToken(type: EdgeType) {
  switch (type) {
    case 'dotted':
      return '-.->';
    case 'thick':
      return '==>';
    case 'line':
      return '---';
    default:
      return '-->';
  }
}

function encodeNode(node: GraphNode) {
  const label = node.label.replace(/"/g, '\\"');
  switch (node.shape) {
    case 'round':
      return `${node.id}([${label}])`;
    case 'diamond':
      return `${node.id}{${label}}`;
    case 'circle':
      return `${node.id}((${label}))`;
    case 'hexagon':
      return `${node.id}{{${label}}}`;
    case 'database':
      return `${node.id}[(${label})]`;
    case 'subroutine':
      return `${node.id}[[${label}]]`;
    default:
      return `${node.id}[${label}]`;
  }
}

function renderSubgraphs(
  parentId: string | null,
  subgraphs: GraphSubgraph[],
  nodes: GraphNode[],
  lines: string[],
  depth: number,
) {
  const indent = '  '.repeat(depth);
  const children = subgraphs.filter((subgraph) => subgraph.parentId === parentId);

  for (const subgraph of children) {
    lines.push(`${indent}subgraph ${subgraph.id}["${subgraph.title.replace(/"/g, '\\"')}"]`);

    for (const node of nodes.filter((entry) => entry.subgraphId === subgraph.id)) {
      lines.push(`${indent}  ${encodeNode(node)}`);
    }

    renderSubgraphs(subgraph.id, subgraphs, nodes, lines, depth + 1);
    lines.push(`${indent}end`);
  }
}

export function serializeMermaidDocument(
  direction: Direction,
  nodes: GraphNode[],
  edges: GraphEdge[],
  subgraphs: GraphSubgraph[],
  unsupportedLines: string[],
) {
  const lines = [`flowchart ${direction}`];

  for (const node of nodes.filter((entry) => entry.subgraphId === null)) {
    lines.push(`  ${encodeNode(node)}`);
  }

  renderSubgraphs(null, subgraphs, nodes, lines, 1);

  if (nodes.length > 0) {
    lines.push('');
  }

  for (const edge of edges) {
    const label = edge.label ? `|${edge.label}|` : '';
    lines.push(`  ${edge.from} ${edgeToken(edge.type)}${label} ${edge.to}`);
  }

  const styledNodes = nodes.filter(
    (node) =>
      node.fill !== defaultNodeStyle.fill ||
      node.stroke !== defaultNodeStyle.stroke ||
      node.textColor !== defaultNodeStyle.textColor,
  );

  if (styledNodes.length > 0) {
    lines.push('');
  }

  for (const node of styledNodes) {
    lines.push(
      `  style ${node.id} fill:${node.fill},stroke:${node.stroke},color:${node.textColor}`,
    );
  }

  if (unsupportedLines.length > 0) {
    lines.push('');
    lines.push('  %% Unsupported lines preserved below');
    for (const line of unsupportedLines) {
      lines.push(`  %% ${line}`);
    }
  }

  return lines.join('\n');
}

export function syncDocument(
  partial: ParsedDocument,
  source: string,
): GraphDocument {
  return {
    ...partial,
    source,
  };
}

export function createDefaultLayout(
  viewport = defaultLayout.viewport,
): LayoutSidecar {
  return {
    version: 1,
    viewport: { ...viewport },
    nodes: {},
    subgraphs: {},
  };
}

export function toSidecar(document: GraphDocument): LayoutSidecar {
  const nodes = Object.fromEntries(
    document.nodes.map((node) => [
      node.id,
      {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      },
    ]),
  );

  const subgraphs = Object.fromEntries(
    document.subgraphs.map((subgraph) => [
      subgraph.id,
      { collapsed: subgraph.collapsed },
    ]),
  );

  return {
    version: document.layout.version,
    viewport: { ...document.layout.viewport },
    nodes,
    subgraphs,
  };
}
