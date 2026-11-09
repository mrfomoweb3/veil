// Spatial focus for menus: d-pad / stick / arrows move to the nearest control in that
// direction, select activates it, back leaves it. No per-screen wiring.
import { onAction, type Dir } from './actions';
import { useInput } from './inputMode';

const FOCUSABLE = 'button:not([disabled]), [role="button"], input[type="range"], select, a[href], [data-focus]';

function layerRoot(): ParentNode {
  // The topmost layer wins: a modal, then a pause menu, else the document.
  return document.querySelector('.modal, .pause-menu') ?? document;
}

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden';
}

export function focusables(root: ParentNode = layerRoot()): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

/** Nearest element in direction `dir` from `from` (by rect centres, favouring alignment). */
export function nearest(from: DOMRect, dir: Dir, candidates: { el: HTMLElement; r: DOMRect }[]) {
  const cx = from.left + from.width / 2, cy = from.top + from.height / 2;
  let best: HTMLElement | null = null, bestScore = Infinity;
  for (const { el, r } of candidates) {
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const dx = x - cx, dy = y - cy;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 4) continue;
    const score = along + across * 2.2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

export function uiHasFocus() {
  const a = document.activeElement as HTMLElement | null;
  return !!a && a !== document.body && a.matches(FOCUSABLE) && visible(a);
}

/** Move focus into a region (e.g. the orders panel), preferring its primary button. */
export function focusInto(selector: string) {
  const root = document.querySelector(selector);
  if (!root) return false;
  const els = focusables(root);
  const el = els.find((e) => e.classList.contains('primary') || e.classList.contains('play-btn')) ?? els[0];
  el?.focus();
  return !!el;
}

function stepRange(el: HTMLInputElement, dir: 1 | -1) {
  const step = Number(el.step) || 1;
  const v = Math.max(Number(el.min || 0), Math.min(Number(el.max || 100), Number(el.value) + dir * step));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function startFocusManager() {
  return onAction((a) => {
    const st = useInput.getState();
    if (st.mode !== 'gamepad' && st.mode !== 'keyboard') return;
    // With a board on screen, menus only take input once focus is inside them.
    const engaged = uiHasFocus() || !st.boardActive || !!document.querySelector('.modal, .pause-menu');
    if (!engaged) return;
    const active = document.activeElement as HTMLElement | null;
    if (a.type === 'uiNav') {
      if (active instanceof HTMLInputElement && active.type === 'range' && (a.dir === 'left' || a.dir === 'right') && uiHasFocus()) {
        return stepRange(active, a.dir === 'left' ? -1 : 1);
      }
      const all = focusables();
      if (!uiHasFocus() || !all.includes(active as HTMLElement)) {
        const first = all.find((e) => e.classList.contains('play-btn') || e.classList.contains('primary')) ?? all[0];
        return first?.focus();
      }
      const others = all.filter((e) => e !== active).map((el) => ({ el, r: el.getBoundingClientRect() }));
      nearest(active!.getBoundingClientRect(), a.dir, others)?.focus();
    } else if (a.type === 'select' && uiHasFocus()) {
      // Pad A/Cross and keyboard Enter/Space both land here. The keyboard handler cancels the
      // browser's own Enter/Space click (so nothing fires twice), so this is the one click.
      active?.click();
    } else if (a.type === 'back' && uiHasFocus() && st.boardActive) {
      active?.blur();
    }
  });
}
