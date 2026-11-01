// Keyboard: arrows/WASD move, Enter selects, Esc backs out, Shift+Enter ends the turn.
import { emit, type Dir } from './actions';
import { setMode } from './inputMode';

const MOVE: Record<string, [Dir, number, number]> = {
  ArrowUp: ['up', 0, -1], KeyW: ['up', 0, -1],
  ArrowDown: ['down', 0, 1], KeyS: ['down', 0, 1],
  ArrowLeft: ['left', -1, 0], KeyA: ['left', -1, 0],
  ArrowRight: ['right', 1, 0], KeyD: ['right', 1, 0],
};

export function startKeyboard() {
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing = t && (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const m = MOVE[e.code];
    let handled = true;
    if (m) {
      emit({ type: 'cursorMove', dx: m[1], dy: m[2] });
      emit({ type: 'uiNav', dir: m[0] });
    } else if (e.code === 'Enter' && e.shiftKey) emit({ type: 'endTurn' });
    else if (e.code === 'Enter' || e.code === 'Space') emit({ type: 'select' });
    else if (e.code === 'Escape' || e.code === 'Backspace') emit({ type: 'back' });
    else if (e.code === 'KeyQ') emit({ type: 'cameraRotate', delta: 0.25 });
    else if (e.code === 'KeyE') emit({ type: 'cameraRotate', delta: -0.25 });
    else if (e.code === 'Equal' || e.code === 'KeyR') emit({ type: 'cameraZoom', delta: 6 });
    else if (e.code === 'Minus' || e.code === 'KeyF') emit({ type: 'cameraZoom', delta: -6 });
    else if (e.code === 'BracketLeft') emit({ type: 'cycleUnit', dir: -1 });
    else if (e.code === 'BracketRight') emit({ type: 'cycleUnit', dir: 1 });
    else if (e.code === 'KeyO') emit({ type: 'orderMenu' });
    else if (e.code === 'KeyT') emit({ type: 'cycleOverlay' });
    else if (e.code === 'KeyP') emit({ type: 'pause' });
    else handled = false;
    if (handled) {
      setMode('keyboard');
      // Keep the page from scrolling and buttons from double-firing.
      if (m || e.code === 'Space' || e.code === 'Enter' || e.code === 'Backspace') e.preventDefault();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
