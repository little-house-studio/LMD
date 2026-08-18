import type { GraphIR } from './graph';

export interface PathIR {
  id: string;
  nodeIds: string[];
  kind: 'chain' | 'branch' | 'cycle';
}

export interface GraphAnalysis {
  sources: string[];
  sinks: string[];
  cycles: string[][];
  components: string[][];
  paths: PathIR[];
}

export function analyzeGraph(graph: GraphIR): GraphAnalysis {
  const nodes = graph.nodes.map((node) => node.id);
  const nodeSet = new Set(nodes);
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();

  for (const id of nodes) {
    outgoing.set(id, []);
    incoming.set(id, 0);
  }

  for (const edge of graph.edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) {
      continue;
    }
    outgoing.get(edge.from)?.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  const sources = nodes.filter((id) => (incoming.get(id) ?? 0) === 0);
  const sinks = nodes.filter((id) => (outgoing.get(id)?.length ?? 0) === 0);

  const cycles: string[][] = [];
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (id: string) => {
    color.set(id, 1);
    stack.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const state = color.get(next) ?? 0;
      if (state === 0) {
        visit(next);
      } else if (state === 1) {
        const start = stack.indexOf(next);
        if (start >= 0) {
          cycles.push(stack.slice(start));
        }
      }
    }
    stack.pop();
    color.set(id, 2);
  };

  for (const id of nodes) {
    if ((color.get(id) ?? 0) === 0) {
      visit(id);
    }
  }

  const seen = new Set<string>();
  const components: string[][] = [];
  const undirected = new Map<string, string[]>();
  for (const id of nodes) {
    undirected.set(id, []);
  }
  for (const edge of graph.edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) {
      continue;
    }
    undirected.get(edge.from)?.push(edge.to);
    undirected.get(edge.to)?.push(edge.from);
  }
  for (const id of nodes) {
    if (seen.has(id)) {
      continue;
    }
    const bucket: string[] = [];
    const queue = [id];
    seen.add(id);
    while (queue.length > 0) {
      const current = queue.pop()!;
      bucket.push(current);
      for (const next of undirected.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    components.push(bucket);
  }

  const paths: PathIR[] = [];
  let pathIndex = 0;
  const walk = (start: string) => {
    const chain = [start];
    const localSeen = new Set([start]);
    let cursor = start;
    while (true) {
      const nexts = (outgoing.get(cursor) ?? []).filter((id) => !localSeen.has(id));
      if (nexts.length !== 1) {
        if (nexts.length > 1) {
          paths.push({
            id: `path_${pathIndex}`,
            nodeIds: [...chain],
            kind: 'branch',
          });
          pathIndex += 1;
        }
        break;
      }
      cursor = nexts[0]!;
      localSeen.add(cursor);
      chain.push(cursor);
    }
    if (chain.length > 1) {
      paths.push({
        id: `path_${pathIndex}`,
        nodeIds: chain,
        kind: 'chain',
      });
      pathIndex += 1;
    }
  };

  const starts = sources.length > 0 ? sources : nodes.slice(0, 1);
  for (const start of starts) {
    walk(start);
  }

  for (const cycle of cycles) {
    paths.push({
      id: `path_${pathIndex}`,
      nodeIds: cycle,
      kind: 'cycle',
    });
    pathIndex += 1;
  }

  return { sources, sinks, cycles, components, paths };
}
