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
import { carryPlan } from './plan';
import { callsign } from './callsign';
import { play, wind } from '../audio/sound';

const hexLabel = (h: [number, number]) => `(${h[0]}, ${h[1]})`;

export function seatName(m: Match | null, i: number, me?: string) {
  const s = m?.seats[i];
  if (!s) return `Seat ${i + 1}`;
  if (s.account === me) return 'You';
  if (s.ai) return warlordName(s.account);
  const name = callsign(s.account);
  // Two players with the same war name in one match: number the later one.
  const twin = m!.seats.findIndex((o, j) => j < i && !o.ai && callsign(o.account) === name);
  return twin >= 0 ? `${name} ${i + 1}` : name;
}

async function refresh() {
  const st = useStore.getState();
  const { chain, matchId } = st;
  if (!chain || matchId == null) return;
  const match = await chain.view<Match | null>('get_match', { match_id: matchId });
  if (!match) return;
  const prev = st.match;
  useStore.setState({ match });
  const seatedMe = match.seats.some((s) => s.account === chain.account);

  // Who has sealed this turn (never what): shown next to each player.
  if (match.status === 'Running' && seatedMe) {
    chain.view<string[]>('get_submitted', { match_id: matchId }).then((sealedBy) => {
      const was = useStore.getState().sealedBy;
      if (useStore.getState().match?.turn !== match.turn) return;
      useStore.setState({ sealedBy });
      if (sealedBy.some((a) => a !== chain.account && !was.includes(a))) play('tick');
    }).catch(() => {});
  }

  // The turn went into the enclave. From here the draft is the plan for the next turn; the
  // sealed orders stay on the board until the result arrives.
  if (match.status === 'Resolving' && !st.planning) {
    const sealed = st.submittedTurn === match.turn;
    useStore.setState({
      planning: true,
      resolvingSince: prev?.status === 'Running' ? Date.now() : null,
      sealedBy: [],
      draft: sealed ? emptyOrders() : st.draft,
      selected: null,
    });
  }
  if (prev && ['Running', 'Resolving'].includes(prev.status) && match.status === 'Finished') play('end');

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
  const now = useStore.getState();
  const carried = now.planning ? carryPlan(now.draft, pv) : null;
  const took = now.resolvingSince ? Date.now() - now.resolvingSince : null;
  const before = st.view;
  const fallen = before ? pv.seats.map((x, i) => (before.seats[i]?.alive && !x.alive ? seatName(match, i, chain.account) : null)).filter((x): x is string => !!x) : [];
  const won = pv.reports.filter((r) => r.edgeTo == null && r.won).length;
  const lost = pv.reports.filter((r) => r.edgeTo == null && !r.won).length;
  const clashes = pv.reports.filter((r) => r.edgeTo != null).length;
  useStore.setState({
    view: pv, memory: new Int8Array(memory), draft: carried?.orders ?? emptyOrders(), selected: null, submittedTurn: null, error: null,
    planning: false, sealedOrders: null, sealedBy: [], resolvingSince: null,
    resolveMs: took ? [...now.resolveMs, took].slice(-5) : now.resolveMs,
    recap: before ? {
      turn: pv.turn, won, lost, clashes,
      tiles: pv.seats[pv.me]?.tiles ?? 0, tilesDelta: (pv.seats[pv.me]?.tiles ?? 0) - (before.seats[before.me]?.tiles ?? 0),
      aether: pv.aether, income: pv.income, fallen,
      plan: carried && (carried.kept || carried.trimmed) ? { kept: carried.kept, trimmed: carried.trimmed } : null,
      at: Date.now(),
    } : null,
  });
  if (pv.reports.length) rumble('combat');
  else if (enemiesNow > enemiesBefore) rumble('reveal');
  if (before) {
    if (!pv.alive && before.alive) play('fall');
    else if (lost) play('defeat');
    else if (won) play('victory');
    else if (clashes) play('battle');
    else play('turn');
    if (fallen.length && pv.alive) setTimeout(() => play('fall'), 700);
  }
  if (carried?.trimmed) useStore.getState().push(`Your plan carried over; ${carried.trimmed} order${carried.trimmed > 1 ? 's were' : ' was'} trimmed to fit the new board.`, 'info', pv.turn);
  else if (carried?.kept) useStore.getState().push('Your plan carried over. Check it, then seal.', 'info', pv.turn);
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
    wind(true);
    // Events trigger a refresh at once; the poll is a fallback. Public RPCs rate-limit, so it's slower off devnet.
    const t = setInterval(tick, chain.network === 'devnet' ? 1500 : 3000);
    const off = chain.onEvent((e) => {
      const d = e.data[0] as { match?: number };
      if (d?.match === matchId) tick();
    });
    return () => { alive = false; clearInterval(t); off(); wind(false); };
  }, [chain, matchId]);
}
