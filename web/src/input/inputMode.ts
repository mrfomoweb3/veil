// Which device the player used last, and what controller is plugged in.
import { create } from 'zustand';
import type { PadFamily } from './gamepadMath';

export type InputMode = 'mouse' | 'touch' | 'keyboard' | 'gamepad';

interface InputState {
  mode: InputMode;
  family: PadFamily;
  padConnected: boolean;
  /** True while a board (match or tutorial) owns the cursor and `select`. */
  boardActive: boolean;
  /** Hold progress of the end-turn button, 0..1. */
  endHold: number;
  paused: null | 'menu' | 'disconnected';
  rumble: boolean;
  set: (p: Partial<Omit<InputState, 'set'>>) => void;
}

let rumblePref = true;
try { rumblePref = localStorage.getItem('veil:rumble') !== 'off'; } catch { /* default on */ }

export const useInput = create<InputState>((set) => ({
  mode: 'mouse',
  family: 'generic',
  padConnected: false,
  boardActive: false,
  endHold: 0,
  paused: null,
  rumble: rumblePref,
  set: (p) => {
    if (p.rumble != null) {
      try { localStorage.setItem('veil:rumble', p.rumble ? 'on' : 'off'); } catch { /* ignore */ }
    }
    set(p);
  },
}));

export function setMode(mode: InputMode) {
  if (useInput.getState().mode !== mode) useInput.getState().set({ mode });
}

/** Mouse and touch: the pointer type tells us which. */
export function startPointerTracking() {
  const onPointer = (e: PointerEvent) => setMode(e.pointerType === 'touch' ? 'touch' : 'mouse');
  window.addEventListener('pointerdown', onPointer, { passive: true });
  window.addEventListener('pointermove', onPointer, { passive: true });
  return () => {
    window.removeEventListener('pointerdown', onPointer);
    window.removeEventListener('pointermove', onPointer);
  };
}
