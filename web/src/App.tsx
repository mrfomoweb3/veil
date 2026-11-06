import { lazy, Suspense, useEffect } from 'react';
import { connect } from './chain';
import type { Config } from './chain/types';
import { useStore } from './store';
import { Landing } from './ui/Landing';
import { Lobby } from './ui/Lobby';
import { MatchScreen } from './ui/MatchScreen';
import { Reveal } from './ui/Reveal';
import { Tutorial } from './ui/Tutorial';
import { PauseMenu } from './ui/PauseMenu';
import { followInvite, InviteScreen } from './ui/Invite';
import { routeMatch, useRouteSync } from './game/route';
import { initSound, wind } from './audio/sound';

const VaultPanel = lazy(() => import('./ui/vault/VaultPanel').then((m) => ({ default: m.VaultPanel })));
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
    initSound();
    startGamepad();
    const stops = [startKeyboard(), startPointerTracking(), startFocusManager()];
    return () => stops.forEach((f) => f());
  }, []);

  useRouteSync();
  // The fog's wind under the title screen and the tutorial; matches turn it on themselves.
  useEffect(() => { if (screen === 'landing' || screen === 'tutorial') { wind(true); return () => wind(false); } }, [screen]);
  useEffect(() => {
    connect()
      .then(async (c) => {
        set({ chain: c, config: await c.view<Config>('get_config') });
        // An invite link, or a reload in the middle of a match.
        const id = routeMatch();
        if (id != null) await followInvite(id);
      })
      .catch((e) => set({ error: `Could not connect: ${(e as Error).message}` }));
  }, [set]);

  return (
    <>
      {screen === 'landing' && <Landing />}
      {screen === 'tutorial' && <Tutorial />}
      {screen === 'lobby' && chain && <Lobby />}
      {screen === 'match' && <MatchScreen />}
      {screen === 'reveal' && <Reveal />}
      {screen === 'invite' && chain && <InviteScreen />}
      {screen === 'vault' && chain && <Suspense fallback={<div className="banner">Opening the vault…</div>}><VaultPanel /></Suspense>}
      {err && screen !== 'match' && <div className="banner bad">{err}</div>}
      <PauseMenu />
    </>
  );
}
