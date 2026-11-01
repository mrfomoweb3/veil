// Controller rumble. Optional everywhere: Safari and Firefox may not support it.
import { useInput } from './inputMode';

type Effect = { duration: number; strongMagnitude: number; weakMagnitude: number };
const EFFECTS: Record<'combat' | 'reveal' | 'sealed', Effect[]> = {
  combat: [{ duration: 120, strongMagnitude: 0.6, weakMagnitude: 0.3 }],
  reveal: [{ duration: 70, strongMagnitude: 0, weakMagnitude: 0.4 }, { duration: 70, strongMagnitude: 0, weakMagnitude: 0.4 }],
  sealed: [{ duration: 400, strongMagnitude: 0.3, weakMagnitude: 0.3 }],
};

interface Actuator { playEffect?: (type: string, params: Effect & { startDelay?: number }) => Promise<unknown> }

export function rumble(kind: keyof typeof EFFECTS) {
  const st = useInput.getState();
  if (!st.rumble || st.mode !== 'gamepad') return;
  const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
  const act = (pad as unknown as { vibrationActuator?: Actuator } | null)?.vibrationActuator;
  let delay = 0;
  for (const e of EFFECTS[kind]) {
    act?.playEffect?.('dual-rumble', { ...e, startDelay: delay })?.catch?.(() => {});
    delay += e.duration + 60;
  }
}
