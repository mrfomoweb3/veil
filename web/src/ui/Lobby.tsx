import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { Match } from '../chain/types';
import { createMatch, joinMatch, openMatch } from './lobbyActions';
import { WARLORDS, warlordName } from '../game/warlords';

const usd = (micro: string) => `$${(Number(micro) / 1e6).toFixed(2)}`;

export function Lobby() {
  const chain = useStore((s) => s.chain)!;
  const set = useStore((s) => s.set);
  const [matches, setMatches] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [seats, setSeats] = useState(4);
  const [ai, setAi] = useState(3);
  const [turnLen, setTurnLen] = useState(45_000);
  const [turns, setTurns] = useState(15);
  const [stakes, setStakes] = useState(false);
  const [buyIn, setBuyIn] = useState(1);
  const [usdc, setUsdc] = useState<string | null>(null);
  const [balance, setBalance] = useState('0');
  const [warlords, setWarlords] = useState<[string, { treasury: string; played: number; won: number; staked: string; earned: string }][]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [all, bal] = await Promise.all([
        chain.view<Match[]>('get_matches', { from_id: 1, limit: 100 }),
        chain.view<string>('get_balance', { account: chain.account }),
      ]);
      if (chain.network === 'devnet') setUsdc(await chain.view<string>('usdc_balance', { account: chain.account }));
      const lords = await chain.view<typeof warlords>('get_warlords').catch(() => []);
      if (alive) { setMatches(all.reverse()); setBalance(bal); setWarlords(lords); }
    };
    load().catch((e) => setErr(e.message));
    const t = setInterval(() => load().catch(() => {}), 3000);
    return () => { alive = false; clearInterval(t); };
  }, [chain]);

  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const mine = matches.filter((m) => m.seats.some((s) => s.account === chain.account) && m.status !== 'Cancelled');
  const open = matches.filter((m) => m.status === 'Lobby' && !m.seats.some((s) => s.account === chain.account));

  return (
    <div className="screen lobby">
      <header className="topbar">
        <button className="ghost" onClick={() => set({ screen: 'landing' })}>← VEIL</button>
        <div className="who">
          <span className="net">{chain.network}</span> {chain.account}
          {usdc != null && <span className="muted"> · {usd(usdc)} play-money USDC</span>}
        </div>
      </header>
      <div className="lobby-grid">
        <section className="panel">
          <h2>New match</h2>
          <label>Seats <input type="range" min={2} max={6} value={seats} onChange={(e) => { const v = +e.target.value; setSeats(v); setAi(Math.min(ai, v - 1)); }} /> <b>{seats}</b></label>
          <label>AI warlords <input type="range" min={0} max={seats - 1} value={ai} onChange={(e) => setAi(+e.target.value)} /> <b>{ai}</b></label>
          <label>Turn length
            <select value={turnLen} onChange={(e) => setTurnLen(+e.target.value)}>
              <option value={30_000}>30 s (blitz)</option>
              <option value={45_000}>45 s (fast)</option>
              <option value={120_000}>2 min</option>
              <option value={43_200_000}>12 h (async)</option>
            </select>
          </label>
          <label>Turns <input type="range" min={6} max={20} value={turns} onChange={(e) => setTurns(+e.target.value)} /> <b>{turns}</b></label>
          <label className="row"><input type="checkbox" checked={stakes} onChange={(e) => setStakes(e.target.checked)} /> Stakes (USDC buy-in, {chain.network === 'devnet' ? 'play money on devnet' : 'real money'})</label>
          {stakes && <label>Buy-in <select value={buyIn} onChange={(e) => setBuyIn(+e.target.value)}><option value={1}>$1</option><option value={5}>$5</option></select></label>}
          <p className="muted small">
            {ai > 0 ? `${ai} AI warlord${ai > 1 ? 's' : ''} fill${ai === 1 ? 's' : ''} seats. ` : ''}
            Practice starts when you press start; empty seats become warlords. {stakes ? 'Stakes pays 1st 60–100% of the pot after a 5% rake; AI seats never take prize money.' : ''}
          </p>
          <div className="cta">
            {!stakes && <button className="primary" disabled={busy} onClick={() => act(() => createMatch({ mode: 'Practice', seats, ai, turnLenMs: turnLen, turns, start: true }))}>Create & start</button>}
            {!stakes && <button className="ghost" disabled={busy} onClick={() => act(() => createMatch({ mode: 'Practice', seats, ai, turnLenMs: turnLen, turns, start: false }))}>Open a lobby</button>}
            {stakes && (
              <button className="primary" disabled={busy} onClick={() => act(async () => {
                const mode = { Stakes: { buy_in: String(buyIn * 1_000_000) } };
                const id = await chain.call<number>('create_match', { mode, max_seats: seats, turn_len_ms: turnLen, ai_seats: ai, max_turns: turns });
                await joinMatch(id, mode);
              })}>Create & buy in</button>
            )}
          </div>
          {chain.network === 'devnet' && <button className="link" disabled={busy} onClick={() => act(() => chain.call('faucet'))}>+ $10 play-money USDC (devnet faucet)</button>}
          {balance !== '0' && <button className="link" disabled={busy} onClick={() => act(() => chain.call('claim'))}>Claim {usd(balance)} winnings / refunds</button>}
          {err && <div className="err">{err}</div>}
        </section>

        <section className="panel warlords">
          <h2>Warlord wallets</h2>
          <p className="muted small">Each AI warlord holds its own USDC. It pays its own Stakes buy-ins and keeps what it wins. Nobody can withdraw it — not even us. Anyone can stake one.</p>
          {warlords.map(([id, b]) => (
            <div key={id} className="match-row lord-row">
              <b title={WARLORDS[id]?.style}>{warlordName(id)}</b>
              <span>{usd(b.treasury)}</span>
              <span className="muted small">{b.won}W / {b.played} played · won {usd(b.earned)}</span>
              <button className="small" disabled={busy} onClick={() => act(() => chain.call('ft_transfer_call', { amount: '1000000', msg: JSON.stringify({ fund_warlord: id }) }))}>Stake $1</button>
            </div>
          ))}
        </section>

        <section className="panel">
          <h2>Your matches</h2>
          {mine.length === 0 && <p className="muted">None yet.</p>}
          {mine.map((m) => (
            <div key={m.id} className="match-row" onClick={() => openMatch(m.id)}>
              <b>#{m.id}</b>
              <span>{m.mode === 'Practice' ? 'Practice' : `Stakes ${usd(m.mode.Stakes.buy_in)}`}</span>
              <span>{m.seats.length}/{m.max_seats} seats</span>
              <span className={`status s-${m.status}`}>{m.status}{m.status === 'Running' ? ` · turn ${m.turn}/${m.max_turns}` : ''}</span>
            </div>
          ))}
          <h2>Open lobbies</h2>
          {open.length === 0 && <p className="muted">No open lobbies — create one.</p>}
          {open.map((m) => (
            <div key={m.id} className="match-row">
              <b>#{m.id}</b>
              <span>{m.mode === 'Practice' ? 'Practice' : `Stakes ${usd(m.mode.Stakes.buy_in)}`}</span>
              <span>{m.seats.length + m.ai_seats}/{m.max_seats} seats</span>
              <button className="small" disabled={busy} onClick={() => act(() => joinMatch(m.id, m.mode))}>Join</button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
