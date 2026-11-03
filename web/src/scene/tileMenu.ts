// Right-click (mouse) and long-press (touch) open the order menu on a tile. A long-press
// swallows the click that follows it, so the tile isn't also selected.
import type { ThreeEvent } from '@react-three/fiber';

const LONG_PRESS_MS = 450;

export function tileMenuHandlers(onMenu: ((i: number) => void) | undefined, toIndex: (instanceId: number) => number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  return {
    onContextMenu(e: ThreeEvent<MouseEvent>) {
      if (e.instanceId == null || !onMenu) return;
      e.stopPropagation();
      e.nativeEvent.preventDefault();
      onMenu(toIndex(e.instanceId));
    },
    onPointerDown(e: ThreeEvent<PointerEvent>) {
      fired = false;
      if (e.pointerType !== 'touch' || e.instanceId == null || !onMenu) return;
      const i = toIndex(e.instanceId);
      cancel();
      timer = setTimeout(() => { fired = true; timer = null; onMenu(i); }, LONG_PRESS_MS);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    /** True (once) if the click about to run ends a long-press. */
    swallowClick() {
      const f = fired;
      fired = false;
      return f;
    },
  };
}
