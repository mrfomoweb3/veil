import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, N8AO, SMAA, TiltShift2, Vignette } from '@react-three/postprocessing';
import { Suspense, useEffect, useRef, type ReactNode } from 'react';
import { Vector3 } from 'three';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import { CloudSea, SkyDome } from './Sky';

const lowEnd = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4;

/** Dives the camera to `focus` whenever it changes; free orbit/pan afterwards. */
function CameraRig({ focus, distance, auto }: { focus: [number, number, number]; distance: number; auto?: boolean }) {
  const controls = useRef<OrbitImpl>(null!);
  const { camera } = useThree();
  const anim = useRef({ t: 0, from: new Vector3(), to: new Vector3(), tFrom: new Vector3(), tTo: new Vector3() });
  const key = focus.join(',');
  useEffect(() => {
    const a = anim.current;
    a.t = 0;
    a.from.copy(camera.position);
    // A narrow lens from far away reads as a diorama (near-isometric).
    const d = distance * 1.55;
    a.to.set(focus[0] + d * 0.42, focus[1] + d * 0.72, focus[2] + d * 0.62);
    a.tFrom.copy(controls.current?.target ?? new Vector3());
    a.tTo.set(...focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, distance]);
  useFrame((_, dt) => {
    const a = anim.current;
    if (a.t < 1) {
      a.t = Math.min(1, a.t + dt / 2.2);
      const e = 1 - Math.pow(1 - a.t, 3);
      camera.position.lerpVectors(a.from, a.to, e);
      controls.current?.target.lerpVectors(a.tFrom, a.tTo, e);
      controls.current?.update();
    }
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      minDistance={8}
      maxDistance={60}
      maxPolarAngle={1.18}
      autoRotate={auto}
      autoRotateSpeed={0.35}
      screenSpacePanning={false}
    />
  );
}

export function World({ children, focus = [0, 0, 0], distance = 16, auto, onMiss }: {
  children: ReactNode;
  focus?: [number, number, number];
  distance?: number;
  auto?: boolean;
  onMiss?: () => void;
}) {
  return (
    <Canvas
      className="world"
      dpr={[1, lowEnd ? 1.25 : 2]}
      shadows="soft"
      camera={{ position: [0, 60, 50], fov: 30, near: 0.5, far: 900 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      onPointerMissed={onMiss}
    >
      <color attach="background" args={['#1a1433']} />
      <fog attach="fog" args={['#c98f8a', 40, 140]} />
      <hemisphereLight args={['#f4ecff', '#a98a7a', 1.05]} />
      <directionalLight
        position={[-14, 22, 10]}
        intensity={2.3}
        color="#ffe3c8"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-near={1}
        shadow-camera-far={70}
      />
      <directionalLight position={[16, 12, -10]} intensity={0.35} color="#c3cdff" />
      <SkyDome />
      <CloudSea />
      <Suspense fallback={null}>{children}</Suspense>
      <CameraRig focus={focus} distance={distance} auto={auto} />
      <EffectComposer multisampling={0} enableNormalPass={false}>
        <N8AO aoRadius={0.9} distanceFalloff={0.6} intensity={2.6} quality={lowEnd ? 'performance' : 'medium'} halfRes={lowEnd} color="#2a1a2e" />
        <SMAA />
        <Bloom luminanceThreshold={0.9} mipmapBlur intensity={0.55} />
        <TiltShift2 blur={lowEnd ? 0.06 : 0.12} />
        <Vignette darkness={0.5} offset={0.3} />
      </EffectComposer>
    </Canvas>
  );
}
