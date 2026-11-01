// The archipelago as a diorama: bevelled island slabs, earth and rock beneath, and a few
// hundred instanced props on top (see props.ts). One draw call per prop type.
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { BufferGeometry, Color, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, SphereGeometry, OctahedronGeometry } from 'three';
import { Terrain } from '../protocol/view';
import * as M from './models';
import { hash01, seatColor } from './palette';
import { buildLayers, type Item, type PropKey } from './props';
import type { TileVis } from './tiles';

export function bob(i: number, t: number) {
  return Math.sin(t * 0.6 + hash01(i, 2) * 6.28) * 0.05;
}

const TOP_COLORS: Record<number, string> = {
  [Terrain.Plains]: M.P.grass,
  [Terrain.Forest]: M.P.forestFloor,
  [Terrain.Highland]: M.P.stone,
  [Terrain.Shrine]: M.P.sand,
  [Terrain.Capital]: M.P.sand,
};
const WHITE = new Color('#ffffff');
const MEMORY = new Color('#9ea3b8');
const dummy = new Object3D();
const hidden = new Matrix4().makeScale(0, 0, 0);

// Built once, shared by every scene.
let kit: Record<PropKey | 'top' | 'under', BufferGeometry> | null = null;
function getKit() {
  kit ??= {
    top: M.tileTop(),
    under: M.underside(),
    treeRound: M.treeRound(),
    treeBall: M.treeBall(),
    pine: M.pine(),
    bush: M.bush(),
    rock: M.rock(),
    grassTuft: M.grassTuft(),
    flowers: M.flowers(),
    ledge: M.ledge(),
    haystack: M.haystack(),
    crate: M.crate(),
    barrel: M.barrel(),
    fence: M.fence(),
    lampPost: M.lampPost(),
    lampGlow: new SphereGeometry(0.035, 10, 8).translate(0, M.LAMP_HEAD_Y, 0),
    house: M.house(),
    keep: M.keep(),
    tent: M.tent(),
    pole: M.pole(),
    flag: M.flag(),
    wall: M.wall(),
    shrineBase: M.shrineBase(),
    crystal: new OctahedronGeometry(0.11, 0).translate(0, M.SHRINE_CRYSTAL_Y, 0),
    campfire: M.campfire(),
    fireGlow: new OctahedronGeometry(0.03, 0).translate(0, 0.045, 0),
  };
  return kit;
}

const matte = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
const glow = {
  lampGlow: new MeshStandardMaterial({ color: '#fff1c9', emissive: '#ffcf7a', emissiveIntensity: 2.4, toneMapped: false }),
  crystal: new MeshStandardMaterial({ color: '#c9fff3', emissive: '#56f0d4', emissiveIntensity: 2.2, toneMapped: false, roughness: 0.3 }),
  fireGlow: new MeshStandardMaterial({ color: '#ffd27a', emissive: '#ff8a3d', emissiveIntensity: 3, toneMapped: false }),
} as Partial<Record<PropKey, MeshStandardMaterial>>;

const tint = (t: TileVis) => (t.sight === 'remembered' ? MEMORY : WHITE);

function Layer({ name, items, tiles, ys }: { name: PropKey; items: Item[]; tiles: TileVis[]; ys: React.MutableRefObject<Float32Array> }) {
  const ref = useRef<InstancedMesh>(null!);
  const geo = getKit()[name];
  const isGlow = !!glow[name];
  useLayoutEffect(() => {
    if (!ref.current) return;
    const c = new Color();
    items.forEach((it, k) => {
      c.copy(it.color ?? WHITE).multiply(tint(tiles[it.tile]));
      ref.current.setColorAt(k, c);
    });
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [items, tiles]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const time = clock.elapsedTime;
    const y = ys.current;
    items.forEach((it, k) => {
      const [x, , z] = tiles[it.tile].pos;
      const flicker = name === 'fireGlow' ? 0.8 + Math.sin(time * 13 + k) * 0.25 : 1;
      dummy.position.set(x + it.x, y[it.tile] + it.y + (it.spin ? Math.sin(time * 1.6 + it.tile) * 0.05 : 0), z + it.z);
      dummy.rotation.set(0, it.spin ? time * 0.8 + it.tile : it.rot, 0);
      dummy.scale.setScalar(it.scale * flicker);
      dummy.updateMatrix();
      ref.current.setMatrixAt(k, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });
  if (!items.length) return null;
  return (
    <instancedMesh
      key={items.length}
      ref={ref}
      args={[geo, glow[name] ?? matte, items.length]}
      castShadow={!isGlow && name !== 'grassTuft' && name !== 'flowers'}
      receiveShadow={!isGlow}
      frustumCulled={false}
    />
  );
}

interface Props {
  tiles: TileVis[];
  onTile?: (index: number) => void;
  onHover?: (index: number | null) => void;
}

export function Islands({ tiles, onTile, onHover }: Props) {
  const n = tiles.length;
  const tops = useRef<InstancedMesh>(null!);
  const unders = useRef<InstancedMesh>(null!);
  const ys = useRef(new Float32Array(n));
  if (ys.current.length !== n) ys.current = new Float32Array(n);
  const kitGeo = getKit();
  const layers = useMemo(() => buildLayers(tiles), [tiles]);
  const shown = useMemo(() => tiles.map((t) => t.terrain != null && t.terrain !== Terrain.Void && t.sight !== 'unknown'), [tiles]);

  useLayoutEffect(() => {
    const c = new Color(), owner = new Color();
    tiles.forEach((t, i) => {
      c.set(t.terrain == null ? '#000' : TOP_COLORS[t.terrain] ?? M.P.grass);
      if (t.sight === 'visible' && t.owner != null) c.lerp(owner.set(seatColor(t.owner)), 0.22);
      c.multiply(tint(t));
      tops.current.setColorAt(i, c);
      unders.current.setColorAt(i, c.copy(tint(t)));
    });
    for (const m of [tops, unders]) if (m.current.instanceColor) m.current.instanceColor.needsUpdate = true;
  }, [tiles]);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    tiles.forEach((t, i) => {
      ys.current[i] = t.pos[1] + bob(i, time);
      if (!shown[i]) {
        tops.current.setMatrixAt(i, hidden);
        unders.current.setMatrixAt(i, hidden);
        return;
      }
      dummy.position.set(t.pos[0], ys.current[i], t.pos[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      tops.current.setMatrixAt(i, dummy.matrix);
      dummy.rotation.set(0, (Math.floor(hash01(i, 6) * 6) * Math.PI) / 3, 0);
      dummy.scale.set(1, 0.85 + hash01(i, 4) * 0.45, 1);
      dummy.updateMatrix();
      unders.current.setMatrixAt(i, dummy.matrix);
    });
    tops.current.instanceMatrix.needsUpdate = true;
    unders.current.instanceMatrix.needsUpdate = true;
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId == null || !onTile) return;
    e.stopPropagation();
    onTile(e.instanceId);
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId == null) return;
    e.stopPropagation();
    onHover?.(e.instanceId);
  };

  return (
    <group>
      <instancedMesh ref={tops} args={[kitGeo.top, matte, n]} receiveShadow castShadow onClick={click} onPointerMove={move} onPointerOut={() => onHover?.(null)} frustumCulled={false} />
      <instancedMesh ref={unders} args={[kitGeo.under, matte, n]} castShadow onClick={click} frustumCulled={false} />
      {(Object.keys(layers) as PropKey[]).map((k) => (
        <Layer key={k} name={k} items={layers[k]} tiles={tiles} ys={ys} />
      ))}
    </group>
  );
}
