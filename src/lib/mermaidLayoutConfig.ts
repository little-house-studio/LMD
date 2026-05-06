export type MermaidLayoutKind =
  | 'dagre'
  | 'elk'
  | 'elk.layered'
  | 'elk.stress'
  | 'elk.force'
  | 'elk.mrtree'
  | 'elk.sporeOverlap'
  | 'tidy-tree'
  | 'cose-bilkent';

export interface MermaidLayoutPreference {
  layout: MermaidLayoutKind;
  source: 'frontmatter' | 'default';
  supportedForAutoLayout: boolean;
}

const supportedAutoLayoutLayouts = new Set<MermaidLayoutKind>([
  'dagre',
  'elk',
  'elk.layered',
  'elk.stress',
  'elk.force',
  'elk.mrtree',
  'elk.sporeOverlap',
]);

function normalizeLayout(value: string): MermaidLayoutKind | null {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '') as MermaidLayoutKind;
  if (
    normalized === 'dagre' ||
    normalized === 'elk' ||
    normalized === 'elk.layered' ||
    normalized === 'elk.stress' ||
    normalized === 'elk.force' ||
    normalized === 'elk.mrtree' ||
    normalized === 'elk.sporeOverlap' ||
    normalized === 'tidy-tree' ||
    normalized === 'cose-bilkent'
  ) {
    return normalized;
  }

  return null;
}

export function readMermaidLayoutPreference(source: string): MermaidLayoutPreference {
  const trimmed = source.trimStart();
  const frontmatterMatch = trimmed.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!frontmatterMatch) {
    return {
      layout: 'dagre',
      source: 'default',
      supportedForAutoLayout: true,
    };
  }

  const config = frontmatterMatch[1];
  const layoutMatch = config.match(/(?:^|\n)\s*layout\s*:\s*([^\n#]+)/);
  const layout = layoutMatch ? normalizeLayout(layoutMatch[1]) : null;

  return {
    layout: layout ?? 'dagre',
    source: layout ? 'frontmatter' : 'default',
    supportedForAutoLayout: supportedAutoLayoutLayouts.has(layout ?? 'dagre'),
  };
}

let elkRegistered = false;

export async function registerMermaidElkLayoutIfNeeded() {
  if (elkRegistered) {
    return;
  }

  const mermaidModule = await import('mermaid');
  const elkModule = await import('@mermaid-js/layout-elk');
  const mermaid = mermaidModule.default as typeof mermaidModule.default & {
    registerLayoutLoaders?: (loaders: unknown) => void;
  };
  const elkLayouts = elkModule.default;

  mermaid.registerLayoutLoaders?.(elkLayouts);
  elkRegistered = true;
}
