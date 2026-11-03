// Keeps the store in step with the chain: match status, my decrypted view, public history.
import { useEffect } from 'react';
import { useStore } from '../store';
import type { Match, PublicFacts, PublicTurnRaw, ViewOut } from '../chain/types';
import { fromB64, INFO_VIEW, open, viewAad } from '../protocol/crypto';
import { decodeView, ISSUES, ORDER_LABEL } from '../protocol/view';
import { Board } from '../protocol/hex';
import { emptyOrders } from '../protocol/orders';
import { loadMemory, saveMemory, viewKey } from '../session';
import { rumble } from '../input/rumble';
import { warlordName } from './warlords';

const hexLabel = (h: [number, number]) => `(${h[0]}, ${h[1]})`;

export function seatName(m: Match | null, i: number, me?: string) {
  const s = m?.seats[i];
  if (!s) return `Seat ${i + 1}`;
  if (s.account === me) return 'You';
  if (s.ai) return warlordName(s.account);
  return s.account.length > 22 ? s.account.slice(0, 10) + '…' + s.account.slice(-6) : s.account;
}

async function refresh() {
  const st = useStore.getState();
  const { chain, matchId } = st;
  if (!chain || matchId == null) return;
  const match = await chain.view<Match | null>('get_match', { match_id: matchId });
  if (!match) return;
  const prev = st.match;
  useStore.setState({ match });

  // Public history (append only).
  if (st.history.length < match.turn + 1 || (prev && prev.status !== match.status)) {
    const more = await chain.view<PublicTurnRaw[]>('get_history', { match_id: matchId, from: st.history.length, limit: 60 });
    if (more.length) {
      const history = [...useStore.getState().history, ...more];
      const facts: PublicFacts[] = history.map((h) => JSON.parse(h.public));
      useStore.setState({ history, facts });
      for (const f of facts.slice(st.history.length)) announce(f, match, chain.account);
    }
  }

  // My view.
  const mine = match.seats.find((s) => s.account === chain.account);
  if (!mine) return;
  const v = await chain.view<ViewOut | null>('get_view', { match_id: matchId, account: chain.account });
  if (!v || (st.view && v.turn <= st.view.turn)) return;
  const { sk } = viewKey(chain.account);
  let pv;
  try {
    pv = decodeView(open(sk, fromB64(v.ciphertext), viewAad(matchId, v.turn, chain.account), INFO_VIEW));
  } catch {
    useStore.getState().set({ error: 'Your view could not be decrypted with this browser’s key. Use “Re-key” to register a new one; it applies from the next turn.' });
    return;
  }
  const board = new Board(pv.radius);
  const memory = st.memory && st.memory.length === board.size ? st.memory : loadMemory(matchId, chain.account, board.size);
  for (const t of pv.tiles) memory[t.index] = t.terrain;
  saveMemory(matchId, chain.account, memory);
  const enemiesBefore = st.view ? st.view.tiles.filter((t) => t.owner != null && t.owner !== st.view!.me).length : 0;
  const enemiesNow = pv.tiles.filter((t) => t.owner != null && t.owner !== pv.me).length;
  useStore.setState({ view: pv, memory: new Int8Array(memory), draft: emptyOrders(), selected: null, submittedTurn: null, error: null });
  if (pv.reports.length) rumble('combat');
  else if (enemiesNow > enemiesBefore) rumble('reveal');
  for (const f of pv.feedback) useStore.getState().push(`${ORDER_LABEL(f.order)}: ${ISSUES[f.issue] ?? 'issue ' + f.issue}`, 'bad', pv.turn);
  for (const r of pv.reports) {
    const where = hexLabel(board.hex(r.tile));
    const text = r.edgeTo != null
      ? `Your column clashed with enemies on the way from ${where}: ${r.mineBefore}→${r.mineAfter} vs ${r.othersBefore}→${r.othersAfter}`
      : `${r.won ? 'Victory' : 'Defeat'} at ${where}: your ${r.mineBefore}→${r.mineAfter}, enemy ${r.othersBefore}→${r.othersAfter}`;
    useStore.getState().push(text, r.won ? 'good' : 'bad', pv.turn);
  }
}

function announce(f: PublicFacts, m: Match, me: string) {
  const push = useStore.getState().push;
  if (f.turn === 0) return push('The clouds part over your capital. Everything else is veiled.', 'info', 0);
  if (f.battles.length) push(`Battle${f.battles.length > 1 ? 's' : ''} broke out at ${f.battles.map((b) => hexLabel(b)).join(', ')}`, 'battle', f.turn);
  if (f.skirmishes.length) push(`${f.skirmishes.length} column${f.skirmishes.length > 1 ? 's' : ''} met in the open sky`, 'battle', f.turn);
  for (const e of f.eliminated) push(`${seatName(m, e, me)} ${m.seats[e]?.account === me ? 'were' : 'was'} eliminated — the capital has fallen`, m.seats[e]?.account === me ? 'bad' : 'good', f.turn);
  if (f.game_over) push('The war is over. The Reveal is coming.', 'info', f.turn);
}

export function useMatchSync() {
  const chain = useStore((s) => s.chain);
  const matchId = useStore((s) => s.matchId);
  useEffect(() => {
    if (!chain || matchId == null) return;
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy || !alive) return;
      busy = true;
      try { await refresh(); } catch (e) { console.warn(e); } finally { busy = false; }
    };
    tick();
    // Events trigger a refresh at once; the poll is a fallback. Public RPCs rate-limit, so it's slower off devnet.
    const t = setInterval(tick, chain.network === 'devnet' ? 1500 : 3000);
    const off = chain.onEvent((e) => {
      const d = e.data[0] as { match?: number };
      if (d?.match === matchId) tick();
    });
    return () => { alive = false; clearInterval(t); off(); };
  }, [chain, matchId]);
}
