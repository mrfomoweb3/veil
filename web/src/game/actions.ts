// Drafting orders locally and sealing them for the enclave.
import { useStore } from '../store';
import { Board, hexDistance, sameHex, type Hex } from '../protocol/hex';
import { encodeOrders, FORT_COST, MAX_MOVES, MAX_RECRUIT, MAX_TRADES, SCOUT_COST, SCOUT_STEPS, type Trade } from '../protocol/orders';
import { fromHex, INFO_ORDERS, ordersAad, seal, toB64 } from '../protocol/crypto';
import { Terrain } from '../protocol/view';
import { play } from '../audio/sound';

export function boardOf() {
  const v = useStore.getState().view;
  return v ? new Board(v.radius) : null;
}

export function tileAt(i: number) {
  return useStore.getState().view?.tiles.find((t) => t.index === i) ?? null;
}

/** What a trade will cost at the warlord's current (public) prices. */
export function tradeCost(t: Trade) {
  const seat = useStore.getState().view?.seats[t.with];
  if (!seat) return 0;
  return 'intel' in t.kind ? seat.intelPrice : seat.trucePrice * t.kind.truce.turns;
}

export function spent() {
  const { draft } = useStore.getState();
  return draft.recruit + (draft.fort ? FORT_COST : 0) + (draft.scout ? SCOUT_COST : 0) + draft.trades.reduce((n, t) => n + tradeCost(t), 0);
}

/** Add a trade to the draft if there is room and aether for it. */
export function addTrade(t: Trade) {
  const st = useStore.getState();
  const v = st.view;
  if (!v) return false;
  if (st.draft.trades.length >= MAX_TRADES) { st.push(`At most ${MAX_TRADES} trades per turn.`, 'bad'); return false; }
  if (spent() + tradeCost(t) > v.aether) { st.push('Not enough aether for that trade.', 'bad'); return false; }
  st.set({ draft: { ...st.draft, trades: [...st.draft.trades, t] } });
  return true;
}

export function removeTrade(k: number) {
  const st = useStore.getState();
  st.set({ draft: { ...st.draft, trades: st.draft.trades.filter((_, j) => j !== k) } });
}

/** Troops that can still leave tile `i` this turn given the draft (recruits appear at the capital). */
export function available(i: number) {
  const { view, draft } = useStore.getState();
  const board = boardOf();
  const t = tileAt(i);
  if (!view || !board || !t || t.owner !== view.me) return 0;
  const h = board.hex(i);
  const out = draft.moves.filter((m) => sameHex(m.from, h)).reduce((s, m) => s + m.count, 0);
  return t.troops + (i === view.capital ? draft.recruit : 0) - out;
}

function passableKnown(i: number) {
  const mem = useStore.getState().memory;
  const t = tileAt(i);
  const terrain = t ? t.terrain : mem?.[i] ?? -1;
  return terrain >= 0 && terrain !== Terrain.Void;
}

export function moveTargets(from: number): number[] {
  const board = boardOf();
  if (!board) return [];
  const h = board.hex(from);
  return board.hexes.map((_, i) => i).filter((i) => hexDistance(board.hex(i), h) === 1 && passableKnown(i));
}

export function clickTile(i: number) {
  const st = useStore.getState();
  const { view, draft, selected, tool, match } = st;
  const board = boardOf();
  if (!view || !board || !view.alive || (match?.status !== 'Running' && match?.status !== 'Resolving')) return;
  const mine = tileAt(i)?.owner === view.me;
  const h = board.hex(i);

  if (tool === 'intel') {
    const w = st.intelFrom;
    if (w == null) return st.set({ tool: 'move' });
    if (addTrade({ with: w, kind: { intel: { at: h } } })) st.push(`Intel on ${fmtHex(h)} ordered — paid only if the warlord can see it.`, 'info');
    return st.set({ tool: 'move', intelFrom: null });
  }

  if (tool === 'fort') {
    if (!mine) return st.push('Forts can only be raised on your own islands.', 'bad');
    if (tileAt(i)?.fort) return st.push('That island is already fortified.', 'bad');
    const fort = draft.fort && sameHex(draft.fort, h) ? null : h;
    const cost = spent() - (draft.fort ? FORT_COST : 0) + (fort ? FORT_COST : 0);
    if (cost > view.aether) return st.push(`A fort costs ${FORT_COST} aether.`, 'bad');
    return st.set({ draft: { ...draft, fort } });
  }

  if (tool === 'scout') {
    const path = draft.scout ? [...draft.scout] : [];
    if (path.length && sameHex(path[path.length - 1], h)) {
      path.pop();
      return st.set({ draft: { ...draft, scout: path.length ? path : null } });
    }
    if (path.length >= SCOUT_STEPS) return st.push('A scout flies at most 3 steps.', 'bad');
    if (path.length === 0) {
      const ok = mine || board.hexes.some((n, j) => hexDistance(n, h) === 1 && tileAt(j)?.owner === view.me);
      if (!ok) return st.push('A scout sets off from one of your islands or right next to one.', 'bad');
      if (spent() + SCOUT_COST > view.aether) return st.push(`A scout costs ${SCOUT_COST} aether.`, 'bad');
    } else if (hexDistance(path[path.length - 1], h) !== 1) {
      return st.push('Each scout step must be to a neighbouring island.', 'bad');
    }
    return st.set({ draft: { ...draft, scout: [...path, h] } });
  }

  // Move tool.
  if (selected == null) {
    if (mine && available(i) > 0) st.set({ selected: i });
    return;
  }
  if (selected === i) return st.set({ selected: null });
  if (moveTargets(selected).includes(i)) {
    if (draft.moves.length >= MAX_MOVES && !draft.moves.some((m) => sameHex(m.from, board.hex(selected)) && sameHex(m.to, h))) {
      return st.push(`At most ${MAX_MOVES} moves per turn.`, 'bad');
    }
    const avail = available(selected);
    const keep = selected === view.capital ? Math.min(2, Math.max(0, avail - 1)) : 0;
    const count = Math.max(1, avail - keep);
    if (avail <= 0) return st.set({ selected: null });
    const from = board.hex(selected);
    const existing = draft.moves.find((m) => sameHex(m.from, from) && sameHex(m.to, h));
    const moves = existing
      ? draft.moves.map((m) => (m === existing ? { ...m, count: m.count + count } : m))
      : [...draft.moves, { from, to: h, count }];
    return st.set({ draft: { ...draft, moves }, selected: null });
  }
  if (mine && available(i) > 0) return st.set({ selected: i });
  st.set({ selected: null });
}

export function setMoveCount(k: number, count: number) {
  const st = useStore.getState();
  const board = boardOf();
  const m = st.draft.moves[k];
  if (!m || !board) return;
  const from = board.index(m.from)!;
  const max = available(from) + m.count;
  const moves = st.draft.moves.map((x, j) => (j === k ? { ...x, count: Math.max(0, Math.min(max, count)) } : x)).filter((x) => x.count > 0);
  st.set({ draft: { ...st.draft, moves } });
}

export function removeMove(k: number) {
  const st = useStore.getState();
  st.set({ draft: { ...st.draft, moves: st.draft.moves.filter((_, j) => j !== k) } });
}

export function setRecruit(n: number) {
  const st = useStore.getState();
  const v = st.view;
  if (!v) return;
  const others = spent() - st.draft.recruit;
  const r = Math.max(0, Math.min(n, MAX_RECRUIT, v.aether - others));
  // Moves out of the capital may rely on recruits; clamp them if recruits shrink.
  st.set({ draft: { ...st.draft, recruit: r } });
}

export async function sendOrders() {
  const st = useStore.getState();
  const { chain, match, view, draft } = st;
  if (!chain || !match || !view || !match.game_pk) return;
  const pt = encodeOrders(draft);
  const ct = seal(fromHex(match.game_pk), pt, ordersAad(match.id, match.turn, chain.account), INFO_ORDERS);
  // A busy public RPC can refuse the relay for a moment (429) or time out. Sending again is safe:
  // a second submit for the same turn only replaces the first.
  for (let attempt = 1; ; attempt++) {
    try {
      await chain.call('submit_orders', { match_id: match.id, turn: match.turn, ct_b64: toB64(ct) });
      break;
    } catch (e) {
      const transient = (e as { transient?: boolean }).transient ?? /429|Rate limit|timeout|timed out|Failed to fetch/i.test((e as Error).message ?? '');
      if (attempt >= 3 || !transient) { play('error'); throw e; }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  st.set({ submittedTurn: match.turn, sealedOrders: draft, sealedBy: [...new Set([...st.sealedBy, chain.account])] });
  play('seal');
  st.push(`Orders sealed for turn ${match.turn}. Nobody can read them, not even us.`, 'good');
  // Last one in: start the turn now rather than when the relayer next looks (up to 5 s later).
  // The relayer runs one resolve per match at a time, so a crank it already started is joined.
  if (chain.network !== 'devnet') {
    const waiting = match.seats.filter((s) => s.alive && !s.ai && !s.autopilot).map((s) => s.account);
    chain.view<string[]>('get_submitted', { match_id: match.id })
      .then((sub) => {
        const inn = new Set([...sub, chain.account]);
        if (waiting.every((a) => inn.has(a))) return chain.call('resolve_turn', { match_id: match.id });
      })
      .catch(() => {});
  }
}

export const fmtHex = (h: Hex) => `(${h[0]}, ${h[1]})`;
