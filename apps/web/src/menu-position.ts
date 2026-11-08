export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

const MARGIN = 4;

/** Where a fixed-position menu goes: right edge aligned to the trigger's right edge, below it, flipped above when it would pass the viewport bottom and there is room above, then clamped inside the viewport with a 4 px margin. */
export function placeMenu(
  trigger: Rect,
  menu: Size,
  viewport: Size,
  gap = 4,
): { left: number; top: number } {
  let left = trigger.right - menu.width;
  let top = trigger.bottom + gap;

  if (top + menu.height > viewport.height - MARGIN) {
    const above = trigger.top - gap - menu.height;
    if (above >= MARGIN) top = above;
  }

  const maxLeft = viewport.width - menu.width - MARGIN;
  const maxTop = viewport.height - menu.height - MARGIN;
  left = maxLeft < MARGIN ? MARGIN : Math.min(Math.max(left, MARGIN), maxLeft);
  top = maxTop < MARGIN ? MARGIN : Math.min(Math.max(top, MARGIN), maxTop);

  return { left, top };
}
