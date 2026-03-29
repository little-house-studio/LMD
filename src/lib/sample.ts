export const sampleMermaidSource = `flowchart LR
  产品说明_a7c["整理需求与范围"]
  评审完成_p4k{"通过"}
  空间草稿_q9m[["本地整理与布局实验"]]
  接口层_h2r[("对外接口与同步层")]
  源码模式_m7n(["原始文本查看"])
  发布_v3x(("输出结果"))

  subgraph Team_Editor["编辑器工作区"]
    画布模式_c1d["可视化编辑"]
    源码模式_s8k["文本源码查看"]
  end

  产品说明_a7c --> 评审完成_p4k
  评审完成_p4k -->|通过| 空间草稿_q9m
  评审完成_p4k -.->|需修改| 产品说明_a7c
  空间草稿_q9m --> 画布模式_c1d
  空间草稿_q9m --> 源码模式_s8k
  画布模式_c1d --> 接口层_h2r
  源码模式_s8k --> 接口层_h2r
  接口层_h2r ==> 源码模式_m7n
  源码模式_m7n --> 发布_v3x

  style 产品说明_a7c fill:#fff7db,stroke:#d97706,color:#412000
  style 评审完成_p4k fill:#e4f0ff,stroke:#1d4ed8,color:#0b1324
  style 空间草稿_q9m fill:#d8fff0,stroke:#0f766e,color:#042f2e
  style 画布模式_c1d fill:#ffe7d4,stroke:#c2410c,color:#431407
  style 源码模式_s8k fill:#f2ecff,stroke:#6d28d9,color:#2e1065
  style 接口层_h2r fill:#dff6ff,stroke:#0369a1,color:#082f49
  style 源码模式_m7n fill:#f2f5f9,stroke:#64748b,color:#0f172a
  style 发布_v3x fill:#ffe3ea,stroke:#be123c,color:#4c0519
`;

export const sampleProjectMarkdown = `# Product Graph Workspace

## Summary

Internal collaborative Mermaid workspace for product graphs and structured outlines.

## Diagram
\`\`\`mermaid
${sampleMermaidSource}
\`\`\`

## Content

- This area is regular Markdown content.
- The canvas editor will not rewrite this content.

\`\`\`lths-compat
v1
\`\`\`
`;
