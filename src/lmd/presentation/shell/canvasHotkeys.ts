export type CanvasHotkeyContext = {
  typing: boolean;
  helpOpen: boolean;
  mode: 'canvas' | 'source';
  selectionKind: string;
  selectionCount: number;
};

export type CanvasHotkeyAction =
  | { type: 'none' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'copy' }
  | { type: 'paste' }
  | { type: 'zoom-in' }
  | { type: 'zoom-out' }
  | { type: 'zoom-reset' }
  | { type: 'duplicate' }
  | { type: 'group' }
  | { type: 'select-all' }
  | { type: 'connect' }
  | { type: 'save' }
  | { type: 'toggle-help' }
  | { type: 'toggle-inspect' }
  | { type: 'select-tool' }
  | { type: 'hand-tool' }
  | { type: 'toggle-node-menu' }
  | { type: 'create-sequence' }
  | { type: 'create-mind' }
  | { type: 'toggle-outline' }
  | { type: 'search' }
  | { type: 'mode-canvas' }
  | { type: 'mode-source' }
  | { type: 'related'; relation: 'linked' | 'mirrored' | 'sibling' }
  | { type: 'inline-edit' }
  | { type: 'delete' }
  | { type: 'escape' };

export function resolveCanvasHotkey(event: KeyboardEvent, ctx: CanvasHotkeyContext): CanvasHotkeyAction {
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (ctx.helpOpen && event.key !== 'Escape') {
    return { type: 'none' };
  }
  if (ctx.typing) {
    if (mod && key === 'f' && ctx.mode === 'canvas') {
      return { type: 'search' };
    }
    return { type: 'none' };
  }
  if (mod && key === 'z' && !event.shiftKey) {
    return { type: 'undo' };
  }
  if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
    return { type: 'redo' };
  }
  if (mod && key === 'c') {
    return { type: 'copy' };
  }
  if (mod && key === 'v') {
    return { type: 'paste' };
  }
  if (mod && (event.key === '=' || event.key === '+')) {
    return { type: 'zoom-in' };
  }
  if (mod && (event.key === '-' || event.key === '_')) {
    return { type: 'zoom-out' };
  }
  if (mod && event.key === '0') {
    return { type: 'zoom-reset' };
  }
  if (mod && key === 'd') {
    return { type: 'duplicate' };
  }
  if (mod && key === 'g') {
    return { type: 'group' };
  }
  if (mod && key === 'a') {
    return { type: 'select-all' };
  }
  if (mod && key === 'l') {
    return { type: 'connect' };
  }
  if (mod && key === 's') {
    return { type: 'save' };
  }
  if (mod && key === '/') {
    return { type: 'toggle-help' };
  }
  if (!mod && key === 'i') {
    return { type: 'toggle-inspect' };
  }
  if (!mod && key === 'v') {
    return { type: 'select-tool' };
  }
  if (!mod && key === 'h') {
    return { type: 'hand-tool' };
  }
  if (!mod && key === 'n') {
    return { type: 'toggle-node-menu' };
  }
  if (!mod && key === 'q') {
    return { type: 'create-sequence' };
  }
  if (!mod && key === 'w') {
    return { type: 'create-mind' };
  }
  if (!mod && (key === '\\' || event.code === 'Backslash')) {
    return { type: 'toggle-outline' };
  }
  if (mod && key === 'f' && ctx.mode === 'canvas') {
    return { type: 'search' };
  }
  if (mod && event.key === '1') {
    return { type: 'mode-canvas' };
  }
  if (mod && (event.key === '2' || key === 'e')) {
    return { type: 'mode-source' };
  }
  if (event.shiftKey && !mod && key === 'e' && ctx.selectionKind !== 'none') {
    return { type: 'mode-source' };
  }
  if (event.key === 'Tab' && ctx.selectionKind === 'node' && ctx.selectionCount > 0) {
    return { type: 'related', relation: event.shiftKey ? 'mirrored' : 'linked' };
  }
  if (event.code === 'Space' && ctx.selectionKind === 'node' && ctx.selectionCount === 1) {
    return { type: 'related', relation: 'sibling' };
  }
  if (event.key === 'Enter' && ctx.selectionKind !== 'none') {
    return { type: 'inline-edit' };
  }
  if (key === 'delete' || key === 'backspace') {
    return ctx.selectionKind !== 'none' ? { type: 'delete' } : { type: 'none' };
  }
  if (key === 'escape') {
    return { type: 'escape' };
  }
  return { type: 'none' };
}
