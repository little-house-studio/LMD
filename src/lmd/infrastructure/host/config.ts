import type { CanvasPolicy } from '../../domain/canvasPolicy';

export type HostConfig = {
  platform: 'web' | 'vscode';
  initialMarkdown?: string;
  /** Sibling `.lths` presentation text (same stem as the `.lmd`). */
  initialMeta?: string;
  fileName?: string;
  /** Embedder canvas contract. Omitted fields use DEFAULT_CANVAS_POLICY. */
  canvas?: Partial<CanvasPolicy>;
};

export function readHostConfig(): HostConfig {
  const config = (window as Window & { __LMD_EDITOR_CONFIG__?: HostConfig }).__LMD_EDITOR_CONFIG__;
  if (!config || typeof config !== 'object') {
    return { platform: 'web' };
  }
  return {
    platform: config.platform === 'vscode' ? 'vscode' : 'web',
    initialMarkdown: typeof config.initialMarkdown === 'string' ? config.initialMarkdown : undefined,
    initialMeta: typeof config.initialMeta === 'string' ? config.initialMeta : undefined,
    fileName: typeof config.fileName === 'string' ? config.fileName : undefined,
    canvas: config.canvas && typeof config.canvas === 'object' ? config.canvas : undefined,
  };
}

export function fallbackNameFromFile(fileName?: string) {
  if (!fileName) {
    return 'LMD Project';
  }
  return fileName.replace(/\.(lmd|lths|md)$/i, '') || 'LMD Project';
}
