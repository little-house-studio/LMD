/**
 * Bounded contexts and allowed inter-context imports.
 * Enforced by `src/layering.test.ts`.
 */
export const LMD_CONTEXTS = [
  'shared-kernel',
  'document',
  'display',
  'diagnostics',
  'editing',
  'layout',
  'runtime',
  'plugin',
  'composition',
] as const;

export type LmdContext = (typeof LMD_CONTEXTS)[number];

export const LMD_CONTEXT_IMPORTS: Record<LmdContext, readonly LmdContext[] | '*'> = {
  'shared-kernel': [],
  document: ['shared-kernel'],
  display: ['shared-kernel', 'document'],
  diagnostics: ['shared-kernel', 'document'],
  editing: ['shared-kernel', 'document', 'diagnostics', 'display'],
  layout: ['shared-kernel', 'document'],
  runtime: ['shared-kernel', 'document', 'diagnostics'],
  plugin: ['shared-kernel', 'document', 'editing', 'diagnostics', 'runtime'],
  composition: '*',
};

export const DDD_LAYERS = ['domain', 'application', 'infrastructure'] as const;
export type DddLayer = (typeof DDD_LAYERS)[number];

const LAYER_RANK: Record<DddLayer, number> = {
  domain: 0,
  application: 1,
  infrastructure: 2,
};

/** Domain cannot import application/infrastructure. Other intra-context layers may. */
export function canImportLayer(from: DddLayer | null, to: DddLayer | null) {
  if (!from || !to) {
    return true;
  }
  if (from === 'domain') {
    return to === 'domain';
  }
  return LAYER_RANK[to] >= 0;
}
