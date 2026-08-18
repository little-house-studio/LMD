/**
 * Canonical sample LMD / Mermaid fixtures for the interpreter and editor shell.
 */
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

  style 产品说明_a7c fill:#121214,stroke:#d6ff3a,color:#f4f4f5
  style 评审完成_p4k fill:#1a1808,stroke:#ffe600,color:#fff8c8
  style 空间草稿_q9m fill:#0e1a14,stroke:#00f0ff,color:#e8fffb
  style 画布模式_c1d fill:#1a0a12,stroke:#ff2a6d,color:#ffe0ea
  style 源码模式_s8k fill:#140e1c,stroke:#c77dff,color:#f3e8ff
  style 接口层_h2r fill:#10160c,stroke:#7cff6b,color:#e8ffe4
  style 源码模式_m7n fill:#0a0a0c,stroke:#f4f4f5,color:#f4f4f5
  style 发布_v3x fill:#1a100a,stroke:#ff6b2c,color:#ffe8d8
`;

export const sampleLegacyProjectMarkdown = `# Product Graph Workspace

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

export const sampleProjectMarkdown = `@project:"Product Graph Workspace"[@comment:"Internal collaborative workspace for product graphs and structured outlines."]

# 关系
@group:"编辑器工作区"[@members:("画布模式","源码模式#2")]
"产品说明" -> "评审完成"
"评审完成" -> |"通过"| "空间草稿"
"评审完成" -> |"需修改"| "产品说明"
"空间草稿" -> "画布模式"
"空间草稿" -> "源码模式#2"
"画布模式" -> "接口层"
"源码模式#2" -> "接口层"
"接口层" -> "源码模式"
"源码模式" -> "发布"
@node:"产品说明"[@comment:"整理需求与范围"]
@node:"评审完成"[@comment:"通过"]
@node:"空间草稿"[@comment:"本地整理与布局实验"]
@node:"接口层"[@comment:"对外接口与同步层"]
@node:"源码模式"[@comment:"原始文本查看"]
@node:"发布"[@comment:"输出结果"]
@node:"画布模式"[@comment:"可视化编辑"]
@node:"源码模式#2"[@comment:"文本源码查看"]

# 时序
@seq:"打开画布"(
  "作者" >> |"打开 .lmd"| "编辑器"
  "编辑器" >> |"解析"| "内核"
  "内核" << |"IR"| "编辑器"
  "编辑器" << |"画布"| "作者"
  @alt:"旧 Mermaid"(
    "编辑器" >> |"迁移"| "内核"
    "内核" << |"新语言"| "编辑器"
  )
)

# 思维导图
@mind:"项目路径"(
  "src"[@comment:"业务代码"]
  "core"[@comment:"核心引擎"]
    "audio"
    "video"
    "canvas"[@comment:"画布"]
  "asset"
)

# 笔记
- This area is regular Markdown content.
- The canvas editor will not rewrite this content.
`;

export const defaultStressTestProjectOptions = {
  groupCount: 100,
  nodesPerGroup: 10,
} as const;

export const defaultStressTestProjectLabel = `${defaultStressTestProjectOptions.groupCount * defaultStressTestProjectOptions.nodesPerGroup} 节点 / ${defaultStressTestProjectOptions.groupCount} 组`;

function clampPositiveInteger(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value ?? fallback));
}

function buildStressTestLmdSource(groupCount: number, nodesPerGroup: number) {
  const lines: string[] = [];
  const groupTitles: string[] = [];
  const groupNodeTitles: string[][] = [];

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const groupTitle = `压力组 ${String(groupIndex + 1).padStart(3, '0')}`;
    const nodeTitles: string[] = [];
    for (let nodeIndex = 0; nodeIndex < nodesPerGroup; nodeIndex += 1) {
      nodeTitles.push(`节点 ${String(groupIndex + 1).padStart(3, '0')}-${String(nodeIndex + 1).padStart(2, '0')}`);
    }
    groupTitles.push(groupTitle);
    groupNodeTitles.push(nodeTitles);
    lines.push(`@group:${JSON.stringify(groupTitle)}[@members:(${nodeTitles.map((title) => JSON.stringify(title)).join(',')})]`);
  }

  groupNodeTitles.forEach((nodeTitles, groupIndex) => {
    for (let nodeIndex = 0; nodeIndex < nodeTitles.length - 1; nodeIndex += 1) {
      lines.push(`${JSON.stringify(nodeTitles[nodeIndex])} -> ${JSON.stringify(nodeTitles[nodeIndex + 1])}`);
    }
    const next = groupNodeTitles[groupIndex + 1];
    if (next) {
      lines.push(`${JSON.stringify(nodeTitles[nodeTitles.length - 1])} -> ${JSON.stringify(next[0])}`);
    }
  });

  return lines.join('\n');
}

export function createStressTestProjectMarkdown(options?: {
  groupCount?: number;
  nodesPerGroup?: number;
}) {
  const groupCount = clampPositiveInteger(options?.groupCount, defaultStressTestProjectOptions.groupCount);
  const nodesPerGroup = clampPositiveInteger(options?.nodesPerGroup, defaultStressTestProjectOptions.nodesPerGroup);
  const totalNodes = groupCount * nodesPerGroup;
  const body = buildStressTestLmdSource(groupCount, nodesPerGroup);

  return `@project:"LMD Stress Test Workspace"[@comment:"Synthetic performance workspace with ${totalNodes} nodes and ${groupCount} groups."]

# 关系
${body}

# 笔记
- Generated for canvas performance testing.
- Replace this workspace freely after profiling.
`;
}
