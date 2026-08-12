/**
 * Stable Mermaid-safe node IDs for LMD: `{title_base}_{short_hash}`.
 */
const ENTITY_ID_BASE_PATTERN = /[\p{L}\p{N}_:-]+/gu;
const ENTITY_ID_WITH_CODE_PATTERN = /^(.*)_([a-z0-9]{3,6})$/i;

function hashString(value: string) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function normalizeEntityIdBase(value: string) {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '_');
  const matches = normalized.match(ENTITY_ID_BASE_PATTERN) ?? [];
  const base = matches
    .join('_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!base) {
    return 'node';
  }

  return /^\d/.test(base) ? `n_${base}` : base;
}

export function extractEntityIdCode(value: string) {
  const match = value.match(ENTITY_ID_WITH_CODE_PATTERN);
  return match?.[2]?.toLowerCase() ?? null;
}

export function deriveEntityTitleFromId(value: string) {
  const match = value.match(ENTITY_ID_WITH_CODE_PATTERN);
  if (!match) {
    return null;
  }

  return match[1].replace(/_/g, ' ').trim() || null;
}

function createEntityIdCode(seed: string) {
  return hashString(seed).toString(36).padStart(3, '0').slice(0, 3);
}

export function buildEntityIdFromTitle(
  title: string,
  usedIds: Set<string>,
  preserveCurrentId?: string,
) {
  const safeTitle = normalizeEntityIdBase(title || '未命名内容');
  const currentCode = preserveCurrentId ? extractEntityIdCode(preserveCurrentId) : null;
  const preferredCode = currentCode ?? createEntityIdCode(safeTitle);
  let candidate = `${safeTitle}_${preferredCode}`;

  if (!usedIds.has(candidate) || candidate === preserveCurrentId) {
    return candidate;
  }

  let salt = 1;
  while (salt < 10000) {
    candidate = `${safeTitle}_${createEntityIdCode(`${safeTitle}:${salt}`)}`;
    if (!usedIds.has(candidate) || candidate === preserveCurrentId) {
      return candidate;
    }
    salt += 1;
  }

  return `${safeTitle}_${Math.random().toString(36).slice(2, 5)}`;
}
