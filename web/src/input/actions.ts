// Every input device (mouse, keyboard, touch, gamepad) speaks these actions. Game code only
// ever listens to actions, never to raw keys or buttons.

export type Dir = 'up' | 'down' | 'left' | 'right';

export type Action =
  | { type: 'cursorMove'; dx: number; dy: number } // one tile step, screen space (dy > 0 = down)
  | { type: 'cameraPan'; x: number; y: number } // per-frame, screen space, -1..1
  | { type: 'cameraZoom'; delta: number } // per-frame, > 0 = closer
  | { type: 'cameraRotate'; delta: number } // per-frame, radians-ish
  | { type: 'select' }
  | { type: 'back' }
  | { type: 'orderMenu' }
  | { type: 'endTurn' }
  | { type: 'endTurnHold'; progress: number } // 0..1 while the end-turn button is held, 0 on release
  | { type: 'cycleUnit'; dir: 1 | -1 }
  | { type: 'cycleOverlay' }
  | { type: 'uiNav'; dir: Dir }
  | { type: 'pause' };

type Listener = (a: Action) => void;
const listeners = new Set<Listener>();

export function emit(a: Action) {
  for (const l of [...listeners]) l(a);
}

export function onAction(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
