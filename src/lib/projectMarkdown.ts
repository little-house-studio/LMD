import {
  createDefaultLayout,
  measureNodeContentSize,
  parseMermaidDocument,
} from './mermaid';
import type {
  GraphDocument,
  GraphNode,
  GraphSubgraph,
  LayoutSidecar,
  ProjectCompatExtras,
  ProjectCompatLayer,
} from './types';

const COMPAT_FENCE = 'lths-compat';
const PROJECT_VERSION = 1;
const DEFAULT_VIEWPORT = createDefaultLayout().viewport;
const EMPTY_PROJECT_MERMAID = `flowchart LR
  Start[Start]`;
const CONTENT_SECTION_TITLE = 'Content';
const NODE_ANNOTATIONS_SECTION_TITLE = 'Node Annotations';

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, '\n');
}

function trimBlock(value: string) {
  return normalizeLineEndings(value).replace(/^\n+|\n+$/g, '');
}

function findLastFenceBlock(source: string, language: string) {
  const pattern = new RegExp(`(^|\\n)\\\`\\\`\\\`${language}\\s*\\n([\\s\\S]*?)\\n\\\`\\\`\\\``, 'gi');
  const matches = [...source.matchAll(pattern)];
  const match = matches.at(-1);
  if (!match || match.index === undefined) {
    return null;
  }

  const start = match.index + (match[1] ? match[1].length : 0);
  const end = start + match[0].length - (match[1] ? match[1].length : 0);
  return {
    start,
    end,
    body: trimBlock(match[2] ?? ''),
  };
}

function findFirstMermaidFence(source: string) {
  const pattern = /(^|\n)```mermaid\s*\n([\s\S]*?)\n```/i;
  const match = source.match(pattern);
  if (!match || match.index === undefined) {
    return null;
  }

  const start = match.index + (match[1] ? match[1].length : 0);
  const end = start + match[0].length - (match[1] ? match[1].length : 0);
  return {
    start,
    end,
    body: trimBlock(match[2] ?? ''),
  };
}

function findFenceBlocks(source: string, language: string) {
  const pattern = new RegExp(`(^|\\n)\\\`\\\`\\\`${language}\\s*\\n([\\s\\S]*?)\\n\\\`\\\`\\\``, 'gi');
  return [...source.matchAll(pattern)].flatMap((match) => {
    if (match.index === undefined) {
      return [];
    }

    const start = match.index + (match[1] ? match[1].length : 0);
    const end = start + match[0].length - (match[1] ? match[1].length : 0);
    return [{
      start,
      end,
      body: trimBlock(match[2] ?? ''),
    }];
  });
}

function inferProjectName(prefixMarkdown: string, fallbackName: string) {
  const headingMatch = prefixMarkdown.match(/^#\s+(.+)$/m);
  return headingMatch?.[1]?.trim() || fallbackName;
}

function inferProjectSummary(prefixMarkdown: string) {
  const summaryMatch = prefixMarkdown.match(/^##\s+Summary\s*\n([\s\S]*?)(?=\n##\s+|\n#\s+|$)/im);
  return trimBlock(summaryMatch?.[1] ?? '');
}

function inferFallbackSummary(source: string) {
  const textOnly = trimBlock(
    normalizeLineEndings(source)
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^#{1,6}\s+.*$/gm, '')
      .replace(/^\s*[-*+]\s+.*$/gm, '')
      .replace(/^\s*\d+\.\s+.*$/gm, ''),
  );
  const paragraphs = textOnly
    .split(/\n\s*\n/)
    .map((paragraph) => trimBlock(paragraph))
    .filter(Boolean);

  return paragraphs[0] ?? '';
}

function stripFirstH1(source: string) {
  const headingPattern = /^#\s+(.+)$/m;
  const match = source.match(headingPattern);
  if (!match) {
    return { title: '', body: trimBlock(source) };
  }

  return {
    title: match[1]?.trim() ?? '',
    body: trimBlock(source.replace(headingPattern, '')),
  };
}

function splitTopLevelSections(source: string) {
  const normalized = normalizeLineEndings(source);
  const headingPattern = /^##\s+(.+?)\s*$/gm;
  const matches = [...normalized.matchAll(headingPattern)];

  if (matches.length === 0) {
    return {
      preamble: trimBlock(normalized),
      sections: [] as Array<{ title: string; body: string }>,
    };
  }

  const sections = matches.map((match, index) => {
    const headingStart = match.index ?? 0;
    const headingEnd = headingStart + match[0].length;
    const nextStart = matches[index + 1]?.index ?? normalized.length;
    const rawBody = normalized.slice(headingEnd, nextStart).replace(/^\n+/, '');

    return {
      title: trimBlock(match[1] ?? ''),
      body: trimBlock(rawBody),
    };
  });

  return {
    preamble: trimBlock(normalized.slice(0, matches[0]?.index ?? 0)),
    sections,
  };
}

function rebuildSection(title: string, body: string) {
  const trimmedTitle = trimBlock(title);
  const trimmedBody = trimBlock(body);
  if (!trimmedTitle) {
    return trimmedBody;
  }

  return trimmedBody ? `## ${trimmedTitle}\n\n${trimmedBody}` : `## ${trimmedTitle}`;
}

function findFirstParseableMermaidBlock(source: string, fallbackLayout?: LayoutSidecar) {
  const blocks = findFenceBlocks(source, 'mermaid');
  for (const block of blocks) {
    try {
      parseMermaidDocument(block.body, fallbackLayout);
      return block;
    } catch {
      continue;
    }
  }

  return null;
}

function stripLeadingSummaryParagraph(source: string, summary: string) {
  const trimmedSource = trimBlock(source);
  const trimmedSummary = trimBlock(summary);
  if (!trimmedSource || !trimmedSummary) {
    return trimmedSource;
  }

  const paragraphs = trimmedSource
    .split(/\n\s*\n/)
    .map((paragraph) => trimBlock(paragraph))
    .filter(Boolean);
  if (paragraphs[0] !== trimmedSummary) {
    return trimmedSource;
  }

  return trimBlock(paragraphs.slice(1).join('\n\n'));
}

function buildContentSection(content: string) {
  const trimmed = trimBlock(content);
  return trimmed ? `## ${CONTENT_SECTION_TITLE}\n\n${trimmed}` : `## ${CONTENT_SECTION_TITLE}`;
}

function parseNodeAnnotationsSection(markdown: string) {
  const normalized = trimBlock(markdown);
  if (!normalized) {
    return {} as Record<string, string>;
  }

  const headingPattern = /^###\s+`?([^\n`]+?)`?\s*$/gm;
  const matches = [...normalized.matchAll(headingPattern)];
  if (matches.length > 0) {
    return Object.fromEntries(
      matches.flatMap((match, index) => {
        const nodeId = trimBlock(match[1] ?? '');
        if (!nodeId) {
          return [];
        }

        const headingStart = match.index ?? 0;
        const headingEnd = headingStart + match[0].length;
        const nextStart = matches[index + 1]?.index ?? normalized.length;
        const body = trimBlock(normalized.slice(headingEnd, nextStart).replace(/^\n+/, ''));
        return body ? [[nodeId, body]] : [];
      }),
    );
  }

  return Object.fromEntries(
    normalized
      .split('\n')
      .map((line) => line.match(/^\s*-\s+`?([^:`\n]+?)`?\s*:\s*(.+)$/))
      .flatMap((match) => {
        if (!match) {
          return [];
        }

        const nodeId = trimBlock(match[1] ?? '');
        const note = trimBlock(match[2] ?? '');
        return nodeId && note ? [[nodeId, note]] : [];
      }),
  );
}

function buildNodeAnnotationsSection(nodeAnnotations: Record<string, string>) {
  const entries = Object.entries(nodeAnnotations)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
    .sort((left, right) => left[0].localeCompare(right[0]));

  if (entries.length === 0) {
    return '';
  }

  const lines = [`## ${NODE_ANNOTATIONS_SECTION_TITLE}`, ''];
  entries.forEach(([nodeId, note], index) => {
    if (index > 0) {
      lines.push('');
    }
    lines.push(`### \`${nodeId}\``);
    lines.push('');
    lines.push(trimBlock(note));
  });

  return lines.join('\n');
}

function extractSuffixSections(
  suffixMarkdown: string,
  legacyNodeNotes?: Record<string, string>,
) {
  const normalized = trimBlock(suffixMarkdown);
  const { preamble, sections } = splitTopLevelSections(normalized);
  const contentFragments: string[] = [];
  const nodeAnnotations = {
    ...(legacyNodeNotes ?? {}),
  } as Record<string, string>;

  if (preamble) {
    contentFragments.push(preamble);
  }

  sections.forEach((section) => {
    const key = section.title.trim().toLowerCase();
    if (key === CONTENT_SECTION_TITLE.toLowerCase()) {
      if (section.body) {
        contentFragments.push(section.body);
      }
      return;
    }

    if (key === NODE_ANNOTATIONS_SECTION_TITLE.toLowerCase()) {
      Object.assign(nodeAnnotations, parseNodeAnnotationsSection(section.body));
      return;
    }

    contentFragments.push(rebuildSection(section.title, section.body));
  });

  return {
    contentMarkdown: trimBlock(contentFragments.filter(Boolean).join('\n\n')),
    nodeAnnotations: Object.fromEntries(
      Object.entries(nodeAnnotations).filter((entry): entry is [string, string] =>
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'string' &&
        entry[1].trim().length > 0,
      ),
    ),
  };
}

export function buildProjectSuffixMarkdown(content: string, nodeAnnotations: Record<string, string> = {}) {
  const blocks = [buildContentSection(content)];
  const annotationsSection = buildNodeAnnotationsSection(nodeAnnotations);
  if (annotationsSection) {
    blocks.push(annotationsSection);
  }
  return blocks.filter(Boolean).join('\n\n');
}

function createEmptyCompatLayer(fallbackLayout?: LayoutSidecar): ProjectCompatLayer {
  const fallback = createDefaultLayout(fallbackLayout?.viewport);
  if (fallbackLayout) {
    fallback.nodes = { ...fallbackLayout.nodes };
    fallback.subgraphs = { ...fallbackLayout.subgraphs };
  }

  return {
    version: PROJECT_VERSION,
    layout: fallback,
    editor: {
      localFileActions: { enabled: true },
    },
  };
}

function buildDefaultPrefix(projectName: string, projectSummary: string) {
  const lines = [`# ${projectName}`, '', '## Summary', ''];
  if (projectSummary.trim()) {
    lines.push(projectSummary.trim(), '');
  }
  lines.push('## Diagram');
  return lines.join('\n');
}

function normalizeCompatLayer(
  compatRaw: string | null,
  fallbackLayout?: LayoutSidecar,
): ProjectCompatLayer {
  const fallback = createEmptyCompatLayer(fallbackLayout);
  if (!compatRaw) {
    return fallback;
  }

  const compactRaw = compatRaw.replace(/\s+/g, '');
  if (!compactRaw.startsWith('v')) {
    return fallback;
  }

  return normalizeCompactCompatLayer(compactRaw, fallback.layout);
}

function normalizeLegacyCompatLayer(
  compatRaw: string | null,
  fallbackLayout?: LayoutSidecar,
): ProjectCompatLayer {
  const fallback = createEmptyCompatLayer(fallbackLayout);
  if (!compatRaw) {
    return fallback;
  }

  const compactRaw = compatRaw.replace(/\s+/g, '');
  if (compactRaw.startsWith('v')) {
    return normalizeCompactCompatLayer(compactRaw, fallback.layout);
  }

  try {
    const parsed = JSON.parse(compatRaw) as Partial<ProjectCompatLayer> & {
      layout?: LayoutSidecar;
    };
    return {
      version: parsed.version ?? PROJECT_VERSION,
      layout: parsed.layout ?? fallback.layout,
      editor: {
        localFileActions: {
          enabled: parsed.editor?.localFileActions?.enabled ?? true,
        },
      },
      extras: parsed.extras,
    };
  } catch {
    return fallback;
  }
}

function formatCompatNumber(value: number) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return Number(value.toFixed(3)).toString();
}

function normalizeCompactCompatLayer(
  compactRaw: string,
  fallback: LayoutSidecar,
): ProjectCompatLayer {
  const nextLayout: LayoutSidecar = {
    version: fallback.version,
    viewport: { ...fallback.viewport },
    nodes: { ...fallback.nodes },
    subgraphs: { ...fallback.subgraphs },
  };
  let version = PROJECT_VERSION;
  let localFileActionsEnabled = true;
  let extras: ProjectCompatExtras | undefined;

  const segments = compactRaw.split(';').filter(Boolean);
  for (const segment of segments) {
    if (/^v\d+$/i.test(segment)) {
      version = Number.parseInt(segment.slice(1), 10) || PROJECT_VERSION;
      continue;
    }

    if (segment.startsWith('vp=')) {
      const [x, y, zoom] = segment
        .slice(3)
        .split(',')
        .map((value) => Number.parseFloat(value));
      if ([x, y, zoom].every((value) => Number.isFinite(value))) {
        nextLayout.viewport = { x, y, zoom };
      }
      continue;
    }

    if (segment.startsWith('n=')) {
      const nodeEntries = segment.slice(2).split('|').filter(Boolean);
      for (const entry of nodeEntries) {
        const [id, rawX, rawY, rawWidth, rawHeight] = entry.split(',');
        const x = Number.parseFloat(rawX);
        const y = Number.parseFloat(rawY);
        if (!id || !Number.isFinite(x) || !Number.isFinite(y)) {
          continue;
        }

        const width = Number.parseFloat(rawWidth);
        const height = Number.parseFloat(rawHeight);
        nextLayout.nodes[id] = {
          x,
          y,
          width: Number.isFinite(width) ? width : fallback.nodes[id]?.width ?? 0,
          height: Number.isFinite(height) ? height : fallback.nodes[id]?.height ?? 0,
        };
      }
      continue;
    }

    if (segment.startsWith('g=')) {
      const groupIds = segment.slice(2).split('|').filter(Boolean);
      for (const id of groupIds) {
        nextLayout.subgraphs[id] = { collapsed: true };
      }
      continue;
    }

    if (segment.startsWith('cb=')) {
      const values = segment.slice(3).split(',').map((value) => Number.parseFloat(value));
      const [x, y, collapsed] = values;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        extras = { ...(extras ?? {}), contentBox: Number.isFinite(collapsed) && collapsed >= 1 ? [x, y, 1] : [x, y] };
      }
      continue;
    }

    if (segment.startsWith('a=')) {
      const entries = segment.slice(2).split('|').filter(Boolean);
      const nodeNotes = Object.fromEntries(
        entries.flatMap((entry) => {
          const separatorIndex = entry.indexOf('~');
          if (separatorIndex <= 0) {
            return [];
          }

          const id = entry.slice(0, separatorIndex);
          const encoded = entry.slice(separatorIndex + 1);
          try {
            const value = decodeURIComponent(encoded);
            return value.trim() ? [[id, value]] : [];
          } catch {
            return [];
          }
        }),
      );

      if (Object.keys(nodeNotes).length > 0) {
        extras = {
          ...(extras ?? {}),
          nodeNotes,
        };
      }
      continue;
    }

    if (segment.startsWith('e=')) {
      localFileActionsEnabled = segment.slice(2) !== '0';
      continue;
    }

    if (segment.startsWith('j=')) {
      try {
        extras = {
          ...(extras ?? {}),
          ...(JSON.parse(decodeURIComponent(segment.slice(2))) as ProjectCompatExtras),
        };
      } catch {
        extras = extras ?? undefined;
      }
    }
  }

  return {
    version,
    layout: nextLayout,
    editor: {
      localFileActions: {
        enabled: localFileActionsEnabled,
      },
    },
    extras,
  };
}

function serializeCompactCompatLayer(input: {
  compat: ProjectCompatLayer;
  nodes: GraphNode[];
  subgraphs: GraphSubgraph[];
}) {
  const parts = [`v${input.compat.version ?? PROJECT_VERSION}`];
  const viewport = input.compat.layout.viewport;

  if (
    viewport.x !== DEFAULT_VIEWPORT.x ||
    viewport.y !== DEFAULT_VIEWPORT.y ||
    viewport.zoom !== DEFAULT_VIEWPORT.zoom
  ) {
    parts.push(
      `vp=${formatCompatNumber(viewport.x)},${formatCompatNumber(viewport.y)},${formatCompatNumber(viewport.zoom)}`,
    );
  }

  const nodeEntries = input.nodes
    .map((node) => {
      const stored = input.compat.layout.nodes[node.id];
      if (!stored) {
        return null;
      }

      const measured = measureNodeContentSize(node.label);
      const values = [
        node.id,
        formatCompatNumber(stored.x),
        formatCompatNumber(stored.y),
      ];

      const widthChanged = Math.round(stored.width) !== Math.round(measured.width);
      const heightChanged = Math.round(stored.height) !== Math.round(measured.height);

      if (widthChanged || heightChanged) {
        values.push(
          formatCompatNumber(stored.width),
          formatCompatNumber(stored.height),
        );
      }

      return values.join(',');
    })
    .filter((entry): entry is string => Boolean(entry));

  if (nodeEntries.length > 0) {
    parts.push(`n=${nodeEntries.join('|')}`);
  }

  const collapsedGroups = input.subgraphs
    .filter((subgraph) => input.compat.layout.subgraphs[subgraph.id]?.collapsed)
    .map((subgraph) => subgraph.id);

  if (collapsedGroups.length > 0) {
    parts.push(`g=${collapsedGroups.join('|')}`);
  }

  if (Array.isArray(input.compat.extras?.contentBox) && input.compat.extras.contentBox.length >= 2) {
    const [x, y, collapsed] = input.compat.extras.contentBox;
    parts.push(
      `cb=${formatCompatNumber(x)},${formatCompatNumber(y)}${collapsed === 1 ? ',1' : ''}`,
    );
  }

  if (input.compat.editor?.localFileActions?.enabled === false) {
    parts.push('e=0');
  }

  const extraEntries = input.compat.extras
    ? Object.fromEntries(
      Object.entries(input.compat.extras).filter(([key, value]) =>
        key !== 'contentBox' &&
        value !== undefined,
      ),
    )
    : {};

  if (Object.keys(extraEntries).length > 0) {
    parts.push(`j=${encodeURIComponent(JSON.stringify(extraEntries))}`);
  }

  return parts.join(';');
}

export function extractMermaidFromProjectMarkdown(rawMarkdown: string) {
  const normalized = normalizeLineEndings(rawMarkdown);
  const mermaidBlock = findFirstMermaidFence(normalized);
  if (mermaidBlock) {
    return mermaidBlock.body;
  }

  return '';
}

export function parseProjectMarkdown(
  rawMarkdown: string,
  fallbackName = 'Untitled Project',
  fallbackLayout?: LayoutSidecar,
): GraphDocument {
  const normalized = normalizeLineEndings(rawMarkdown).trim();

  const compatBlock = findLastFenceBlock(normalized, COMPAT_FENCE);
  const markdownWithoutCompat = compatBlock
    ? `${normalized.slice(0, compatBlock.start)}${normalized.slice(compatBlock.end)}`.trim()
    : normalized;
  const compat = normalizeCompatLayer(compatBlock?.body ?? null, fallbackLayout);
  const mermaidBlock = findFirstMermaidFence(markdownWithoutCompat);

  if (!mermaidBlock) {
    throw new Error('Project markdown must contain one ```mermaid``` block.');
  }

  const prefixMarkdown = trimBlock(markdownWithoutCompat.slice(0, mermaidBlock.start));
  const legacyNodeNotes = compat.extras?.nodeNotes && typeof compat.extras.nodeNotes === 'object'
    ? compat.extras.nodeNotes
    : undefined;
  const suffixSections = extractSuffixSections(trimBlock(markdownWithoutCompat.slice(mermaidBlock.end)), legacyNodeNotes);
  const suffixMarkdown = buildProjectSuffixMarkdown(suffixSections.contentMarkdown, suffixSections.nodeAnnotations);
  const mermaidSource = mermaidBlock.body;
  const parsed = parseMermaidDocument(mermaidSource, compat.layout);
  const projectName = inferProjectName(prefixMarkdown, fallbackName);
  const projectSummary = inferProjectSummary(prefixMarkdown);
  const compatExtras = compat.extras
    ? Object.fromEntries(
      Object.entries(compat.extras).filter(([key]) => key !== 'nodeNotes'),
    )
    : undefined;

  return {
    ...parsed,
    source: mermaidSource,
    markdown: serializeProjectMarkdown({
      projectName,
      projectSummary,
      prefixMarkdown,
      suffixMarkdown,
      mermaidSource,
      compat: {
        ...compat,
        layout: parsed.layout,
        extras: compatExtras,
      },
      nodes: parsed.nodes,
      subgraphs: parsed.subgraphs,
    }),
    projectName,
    projectSummary,
    prefixMarkdown: prefixMarkdown || buildDefaultPrefix(projectName, projectSummary),
    suffixMarkdown,
    contentMarkdown: suffixSections.contentMarkdown,
    nodeAnnotations: suffixSections.nodeAnnotations,
    compat: {
      ...compat,
      layout: parsed.layout,
      extras: compatExtras,
    },
  };
}

export function standardizeProjectMarkdown(
  rawMarkdown: string,
  fallbackName = 'Untitled Project',
  fallbackLayout?: LayoutSidecar,
) {
  const normalized = normalizeLineEndings(rawMarkdown).trim();
  const compatBlock = findLastFenceBlock(normalized, COMPAT_FENCE);
  const compat = normalizeLegacyCompatLayer(compatBlock?.body ?? null, fallbackLayout);
  const bodyWithoutCompat = compatBlock
    ? trimBlock(`${normalized.slice(0, compatBlock.start)}${normalized.slice(compatBlock.end)}`)
    : normalized;

  const strippedTitle = stripFirstH1(bodyWithoutCompat);
  const projectName = strippedTitle.title || inferProjectName(bodyWithoutCompat, fallbackName);
  const { preamble, sections } = splitTopLevelSections(strippedTitle.body);
  const normalizedSections = sections.map((section) => ({
    ...section,
    key: section.title.trim().toLowerCase(),
  }));
  const summarySections = normalizedSections.filter((section) => section.key === 'summary');
  const diagramSections = normalizedSections.filter((section) => section.key === 'diagram');
  const contentSections = normalizedSections.filter((section) => section.key === 'content');
  const annotationSections = normalizedSections.filter((section) => section.key === 'node annotations');
  const extraSections = normalizedSections.filter((section) =>
    section.key !== 'summary' &&
    section.key !== 'diagram' &&
    section.key !== 'content' &&
    section.key !== 'node annotations',
  );

  let mermaidSource = '';
  const contentFragments: string[] = [];

  if (preamble) {
    contentFragments.push(preamble);
  }

  let diagramHandled = false;
  for (const section of diagramSections) {
    const parsedBlock = findFirstParseableMermaidBlock(section.body, compat.layout);
    if (!diagramHandled && parsedBlock) {
      mermaidSource = parsedBlock.body;
      const residue = trimBlock(
        `${section.body.slice(0, parsedBlock.start)}${section.body.slice(parsedBlock.end)}`,
      );
      if (residue) {
        contentFragments.push(residue);
      }
      diagramHandled = true;
      continue;
    }

    if (trimBlock(section.body)) {
      contentFragments.push(section.body);
    }
  }

  if (!mermaidSource) {
    const parsedBlock = findFirstParseableMermaidBlock(strippedTitle.body, compat.layout);
    if (parsedBlock) {
      mermaidSource = parsedBlock.body;
      const residue = trimBlock(
        `${strippedTitle.body.slice(0, parsedBlock.start)}${strippedTitle.body.slice(parsedBlock.end)}`,
      );
      if (residue) {
        const cleanedResidue = splitTopLevelSections(residue);
        if (cleanedResidue.preamble) {
          contentFragments.push(cleanedResidue.preamble);
        }
        cleanedResidue.sections
          .filter((section) => section.title.trim().toLowerCase() !== 'summary')
          .forEach((section) => {
            if (section.title.trim().toLowerCase() === 'content') {
              if (section.body) {
                contentFragments.push(section.body);
              }
            } else if (section.title.trim().toLowerCase() !== 'diagram') {
              contentFragments.push(rebuildSection(section.title, section.body));
            }
          });
      }
    } else if (/^(?:flowchart|graph)\s+(TD|LR|RL|BT)\b/i.test(strippedTitle.body.trim())) {
      mermaidSource = strippedTitle.body.trim();
    } else {
      mermaidSource = EMPTY_PROJECT_MERMAID;
    }
  }

  contentSections.forEach((section) => {
    if (section.body) {
      contentFragments.push(section.body);
    }
  });

  const legacyNodeNotes = compat.extras?.nodeNotes && typeof compat.extras.nodeNotes === 'object'
    ? compat.extras.nodeNotes
    : undefined;
  const nodeAnnotations = {
    ...(legacyNodeNotes ?? {}),
  } as Record<string, string>;
  annotationSections.forEach((section) => {
    Object.assign(nodeAnnotations, parseNodeAnnotationsSection(section.body));
  });

  extraSections.forEach((section) => {
    contentFragments.push(rebuildSection(section.title, section.body));
  });

  let contentMarkdown = trimBlock(contentFragments.filter(Boolean).join('\n\n'));
  const projectSummary = summarySections[0]?.body || inferFallbackSummary(contentMarkdown);
  if (!summarySections[0]?.body) {
    contentMarkdown = stripLeadingSummaryParagraph(contentMarkdown, projectSummary);
  }

  const standardizedMarkdown = serializeProjectMarkdown({
    projectName,
    projectSummary,
    prefixMarkdown: buildDefaultPrefix(projectName, projectSummary),
    suffixMarkdown: buildProjectSuffixMarkdown(contentMarkdown, nodeAnnotations),
    mermaidSource,
    compat: {
      ...compat,
      extras: compat.extras
        ? Object.fromEntries(Object.entries(compat.extras).filter(([key]) => key !== 'nodeNotes'))
        : undefined,
    },
    nodes: [],
    subgraphs: [],
  });

  return parseProjectMarkdown(standardizedMarkdown, projectName, compat.layout);
}

export function serializeProjectMarkdown(input: {
  projectName: string;
  projectSummary: string;
  prefixMarkdown?: string;
  suffixMarkdown?: string;
  contentMarkdown?: string;
  nodeAnnotations?: Record<string, string>;
  mermaidSource: string;
  compat: ProjectCompatLayer;
  nodes?: GraphNode[];
  subgraphs?: GraphSubgraph[];
}) {
  const prefix = trimBlock(input.prefixMarkdown ?? '') || buildDefaultPrefix(
    input.projectName,
    input.projectSummary,
  );
  const normalizedNodeAnnotations = Object.fromEntries(
    Object.entries(input.nodeAnnotations ?? {}).filter((entry): entry is [string, string] =>
      typeof entry[0] === 'string' &&
      typeof entry[1] === 'string' &&
      entry[1].trim().length > 0,
    ),
  );
  const suffixSource = input.contentMarkdown !== undefined || Object.keys(normalizedNodeAnnotations).length > 0
    ? buildProjectSuffixMarkdown(input.contentMarkdown ?? '', normalizedNodeAnnotations)
    : trimBlock(input.suffixMarkdown ?? '');
  const suffix = trimBlock(suffixSource);
  const compat = {
    version: input.compat.version ?? PROJECT_VERSION,
    layout: input.compat.layout,
    editor: {
      localFileActions: {
        enabled: input.compat.editor?.localFileActions?.enabled ?? true,
      },
    },
    extras: input.compat.extras,
  };

  const blocks = [
    prefix,
    '```mermaid',
    input.mermaidSource.trim(),
    '```',
  ];

  if (suffix) {
    blocks.push('', suffix);
  }

  blocks.push(
    '',
    `\`\`\`${COMPAT_FENCE}`,
    serializeCompactCompatLayer({
      compat,
      nodes: input.nodes ?? [],
      subgraphs: input.subgraphs ?? [],
    }),
    '```',
    '',
  );

  return blocks.join('\n');
}

export function createProjectMarkdownTemplate(projectName: string, mermaidSource: string) {
  const projectSummary = '';
  const compat: ProjectCompatLayer = createEmptyCompatLayer();

  return serializeProjectMarkdown({
    projectName,
    projectSummary,
    prefixMarkdown: buildDefaultPrefix(projectName, projectSummary),
    contentMarkdown: '',
    nodeAnnotations: {},
    mermaidSource,
    compat,
    nodes: [],
    subgraphs: [],
  });
}
