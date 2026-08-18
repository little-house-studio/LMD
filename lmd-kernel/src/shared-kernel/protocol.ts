/** LMD protocol identity. Independent from presentation metadata version. */

export const LMD_PROTOCOL_NAME = 'lmd' as const;
export const LMD_PROTOCOL_VERSION = 1 as const;

export type LmdProtocolVersion = typeof LMD_PROTOCOL_VERSION;

export interface LmdProtocolStamp {
  name: typeof LMD_PROTOCOL_NAME;
  version: LmdProtocolVersion;
}

export const LMD_PROTOCOL: LmdProtocolStamp = {
  name: LMD_PROTOCOL_NAME,
  version: LMD_PROTOCOL_VERSION,
};

export const LMD_MEDIA_TYPE = 'text/x-lmd';
export const LMD_FILE_SUFFIX = '.lmd';
/** Sibling presentation file: `foo.lmd` → `foo.lths` (same stem, same folder). */
export const LMD_META_SUFFIX = '.lths';
export const LMD_COMPAT_FENCE = 'lths-compat';

export function siblingMetaPath(lmdPath: string) {
  return lmdPath.replace(/\.lmd$/i, '') + LMD_META_SUFFIX;
}
