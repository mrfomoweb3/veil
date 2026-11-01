// Options / Menu / P: controls reference, rumble toggle, leave. Also shown when the
// controller disconnects mid-match. (The turn clock is on chain: it keeps running.)
import { useEffect } from 'react';
import { onAction } from '../input/actions';
import { focusInto } from '../input/focus';
import { Glyph, type Hint } from '../input/glyphs';
import { useInput } from '../input/inputMode';
import { useStore } from '../store';

const ROWS: [Hint, string][] = [
  ['move', 'Move the cursor tile by tile'],
  ['select', 'Select an island / confirm'],
  ['back', 'Cancel / leave a menu'],
  ['orderMenu', 'Jump to the orders panel'],
  ['cyclePrev', 'Previous army'],
  ['cycleNext', 'Next army'],
  ['overlay', 'Threat view on / off'],
  ['camera', 'Rotate and pan the camera'],
  ['zoom', 'Zoom'],
  ['endTurn', 'Seal orders (hold on a controller)'],
  ['pause', 'This menu'],
];

export function PauseMenu() {
  const paused = useInput((s) => s.paused);
  const rumbleOn = useInput((s) => s.rumble);
  const padConnected = useInput((s) => s.padConnected);
  const set = useInput((s) => s.set);

  useEffect(
    () =>
      onAction((a) => {
        const st = useInput.getState();
        if (a.type === 'pause') st.set({ paused: st.paused ? null : 'menu' });
        else if (a.type === 'back' && st.paused === 'menu') st.set({ paused: null });
      }),
    [],
  );
  useEffect(() => {
    if (paused) setTimeout(() => focusInto('.pause-menu'), 50);
  }, [paused]);

  if (!paused) return null;
  return (
    <div className="pause-menu modal">
      <div className="panel sheet">
        {paused === 'disconnected' ? (
          <>
            <h2>Controller disconnected</h2>
            <p>Reconnect it and press any button, or keep playing with the mouse. The turn clock keeps running on chain.</p>
            <button className="primary" onClick={() => set({ paused: null })}>Continue without it</button>
          </>
        ) : (
          <>
            <h2>Menu</h2>
            <p className="muted small">The turn clock is on chain, so it keeps running while this is open.</p>
            <table className="controls-table"><tbody>
              {ROWS.map(([h, label]) => (
                <tr key={h}><td><Glyph h={h} /></td><td>{label}</td></tr>
              ))}
            </tbody></table>
            {!padConnected && <p className="muted small">🎮 Using a controller? Press any button on it (browsers only see a pad after a press).</p>}
            <div className="cta">
              <button className="primary" onClick={() => set({ paused: null })}>Resume</button>
              <button className="ghost" onClick={() => set({ rumble: !rumbleOn })}>Rumble: {rumbleOn ? 'on' : 'off'}</button>
              <button className="ghost" onClick={() => { set({ paused: null }); useStore.getState().resetMatch(); useStore.getState().set({ screen: 'landing', matchId: null }); }}>Main menu</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
