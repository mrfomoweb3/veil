import { useStore } from '../store';
import { viewKey } from '../session';
import type { Mode } from '../chain/types';

export async function openMatch(id: number) {
  const st = useStore.getState();
  st.resetMatch();
  st.set({ matchId: id, screen: 'match' });
}

export async function createMatch(opts: { mode: Mode; seats: number; ai: number; turnLenMs: number; turns: number; start: boolean }) {
  const { chain } = useStore.getState();
  if (!chain) throw new Error('not connected');
  const id = await chain.call<number>('create_match', {
    mode: opts.mode,
    max_seats: opts.seats,
    turn_len_ms: opts.turnLenMs,
    ai_seats: opts.ai,
    max_turns: opts.turns,
  });
  const { pkHex } = viewKey(chain.account);
  if (opts.mode === 'Practice') {
    await chain.call('join_practice', { match_id: id, view_pk: pkHex });
    if (opts.start) await chain.call('start', { match_id: id });
  }
  await openMatch(id);
  return id;
}

export async function joinMatch(id: number, mode: Mode) {
  const { chain } = useStore.getState();
  if (!chain) throw new Error('not connected');
  const { pkHex } = viewKey(chain.account);
  if (mode === 'Practice') {
    await chain.call('join_practice', { match_id: id, view_pk: pkHex });
  } else {
    await chain.call('ft_transfer_call', { amount: mode.Stakes.buy_in, msg: JSON.stringify({ join: id, view_pk: pkHex }) });
  }
  await openMatch(id);
}

export const quickPractice = () => createMatch({ mode: 'Practice', seats: 4, ai: 3, turnLenMs: 45_000, turns: 15, start: true });
