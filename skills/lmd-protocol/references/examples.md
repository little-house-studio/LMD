# Examples

## Example 1: Minimal Valid LMD

````md
# Product Graph Workspace

## Summary

Internal collaborative Mermaid workspace for product graphs and structured outlines.

## Diagram
```mermaid
flowchart LR
  产品说明_a7c["整理需求与范围"]
  评审完成_p4k["通过"]
  评审完成_q9m["需修改"]

  产品说明_a7c -->|通过| 评审完成_p4k
  产品说明_a7c -->|需修改| 评审完成_q9m
```

## Content

- This area is regular Markdown content.
- The canvas editor should not rewrite this content into nodes unless explicitly requested.

```lths-compat
v1;vp=120,90,1
```
````

## Example 2: Grouped Flowchart

````md
# Editor Workspace

## Summary

One group feeds another.

## Diagram
```mermaid
flowchart LR
  subgraph 编辑器工作区_g01["编辑器工作区"]
    画布模式_3mh["主编辑画布"]
    源码模式_16l["文本源码查看"]
  end

  草稿入口_7pk["输入与草稿"]
  接口层_p4k["服务接入"]

  草稿入口_7pk --> 画布模式_3mh
  草稿入口_7pk --> 源码模式_16l
  画布模式_3mh --> 接口层_p4k
  源码模式_16l --> 接口层_p4k
```

## Content

附加说明写在这里。

```lths-compat
v1;vp=-220,140,0.92
```
````

## Example 3: Source-Only Mermaid

This is valid in LMD, but should be preserved as source rather than rewritten by graph tools:

````md
# Runtime Types

## Summary

Source-only class diagram.

## Diagram
```mermaid
classDiagram
  class Engine {
    +init() void
    +next() int16_t
  }
```

## Content

This file uses a Mermaid type outside the canvas-editable scope.

```lths-compat
v1;vp=120,90,1
```
````

## Bad Patterns

Avoid these:

```mermaid
flowchart LR
  N1["标题<br/>详细"]
```

Reason:
- weak semantic ID
- harder for tooling and AI to read

Also avoid:

```mermaid
flowchart LR
  评审完成__R02__P4K["通过"]
```

Reason:
- too much private structure in the ID
- less readable for humans and AI
