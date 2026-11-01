// Camera control from actions (gamepad right stick + triggers, keyboard Q/E/R/F), and
// gentle follow of the board cursor. Also publishes the camera's ground basis so the
// cursor can step "up the screen" whatever the camera angle.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import type { OrbitControls } from 'three-stdlib';
import { onAction } from '../input/actions';
import { useInput } from '../input/inputMode';

let azimuth = 0;
/** Screen right and screen up, as unit vectors on the ground plane (x, z). */
export function groundBasis(): { right: [number, number]; up: [number, number] } {
  return { right: [Math.cos(azimuth), -Math.sin(azimuth)], up: [-Math.sin(azimuth), -Math.cos(azimuth)] };
}

const tmp = new Vector3();

export function PadCamera({ follow }: { follow?: [number, number, number] | null }) {
  const controls = useThree((s) => s.controls) as unknown as OrbitControls | null;
  const camera = useThree((s) => s.camera);
  const acc = useRef({ rotate: 0, zoom: 0, panY: 0 });

  useEffect(
    () =>
      onAction((a) => {
        if (a.type === 'cameraRotate') acc.current.rotate += a.delta;
        if (a.type === 'cameraZoom') acc.current.zoom += a.delta;
        if (a.type === 'cameraPan') acc.current.panY += a.y;
      }),
    [],
  );

  useFrame((_, dt) => {
    if (!controls) return;
    azimuth = controls.getAzimuthalAngle();
    const a = acc.current;
    if (a.rotate) {
      controls.setAzimuthalAngle(azimuth + a.rotate);
      a.rotate = 0;
    }
    if (a.zoom) {
      // Move the camera along its view line, within the controls' distance limits.
      const dist = controls.getDistance();
      const next = Math.min(controls.maxDistance, Math.max(controls.minDistance, dist * (1 - a.zoom * 0.012)));
      tmp.copy(camera.position).sub(controls.target).setLength(next);
      camera.position.copy(controls.target).add(tmp);
      a.zoom = 0;
    }
    if (a.panY) {
      const { up } = groundBasis();
      const step = -a.panY * 0.25;
      controls.target.x += up[0] * step;
      controls.target.z += up[1] * step;
      camera.position.x += up[0] * step;
      camera.position.z += up[1] * step;
      a.panY = 0;
    }
    // Keep the cursor in view for pad and keyboard players.
    const mode = useInput.getState().mode;
    if (follow && (mode === 'gamepad' || mode === 'keyboard')) {
      const k = Math.min(1, dt * 3);
      const dx = (follow[0] - controls.target.x) * k, dz = (follow[2] - controls.target.z) * k;
      if (Math.abs(dx) + Math.abs(dz) > 1e-4) {
        controls.target.x += dx;
        controls.target.z += dz;
        camera.position.x += dx;
        camera.position.z += dz;
      }
    }
    controls.update();
  });
  return null;
}
