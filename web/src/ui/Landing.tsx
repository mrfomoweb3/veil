import { useMemo, useState } from 'react';
import { World } from '../scene/World';
import { Islands } from '../scene/Islands';
import { FogClouds } from '../scene/Sky';
import { decorativeTiles } from '../scene/tiles';
import { useStore } from '../store';
import { quickPractice } from './lobbyActions';
import { Logo } from './Logo';

const RUNES = ['ᚠ', 'ᚱ', 'ᛉ', 'ᚦ'];

export function Landing() {
  const tiles = useMemo(() => decorativeTiles(5), []);
  const chain = useStore((s) => s.chain);
  const set = useStore((s) => s.set);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const quick = async () => {
    setBusy(true);
    setErr(null);
    try { await quickPractice(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="screen intro">
      <World focus={[0, 0, 0]} distance={20} auto>
        <Islands tiles={tiles} />
        <FogClouds tiles={tiles} />
      </World>
      <div className="intro-shade" />
      {RUNES.map((r, k) => <div key={k} className={`runestone r${k}`} aria-hidden><span>{r}</span></div>)}
      <main className="intro-center">
        <Logo />
        <button className="play-btn" onClick={() => set({ screen: 'tutorial' })}>
          <span>PLAY</span>
        </button>
        <div className="intro-links">
          <button className="link" disabled={!chain || busy} onClick={quick}>{busy ? 'Raising the islands…' : 'Skip the tutorial — quick match'}</button>
          <span>·</span>
          <button className="link" disabled={!chain} onClick={() => set({ screen: 'lobby' })}>Lobbies</button>
        </div>
        <p className="intro-tag">A strategy game where even the developer can’t see the map.</p>
        {err && <div className="err">{err}</div>}
      </main>
    </div>
  );
}
