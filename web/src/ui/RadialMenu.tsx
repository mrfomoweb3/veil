// The radial order menu, pinned to its tile in the 3D scene. Stick / arrows point at a slot,
// select confirms, back cancels; mouse and touch tap the options directly.
import { Html } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import { onAction } from '../input/actions';
import { useInput } from '../input/inputMode';
import { Glyph } from '../input/glyphs';
import { focusInto } from '../input/focus';
import { useStore } from '../store';
import { applyRadial, pickByDirection, radialContext, radialOptions, type RadialId, type RadialOption } from '../game/radial';
import type { TileVis } from '../scene/tiles';

export const openRadial = (i: number) => useInput.getState().set({ radial: i });
// Deferred, so the action that closed the menu is not also handled by the board this same tick.
export const closeRadial = () => queueMicrotask(() => useInput.getState().set({ radial: null }));

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

export function RadialMenu({ tiles }: { tiles: TileVis[] }) {
  const at = useInput((s) => s.radial);
  const padLike = useInput((s) => s.mode === 'gamepad' || s.mode === 'keyboard');
  // Recompute when anything the options depend on changes.
  const view = useStore((s) => s.view);
  const draft = useStore((s) => s.draft);
  const selected = useStore((s) => s.selected);
  const opts = useMemo(() => {
    const c = at == null ? null : radialContext(at);
    return c ? radialOptions(c) : [];
  }, [at, view, draft, selected]);
  const [hot, setHot] = useState<RadialId | null>(null);
  const hotRef = useRef(hot);
  hotRef.current = hot;

  useEffect(() => setHot(null), [at]);

  useEffect(() => {
    if (at == null) return;
    const choose = (o: RadialOption | undefined) => {
      if (!o) return closeRadial();
      if (!o.enabled) return useStore.getState().push(o.why ?? 'Not available here.', 'bad');
      applyRadial(o.id, at);
      closeRadial();
    };
    return onAction((a) => {
      if (useInput.getState().paused) return;
      if (a.type === 'cursorMove') {
        const o = pickByDirection(opts, a.dx, a.dy);
        if (o) setHot(o.id);
      } else if (a.type === 'select') {
        choose(opts.find((o) => o.id === hotRef.current));
      } else if (a.type === 'orderMenu') {
        // Pressed twice: the full orders panel (recruits, trades, seal).
        closeRadial();
        queueMicrotask(() => focusInto('.orders'));
      } else if (a.type === 'back' || a.type === 'pause') {
        closeRadial();
      }
    });
  }, [at, opts]);

  if (at == null || !tiles[at]) return null;
  const p = tiles[at].pos;
  const hotOpt = opts.find((o) => o.id === hot);
  return (
    <Html position={[p[0], p[1] + 0.9, p[2]]} center zIndexRange={[40, 30]}>
      {/* The menu lives inside the canvas wrapper; keep its pointer events from reaching the tiles below. */}
      <div className="radial" role="menu" onContextMenu={(e) => e.preventDefault()} onPointerDown={stop} onPointerUp={stop} onClick={stop}>
        {opts.map((o) => (
          <button
            key={o.id}
            role="menuitem"
            className={`radial-opt s-${o.slot} ${o.enabled ? '' : 'off'} ${hot === o.id ? 'hot' : ''}`}
            title={o.enabled ? o.label : o.why}
            onPointerEnter={() => setHot(o.id)}
            onClick={(e) => {
              e.stopPropagation();
              if (!o.enabled) return useStore.getState().push(o.why ?? 'Not available here.', 'bad');
              applyRadial(o.id, at);
              closeRadial();
            }}
          >
            <span className="ico">{o.icon}</span>
            <span className="lbl">{o.label}</span>
          </button>
        ))}
        <button className="radial-hub" aria-label="Close" onClick={(e) => { e.stopPropagation(); closeRadial(); }}>
          {padLike ? <Glyph h="back" /> : '×'}
        </button>
        {hotOpt && !hotOpt.enabled && hotOpt.why && <div className="radial-why">{hotOpt.why}</div>}
        {padLike && <div className="radial-hint"><Glyph h="move" /> point · <Glyph h="select" /> order · <Glyph h="orderMenu" /> panel</div>}
      </div>
    </Html>
  );
}
