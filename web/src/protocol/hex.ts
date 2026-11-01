// Axial hex board with the same fixed tile order as crates/veil-rules/src/hex.rs.
export type Hex = [number, number];

export const DIRS: Hex[] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export const hexDistance = (a: Hex, b: Hex) => {
  const dq = a[0] - b[0], dr = a[1] - b[1];
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};
export const neighbors = (h: Hex): Hex[] => DIRS.map((d) => [h[0] + d[0], h[1] + d[1]]);
export const sameHex = (a: Hex, b: Hex) => a[0] === b[0] && a[1] === b[1];

export class Board {
  readonly hexes: Hex[] = [];
  private readonly idx = new Map<string, number>();
  constructor(readonly radius: number) {
    for (let q = -radius; q <= radius; q++) {
      for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
        this.idx.set(`${q},${r}`, this.hexes.length);
        this.hexes.push([q, r]);
      }
    }
  }
  get size() { return this.hexes.length; }
  index(h: Hex): number | undefined { return this.idx.get(`${h[0]},${h[1]}`); }
  hex(i: number): Hex { return this.hexes[i]; }
}

/** World position of a hex center (pointy-top layout, unit = hex radius). */
export function hexToWorld(h: Hex, size = 1): [number, number] {
  const x = size * Math.sqrt(3) * (h[0] + h[1] / 2);
  const z = size * 1.5 * h[1];
  return [x, z];
}

/** Ring of hexes at distance k, walked in the same order as Board::ring in Rust. */
export function ring(k: number): Hex[] {
  if (k === 0) return [[0, 0]];
  const out: Hex[] = [];
  let h: Hex = [DIRS[4][0] * k, DIRS[4][1] * k];
  for (const d of DIRS) for (let i = 0; i < k; i++) { out.push(h); h = [h[0] + d[0], h[1] + d[1]]; }
  return out;
}

/** Capital positions are an open rule: evenly spaced on ring R-1 (see map::infer_capitals). */
export function inferCapitals(radius: number, seats: number, me: number, myCapital: Hex): Hex[] {
  const rg = ring(radius - 1);
  const l = rg.length;
  const pos = rg.findIndex((h) => sameHex(h, myCapital));
  if (pos < 0) return [];
  const offset = (pos + l - (Math.floor((me * l) / seats) % l)) % l;
  return Array.from({ length: seats }, (_, i) => rg[(offset + Math.floor((i * l) / seats)) % l]);
}
