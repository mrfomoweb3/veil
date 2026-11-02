import { create } from 'zustand';
import type { Chain, Config, Match, PublicFacts, PublicTurnRaw } from './chain/types';
import type { PlayerView } from './protocol/view';
import { emptyOrders, type Orders } from './protocol/orders';

export type Screen = 'landing' | 'tutorial' | 'lobby' | 'match' | 'reveal';
export type Tool = 'move' | 'scout' | 'fort' | 'intel';
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
  set: (p) => set(p),
  push: (text, tone = 'info', turn) =>
    set({ feed: [{ id: ++feedId, turn: turn ?? get().match?.turn ?? 0, text, tone }, ...get().feed].slice(0, 40) }),
  resetMatch: () =>
    set({ match: null, view: null, memory: null, history: [], facts: [], draft: emptyOrders(), selected: null, tool: 'move', submittedTurn: null, feed: [], attestTurn: null, intelFrom: null }),
}));
