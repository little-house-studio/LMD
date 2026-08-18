# LTHS_MD — Agent Instructions

Mermaid spatial editor. pnpm monorepo with one VS Code custom-editor extension and a browser UI.

## Packages

| Path | Product | Files | Role |
|------|---------|-------|------|
| repo root | **LMD_EDITER** | `*.lmd` | Mermaid flowchart canvas + project Markdown |
| `lmd-kernel/` | **@lths/lmd** | protocol | LMD spec / IR / parse / commands / SDK（无 UI） |

## Canvas runtime (Canvas2D Stage — Project Graph style)

- **Engine:** self-hosted Canvas2D in `src/lmd/presentation/canvas/` (not React Flow / DOM nodes)
- **Entry:** `src/main.tsx` → `src/lmd/presentation/shell/FlowApp.tsx` → `StageCanvas`
- **Stage modules:** `presentation/canvas/engine.ts` (rAF tick, camera, cull, hit-test, drag)
- **Placement:** `src/lmd/placement/` — edge/group/label/node-band geometry; do not reimplement in `engine.ts`
- **Shell:** `application/editing`, `presentation/inspector/InspectorPanel`
- **LMD protocol kernel:** `lmd-kernel/` (`@lths/lmd`) — spec, IR, parse, diagnostics, commands
- **LMD editor:** `src/lmd/` — DDD layers (domain / application / infrastructure / presentation)
- **Hydration:** only when `externalRevision` bumps (open / sample / undo / inspector). Canvas commits must **not** remount stage.
- **Paint rule:** single canvas; view-cull off-screen; mutate working doc during drag; commit on pointer-up
- **Legacy RF code:** `src/lmd/presentation/legacy-rf/` kept for reference only

- Package manager: **pnpm** only (`packageManager` pinned in root `package.json`).
- Workspace: `pnpm-workspace.yaml` includes `lmd-kernel`.
- Root app is the LMD editor; protocol kernel is `@lths/lmd`.

## Commands

```bash
# Root (LMD)
pnpm install
pnpm dev                    # Vite http://127.0.0.1:5280/
pnpm run dev:vscode         # Vite webview + tsc watch for extension host
pnpm run build:vscode       # dist/ webview + out/extension.cjs
pnpm run package:vsix       # LMD_EDITER.vsix
pnpm lint
pnpm run test:kernel        # @lths/lmd protocol kernel
pnpm run test:hotpath       # sceneHotPath + layout unit tests
pnpm run stress:hotpath     # perf stress scripts
```

VS Code extension debug: launch **Run LMD_EDITER** (F5). Dev mode expects `LMD_EDITER_WEBVIEW_DEV_SERVER=http://127.0.0.1:5280`. Extension host changes (`extension-src/extension.cts`) need host reload; webview UI hot-reloads under `dev:vscode`.

## Layout Map

```
lmd-kernel/                 # ★ LMD protocol kernel (@lths/lmd), DDD contexts
  shared-kernel / document / display / diagnostics / editing / layout / runtime / plugin / composition
  compat/                   # 旧子路径门面（legacy / spec / ir …）
src/lmd/                    # LMD editor（打开即见 DDD 层）
  shared/ domain/ placement/ application/ infrastructure/ presentation/ tests/
src/lib/                    # Compat re-exports for legacy App.tsx
src/App.tsx                 # Legacy monolith (reference)
src/main.tsx                # Browser bootstrap → presentation/shell/FlowApp

extension-src/extension.cts # VS Code custom editor host (LMD)
skills/lmd-protocol/        # Authoritative LMD file-format skill + references
scripts/                    # dist prep, perf stress/benchmark
```

## LMD Format (critical)

When reading, writing, or validating `.lmd` files, follow `skills/lmd-protocol/` (and its `references/`).

A project is **two sibling files** (`foo.lmd` + `foo.lths`, same stem, same folder). Opening the editor creates `.lths` if it is missing.

Canonical `.lmd` is the instruction language (`@project` / `# 关系` / `# 笔记`). Sibling `.lths` (JSON `v: 1`) holds viewport, node `x/y/width/height`, colors, group collapse, extras.

```text
@project:"项目名"[@comment:"摘要"]

# 关系
@group:"组"[@members:("A","B")]
"A" -> |"标签"| "B"

# 笔记
自由 Markdown，不自动变节点。
```

Rules of thumb:

- Print only the canonical forms (`@group`, one edge per line, `@comment`). `@groud` / `@subbranch` / `<-` are parse aliases.
- Display names live in quotes; kernel ids stay `buildEntityIdFromTitle` and key `.lths`.
- Semantic content never moves into `.lths`. Layout-only work updates `.lths`.
- Mermaid is import/export only (`printMermaid` / open mermaid). Old Markdown+Mermaid `.lmd` migrates on open.
- Sequence lives in `# 时序` / `@seq`. Participants are inferred from `>>` / `<<` endpoints; do not require `@actor` lines.
- Mind maps live in `# 思维导图` / `@mind`. The title is the root; children use 2-space indent. Markdown lists are read aliases. Position goes in `.lths` extras.`mindFrames`.
- `@ai` / `@cli` / `@plugin` are preserved as unsupported lines and are not executed.

Parse/serialize: `@lths/lmd` (`openLmd` / `printLmd` / `printLmdMeta` / `printMermaid`).

## Architecture Notes

- **Text source of truth**: LMD is a sibling pair (`.lmd` relation + `.lths` presentation). Do not invent extra sidecar formats.
- **Hot path**: continuous pan/zoom/drag must not commit full document state every frame. Live viewport stays separate from topology; see `sceneHotPath.ts` and existing counters in tests.
- **VS Code vs browser**: plugin builds strip AI, cloud collab, and some file-management UI. Prefer feature flags / env checks over forking whole trees.
- **Deploy**: static assets only (`base: './'`). Build on a strong machine; deploy `dist/`. Do not put Mermaid layout/render on weak server hardware (e.g. RK3366).
- **React**: functional components + hooks; TypeScript strict enough for existing configs. Prefer pure helpers in `src/lib/` over growing `App.tsx` further when adding logic.

## Coding Conventions

- Language: TypeScript / TSX; ESM (`"type": "module"`).
- Indentation and style: match surrounding files (2-space, existing naming).
- Prefer `const`; avoid unnecessary abstractions.
- **低耦高内聚**：构建时发现可独立的算法/规则，就拆到自己的文件或目录（参考 `src/lmd/placement/`）。画布与壳只调用，不重写几何。旧路径只许 re-export。
- Do not commit generated `dist/`, `out/`, `*.vsix`, or `node_modules/`.
- Tests: hot-path unit tests are plain `tsx` scripts (`*.test.ts`), not a full Jest/Vitest suite. Keep them fast and counter-based where the existing pattern does.
- Lint: `pnpm lint` (ESLint flat config + react-hooks).

## Product Boundaries

- Editor is primarily a **tool**; external AI/agent control is via clean text + APIs, not embedding a permanent AI runtime in the core canvas path.
- `自定义新框架/` is design notes for a future plugin system — not production code. Do not assume those APIs exist unless implementing them.
- PRD (`需求文档.md`) is useful context but can lag; prefer code + `skills/lmd-protocol/` for format truth.

## When Changing Behavior

1. Prefer pure functions in `lmd-kernel/` / `src/lmd/placement/` / `src/lmd/` with unit coverage for parse, serialize, placement, and hot path. Document mutations should go through `LmdCommand` when touching kernel-level behavior. If a change reveals a mixed-in algorithm, extract it before adding more behavior.
2. Preserve `@project` / `# 关系` / `# 笔记` in `.lmd` and keep presentation in the sibling `.lths` when round-tripping.
3. Do not put private coordinates or editor metadata inside the relation language.
4. After interaction/perf work, run `pnpm run test:hotpath` (and stress scripts if touching pan/zoom/cull).
5. Extension messaging: keep webview ↔ host protocol backward-compatible unless you bump and update both sides.
