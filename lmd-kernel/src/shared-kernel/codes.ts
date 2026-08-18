export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';
export type FixSafety = 'safe' | 'suggest' | 'interactive' | 'unsafe';

export type LmdDiagnosticCode =
  | 'LMD001'
  | 'LMD002'
  | 'LMD101'
  | 'LMD110'
  | 'LMD120'
  | 'LMD130'
  | 'LMD201'
  | 'LMD202'
  | 'LMD301'
  | 'LMD310'
  | 'LMD700'
  | 'LMD801'
  | 'LMD900'
  | 'LMD901';

export interface DiagnosticCodeMeta {
  code: LmdDiagnosticCode;
  severity: DiagnosticSeverity;
  summary: string;
  fix?: FixSafety;
}

export const LMD_DIAGNOSTIC_META: Record<LmdDiagnosticCode, DiagnosticCodeMeta> = {
  LMD001: { code: 'LMD001', severity: 'error', summary: '文档无法解析' },
  LMD002: { code: 'LMD002', severity: 'error', summary: '缺少 Diagram / mermaid 块' },
  LMD101: { code: 'LMD101', severity: 'error', summary: '节点 ID 重复' },
  LMD110: {
    code: 'LMD110',
    severity: 'error',
    summary: '边引用了不存在的端点',
    fix: 'suggest',
  },
  LMD120: { code: 'LMD120', severity: 'error', summary: '分组父子关系成环' },
  LMD130: { code: 'LMD130', severity: 'error', summary: '分组父级不存在' },
  LMD201: { code: 'LMD201', severity: 'warning', summary: '存在画布无法渲染的 Mermaid 行' },
  LMD202: { code: 'LMD202', severity: 'warning', summary: '图类型仅源码保留，画布不改写' },
  LMD301: {
    code: 'LMD301',
    severity: 'warning',
    summary: '项目名为空',
    fix: 'safe',
  },
  LMD310: { code: 'LMD310', severity: 'warning', summary: '节点 ID 不含稳定后缀' },
  LMD700: { code: 'LMD700', severity: 'error', summary: '运行时未启用或能力未授权' },
  LMD801: { code: 'LMD801', severity: 'info', summary: '布局后端未注册' },
  LMD900: { code: 'LMD900', severity: 'error', summary: '未知命令' },
  LMD901: { code: 'LMD901', severity: 'error', summary: '命令参数无效' },
};

export function diagnosticMessage(code: LmdDiagnosticCode, detail?: string) {
  const summary = LMD_DIAGNOSTIC_META[code].summary;
  return detail ? `${summary}：${detail}` : summary;
}
