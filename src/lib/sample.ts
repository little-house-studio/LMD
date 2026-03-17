export const sampleSource = `flowchart LR
  Brief[产品说明]
  Review{评审完成?}
  Draft[[空间草稿]]
  API[(接口层)]
  Docs([源码模式])
  Ship((发布))

  subgraph Team_Editor["编辑器工作区"]
    Canvas[画布模式]
    Source[源码模式]
  end

  Brief --> Review
  Review -->|通过| Draft
  Review -.->|需修改| Brief
  Draft --> Canvas
  Draft --> Source
  Canvas --> API
  Source --> API
  API ==> Docs
  Docs --> Ship

  style Brief fill:#fff7db,stroke:#d97706,color:#412000
  style Review fill:#e4f0ff,stroke:#1d4ed8,color:#0b1324
  style Draft fill:#d8fff0,stroke:#0f766e,color:#042f2e
  style Canvas fill:#ffe7d4,stroke:#c2410c,color:#431407
  style Source fill:#f2ecff,stroke:#6d28d9,color:#2e1065
  style API fill:#dff6ff,stroke:#0369a1,color:#082f49
  style Docs fill:#f2f5f9,stroke:#64748b,color:#0f172a
  style Ship fill:#ffe3ea,stroke:#be123c,color:#4c0519
`;
