# LTHS_MD — Agent Instructions

Mermaid spatial editor + Little House Markmap editor. pnpm monorepo with two VS Code custom-editor extensions and browser UIs.

## Packages

| Path | Product | Files | Role |
|------|---------|-------|------|
| repo root | **LMD_EDITER** | `*.lmd` | Mermaid flowchart canvas + project Markdown |
| `lmp/` | **LMP_EDITER** | `*.lmp` | Tree / markmap outline editor |

## Canvas runtime (Canvas2D Stage — Project Graph style)

- **Engine:** self-hosted Canvas2D in `src/lmd/stage/` (not React Flow / DOM nodes)
- **Entry:** `src/main.tsx` → `src/lmd/FlowApp.tsx` → `StageCanvas`
- **Stage modules:** `src/lmd/stage/engine.ts` (rAF tick, camera, cull, hit-test, drag), `camera.ts`, `math.ts`
- **Shell:** `src/lmd/flow/documentOps.ts`, `InspectorPanel`
- **LMD format + editor:** `src/lmd/` — parse/serialize `.lmd`, Mermaid flowchart, entity IDs, canvas, inspector
- **Hydration:** only when `externalRevision` bumps (open / sample / undo / inspector). Canvas commits must **not** remount stage.
- **Paint rule:** single canvas; view-cull off-screen; mutate working doc during drag; commit on pointer-up
- **Legacy RF code:** `src/lmd/flow/LmdFlowCanvas.tsx` etc. kept for reference only

- Package manager: **pnpm** only (`packageManager` pinned in root `package.json`).
- Workspace: `pnpm-workspace.yaml` includes `lmp`.
- Root app is the LMD product; LMP is a sibling package under `lmp/`.

## Commands

```bash
# Root (LMD)
pnpm install
pnpm dev                    # Vite http://127.0.0.1:5280/
pnpm run dev:vscode         # Vite webview + tsc watch for extension host
pnpm run build:vscode       # dist/ webview + out/extension.cjs
pnpm run package:vsix       # LMD_EDITER.vsix
pnpm lint
pnpm run test:hotpath       # sceneHotPath + layoutCache unit tests
pnpm run stress:hotpath     # perf stress scripts

# LMP
pnpm --dir lmp dev          # Vite port 5174
pnpm --dir lmp run build:vscode
pnpm --dir lmp run package:vsix
```

VS Code extension debug: launch **Run LMD_EDITER** (F5). Dev mode expects `LMD_EDITER_WEBVIEW_DEV_SERVER=http://127.0.0.1:5280`. Extension host changes (`extension-src/extension.cts`) need host reload; webview UI hot-reloads under `dev:vscode`.

## Layout Map

```
src/lmd/                    # ★ all LMD product code
  index.ts                  # Format public API
  types.ts / entityId.ts / mermaid.ts / projectMarkdown.ts / sample.ts
  FlowApp.tsx               # Editor shell
  stage/                    # Canvas2D runtime
  flow/                     # documentOps, inspector, RF legacy
  hotpath/                  # sceneHotPath, canvasEngine
  storage.ts
src/lib/                    # Compat re-exports for legacy App.tsx
src/App.tsx                 # Legacy monolith (reference)
src/main.tsx                # Browser bootstrap → lmd/FlowApp

extension-src/extension.cts # VS Code custom editor host (LMD)
skills/lmd-protocol/        # Authoritative LMD file-format skill + references
lmp/                        # LMP_EDITER sibling package
scripts/                    # dist prep, perf stress/benchmark
```

## LMD Format (critical)

When reading, writing, or validating `.lmd` files, follow `skills/lmd-protocol/` (and its `references/`).

Canonical structure:

1. `# Project Name`
2. `## Summary`
3. `## Diagram` + one fenced `mermaid` block
4. `## Content` (user Markdown; not auto-converted to nodes)
5. Final fenced `lths-compat` block (editor-only: viewport, layout, pinned UI)

Rules of thumb:

- Keep the whole file valid Markdown; keep Mermaid **standard**.
- Canvas rewrite is only for `flowchart` / `graph`. Other diagram types: preserve as source-only.
- Node title lives in the **ID** (`标题_a7c`); Mermaid label holds **description** only.
- Semantic content never moves into `lths-compat`. Layout-only work updates compat, not Mermaid labels.
- Prefer `flowchart LR` for new diagrams unless the file already uses another direction.
- IDs: use `buildEntityIdFromTitle` / `normalizeEntityIdBase`; keep IDs stable across renames when a code suffix exists.

Parse/serialize entry points: `src/lmd/projectMarkdown.ts` + `src/lmd/mermaid.ts`.

## LMP Format

- Source is tree text using box-drawing prefixes (`├──`, `│`, `└──`).
- Optional trailing meta: `<!-- lmp:meta ... -->` (colors, layout mode).
- Logic lives in `lmp/src/lib/outline.ts`; keep parse/serialize round-trip stable.

## Architecture Notes

- **Single-file source of truth**: project state serializes to `.lmd` / `.lmp` text; avoid inventing sidecar file formats.
- **Hot path**: continuous pan/zoom/drag must not commit full document state every frame. Live viewport stays separate from topology; see `sceneHotPath.ts` / `layoutCache.ts` and existing counters in tests.
- **VS Code vs browser**: plugin builds strip AI, cloud collab, and some file-management UI. Prefer feature flags / env checks over forking whole trees.
- **Deploy**: static assets only (`base: './'`). Build on a strong machine; deploy `dist/`. Do not put Mermaid layout/render on weak server hardware (e.g. RK3366).
- **React**: functional components + hooks; TypeScript strict enough for existing configs. Prefer pure helpers in `src/lib/` over growing `App.tsx` further when adding logic.

## Coding Conventions

- Language: TypeScript / TSX; ESM (`"type": "module"`).
- Indentation and style: match surrounding files (2-space, existing naming).
- Prefer `const`; avoid unnecessary abstractions.
- Do not commit generated `dist/`, `out/`, `*.vsix`, or `node_modules/`.
- Tests: hot-path unit tests are plain `tsx` scripts (`*.test.ts`), not a full Jest/Vitest suite. Keep them fast and counter-based where the existing pattern does.
- Lint: `pnpm lint` (ESLint flat config + react-hooks).

## Product Boundaries

- Editor is primarily a **tool**; external AI/agent control is via clean text + APIs, not embedding a permanent AI runtime in the core canvas path.
- `自定义新框架/` is design notes for a future plugin system — not production code. Do not assume those APIs exist unless implementing them.
- PRD (`需求文档.md`) is useful context but can lag; prefer code + `skills/lmd-protocol/` for format truth.

## When Changing Behavior

1. Prefer pure functions in `src/lmd/` / `lmp/src/lib/` with unit coverage for parse, serialize, and hot path.
2. Preserve LMD section order and `lths-compat` when round-tripping.
3. Do not put private coordinates or editor metadata inside Mermaid source.
4. After interaction/perf work, run `pnpm run test:hotpath` (and stress scripts if touching pan/zoom/cull).
5. Extension messaging: keep webview ↔ host protocol backward-compatible unless you bump and update both sides.
