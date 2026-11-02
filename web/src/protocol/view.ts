// Decoder for the fixed-size binary view (crates/veil-rules/src/view.rs, VIEW_VERSION 1).
export enum Terrain { Plains = 0, Forest = 1, Highland = 2, Shrine = 3, Void = 4, Capital = 5 }
export const TERRAIN_NAMES = ['Plains', 'Forest', 'Highland', 'Shrine', 'Void', 'Capital'];
export const DEFENSE = [1.0, 1.25, 1.15, 1.0, 1.0, 1.5];
export const INCOME = [1, 1, 1, 3, 0, 3];

export interface VisibleTile { index: number; terrain: Terrain; owner: number | null; troops: number; fort: boolean }
export interface BattleReport { tile: number; edgeTo: number | null; won: boolean; mineBefore: number; mineAfter: number; othersBefore: number; othersAfter: number }
export interface Feedback { issue: number; order: number }
export interface SeatSummary { alive: boolean; tiles: number; warlord: boolean; intelPrice: number; trucePrice: number; truceUntil: number }
export interface PlayerView {
  turn: number; me: number; radius: number; capital: number; alive: boolean; gameOver: boolean;
  aether: number; income: number; seats: SeatSummary[]; scout: number | null;
  tiles: VisibleTile[]; reports: BattleReport[]; feedback: Feedback[];
}

export const ISSUES: Record<number, string> = {
  1: 'Your orders could not be read',
  2: 'You missed the turn',
  3: 'Too many moves (max 6)',
  4: 'Not your tile',
  5: 'Destination not adjacent',
  6: 'Destination is open sky',
  7: 'Not enough troops there',
  8: 'Recruitment reduced to what you could afford',
  9: 'Not enough aether',
  10: 'Fort could not be built there',
  11: 'Scout route invalid',
  12: 'Scout route cut short',
  13: 'Your scout was lost',
  14: 'Intel bought — the island is in your view',
  15: 'Truce bought — the warlord will hold back',
  16: 'The warlord can’t see that island, so there was nothing to sell (nothing charged)',
  17: 'Trade refused',
  18: 'You attacked a warlord you had a truce with — the truce is over',
};
export const ORDER_LABEL = (o: number) =>
  o === 200 ? 'Recruit' : o === 201 ? 'Fort' : o === 202 ? 'Scout' : o === 255 ? 'All orders' : o >= 210 && o < 255 ? `Trade ${o - 209}` : `Move ${o + 1}`;

export function decodeView(bytes: Uint8Array): PlayerView {
  const n = (bytes[0] << 8) | bytes[1];
  const b = bytes.subarray(2, 2 + n);
  let i = 0;
  const u8 = () => b[i++];
  const u16 = () => { const v = (b[i] << 8) | b[i + 1]; i += 2; return v; };
  const u32 = () => { const v = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; i += 4; return v; };
  if (u8() !== 2) throw new Error('unknown view version');
  const me = u8(), radius = u8(), capital = u8(), flags = u8();
  const turn = u32(), aether = u32(), income = u32();
  const seats = Array.from({ length: u8() }, () => {
    const f = u8();
    return { alive: (f & 1) !== 0, warlord: (f & 2) !== 0, tiles: u16(), intelPrice: u16(), trucePrice: u16(), truceUntil: u16() };
  });
  const sc = u8();
  const tiles = Array.from({ length: u8() }, () => {
    const index = u8(), packed = u8(), owner = u8(), troops = u16();
    return { index, terrain: (packed & 7) as Terrain, fort: (packed & 8) !== 0, owner: owner === 255 ? null : owner, troops };
  });
  const reports = Array.from({ length: u8() }, () => {
    const tile = u8(), e = u8(), won = u8() !== 0;
    return { tile, edgeTo: e === 255 ? null : e, won, mineBefore: u16(), mineAfter: u16(), othersBefore: u16(), othersAfter: u16() };
  });
  const feedback = Array.from({ length: u8() }, () => ({ issue: u8(), order: u8() }));
  return { turn, me, radius, capital, alive: (flags & 1) !== 0, gameOver: (flags & 2) !== 0, aether, income, seats, scout: sc === 255 ? null : sc, tiles, reports, feedback };
}
