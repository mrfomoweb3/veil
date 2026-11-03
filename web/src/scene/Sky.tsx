// Sunset sky dome, the cloud sea below the islands, and the fog-of-war clouds themselves.
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { BackSide, InstancedMesh, Object3D, ShaderMaterial } from 'three';
import { hash01 } from './palette';
import type { TileVis } from './tiles';
import { tileMenuHandlers } from './tileMenu';

export function SkyDome() {
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        uniforms: {},
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP;
          void main(){
            float h = vP.y;
            vec3 top = vec3(0.05,0.06,0.18), mid = vec3(0.36,0.22,0.47), hor = vec3(1.0,0.62,0.48), low = vec3(0.98,0.80,0.66);
            vec3 c = h > 0.25 ? mix(mid, top, smoothstep(0.25, 0.85, h)) : h > 0.0 ? mix(hor, mid, smoothstep(0.0, 0.25, h)) : mix(hor, low, smoothstep(0.0, -0.3, h));
            float sun = pow(max(dot(vP, normalize(vec3(-0.6, 0.08, -0.8))), 0.0), 220.0);
            gl_FragColor = vec4(c + vec3(1.0,0.8,0.6) * sun * 1.6, 1.0);
          }`,
      }),
    [],
  );
  return (
    <mesh material={mat} renderOrder={-10}>
      <sphereGeometry args={[300, 32, 16]} />
    </mesh>
  );
}

const NOISE = `
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int k = 0; k < 5; k++){ v += a*n(p); p *= 2.03; a *= 0.5; } return v; }
`;

export function CloudSea() {
  const ref = useRef<ShaderMaterial>(null!);
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vW; ${NOISE}
          void main(){
            vec2 p = vW.xz * 0.06 + vec2(uTime * 0.012, uTime * 0.005);
            float c = fbm(p) * 0.65 + fbm(p * 2.7 - uTime * 0.02) * 0.35;
            vec3 deep = vec3(0.30, 0.22, 0.45), lit = vec3(1.0, 0.82, 0.76), warm = vec3(1.0, 0.64, 0.52);
            float d = length(vW.xz) / 180.0;
            vec3 col = mix(deep, lit, smoothstep(0.35, 0.8, c));
            col = mix(col, warm, smoothstep(0.2, 1.0, d) * 0.7);
            gl_FragColor = vec4(col, 1.0 - smoothstep(0.75, 1.0, d));
          }`,
      }),
    [],
  );
  useFrame(({ clock }) => { ref.current.uniforms.uTime.value = clock.elapsedTime; });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.2, 0]} renderOrder={-5}>
      <planeGeometry args={[400, 400, 1, 1]} />
      <primitive object={mat} ref={ref} attach="material" />
    </mesh>
  );
}

const PUFFS = 7;
const dummy = new Object3D();

/** The fog of war: cloud puffs over every tile, burned off where you can see. */
export function FogClouds({ tiles, onTile, onTileMenu }: { tiles: TileVis[]; onTile?: (i: number) => void; onTileMenu?: (i: number) => void }) {
  const ref = useRef<InstancedMesh>(null!);
  const density = useRef<Float32Array>(new Float32Array(0));
  const n = tiles.length;
  if (density.current.length !== n) density.current = new Float32Array(n).fill(1);
  const targets = useMemo(() => tiles.map((t) => (t.sight === 'visible' ? 0 : t.sight === 'remembered' ? 0.32 : 1)), [tiles]);

  useFrame(({ clock }, dt) => {
    const time = clock.elapsedTime;
    const d = density.current;
    for (let i = 0; i < n; i++) {
      // Clouds burn off quickly and roll back in slowly.
      const rate = targets[i] < d[i] ? 2.2 : 0.7;
      d[i] += (targets[i] - d[i]) * Math.min(1, dt * rate);
      const [x, , z] = tiles[i].pos;
      for (let k = 0; k < PUFFS; k++) {
        const a = hash01(i, 50 + k) * 6.28, r = k === 0 ? 0 : 0.3 + hash01(i, 60 + k) * 0.45;
        const s = d[i] * (0.5 + hash01(i, 70 + k) * 0.32) * (k === 0 ? 1.3 : 1);
        const drift = Math.sin(time * 0.25 + i + k) * 0.06;
        dummy.position.set(x + Math.cos(a) * r + drift, 0.2 + hash01(i, 80 + k) * 0.3 + (1 - d[i]) * 0.9, z + Math.sin(a) * r);
        dummy.scale.set(s * 1.25, s * 0.55, s * 1.25);
        dummy.updateMatrix();
        ref.current.setMatrixAt(i * PUFFS + k, dummy.matrix);
      }
    }
    ref.current.instanceMatrix.needsUpdate = true;
  });

  const menu = useMemo(() => tileMenuHandlers(onTileMenu, (id) => Math.floor(id / PUFFS)), [onTileMenu]);
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId == null || !onTile) return;
    e.stopPropagation();
    if (menu.swallowClick()) return;
    onTile(Math.floor(e.instanceId / PUFFS));
  };
  const { swallowClick: _, ...menuProps } = menu;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n * PUFFS]} onClick={click} {...menuProps}>
      <icosahedronGeometry args={[0.62, 2]} />
      <meshStandardMaterial color="#f4ede8" emissive="#c9a8b8" emissiveIntensity={0.12} roughness={1} />
    </instancedMesh>
  );
}
