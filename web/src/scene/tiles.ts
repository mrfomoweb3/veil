// What the scene draws for each tile, derived from my view + terrain memory (or a full
// state, for The Reveal and the landing flyover).
import { Board, hexToWorld, type Hex } from '../protocol/hex';
import { Terrain, type PlayerView } from '../protocol/view';
import { hash01 } from './palette';

export type Sight = 'visible' | 'remembered' | 'unknown';

export interface TileVis {
  index: number;
  hex: Hex;
  pos: [number, number, number];
  terrain: Terrain | null;
  sight: Sight;
  owner: number | null;
  troops: number;
  fort: boolean;
}

export function baseHeight(i: number, terrain: Terrain | null) {
  return (hash01(i, 1) - 0.5) * 0.35 + (terrain === Terrain.Highland ? 0.28 : 0) + (terrain === Terrain.Capital ? 0.12 : 0);
}

function place(board: Board, i: number, terrain: Terrain | null): [number, number, number] {
  const [x, z] = hexToWorld(board.hex(i));
  return [x, baseHeight(i, terrain), z];
}

export function tilesFromView(view: PlayerView, memory: Int8Array | null): TileVis[] {
  const board = new Board(view.radius);
  const vis = new Map(view.tiles.map((t) => [t.index, t]));
  return board.hexes.map((hex, index) => {
    const v = vis.get(index);
    if (v) return { index, hex, pos: place(board, index, v.terrain), terrain: v.terrain, sight: 'visible', owner: v.owner, troops: v.troops, fort: v.fort };
    const m = memory?.[index] ?? -1;
    const terrain = m >= 0 ? (m as Terrain) : null;
    return { index, hex, pos: place(board, index, terrain), terrain, sight: terrain == null ? 'unknown' : 'remembered', owner: null, troops: 0, fort: false };
  });
}

export interface FullTile { terrain: Terrain; owner: number | null; troops: number; fort: boolean }

export function tilesFromState(radius: number, tiles: FullTile[]): TileVis[] {
  const board = new Board(radius);
  return board.hexes.map((hex, index) => {
    const t = tiles[index];
    return { index, hex, pos: place(board, index, t.terrain), terrain: t.terrain, sight: 'visible', owner: t.owner, troops: t.troops, fort: t.fort };
  });
}

/** A decorative archipelago for the landing page (not a real match). */
export function decorativeTiles(radius = 5): TileVis[] {
  const board = new Board(radius);
  return board.hexes.map((hex, index) => {
    const r = hash01(index, 7);
    const terrain: Terrain = r < 0.12 ? Terrain.Void : r < 0.32 ? Terrain.Forest : r < 0.45 ? Terrain.Highland : r < 0.5 ? Terrain.Shrine : Terrain.Plains;
    const d = Math.max(Math.abs(hex[0]), Math.abs(hex[1]), Math.abs(hex[0] + hex[1]));
    const sight: Sight = d <= 1 ? 'visible' : d <= 2 && hash01(index, 3) < 0.6 ? 'remembered' : 'unknown';
    return { index, hex, pos: place(board, index, terrain), terrain, sight, owner: null, troops: 0, fort: false };
  });
}
