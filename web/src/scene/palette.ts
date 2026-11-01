import { Color } from 'three';

export const SEAT_COLORS = ['#ff6b5b', '#4dabf7', '#ffd43b', '#51cf66', '#cc5de8', '#ff922b'];

/** Island top colors by terrain (Plains, Forest, Highland, Shrine, Void, Capital). */
export const TERRAIN_COLORS = ['#a6cf6f', '#5a9a52', '#c4b08c', '#9fe3d3', '#000000', '#efe6d2'];
export const ROCK = '#6a5578';
export const MEMORY_TINT = new Color('#7a7f98');

export const seatColor = (owner: number | null | undefined) => (owner == null ? '#c9c4d8' : SEAT_COLORS[owner % SEAT_COLORS.length]);

/** Stable per-tile pseudo-random in [0, 1). */
export function hash01(i: number, salt = 0) {
  let x = (i + 1) * 374761393 + salt * 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
