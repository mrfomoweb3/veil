// Procedural low-poly models in a soft "diorama" style: bevelled shapes, matte vertex
// colours, a muted warm palette. Every model is ONE merged geometry with per-vertex colour,
// so each prop type renders as a single instanced draw call.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Euler,
  ExtrudeGeometry,
  Matrix4,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three-stdlib';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const P = {
  grass: '#a9bd7e',
  grassDark: '#8aa36b',
  forestFloor: '#87a06d',
  stone: '#cdbfa6',
  stoneDark: '#a99a83',
  sand: '#e2d3b2',
  earth: '#9a7660',
  earthDark: '#7c5d4d',
  rock: '#9a8f86',
  rockDark: '#776c66',
  trunk: '#7d5c47',
  leaf: '#7fa673',
  leafLight: '#98b884',
  leafDark: '#5f8a5c',
  pine: '#5e8763',
  wood: '#cf8d55',
  woodDark: '#a96d42',
  crate: '#d9a64f',
  crateDark: '#b5833a',
  barrel: '#a87150',
  metal: '#6f6f78',
  wall: '#d27a58',
  wallLight: '#e39a74',
  roof: '#5f5552',
  roofInner: '#e7a07a',
  cream: '#ece3d3',
  window: '#4b4f60',
  canvas: '#f1e8d8',
  hay: '#e2c16b',
  white: '#ffffff',
};

type V3 = [number, number, number];

/** Transform `g`, paint it one colour, strip UVs, de-index: ready to merge. */
export function part(g: BufferGeometry, color: string, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) {
  const m = new Matrix4().compose(new Vector3(...pos), new Quaternion().setFromEuler(new Euler(...rot)), new Vector3(...scale));
  let geo = g.index ? g.toNonIndexed() : g;
  geo.applyMatrix4(m);
  geo.deleteAttribute('uv');
  const c = new Color(color);
  const n = geo.getAttribute('position').count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new BufferAttribute(cols, 3));
  geo = geo.clone();
  return geo;
}

export function merge(parts: BufferGeometry[]) {
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

const rbox = (w: number, h: number, d: number, r = 0.03, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));

/** Pointy-top hexagon outline (matches the board layout). */
function hexShape(r: number) {
  const s = new Shape();
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (30 + 60 * k);
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (k === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

// ---------------------------------------------------------------- island

/** The walkable top: a bevelled hex slab, white so instance colour sets the terrain. Top at y = 0. */
export function tileTop() {
  const g = new ExtrudeGeometry(hexShape(0.8), { depth: 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 3 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -0.15, 0);
  g.computeVertexNormals();
  return merge([part(g, P.white)]);
}

/** Earth and rock hanging under the slab. */
export function underside() {
  return merge([
    part(new CylinderGeometry(0.84, 0.7, 0.2, 6, 1), P.earth, [0, -0.25, 0]),
    part(new CylinderGeometry(0.7, 0.42, 0.32, 6, 1), P.earthDark, [0, -0.5, 0], [0, 0.25, 0]),
    part(new ConeGeometry(0.42, 0.75, 6), P.rockDark, [0, -1.03, 0], [Math.PI, 0.5, 0]),
    part(new DodecahedronGeometry(0.16, 0), P.rock, [0.42, -0.62, 0.1], [0.3, 0.2, 0], [1, 1.5, 1]),
    part(new DodecahedronGeometry(0.11, 0), P.rockDark, [-0.3, -0.75, -0.25], [0.5, 0.1, 0.4], [1, 1.6, 1]),
  ]);
}

// ---------------------------------------------------------------- nature

export const treeRound = () =>
  merge([
    part(new CylinderGeometry(0.03, 0.045, 0.2, 6), P.trunk, [0, 0.1, 0]),
    part(rbox(0.24, 0.34, 0.24, 0.1, 3), P.leaf, [0, 0.36, 0]),
  ]);

export const treeBall = () =>
  merge([
    part(new CylinderGeometry(0.03, 0.04, 0.18, 6), P.trunk, [0, 0.09, 0]),
    part(new SphereGeometry(0.15, 10, 8), P.leafLight, [0, 0.3, 0]),
    part(new SphereGeometry(0.1, 10, 8), P.leaf, [0.07, 0.42, 0.02]),
  ]);

export const pine = () =>
  merge([
    part(new CylinderGeometry(0.025, 0.035, 0.12, 6), P.trunk, [0, 0.06, 0]),
    part(new ConeGeometry(0.16, 0.26, 7), P.pine, [0, 0.22, 0]),
    part(new ConeGeometry(0.11, 0.22, 7), P.leafDark, [0, 0.37, 0]),
  ]);

export const bush = () =>
  merge([
    part(new SphereGeometry(0.09, 9, 7), P.leaf, [0, 0.06, 0], [0, 0, 0], [1, 0.8, 1]),
    part(new SphereGeometry(0.07, 9, 7), P.leafLight, [0.08, 0.05, 0.03], [0, 0, 0], [1, 0.8, 1]),
    part(new SphereGeometry(0.06, 9, 7), P.leafDark, [-0.06, 0.04, 0.05], [0, 0, 0], [1, 0.8, 1]),
  ]);

export const rock = () =>
  merge([
    part(new DodecahedronGeometry(0.09, 1), P.rock, [0, 0.04, 0], [0.2, 0.4, 0], [1, 0.65, 0.9]),
    part(new DodecahedronGeometry(0.05, 0), P.rockDark, [0.09, 0.02, 0.05], [0.5, 0.1, 0.3], [1, 0.7, 1]),
  ]);

export const grassTuft = () =>
  merge([
    part(new ConeGeometry(0.012, 0.09, 4), P.grassDark, [0, 0.045, 0], [0.15, 0, 0.1]),
    part(new ConeGeometry(0.012, 0.07, 4), P.grassDark, [0.025, 0.035, 0.01], [0, 0, -0.35]),
    part(new ConeGeometry(0.012, 0.08, 4), P.leafDark, [-0.02, 0.04, -0.015], [-0.25, 0, 0.25]),
  ]);

/** White so instance colour picks the bloom colour. */
export const flowers = () =>
  merge([
    part(new SphereGeometry(0.018, 6, 4), P.white, [0, 0.03, 0]),
    part(new SphereGeometry(0.016, 6, 4), P.white, [0.035, 0.025, 0.02]),
    part(new SphereGeometry(0.016, 6, 4), P.white, [-0.02, 0.028, 0.03]),
  ]);

export const ledge = () =>
  merge([
    part(rbox(0.42, 0.14, 0.3, 0.05), P.stoneDark, [0, 0.07, 0]),
    part(rbox(0.3, 0.12, 0.22, 0.05), P.stone, [0.04, 0.19, -0.02]),
    part(new DodecahedronGeometry(0.05, 0), P.rock, [-0.16, 0.16, 0.08]),
  ]);

export const haystack = () =>
  merge([
    part(new CylinderGeometry(0.09, 0.1, 0.1, 10), P.hay, [0, 0.05, 0], [Math.PI / 2, 0, 0]),
    part(new TorusGeometry(0.095, 0.008, 4, 12), P.woodDark, [0, 0.05, 0.02], [0, 0, 0]),
  ]);

// ---------------------------------------------------------------- built

export const crate = () =>
  merge([
    part(rbox(0.12, 0.12, 0.12, 0.012), P.crate, [0, 0.06, 0]),
    part(rbox(0.125, 0.02, 0.125, 0.006), P.crateDark, [0, 0.03, 0]),
    part(rbox(0.125, 0.02, 0.125, 0.006), P.crateDark, [0, 0.095, 0]),
  ]);

export const barrel = () =>
  merge([
    part(new CylinderGeometry(0.05, 0.05, 0.13, 10), P.barrel, [0, 0.065, 0]),
    part(new TorusGeometry(0.051, 0.006, 4, 12), P.metal, [0, 0.03, 0], [Math.PI / 2, 0, 0]),
    part(new TorusGeometry(0.051, 0.006, 4, 12), P.metal, [0, 0.1, 0], [Math.PI / 2, 0, 0]),
  ]);

export const fence = () =>
  merge([
    part(rbox(0.035, 0.14, 0.035, 0.01), P.woodDark, [-0.2, 0.07, 0]),
    part(rbox(0.035, 0.14, 0.035, 0.01), P.woodDark, [0, 0.07, 0]),
    part(rbox(0.035, 0.14, 0.035, 0.01), P.woodDark, [0.2, 0.07, 0]),
    part(rbox(0.44, 0.03, 0.02, 0.008), P.wood, [0, 0.1, 0]),
    part(rbox(0.44, 0.03, 0.02, 0.008), P.wood, [0, 0.05, 0]),
  ]);

export const lampPost = () =>
  merge([
    part(new CylinderGeometry(0.03, 0.035, 0.03, 8), P.roof, [0, 0.015, 0]),
    part(new CylinderGeometry(0.012, 0.012, 0.3, 6), P.roof, [0, 0.16, 0]),
  ]);
export const LAMP_HEAD_Y = 0.33;

/** A little flat-roofed house, like a town block: walls, a thick roof rim, an inset. */
export const house = () =>
  merge([
    part(rbox(0.32, 0.2, 0.24, 0.025), P.wall, [0, 0.1, 0]),
    part(rbox(0.36, 0.06, 0.28, 0.025), P.roof, [0, 0.22, 0]),
    part(rbox(0.28, 0.02, 0.2, 0.008), P.roofInner, [0, 0.245, 0]),
    part(rbox(0.06, 0.11, 0.01, 0.004), P.roof, [0.07, 0.055, 0.122]),
    part(rbox(0.08, 0.06, 0.01, 0.004), P.window, [-0.07, 0.11, 0.122]),
    part(rbox(0.01, 0.06, 0.08, 0.004), P.window, [0.162, 0.11, 0]),
    part(new CylinderGeometry(0.02, 0.02, 0.06, 8), P.roof, [0.08, 0.28, -0.05]),
    part(rbox(0.07, 0.045, 0.06, 0.012), P.cream, [-0.06, 0.275, -0.03]),
  ]);

/** The capital's keep: stone tiers with crenellations, a door and windows. */
export function keep() {
  const parts = [
    part(rbox(0.5, 0.26, 0.44, 0.04), P.cream, [0, 0.13, 0]),
    part(rbox(0.54, 0.05, 0.48, 0.02), P.stoneDark, [0, 0.285, 0]),
    part(rbox(0.32, 0.26, 0.28, 0.035), P.wallLight, [0.03, 0.42, -0.03]),
    part(rbox(0.36, 0.05, 0.32, 0.02), P.roof, [0.03, 0.57, -0.03]),
    part(rbox(0.26, 0.02, 0.22, 0.008), P.roofInner, [0.03, 0.598, -0.03]),
    part(rbox(0.1, 0.15, 0.012, 0.01), P.roof, [0, 0.075, 0.222]),
    part(rbox(0.06, 0.07, 0.012, 0.005), P.window, [0.03, 0.44, 0.115]),
    part(rbox(0.012, 0.07, 0.06, 0.005), P.window, [0.192, 0.44, -0.03]),
  ];
  for (let k = 0; k < 5; k++) {
    parts.push(part(rbox(0.06, 0.05, 0.05, 0.01), P.stone, [-0.22 + k * 0.11, 0.335, 0.2]));
    parts.push(part(rbox(0.05, 0.05, 0.06, 0.01), P.stone, [0.23, 0.335, -0.2 + k * 0.1]));
  }
  parts.push(part(new CylinderGeometry(0.008, 0.008, 0.32, 6), P.roof, [-0.06, 0.76, -0.1]));
  return merge(parts);
}
export const KEEP_FLAG: V3 = [-0.06, 0.86, -0.1];

/** A camp tent. White canvas so instance colour = the owner's colours. */
export const tent = () =>
  merge([
    part(new ConeGeometry(0.11, 0.16, 4), P.white, [0, 0.08, 0], [0, Math.PI / 4, 0]),
    part(rbox(0.03, 0.06, 0.005, 0.002), P.roof, [0, 0.03, 0.078]),
  ]);

export const pole = () => merge([part(new CylinderGeometry(0.008, 0.01, 0.42, 6), P.roof, [0, 0.21, 0])]);
export const POLE_FLAG: V3 = [0.07, 0.37, 0];

/** A pennant; white, coloured per owner by instance colour. */
export const flag = () => merge([part(rbox(0.14, 0.09, 0.012, 0.004), P.white)]);

/** One stone wall segment, centred, running along x. */
export function wall() {
  const parts = [part(rbox(0.74, 0.14, 0.09, 0.025), P.stone, [0, 0.07, 0])];
  for (let k = 0; k < 4; k++) parts.push(part(rbox(0.09, 0.05, 0.1, 0.012), P.stoneDark, [-0.27 + k * 0.18, 0.16, 0]));
  return merge(parts);
}

export function shrineBase() {
  const parts = [
    part(new CylinderGeometry(0.42, 0.46, 0.06, 6), P.stone, [0, 0.03, 0]),
    part(new CylinderGeometry(0.32, 0.36, 0.05, 6), P.cream, [0, 0.085, 0]),
  ];
  for (let k = 0; k < 4; k++) {
    const a = (Math.PI / 2) * k + Math.PI / 4;
    parts.push(part(new CylinderGeometry(0.03, 0.035, 0.32, 8), P.cream, [Math.cos(a) * 0.24, 0.27, Math.sin(a) * 0.24]));
    parts.push(part(rbox(0.08, 0.03, 0.08, 0.01), P.stoneDark, [Math.cos(a) * 0.24, 0.44, Math.sin(a) * 0.24]));
  }
  return merge(parts);
}
export const SHRINE_CRYSTAL_Y = 0.42;

export const campfire = () =>
  merge([
    part(new TorusGeometry(0.05, 0.018, 5, 9), P.rock, [0, 0.015, 0], [Math.PI / 2, 0, 0]),
    part(new CylinderGeometry(0.008, 0.008, 0.09, 5), P.trunk, [0, 0.02, 0], [0, 0, Math.PI / 2.3]),
    part(new CylinderGeometry(0.008, 0.008, 0.09, 5), P.trunk, [0, 0.02, 0], [Math.PI / 2.3, 0, 0]),
  ]);
