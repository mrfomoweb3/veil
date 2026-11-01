import { useEffect } from 'react';
import { connect } from './chain';
import type { Config } from './chain/types';
import { useStore } from './store';
import { Landing } from './ui/Landing';
import { Lobby } from './ui/Lobby';
import { MatchScreen } from './ui/MatchScreen';
import { Reveal } from './ui/Reveal';
import { Tutorial } from './ui/Tutorial';
import { PauseMenu } from './ui/PauseMenu';
import { startGamepad } from './input/gamepad';
import { startKeyboard } from './input/keyboard';
import { startPointerTracking } from './input/inputMode';
import { startFocusManager } from './input/focus';

export function App() {
  const screen = useStore((s) => s.screen);
  const chain = useStore((s) => s.chain);
  const set = useStore((s) => s.set);
  const err = useStore((s) => s.error);

  useEffect(() => {
    startGamepad();
    const stops = [startKeyboard(), startPointerTracking(), startFocusManager()];
    return () => stops.forEach((f) => f());
  }, []);

  useEffect(() => {
    connect()
      .then(async (c) => set({ chain: c, config: await c.view<Config>('get_config') }))
      .catch((e) => set({ error: `Could not connect: ${(e as Error).message}` }));
  }, [set]);

  return (
    <>
      {screen === 'landing' && <Landing />}
      {screen === 'tutorial' && <Tutorial />}
      {screen === 'lobby' && chain && <Lobby />}
      {screen === 'match' && <MatchScreen />}
      {screen === 'reveal' && <Reveal />}
      {err && screen !== 'match' && <div className="banner bad">{err}</div>}
      <PauseMenu />
    </>
  );
}
