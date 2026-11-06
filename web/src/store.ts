import { create } from 'zustand';
import type { Chain, Config, Match, PublicFacts, PublicTurnRaw } from './chain/types';
import type { PlayerView } from './protocol/view';
import { emptyOrders, type Orders } from './protocol/orders';

export type Screen = 'landing' | 'tutorial' | 'lobby' | 'match' | 'reveal' | 'vault' | 'invite';
export type Tool = 'move' | 'scout' | 'fort' | 'intel';
export interface TurnRecap { turn: number; won: number; lost: number; clashes: number; tiles: number; tilesDelta: number; aether: number; income: number; fallen: string[]; plan: { kept: number; trimmed: number } | null; at: number }
export interface FeedItem { id: number; turn: number; text: string; tone: 'info' | 'battle' | 'good' | 'bad' }

interface State {
  chain: Chain | null;
  config: Config | null;
  screen: Screen;
  error: string | null;
  matchId: number | null;
  match: Match | null;
  view: PlayerView | null;
  memory: Int8Array | null;
  history: PublicTurnRaw[];
  facts: PublicFacts[];
  draft: Orders;
  selected: number | null;
  tool: Tool;
  submittedTurn: number | null;
  feed: FeedItem[];
  attestTurn: number | null;
  /** Which warlord the 'intel' tool is buying from. */
  intelFrom: number | null;
  /** The orders sealed this turn, still drawn while the next turn is being planned. */
  sealedOrders: Orders | null;
  /** True while the enclave resolves: the draft is the plan for the next turn. */
  planning: boolean;
  /** Accounts that have sealed this turn (not what). */
  sealedBy: string[];
  /** When this browser saw the turn start resolving, and how long recent turns took. */
  resolvingSince: number | null;
  resolveMs: number[];
  recap: TurnRecap | null;
  set: (p: Partial<State>) => void;
  push: (text: string, tone?: FeedItem['tone'], turn?: number) => void;
  resetMatch: () => void;
}

let feedId = 0;
export const useStore = create<State>((set, get) => ({
  chain: null,
  config: null,
  screen: 'landing',
  error: null,
  matchId: null,
  match: null,
  view: null,
  memory: null,
  history: [],
  facts: [],
  draft: emptyOrders(),
  selected: null,
  tool: 'move',
  submittedTurn: null,
  feed: [],
  attestTurn: null,
  intelFrom: null,
  sealedOrders: null,
  planning: false,
  sealedBy: [],
  resolvingSince: null,
  resolveMs: [],
  recap: null,
  set: (p) => set(p),
  push: (text, tone = 'info', turn) =>
    set({ feed: [{ id: ++feedId, turn: turn ?? get().match?.turn ?? 0, text, tone }, ...get().feed].slice(0, 40) }),
  resetMatch: () =>
    set({ match: null, view: null, memory: null, history: [], facts: [], draft: emptyOrders(), selected: null, tool: 'move', submittedTurn: null, feed: [], attestTurn: null, intelFrom: null, sealedOrders: null, planning: false, sealedBy: [], resolvingSince: null, resolveMs: [], recap: null }),
}));
