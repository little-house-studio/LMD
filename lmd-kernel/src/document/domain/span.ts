export interface SourceSpan {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export const UNKNOWN_SPAN: SourceSpan = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
};
