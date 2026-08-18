import type { LmdDocument } from '../../document/domain/document';
import type { Diagnostic, FixMode } from '../domain/diagnostic';
import { checkLmd } from '../domain/check';

const MODE_RANK: Record<FixMode, number> = {
  safe: 0,
  suggest: 1,
};

export function collectFixes(diagnostics: Diagnostic[], mode: FixMode = 'safe') {
  const allowed = MODE_RANK[mode];
  return diagnostics.filter((item) => {
    if (!item.fix) {
      return false;
    }
    if (item.fix.safety === 'safe') {
      return true;
    }
    return allowed >= MODE_RANK.suggest && item.fix.safety === 'suggest';
  });
}

export function applyFixes(
  document: LmdDocument,
  diagnostics: Diagnostic[],
  mode: FixMode = 'safe',
): { document: LmdDocument; applied: number } {
  let next = document;
  let applied = 0;
  for (const item of collectFixes(diagnostics, mode)) {
    next = item.fix!.apply(next);
    applied += 1;
  }
  return { document: next, applied };
}

export function fixLmd(
  document: LmdDocument,
  mode: FixMode = 'safe',
): { document: LmdDocument; applied: number; diagnostics: Diagnostic[] } {
  const before = checkLmd(document);
  const result = applyFixes(document, before, mode);
  return {
    ...result,
    diagnostics: checkLmd(result.document),
  };
}
