# LMD Architecture (DDD modular monolith)

内核 `@lths/lmd` 与编辑器 `src/lmd` 是两个限界上下文。  
跨上下文只走公开端口；上下文内部再按 domain / application / infrastructure 分层。

## 内核限界上下文

```
shared-kernel     协议版本、ID、诊断码、图元枚举
document          核心域：LmdDocument 聚合（graph / style / layout / exec）
display           通用子域：指令语言解析打印 + Mermaid 导入导出（含 working-model ACL）
diagnostics       支撑：check / fixer
editing           应用：LmdCommand 目录与 dispatch
layout            支撑：布局端口
runtime           支撑：capability，默认拒绝
plugin            支撑：贡献点注册表
composition       组合根：SDK / CLI / adapters / testkit
```

依赖只能指向被允许的上下文。`document.domain` 不能引用 application/infrastructure。  
`src/layering.test.ts` 同时检查上下文边界和 DDD 层。

旧路径 `@lths/lmd/spec` `@lths/lmd/ir` `@lths/lmd/legacy` 仍是兼容门面。

## 编辑器限界上下文（`src/lmd`）

```
shared/            几何等跨模块语言
domain/            标签、ID、选择、样式、CanvasEditingPort
application/       文档用例（editing / io / layout / ui）
infrastructure/    宿主、求解器、热路径、存储、内核适配
presentation/      壳 / Canvas2D / 属性栏 / 遗留 RF
```

画布禁止 import FlowApp。打开 `.lmd` ≠ 同意执行。  
分层由 `src/lmd/tests/layering.test.ts` 检查。

## 数据流

```
.lmd 指令语言 + .lths → display.parse (旧 Mermaid 会迁移)
                      → document.LmdDocument
                      → diagnostics.check
                      → editing.dispatch
                      → display.print / printLmdMeta / printMermaid
```

编辑器工作模型 `GraphDocument` 只活在 display working-model 与 `src/lmd/application/editing`。  
协议真相是 `LmdDocument`。
