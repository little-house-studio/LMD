# LMD (`src/lmd`)

`.lmd` 产品模块：格式解释器 + Canvas2D 编辑器。与 `lmp/` 一样，LMD 相关代码集中在这一棵目录里。

## 目录

```
src/lmd/
  index.ts                 # 格式公共 API
  types.ts / entityId.ts / mermaid.ts / projectMarkdown.ts / sample.ts
  FlowApp.tsx              # 编辑器壳
  stage/                   # Canvas2D 舞台
  flow/                    # 文档操作、属性栏、（遗留 RF）
  hotpath/                 # 视口/裁剪热路径
  storage.ts               # localStorage 键
```

协议说明：仓库 `skills/lmd-protocol/`。

## 格式入口

```ts
import {
  parseProjectMarkdown,
  serializeProjectMarkdown,
  standardizeProjectMarkdown,
  parseMermaidDocument,
  serializeMermaidDocument,
  createDefaultLayout,
  buildEntityIdFromTitle,
  type GraphDocument,
} from '../lmd';
```

应用入口：`src/main.tsx` → `src/lmd/FlowApp.tsx` → `stage/StageCanvas`。

## 边界

**格式层负责**

- LMD 顶层 Markdown（Project / Summary / Diagram / Content / `lths-compat`）
- Mermaid `flowchart` / `graph` 解析与回写
- 稳定节点 ID、布局 sidecar、样例

**编辑器层负责**

- Canvas2D 绘制与交互
- 工具栏 / 属性栏 / VS Code 桥

`src/lib/{types,entityId,mermaid,projectMarkdown,sample,sceneHotPath,canvasEngine,storage}.ts` 仍是薄 re-export，给旧 `App.tsx` 用。新代码直接依赖 `src/lmd`。
