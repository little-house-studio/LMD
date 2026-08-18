import type { GraphDocument } from '../compat/types';
import type { SequenceFrame } from '../../placement/sequence';

export function readSequenceFrames(extras: Record<string, unknown> | undefined): SequenceFrame[] {
  const raw = extras?.sequenceFrames;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const value = entry as Partial<SequenceFrame>;
    if (typeof value.id !== 'string' || !value.id) {
      return [];
    }
    return [{
      id: value.id,
      x: Number(value.x) || 0,
      y: Number(value.y) || 0,
      width: Math.max(0, Number(value.width) || 0),
      height: Math.max(0, Number(value.height) || 0),
    }];
  });
}

export function writeSequenceFrames(document: GraphDocument, frames: SequenceFrame[]): GraphDocument {
  return {
    ...document,
    compat: {
      version: document.compat?.version ?? 1,
      layout: document.compat?.layout ?? document.layout,
      editor: document.compat?.editor,
      extras: {
        ...(document.compat?.extras ?? {}),
        sequenceFrames: frames.map((frame) => ({ ...frame })),
      },
    },
  };
}
