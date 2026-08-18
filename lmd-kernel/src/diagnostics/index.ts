export type { Diagnostic, DiagnosticFix, DiagnosticRelated, FixMode } from './domain/diagnostic';
export { checkLmd } from './domain/check';
export { applyFixes, collectFixes, fixLmd } from './application/fix';
