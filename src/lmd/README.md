# LMD 编辑器（`src/lmd`）

协议内核在 `lmd-kernel/`（`@lths/lmd`）。这里是画布与宿主壳，按 DDD 分层。

```
shared/            跨层几何（Rect / Vec2 / 曲线）
domain/            标签、ID、选择、样式、画布端口类型
placement/         ★ 位置算法（连线/往返/标签夹取/组框/节点分栏）
application/       用例：editing / io / layout / ui
infrastructure/    宿主、布局求解、热路径、持久化、内核适配、格式兼容
presentation/      壳 / Canvas2D / 属性栏 / 遗留 React Flow
tests/             冒烟、热路径、分层检查
index.ts           组合根：对外 re-export 格式 API
```

依赖方向：`presentation → application / infrastructure / placement / domain`。  
`placement` 只引用 `shared` / `domain`，禁止引用 presentation。  
`domain` 不引用 application / infrastructure / presentation。  
`application` 与 `infrastructure` 不引用 presentation。

位置算法说明见 `placement/README.md`。改绘制时不要把几何写回 `engine.ts`。  
以后构建时若发现还能解耦，就继续拆成低耦高内聚的小模块，而不是加厚现有大文件。

画布只通过 `CanvasEditingPort` 改文档，禁止 import `FlowApp`。  
关系文件走 `@lths/lmd` 的 `parseLmd` / `printLmd`；`@lths/lmd/legacy` 只给旧 Markdown 兼容。

## 宿主嵌入（`runtime.ts`）

画布是可嵌入库，不是单一应用。宿主只配 `CanvasPolicy`，不要再加第二套布局开关。

| 字段 | 默认 | 含义 |
|------|------|------|
| `mode` | `free` | 自由拖拽并落盘坐标；`derived` 才锁坐标、打开即重算 |
| `snap.size` / `major` | 16 / 48 | 磁贴网格；拖、方向键、整理后的落点都吸附 |
| `tools.organize` | true | 整理 = 结构求解（量宽 + 嵌套组紧凑块） |
| `tools.frames` | true | 形状框 |

打开时：同名 `.lths`（或旧文件里的 `lths-compat`）没有节点坐标就整理一次；有坐标则保持。之后只在点「整理」或 `layout.tidy` 时重排。  
关系文件是指令语言（`@project` / `# 关系`）；旧 Markdown+Mermaid 打开即迁移。菜单可导入/导出 Mermaid，PNG 仍走画布。  
`window.__LMD_EDITOR_CONFIG__.canvas` 可覆盖政策。内核 `layout.tidy` / `layout.auto` 同一套整理。
