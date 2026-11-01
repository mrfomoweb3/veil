// Where every prop goes. Scenery is deterministic per tile (index + terrain), so the same
// island always looks the same; military detail (banners, tents, walls) follows the game.
import { Color } from 'three';
import { Terrain } from '../protocol/view';
import { hash01, seatColor } from './palette';
import type { TileVis } from './tiles';
import { KEEP_FLAG, POLE_FLAG } from './models';

export type PropKey =
  | 'treeRound' | 'treeBall' | 'pine' | 'bush' | 'rock' | 'grassTuft' | 'flowers' | 'ledge' | 'haystack'
  | 'crate' | 'barrel' | 'fence' | 'lampPost' | 'lampGlow' | 'house' | 'keep' | 'tent' | 'pole' | 'flag'
  | 'wall' | 'shrineBase' | 'crystal' | 'campfire' | 'fireGlow';

export interface Item {
  tile: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  color?: Color;
  spin?: boolean;
}

export type Layers = Record<PropKey, Item[]>;

const FLOWER_COLORS = ['#f6d36b', '#f7f2e6', '#ea9fb3', '#c8b5f0', '#f3a26b'].map((c) => new Color(c));
/** Pointy-top hex: edge midpoints sit at these angles (radians, x = cos, z = sin). */
const EDGE_ANGLES = [0, 1, 2, 3, 4, 5].map((k) => (Math.PI / 3) * k);
const APOTHEM = 0.8 * Math.cos(Math.PI / 6);

function emptyLayers(): Layers {
  const keys: PropKey[] = ['treeRound', 'treeBall', 'pine', 'bush', 'rock', 'grassTuft', 'flowers', 'ledge', 'haystack', 'crate', 'barrel', 'fence', 'lampPost', 'lampGlow', 'house', 'keep', 'tent', 'pole', 'flag', 'wall', 'shrineBase', 'crystal', 'campfire', 'fireGlow'];
  return Object.fromEntries(keys.map((k) => [k, []])) as unknown as Layers;
}

/** Scatter up to `n` points in an annulus, keeping `spacing` from everything already placed. */
function scatter(tile: number, salt: number, n: number, taken: [number, number][], minR: number, maxR: number, spacing: number) {
  const out: [number, number][] = [];
  for (let k = 0; k < n * 8 && out.length < n; k++) {
    const a = hash01(tile, salt + k * 2) * Math.PI * 2;
    const r = minR + Math.sqrt(hash01(tile, salt + k * 2 + 1)) * (maxR - minR);
    const p: [number, number] = [Math.cos(a) * r, Math.sin(a) * r];
    // Stay inside the hexagon, not just the circle.
    if (EDGE_ANGLES.some((e) => p[0] * Math.cos(e) + p[1] * Math.sin(e) > APOTHEM - 0.12)) continue;
    if (taken.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < spacing)) continue;
    taken.push(p);
    out.push(p);
  }
  return out;
}

export function buildLayers(tiles: TileVis[]): Layers {
  const L = emptyLayers();
  for (const t of tiles) {
    if (t.terrain == null || t.terrain === Terrain.Void || t.sight === 'unknown') continue;
    const i = t.index;
    const h = (s: number) => hash01(i, s);
    const add = (key: PropKey, x: number, z: number, extra: Partial<Item> = {}) =>
      L[key].push({ tile: i, x, y: 0, z, rot: h(900 + L[key].length) * Math.PI * 2, scale: 0.85 + h(950 + L[key].length) * 0.3, ...extra });
    const taken: [number, number][] = [];
    // The middle of an ordinary tile is kept clear for the army camp and banner.
    const centreFree = t.terrain !== Terrain.Capital && t.terrain !== Terrain.Shrine;
    const inner = centreFree ? 0.3 : 0;
    const edgeFence = (salt: number) => {
      const e = EDGE_ANGLES[Math.floor(h(salt) * 6)];
      const r = APOTHEM - 0.1;
      add('fence', Math.cos(e) * r, Math.sin(e) * r, { rot: -e + Math.PI / 2, scale: 1 });
      taken.push([Math.cos(e) * r, Math.sin(e) * r]);
    };

    switch (t.terrain) {
      case Terrain.Plains: {
        if (h(1) < 0.3) edgeFence(2);
        if (h(3) < 0.35) for (const [x, z] of scatter(i, 10, 1, taken, inner, 0.6, 0.2)) add(h(4) < 0.5 ? 'treeRound' : 'treeBall', x, z);
        if (h(5) < 0.22) for (const [x, z] of scatter(i, 30, 1, taken, inner, 0.6, 0.18)) add('haystack', x, z);
        if (h(6) < 0.45) for (const [x, z] of scatter(i, 50, 1, taken, inner, 0.62, 0.14)) add('rock', x, z, { scale: 0.7 + h(7) * 0.5 });
        for (const [x, z] of scatter(i, 70, 2, taken, inner, 0.62, 0.12)) add('flowers', x, z, { color: FLOWER_COLORS[Math.floor(h(x * 100 + 8) * FLOWER_COLORS.length)] });
        for (const [x, z] of scatter(i, 90, 5, [...taken], 0.15, 0.66, 0.1)) add('grassTuft', x, z);
        break;
      }
      case Terrain.Forest: {
        const trees = scatter(i, 10, 6, taken, inner, 0.64, 0.19);
        trees.forEach(([x, z], k) => add(['pine', 'treeRound', 'treeBall'][Math.floor(h(20 + k) * 3)] as PropKey, x, z, { scale: 0.85 + h(30 + k) * 0.45 }));
        for (const [x, z] of scatter(i, 40, 2, taken, inner, 0.64, 0.14)) add('bush', x, z);
        if (h(5) < 0.3) for (const [x, z] of scatter(i, 50, 1, taken, inner, 0.6, 0.12)) add('rock', x, z);
        for (const [x, z] of scatter(i, 90, 3, [...taken], 0.15, 0.66, 0.1)) add('grassTuft', x, z);
        break;
      }
      case Terrain.Highland: {
        for (const [x, z] of scatter(i, 10, 1 + Math.floor(h(2) * 2), taken, Math.max(inner, 0.3), 0.55, 0.32)) add('ledge', x, z, { scale: 0.9 + h(3) * 0.4 });
        for (const [x, z] of scatter(i, 30, 3, taken, inner, 0.64, 0.13)) add('rock', x, z, { scale: 0.8 + h(4) * 0.7 });
        if (h(5) < 0.5) for (const [x, z] of scatter(i, 50, 1, taken, inner, 0.6, 0.16)) add('pine', x, z);
        for (const [x, z] of scatter(i, 90, 2, [...taken], 0.15, 0.66, 0.1)) add('grassTuft', x, z);
        break;
      }
      case Terrain.Shrine: {
        add('shrineBase', 0, 0, { rot: Math.PI / 6, scale: 1 });
        add('crystal', 0, 0, { spin: true, scale: 1, rot: 0 });
        taken.push([0, 0]);
        for (const [x, z] of scatter(i, 10, 2, taken, 0.5, 0.64, 0.2)) {
          add('lampPost', x, z, { scale: 1 });
          add('lampGlow', x, z, { scale: 1 });
        }
        for (const [x, z] of scatter(i, 30, 3, taken, 0.48, 0.66, 0.14)) add('bush', x, z);
        break;
      }
      case Terrain.Capital: {
        add('keep', 0, 0, { rot: Math.PI / 6 + h(1) * 0.2, scale: 1 });
        taken.push([0, 0], [0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12]);
        for (const [x, z] of scatter(i, 10, 2, taken, 0.47, 0.6, 0.3)) add('house', x, z, { rot: Math.atan2(-x, -z) + (h(x * 50) - 0.5) * 0.3, scale: 0.95 });
        for (const [x, z] of scatter(i, 30, 3, taken, 0.36, 0.64, 0.12)) add(h(x * 70) < 0.5 ? 'crate' : 'barrel', x, z);
        for (const [x, z] of scatter(i, 50, 2, taken, 0.4, 0.64, 0.18)) {
          add('lampPost', x, z, { scale: 1 });
          add('lampGlow', x, z, { scale: 1 });
        }
        for (const [x, z] of scatter(i, 70, 2, taken, 0.4, 0.66, 0.14)) add('bush', x, z);
        break;
      }
    }

    // Military detail: only for what you can actually see right now.
    if (t.sight !== 'visible' || t.owner == null) continue;
    const color = new Color(seatColor(t.owner));
    const canvas = color.clone().lerp(new Color('#ffffff'), 0.35);
    if (t.terrain === Terrain.Capital) {
      add('flag', KEEP_FLAG[0], KEEP_FLAG[2], { y: KEEP_FLAG[1], rot: 0, scale: 1, color });
    } else {
      const pz = t.terrain === Terrain.Shrine ? 0.32 : -0.2;
      add('pole', -0.04, pz, { rot: 0, scale: 1 });
      add('flag', -0.04 + POLE_FLAG[0], pz + POLE_FLAG[2], { y: POLE_FLAG[1], rot: 0, scale: 1, color });
    }
    const tents = t.troops <= 0 ? 0 : Math.min(3, Math.ceil(t.troops / 6));
    const camp: [number, number][] = t.terrain === Terrain.Capital
      ? [[0.36, 0.28], [-0.4, 0.22], [0.05, 0.5]]
      : t.terrain === Terrain.Shrine
        ? [[0.3, -0.3], [-0.32, -0.26], [0.0, -0.45]]
        : [[0.1, 0.06], [-0.13, 0.1], [0.04, 0.22]];
    camp.slice(0, tents).forEach(([x, z], k) => add('tent', x, z, { rot: (k - 1) * 0.5, scale: 0.9 + Math.min(1, t.troops / 30) * 0.4, color: canvas }));
    if (tents >= 2) {
      const [x, z] = t.terrain === Terrain.Capital ? [0.2, 0.42] : t.terrain === Terrain.Shrine ? [0.12, -0.36] : [-0.02, 0.0];
      add('campfire', x, z + 0.02, { scale: 1 });
      add('fireGlow', x, z + 0.02, { scale: 1 });
    }
    if (t.fort) {
      EDGE_ANGLES.forEach((e, k) => {
        if (t.terrain === Terrain.Capital && k % 2 === 1) return; // leave gates
        const r = APOTHEM - 0.04;
        add('wall', Math.cos(e) * r, Math.sin(e) * r, { rot: -e + Math.PI / 2, scale: 1 });
      });
    }
  }
  return L;
}
