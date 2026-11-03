// A tile cursor driven by actions: steps to the hex neighbour that best matches the
// screen-space push, so "up" is always up the screen.
import { useEffect, useRef, useState } from 'react';
import { onAction } from '../input/actions';
import { bestDirection } from '../input/gamepadMath';
import { uiHasFocus } from '../input/focus';
import { useInput } from '../input/inputMode';
import { groundBasis } from '../scene/PadCamera';
import type { TileVis } from '../scene/tiles';

export function stepCursor(tiles: TileVis[], from: number, dx: number, dy: number): number {
  const here = tiles[from];
  if (!here) return from;
  const { right, up } = groundBasis();
  const near = tiles.filter((t) => {
    const dq = t.hex[0] - here.hex[0], dr = t.hex[1] - here.hex[1];
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2 === 1;
  });
  const dirs = near.map((t) => {
    const wx = t.pos[0] - here.pos[0], wz = t.pos[2] - here.pos[2];
    return [wx * right[0] + wz * right[1], -(wx * up[0] + wz * up[1])] as [number, number];
  });
  const k = bestDirection([dx, dy], dirs);
  return k < 0 ? from : near[k].index;
}

export function useBoardCursor(opts: { tiles: TileVis[]; start: number | null; enabled: boolean; onSelect: (i: number) => void }) {
  const [cursor, setCursor] = useState<number | null>(opts.start);
  const ref = useRef(opts);
  ref.current = opts;
  const cur = useRef(cursor);
  cur.current = cursor;

  useEffect(() => {
    if (cursor == null && opts.start != null) setCursor(opts.start);
  }, [opts.start, cursor]);

  useEffect(() => {
    const set = useInput.getState().set;
    set({ boardActive: opts.enabled });
    return () => set({ boardActive: false });
  }, [opts.enabled]);

  useEffect(
    () =>
      onAction((a) => {
        const o = ref.current;
        if (!o.enabled || uiHasFocus() || useInput.getState().paused || useInput.getState().radial != null) return;
        if (a.type === 'cursorMove') {
          const from = cur.current ?? o.start;
          if (from == null) return;
          setCursor(stepCursor(o.tiles, from, a.dx, a.dy));
        } else if (a.type === 'select') {
          const at = cur.current ?? o.start;
          if (at != null) o.onSelect(at);
        }
      }),
    [],
  );
  return [cursor, setCursor] as const;
}
