// Reads standard-mapping gamepads once per animation frame and turns them into actions.
// (A global rAF loop rather than R3F's useFrame, so menus without a 3D scene work too.)
import { emit, type Dir } from './actions';
import { END_TURN_HOLD_MS, padFamily, pressedEdges, radialDeadzone, Repeater, stickDir } from './gamepadMath';
import { setMode, useInput } from './inputMode';

export const B = {
  south: 0, east: 1, west: 2, north: 3, l1: 4, r1: 5, l2: 6, r2: 7,
  share: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, home: 16, touchpad: 17,
} as const;

const DPAD: Record<number, [Dir, number, number]> = {
  [B.up]: ['up', 0, -1], [B.down]: ['down', 0, 1], [B.left]: ['left', -1, 0], [B.right]: ['right', 1, 0],
};

const dirOf = (dx: number, dy: number): Dir => (Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');

let started = false;

export function startGamepad() {
  if (started || typeof navigator === 'undefined' || !navigator.getGamepads) return;
  started = true;
  let prev: boolean[] = [];
  const stick = new Repeater();
  let holdStart: number | null = null;
  let endFired = false;

  const onConnect = (e: GamepadEvent) => {
    useInput.getState().set({ padConnected: true, family: padFamily(e.gamepad.id) });
    if (useInput.getState().paused === 'disconnected') useInput.getState().set({ paused: null });
  };
  const onDisconnect = () => {
    const anyLeft = [...navigator.getGamepads()].some((p) => p && p.connected);
    const st = useInput.getState();
    st.set({ padConnected: anyLeft });
    if (!anyLeft && st.mode === 'gamepad' && st.boardActive) st.set({ paused: 'disconnected' });
  };
  window.addEventListener('gamepadconnected', onConnect);
  window.addEventListener('gamepaddisconnected', onDisconnect);

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const pad = [...navigator.getGamepads()].find((p) => p && p.connected && p.mapping === 'standard');
    if (!pad) return;
    const pressed = pad.buttons.map((b) => b.pressed);
    const [lx, ly] = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
    const [rx, ry] = radialDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
    const zoom = (pad.buttons[B.r2]?.value ?? 0) - (pad.buttons[B.l2]?.value ?? 0);
    const active = pressed.some(Boolean) || Math.hypot(lx, ly) > 0.35 || rx !== 0 || ry !== 0;
    if (active) {
      setMode('gamepad');
      const st = useInput.getState();
      if (!st.padConnected) st.set({ padConnected: true, family: padFamily(pad.id) });
      if (st.paused === 'disconnected') st.set({ paused: null });
    }

    for (const i of pressedEdges(prev, pressed)) {
      if (DPAD[i]) {
        const [dir, dx, dy] = DPAD[i];
        emit({ type: 'cursorMove', dx, dy });
        emit({ type: 'uiNav', dir });
        continue;
      }
      switch (i) {
        case B.south: emit({ type: 'select' }); break;
        case B.east: emit({ type: 'back' }); break;
        case B.west: emit({ type: 'orderMenu' }); break;
        case B.north: emit({ type: 'cycleOverlay' }); break;
        case B.l1: emit({ type: 'cycleUnit', dir: -1 }); break;
        case B.r1: emit({ type: 'cycleUnit', dir: 1 }); break;
        case B.options: emit({ type: 'pause' }); break;
      }
    }

    // End turn: hold the touchpad / Share / View button for 0.6 s (it can't be undone).
    const holding = !!(pressed[B.touchpad] || pressed[B.share]);
    if (holding) {
      holdStart ??= now;
      const progress = Math.min(1, (now - holdStart) / END_TURN_HOLD_MS);
      if (!endFired) emit({ type: 'endTurnHold', progress });
      if (progress >= 1 && !endFired) {
        endFired = true;
        emit({ type: 'endTurn' });
        emit({ type: 'endTurnHold', progress: 0 });
      }
    } else if (holdStart != null) {
      holdStart = null;
      endFired = false;
      emit({ type: 'endTurnHold', progress: 0 });
    }

    // Left stick: tile-to-tile cursor with repeat.
    const d = stickDir(lx, ly);
    if (stick.update(d ? d.join(',') : null, now) && d) {
      emit({ type: 'cursorMove', dx: d[0], dy: d[1] });
      emit({ type: 'uiNav', dir: dirOf(d[0], d[1]) });
    }

    // Right stick: rotate (x) and pan (y). Triggers: zoom.
    if (rx !== 0) emit({ type: 'cameraRotate', delta: -rx * 0.035 });
    if (ry !== 0) emit({ type: 'cameraPan', x: 0, y: ry });
    if (Math.abs(zoom) > 0.05) emit({ type: 'cameraZoom', delta: zoom });

    prev = pressed;
  };
  requestAnimationFrame(frame);
}
