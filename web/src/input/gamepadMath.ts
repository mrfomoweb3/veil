// Pure functions behind the gamepad: deadzone, repeat timing, edge detection, direction
// picking, controller family. Unit-tested in gamepadMath.test.ts.

export const DEADZONE = 0.2;
export const REPEAT_DELAY_MS = 250;
export const REPEAT_EVERY_MS = 90;
export const END_TURN_HOLD_MS = 600;

/** Radial deadzone, rescaled so motion starts smoothly at the edge of the dead area. */
export function radialDeadzone(x: number, y: number, dz = DEADZONE): [number, number] {
  const m = Math.hypot(x, y);
  if (m <= dz) return [0, 0];
  const scaled = Math.min(1, (m - dz) / (1 - dz));
  return [(x / m) * scaled, (y / m) * scaled];
}

/** 8-way direction of a stick (after deadzone), or null when centred. Screen space. */
export function stickDir(x: number, y: number, dz = DEADZONE): [number, number] | null {
  const [sx, sy] = radialDeadzone(x, y, dz);
  if (sx === 0 && sy === 0) return null;
  // Only strong pushes step the cursor; light touches are ignored.
  if (Math.hypot(sx, sy) < 0.35) return null;
  const a = Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) * (Math.PI / 4);
  return [Math.round(Math.cos(a) * 1000) / 1000, Math.round(Math.sin(a) * 1000) / 1000];
}

/** Tile-to-tile repeat: first step immediate, then after REPEAT_DELAY_MS, then every REPEAT_EVERY_MS. */
export class Repeater<K extends string = string> {
  private key: K | null = null;
  private next = 0;
  private repeated = false;
  constructor(private delay = REPEAT_DELAY_MS, private every = REPEAT_EVERY_MS) {}
  /** Feed the currently held key (or null) each frame; returns true when a step should fire. */
  update(key: K | null, now: number): boolean {
    if (key == null) {
      this.key = null;
      return false;
    }
    if (key !== this.key) {
      this.key = key;
      this.repeated = false;
      this.next = now + this.delay;
      return true;
    }
    if (now >= this.next) {
      this.next = now + this.every;
      this.repeated = true;
      return true;
    }
    return false;
  }
  get repeating() {
    return this.repeated;
  }
}

/** Indices of buttons that went from released to pressed between two frames. */
export function pressedEdges(prev: boolean[], now: boolean[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < now.length; i++) if (now[i] && !prev[i]) out.push(i);
  return out;
}

/**
 * Pick the board direction that best matches a screen-space push. `dirs` are the six hex
 * neighbour offsets already projected into screen space (x right, y down).
 */
export function bestDirection(push: [number, number], dirs: [number, number][]): number {
  let best = -1;
  let score = 0.2; // must point at least roughly that way
  const pm = Math.hypot(push[0], push[1]) || 1;
  dirs.forEach((d, i) => {
    const dm = Math.hypot(d[0], d[1]) || 1;
    const s = (push[0] * d[0] + push[1] * d[1]) / (pm * dm);
    if (s > score) {
      score = s;
      best = i;
    }
  });
  return best;
}

export type PadFamily = 'playstation' | 'xbox' | 'generic';

export function padFamily(id: string): PadFamily {
  const s = id.toLowerCase();
  // Vendor ids are the most reliable; "Wireless Controller" alone is Sony's name but Xbox
  // pads say "Xbox Wireless Controller", so Xbox is checked first.
  if (s.includes('045e') || s.includes('xinput') || s.includes('xbox')) return 'xbox';
  if (s.includes('054c') || s.includes('dualsense') || s.includes('dualshock') || s.includes('wireless controller')) return 'playstation';
  return 'generic';
}
