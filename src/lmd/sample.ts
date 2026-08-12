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

function buildStressTestMermaidSource(groupCount: number, nodesPerGroup: number) {
  const lines = ['flowchart LR'];
  const groupIds: string[][] = [];

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const mermaidGroupId = `Stress_Group_${String(groupIndex + 1).padStart(3, '0')}`;
    const groupNodeIds: string[] = [];
    lines.push(`  subgraph ${mermaidGroupId}["压力组 ${String(groupIndex + 1).padStart(3, '0')}"]`);

    for (let nodeIndex = 0; nodeIndex < nodesPerGroup; nodeIndex += 1) {
      const nodeId = `stress_${String(groupIndex + 1).padStart(3, '0')}_${String(nodeIndex + 1).padStart(2, '0')}`;
      groupNodeIds.push(nodeId);
      lines.push(`    ${nodeId}["节点 ${String(groupIndex + 1).padStart(3, '0')}-${String(nodeIndex + 1).padStart(2, '0')}"]`);
    }

    lines.push('  end');
    groupIds.push(groupNodeIds);
  }

  lines.push('');

  groupIds.forEach((groupNodeIds, groupIndex) => {
    for (let nodeIndex = 0; nodeIndex < groupNodeIds.length - 1; nodeIndex += 1) {
      lines.push(`  ${groupNodeIds[nodeIndex]} --> ${groupNodeIds[nodeIndex + 1]}`);
    }

    const nextGroupNodeIds = groupIds[groupIndex + 1];
    if (nextGroupNodeIds) {
      lines.push(`  ${groupNodeIds[groupNodeIds.length - 1]} --> ${nextGroupNodeIds[0]}`);
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
  const mermaidSource = buildStressTestMermaidSource(groupCount, nodesPerGroup);

  return `# LMD Stress Test Workspace

## Summary

Synthetic performance workspace with ${totalNodes} nodes and ${groupCount} groups.

## Diagram
\`\`\`mermaid
${mermaidSource}
\`\`\`

## Content

- Generated for canvas performance testing.
- Replace this workspace freely after profiling.

\`\`\`lths-compat
v1
\`\`\`
`;
}
