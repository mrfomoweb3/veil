// Planning ahead: while the enclave resolves a turn, the player drafts the next one on the board
// they last saw. When the new view arrives, the plan is carried onto it: anything the new board
// no longer allows (an island lost, fewer troops, less aether, a warlord gone) is trimmed, never
// silently kept, and the player is told how much changed.
import { Board, hexDistance, sameHex } from '../protocol/hex';
import { emptyOrders, FORT_COST, MAX_RECRUIT, SCOUT_COST, type Orders } from '../protocol/orders';
import type { PlayerView } from '../protocol/view';

export interface Carried { orders: Orders; kept: number; trimmed: number }

const size = (o: Orders) => o.moves.length + (o.scout ? 1 : 0) + (o.fort ? 1 : 0) + (o.recruit ? 1 : 0) + o.trades.length;

export function carryPlan(plan: Orders, view: PlayerView): Carried {
  const before = size(plan);
  if (!before || !view.alive) return { orders: emptyOrders(), kept: 0, trimmed: before };
  const board = new Board(view.radius);
  const tile = (i: number | undefined) => (i == null ? undefined : view.tiles.find((t) => t.index === i));
  const mine = (i: number | undefined) => tile(i)?.owner === view.me;
  const out = emptyOrders();
  let budget = view.aether;
  let trimmed = 0;

  // Recruits first: moves out of the capital may count on them.
  out.recruit = Math.max(0, Math.min(plan.recruit, MAX_RECRUIT, budget));
  if (out.recruit < plan.recruit) trimmed++;
  budget -= out.recruit;

  const left = new Map<number, number>();
  for (const m of plan.moves) {
    const from = board.index(m.from);
    const t = tile(from);
    if (from == null || !t || t.owner !== view.me || board.index(m.to) == null || hexDistance(m.from, m.to) !== 1) { trimmed++; continue; }
    if (!left.has(from)) left.set(from, t.troops + (from === view.capital ? out.recruit : 0));
    const count = Math.min(m.count, left.get(from)!);
    if (count <= 0) { trimmed++; continue; }
    if (count < m.count) trimmed++;
    left.set(from, left.get(from)! - count);
    out.moves.push({ from: m.from, to: m.to, count });
  }

  if (plan.fort) {
    const i = board.index(plan.fort);
    if (mine(i) && !tile(i)!.fort && budget >= FORT_COST) { out.fort = plan.fort; budget -= FORT_COST; } else trimmed++;
  }

  if (plan.scout?.length) {
    const start = plan.scout[0];
    const near = view.tiles.some((t) => t.owner === view.me && (sameHex(board.hex(t.index), start) || hexDistance(board.hex(t.index), start) === 1));
    if (near && budget >= SCOUT_COST) { out.scout = plan.scout; budget -= SCOUT_COST; } else trimmed++;
  }

  for (const tr of plan.trades) {
    const seat = view.seats[tr.with];
    const cost = !seat ? Infinity : 'intel' in tr.kind ? seat.intelPrice : seat.trucePrice * tr.kind.truce.turns;
    if (seat?.alive && seat.warlord && budget >= cost) { out.trades.push(tr); budget -= cost; } else trimmed++;
  }

  return { orders: out, kept: size(out), trimmed };
}
