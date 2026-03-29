---
name: lmd-protocol
description: Use when reading, writing, standardizing, or validating this project's `.lmd` files; covers the LMD file structure, Mermaid flowchart rules, node ID/description conventions, compat-layer expectations, and the handling boundaries between canvas-editable content and source-only Mermaid.
---

# LMD Protocol

Use this skill when a task touches the LMD file format used by this project.

Typical triggers:
- The user asks how an `.lmd` file is structured
- The user wants to edit or generate LMD source
- A change affects `Project Name`, `Summary`, `Diagram`, `Content`, or `lths-compat`
- AI prompts or tools need to know what the file format means
- A Mermaid snippet must be judged as canvas-editable vs source-only

## What LMD Is For

LMD is the project’s single-file source of truth for structured graph work.

It is designed to let one `.lmd` file serve all of these purposes at once:
- human-readable Markdown document
- standard Mermaid graph source
- canvas-editable flowchart document
- Git-friendly text asset
- AI-readable project graph context

In practice, one LMD file is used to store:
- project name
- summary
- main Mermaid diagram
- regular Markdown notes / additional information
- editor-only layout state at the end

This means the file is not just “a Mermaid snippet”. It is a full project document with:
- semantic content for people and AI
- structural graph content for the canvas
- minimal editor state for restoring layout

## Typical Applications

Use LMD when the user is working on:
- product graphs
- structured outlines
- internal workflow diagrams
- architecture flowcharts
- review / decision graphs
- graph-like planning documents that still need Markdown content around the diagram

LMD is especially useful when:
- the user wants one file instead of separate diagram + sidecar files
- the graph must remain close to standard Mermaid
- the content should still be readable in Git, code review, or text editors
- AI needs the whole project context, not only raw diagram edges

## Core Rules

- LMD is a single-file Markdown format stored as a `.lmd` file.
- Keep the whole file valid Markdown.
- Keep Mermaid valid standard Mermaid.
- Do not introduce private coordinates, private annotations, or custom metadata into Mermaid source.
- `flowchart` / `graph` are the only diagram types that the structured canvas is allowed to rewrite.
- Other Mermaid diagram types may exist, but should be preserved as source instead of being rewritten through graph tools.

## Required Top-Level Structure

An LMD document should follow this structure:

1. `# Project Name`
2. `## Summary`
3. `## Diagram`
4. one standard fenced `mermaid` block
5. `## Content`
6. one final fenced `lths-compat` block

Read [references/file-structure.md](references/file-structure.md) for the exact layout and invariants.

## Diagram Rules

- Prefer `flowchart LR` unless the existing file already uses another flowchart direction.
- Canvas nodes conceptually have:
  - a title
  - a description
- In Mermaid source:
  - the node ID should be title-derived and stable
  - the Mermaid label should store the description only
- Relationships belong on edges, not inside node IDs.
- Subgraphs represent grouping/hierarchy. Do not encode grouping into node IDs.
- If a user wants non-flowchart Mermaid such as `classDiagram`, keep it as source-only unless they explicitly want a conversion.

Read [references/diagram-rules.md](references/diagram-rules.md) for canonical Mermaid patterns.

## Content Rules

- `## Content` is regular Markdown.
- Treat it as user-authored content.
- Do not convert it into nodes unless the user explicitly asks.
- The editor may render it as a pinned "附加信息" window, but file format remains plain Markdown in `## Content`.

## Compat Layer Rules

- `lths-compat` is editor-only state.
- Keep it short and machine-oriented.
- It may contain viewport, pinned window state, and layout hints.
- Never move real semantic content into `lths-compat`.
- Do not use old standalone `Node Annotations` sections; the current format does not rely on that structure.

## What To Preserve Carefully

When fulfilling different requests, pay attention to different layers:

- If the user asks for content editing:
  - prioritize `Project Name`, `Summary`, `Content`, node titles, node descriptions, and edge labels
- If the user asks for structural graph changes:
  - prioritize Mermaid `flowchart` nodes, edges, and subgraphs
- If the user asks for layout-only changes:
  - prefer updating `lths-compat`, not semantic Markdown
- If the user asks for standards/compatibility:
  - keep Mermaid standard and avoid private extensions in the Mermaid block
- If the user asks for AI/tooling support:
  - describe the full LMD structure explicitly and respect the flowchart-only rewrite boundary

## Which Part Matters For Which Request

Use this checklist to decide what part of the file matters most:

- naming / document identity:
  - focus on `# Project Name`
- overview / brief:
  - focus on `## Summary`
- graph structure / nodes / relationships / grouping:
  - focus on the Mermaid block in `## Diagram`
- notes / freeform user content / pinned additional information window:
  - focus on `## Content`
- layout / viewport / pinned card geometry / editor restore behavior:
  - focus on `lths-compat`

If the request is about meaning, wording, or documentation quality:
- prioritize `Project Name`, `Summary`, `Content`, node titles, node descriptions, edge labels

If the request is about topology or graph editing:
- prioritize the Mermaid `flowchart` block

If the request is about editor feel or persistence:
- prioritize `lths-compat`

## Do / Don't

Do:
- preserve the top-level section order
- preserve regular Markdown in `## Content`
- preserve source-only Mermaid when the diagram type is not `flowchart` / `graph`
- keep node IDs stable and Mermaid-safe
- keep labels readable and user-facing

Don't:
- rewrite a non-flowchart Mermaid block into a flowchart unless explicitly requested
- invent removed sections such as `Node Annotations`
- put private editor metadata into Mermaid labels
- drop the final `lths-compat` block when editor state must survive

## Examples

Open only what you need:
- [references/file-structure.md](references/file-structure.md): exact file layout
- [references/diagram-rules.md](references/diagram-rules.md): Mermaid node/edge/subgraph conventions
- [references/examples.md](references/examples.md): canonical `.lmd` examples and bad/good patterns

## Quick Decision Policy

- Need to answer "what is this file?" -> read `references/file-structure.md`
- Need to generate or repair Mermaid -> read `references/diagram-rules.md`
- Need examples or prompt snippets -> read `references/examples.md`
