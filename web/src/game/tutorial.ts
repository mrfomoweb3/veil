// The tutorial's own tiny world: a scripted 37-tile board played entirely in the browser.
// It uses the same visuals as a real match and the same crypto (real sealing, a real
// ed25519 "VRF" signature with a throwaway key), so what you see is what the game does.
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';
import { Board, hexDistance, type Hex } from '../protocol/hex';
import { Terrain } from '../protocol/view';
import { tilesFromState, type FullTile, type TileVis } from '../scene/tiles';

export const R = 3;
export const board = new Board(R);
export const ME = 0;
export const ENEMY = 1;
export const CAPITAL: Hex = [-2, 1];
export const MARCH: Hex = [-1, 1];
export const RAIDERS: Hex = [0, 1];
export const ENEMY_CAPITAL: Hex = [2, -1];

const idx = (h: Hex) => board.index(h)!;

export function initialWorld(): FullTile[] {
  const terrain = (h: Hex): Terrain => {
    const key = `${h[0]},${h[1]}`;
    const fixed: Record<string, Terrain> = {
      '-2,1': Terrain.Capital, '2,-1': Terrain.Capital, '-1,1': Terrain.Plains, '0,1': Terrain.Plains,
      '0,-2': Terrain.Shrine, '1,-1': Terrain.Forest, '-1,0': Terrain.Forest, '-2,2': Terrain.Highland,
      '1,2': Terrain.Void, '-3,0': Terrain.Void, '2,1': Terrain.Highland, '0,0': Terrain.Plains,
      '-1,2': Terrain.Plains, '-3,2': Terrain.Forest, '3,-3': Terrain.Forest, '1,0': Terrain.Highland,
    };
    if (fixed[key] != null) return fixed[key];
    const r = Math.abs(Math.sin(h[0] * 12.9898 + h[1] * 78.233) * 43758.5453) % 1;
    return r < 0.35 ? Terrain.Forest : r < 0.5 ? Terrain.Highland : Terrain.Plains;
  };
  const tiles: FullTile[] = board.hexes.map((h) => ({ terrain: terrain(h), owner: null, troops: 0, fort: false }));
  Object.assign(tiles[idx(CAPITAL)], { owner: ME, troops: 6 });
  Object.assign(tiles[idx(ENEMY_CAPITAL)], { owner: ENEMY, troops: 9, fort: true });
  Object.assign(tiles[idx([1, -1])], { owner: ENEMY, troops: 7 });
  Object.assign(tiles[idx([2, 0])], { owner: ENEMY, troops: 2 });
  return tiles;
}

/** The same fog rule as the real game (crates/veil-rules/src/vision.rs). */
export function vision(tiles: FullTile[]): boolean[] {
  const eyes = tiles
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.owner === ME && t.troops > 0)
    .map(({ t, i }) => ({ h: board.hex(i), range: 1 + (t.terrain === Terrain.Highland || t.terrain === Terrain.Capital ? 1 : 0) }));
  return tiles.map((t, i) => {
    if (t.owner === ME) return true;
    const h = board.hex(i);
    return eyes.some((e) => hexDistance(e.h, h) <= e.range - (t.terrain === Terrain.Forest ? 1 : 0));
  });
}

export function toVis(tiles: FullTile[], seen: Set<number>, reveal: boolean): TileVis[] {
  const vis = vision(tiles);
  return tilesFromState(R, tiles).map((t, i) => {
    if (reveal || vis[i]) return t;
    if (seen.has(i)) return { ...t, sight: 'remembered', owner: null, troops: 0, fort: false };
    return { ...t, terrain: null, sight: 'unknown', owner: null, troops: 0, fort: false };
  });
}

export const neighboursOf = (h: Hex) => board.hexes.map((x, i) => [x, i] as const).filter(([x]) => hexDistance(x, h) === 1).map(([, i]) => i);

/** A real ed25519 signature over an OutLayer-style alpha, with a throwaway key. */
export function demoVrf(turn: number) {
  const sk = randomBytes(32);
  const pk = ed25519.getPublicKey(sk);
  const alpha = `vrf:4217:veil.near:turn-${turn}`;
  const sig = ed25519.sign(new TextEncoder().encode(alpha), sk);
  const output = sha256(sig);
  // Same mapping as the rules: two rolls in [0.85, 1.15].
  const roll = (k: number) => 0.85 + (((output[k] << 8) | output[k + 1]) % 301) / 1000;
  return { pk, alpha, sig, output, attack: roll(0), defend: roll(2) };
}

export function verifyDemo(v: ReturnType<typeof demoVrf>) {
  return ed25519.verify(v.sig, new TextEncoder().encode(v.alpha), v.pk);
}
