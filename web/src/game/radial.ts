// The radial order menu: one menu for pad, keyboard, mouse (right-click) and touch (long-press).
// Options sit in fixed slots so the same flick always means the same order.
import { useStore } from '../store';
import { hexDistance, sameHex } from '../protocol/hex';
import { FORT_COST, SCOUT_COST, SCOUT_STEPS } from '../protocol/orders';
import { available, boardOf, clickTile, moveTargets, spent, tileAt } from './actions';

export type RadialId = 'march' | 'scout' | 'fort' | 'strike';
export type Slot = 'up' | 'right' | 'down' | 'left';

export interface RadialOption { id: RadialId; slot: Slot; label: string; icon: string; enabled: boolean; why?: string }

/** Screen direction of each slot (dy > 0 = down), for stick and arrow picking. */
export const SLOT_DIR: Record<Slot, [number, number]> = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };

/** Everything the menu needs to know about one tile, read from the store by `radialContext`. */
export interface RadialCtx {
  mine: boolean;
  /** Troops that could still leave this tile. */
  troops: number;
  fortified: boolean;
  /** A tile is selected and this tile is one step from it. */
  target: null | 'enemy' | 'unknown' | 'friendly' | 'empty';
  /** Why a scout can't use this tile now, or null if it can. */
  scoutBlock: string | null;
  aetherLeft: number;
  fortHere: boolean;
}

export function radialOptions(c: RadialCtx): RadialOption[] {
  const strikeLabel = c.target === 'enemy' ? 'Attack' : c.target === 'unknown' ? 'Attack into fog' : 'Move here';
  return [
    {
      id: 'march', slot: 'up', label: 'March from here', icon: '⚑',
      enabled: c.mine && c.troops > 0,
      why: !c.mine ? 'Not your island' : c.troops > 0 ? undefined : 'No troops left to send',
    },
    {
      id: 'scout', slot: 'right', label: 'Scout', icon: '👁',
      enabled: c.scoutBlock == null,
      why: c.scoutBlock ?? undefined,
    },
    {
      id: 'fort', slot: 'down', label: c.fortHere ? 'Cancel fort' : `Fortify (${FORT_COST})`, icon: '◆',
      enabled: c.fortHere || (c.mine && !c.fortified && c.aetherLeft >= FORT_COST),
      why: c.fortHere ? undefined : !c.mine ? 'Only on your own islands' : c.fortified ? 'Already fortified' : c.aetherLeft < FORT_COST ? `Needs ${FORT_COST} aether` : undefined,
    },
    {
      id: 'strike', slot: 'left', label: c.target ? strikeLabel : 'Attack', icon: '⚔',
      enabled: c.target != null,
      why: c.target ? undefined : 'Pick a march first, then open this on a neighbour',
    },
  ];
}

export function radialContext(i: number): RadialCtx | null {
  const { view, draft, selected } = useStore.getState();
  const board = boardOf();
  if (!view || !board) return null;
  const t = tileAt(i);
  const h = board.hex(i);
  const mine = t?.owner === view.me;
  const left = view.aether - spent();

  let target: RadialCtx['target'] = null;
  if (selected != null && selected !== i && moveTargets(selected).includes(i)) {
    if (!t) target = 'unknown';
    else if (t.owner === view.me) target = 'friendly';
    else if (t.owner != null) target = 'enemy';
    else target = 'empty';
  }

  const path = draft.scout ?? [];
  let scoutBlock: string | null = null;
  if (path.length && sameHex(path[path.length - 1], h)) scoutBlock = null; // undoes the last step
  else if (path.length >= SCOUT_STEPS) scoutBlock = `A scout flies at most ${SCOUT_STEPS} steps`;
  else if (path.length === 0) {
    const near = mine || board.hexes.some((n, j) => hexDistance(n, h) === 1 && tileAt(j)?.owner === view.me);
    if (!near) scoutBlock = 'Must start on or next to your island';
    else if (left < SCOUT_COST) scoutBlock = `Needs ${SCOUT_COST} aether`;
  } else if (hexDistance(path[path.length - 1], h) !== 1) scoutBlock = 'Each step must be to a neighbour';

  return {
    mine,
    troops: mine ? available(i) : 0,
    fortified: !!t?.fort,
    target,
    scoutBlock,
    aetherLeft: left,
    fortHere: !!draft.fort && sameHex(draft.fort, h),
  };
}

/** Carry out a menu choice through the same code path as clicking with that tool. */
export function applyRadial(id: RadialId, i: number) {
  const st = useStore.getState();
  if (id === 'march') return st.set({ tool: 'move', selected: i });
  if (id === 'strike') { st.set({ tool: 'move' }); return clickTile(i); }
  st.set({ tool: id === 'scout' ? 'scout' : 'fort' });
  clickTile(i);
  st.set({ tool: 'move' });
}

/** The option a stick or arrow push points at, if it's enabled. */
export function pickByDirection(opts: RadialOption[], dx: number, dy: number): RadialOption | null {
  const pm = Math.hypot(dx, dy);
  if (pm === 0) return null;
  let best: RadialOption | null = null;
  let score = 0.75; // within ~40° of a slot; an exact diagonal is ambiguous and picks nothing
  for (const o of opts) {
    const [x, y] = SLOT_DIR[o.slot];
    const s = (dx * x + dy * y) / pm;
    if (s > score) { score = s; best = o; }
  }
  return best;
}
