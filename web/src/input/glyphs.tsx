// Button hints that match the controller in the player's hands (or the keyboard).
import type { PadFamily } from './gamepadMath';
import { useInput } from './inputMode';

export type Hint = 'select' | 'back' | 'orderMenu' | 'overlay' | 'cyclePrev' | 'cycleNext' | 'endTurn' | 'pause' | 'move' | 'camera' | 'zoom';

const PAD: Record<PadFamily, Record<Hint, string>> = {
  playstation: { select: '✕', back: '○', orderMenu: '□', overlay: '△', cyclePrev: 'L1', cycleNext: 'R1', endTurn: 'Touchpad', pause: 'Options', move: 'L-stick', camera: 'R-stick', zoom: 'L2/R2' },
  xbox: { select: 'A', back: 'B', orderMenu: 'X', overlay: 'Y', cyclePrev: 'LB', cycleNext: 'RB', endTurn: 'View', pause: 'Menu', move: 'L-stick', camera: 'R-stick', zoom: 'LT/RT' },
  generic: { select: 'A', back: 'B', orderMenu: 'X', overlay: 'Y', cyclePrev: 'LB', cycleNext: 'RB', endTurn: 'Back', pause: 'Start', move: 'L-stick', camera: 'R-stick', zoom: 'Triggers' },
};
const KEYS: Record<Hint, string> = {
  select: 'Enter', back: 'Esc', orderMenu: 'O', overlay: 'T', cyclePrev: '[', cycleNext: ']', endTurn: 'Shift+Enter', pause: 'P', move: 'WASD', camera: 'Q/E', zoom: 'R/F',
};
const PS_COLORS: Partial<Record<string, string>> = { '✕': '#7aa7ff', '○': '#ff6b6b', '□': '#e58fd8', '△': '#4fd1a5' };

export function glyphText(h: Hint, family: PadFamily, keyboard: boolean) {
  return keyboard ? KEYS[h] : PAD[family][h];
}

/** A small key/button badge. Renders nothing for mouse and touch players. */
export function Glyph({ h }: { h: Hint }) {
  const mode = useInput((s) => s.mode);
  const family = useInput((s) => s.family);
  if (mode !== 'gamepad' && mode !== 'keyboard') return null;
  const t = glyphText(h, family, mode === 'keyboard');
  const color = mode === 'gamepad' && family === 'playstation' ? PS_COLORS[t] : undefined;
  return <kbd className={`glyph ${mode} ${family}`} style={color ? { color } : undefined}>{t}</kbd>;
}
