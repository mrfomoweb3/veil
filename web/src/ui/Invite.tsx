// Opening an invite link (`?m=12`): see who is in, take a seat with one click.
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { Match } from '../chain/types';
import { seatName } from '../game/sync';
import { seatColor } from '../scene/palette';
import { joinMatch, openMatch } from './lobbyActions';

const usd = (micro: string) => `$${(Number(micro) / 1e6).toFixed(2)}`;

/** Decides where a link lands: your seat, the invite card, The Reveal, or a polite dead end. */
export async function followInvite(id: number) {
  const { chain, set } = useStore.getState();
  if (!chain) return;
  const m = await chain.view<Match | null>('get_match', { match_id: id }).catch(() => null);
  if (!m) return set({ screen: 'landing', error: `Match #${id} does not exist on this network.` });
  if (m.seats.some((s) => s.account === chain.account)) return openMatch(id);
  if (m.status === 'Revealed') {
    useStore.getState().resetMatch();
    return set({ matchId: id, match: m, screen: 'reveal' });
  }
  useStore.getState().resetMatch();
  set({ matchId: id, match: m, screen: 'invite' });
}

export function InviteScreen() {
  const { chain, matchId, set } = useStore();
  const [m, setM] = useState<Match | null>(useStore.getState().match);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!chain || matchId == null) return;
    let alive = true;
    const load = () => chain.view<Match | null>('get_match', { match_id: matchId }).then((x) => {
      if (!alive || !x) return;
      setM(x);
      // Someone else's tab (or this account in another tab) may have seated us meanwhile.
      if (x.seats.some((s) => s.account === chain.account)) openMatch(x.id);
    }).catch(() => {});
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [chain, matchId]);

  if (!chain || !m) return null;
  const taken = m.seats.length + m.ai_seats;
  const open = m.status === 'Lobby' && taken < m.max_seats;
  const stakes = typeof m.mode === 'object' ? m.mode.Stakes.buy_in : null;
  const host = seatName(m, m.seats.findIndex((s) => s.account === m.host), chain.account);

  const join = async () => {
    setBusy(true);
    setErr(null);
    try { await joinMatch(m.id, m.mode); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="screen invite-screen">
      <div className="panel float-center invite">
        <h2>{open ? 'You’re invited to a war' : m.status === 'Lobby' ? 'This lobby is full' : 'This war has already begun'}</h2>
        <p className="muted">Match #{m.id} · hosted by {host} · {m.max_turns} turns of {Math.round(m.turn_len_ms / 1000)} s</p>
        <ul className="invite-seats">
          {m.seats.map((s, i) => <li key={s.account}><i className="dot" style={{ background: seatColor(i) }} /> {seatName(m, i, chain.account)}</li>)}
          {Array.from({ length: m.ai_seats }, (_, k) => <li key={`ai${k}`} className="muted"><i className="dot" /> AI warlord</li>)}
          {Array.from({ length: Math.max(0, m.max_seats - taken) }, (_, k) => <li key={`e${k}`} className="empty">open seat</li>)}
        </ul>
        {open ? (
          <>
            <button className="primary" disabled={busy} onClick={join}>
              {busy ? 'Taking your seat…' : stakes ? `Join for ${usd(stakes)} USDC` : 'Join the war'}
            </button>
            <p className="muted small">{stakes ? 'Your buy-in goes into the pot; the winner takes it after a 5% rake. Leave before the start and it comes back.' : 'Practice match: free, no wallet. The match starts when the host says so, or by itself once every seat is taken.'}</p>
          </>
        ) : (
          <p>{m.status === 'Lobby' ? 'Every seat is taken.' : 'You can’t join a match in progress. When it ends, this link opens its Reveal: the whole war with the fog lifted.'}</p>
        )}
        <div className="cta">
          <button className="ghost" onClick={() => set({ screen: 'lobby', matchId: null, match: null })}>Find another match</button>
          <button className="link" onClick={() => set({ screen: 'landing', matchId: null, match: null })}>Home</button>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
