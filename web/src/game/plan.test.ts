import { describe, expect, it } from 'vitest';
import { carryPlan } from './plan';
import { Board, type Hex } from '../protocol/hex';
import { emptyOrders, FORT_COST } from '../protocol/orders';
import type { PlayerView } from '../protocol/view';

const board = new Board(2);
const H = (i: number) => board.hex(i);
const nb = (i: number) => board.hexes.findIndex((h) => Math.abs(h[0] - H(i)[0]) + Math.abs(h[1] - H(i)[1]) + Math.abs(h[0] + h[1] - H(i)[0] - H(i)[1]) === 2);

function view(over: Partial<PlayerView> = {}): PlayerView {
  return {
    turn: 3, me: 0, radius: 2, capital: 0, alive: true, gameOver: false, aether: 20, income: 4, scout: null,
    seats: [
      { alive: true, warlord: false, tiles: 2, intelPrice: 0, trucePrice: 0, truceUntil: 0 },
      { alive: true, warlord: true, tiles: 3, intelPrice: 3, trucePrice: 2, truceUntil: 0 },
    ],
    tiles: [
      { index: 0, terrain: 1, owner: 0, troops: 5, fort: false },
      { index: nb(0), terrain: 1, owner: 0, troops: 2, fort: false },
    ],
    reports: [], feedback: [], ...over,
  };
}

describe('carrying a plan onto the next turn', () => {
  it('keeps what still fits', () => {
    const plan = { ...emptyOrders(), recruit: 2, moves: [{ from: H(0), to: H(nb(0)), count: 6 }], fort: H(nb(0)) as Hex };
    const r = carryPlan(plan, view());
    expect(r.orders).toEqual(plan);
    expect(r.trimmed).toBe(0);
  });

  it('trims a move to the troops now there, recruits included', () => {
    const plan = { ...emptyOrders(), recruit: 1, moves: [{ from: H(0), to: H(nb(0)), count: 9 }] };
    const r = carryPlan(plan, view());
    expect(r.orders.moves[0].count).toBe(6);
    expect(r.trimmed).toBe(1);
  });

  it('drops orders from an island that was lost', () => {
    const lost = view({ tiles: [{ index: 0, terrain: 1, owner: 0, troops: 5, fort: false }, { index: nb(0), terrain: 1, owner: 1, troops: 4, fort: false }] });
    const plan = { ...emptyOrders(), moves: [{ from: H(nb(0)), to: H(0), count: 1 }], fort: H(nb(0)) as Hex };
    const r = carryPlan(plan, lost);
    expect(r.orders.moves).toEqual([]);
    expect(r.orders.fort).toBeNull();
    expect(r.trimmed).toBe(2);
  });

  it('respects the new aether: recruits, then fort, scout and trades in that order', () => {
    const plan = { ...emptyOrders(), recruit: 5, fort: H(nb(0)) as Hex, trades: [{ with: 1, kind: { truce: { turns: 3 } } }] };
    const r = carryPlan(plan, view({ aether: 5 + FORT_COST }));
    expect(r.orders.recruit).toBe(5);
    expect(r.orders.fort).toEqual(H(nb(0)));
    expect(r.orders.trades).toEqual([]);
    expect(r.trimmed).toBe(1);
  });

  it('drops trades with a warlord that has fallen, and everything if I have', () => {
    const plan = { ...emptyOrders(), trades: [{ with: 1, kind: { intel: { at: H(3) } } }] };
    const v = view();
    v.seats[1].alive = false;
    expect(carryPlan(plan, v).orders.trades).toEqual([]);
    expect(carryPlan({ ...plan, recruit: 1 }, view({ alive: false })).kept).toBe(0);
  });
});
