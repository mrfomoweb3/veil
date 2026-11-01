import { describe, expect, it } from 'vitest';
import { stepCursor } from './boardCursor';
import { tilesFromState } from '../scene/tiles';
import { Board } from '../protocol/hex';
import { Terrain } from '../protocol/view';

const board = new Board(2);
const tiles = tilesFromState(2, board.hexes.map(() => ({ terrain: Terrain.Plains, owner: null, troops: 0, fort: false })));
const at = (q: number, r: number) => board.index([q, r])!;

describe('board cursor (camera at its default azimuth 0: looking down -z)', () => {
  it('right on screen is +x on the board', () => {
    expect(board.hex(stepCursor(tiles, at(0, 0), 1, 0))).toEqual([1, 0]);
  });
  it('up on screen moves to a neighbour with smaller z (r - 1)', () => {
    const h = board.hex(stepCursor(tiles, at(0, 0), 0, -1));
    expect(h[1]).toBe(-1);
  });
  it('stays put at the edge of the board', () => {
    expect(stepCursor(tiles, at(2, 0), 1, 0)).toBe(at(2, 0));
  });
});
