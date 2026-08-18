export function placeMenuAroundAnchor(
  anchor: { x: number; y: number; width: number; height: number },
  menu: { width: number; height: number },
  view: { width: number; height: number },
) {
  const pad = 10;
  const topReserve = 56;
  const bottomReserve = 88;
  const gap = 12;
  let left = anchor.x + anchor.width / 2 - menu.width / 2;
  left = Math.min(Math.max(pad, left), Math.max(pad, view.width - menu.width - pad));
  const above = anchor.y - menu.height - gap;
  const below = anchor.y + anchor.height + gap;
  let top = above;
  let side: 'above' | 'below' | 'right' = 'above';
  if (above >= topReserve) {
    top = above;
    side = 'above';
  } else if (below + menu.height <= view.height - bottomReserve) {
    top = below;
    side = 'below';
  } else {
    side = 'right';
    left = Math.min(anchor.x + anchor.width + gap, Math.max(pad, view.width - menu.width - pad));
    top = Math.min(
      Math.max(topReserve, anchor.y),
      Math.max(topReserve, view.height - menu.height - bottomReserve),
    );
  }
  const caret = Math.min(
    Math.max(16, anchor.x + anchor.width / 2 - left),
    Math.max(16, menu.width - 16),
  );
  return { left, top, side, caret };
}
