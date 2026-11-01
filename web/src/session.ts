// The player's X25519 view key: generated in the browser, never leaves it. The enclave
// encrypts this player's view to its public half.
import { fromHex, newSecretKey, publicKey, toHex } from './protocol/crypto';

const key = (account: string) => `veil:viewsk:${account}`;

export function viewKey(account: string): { sk: Uint8Array; pkHex: string } {
  let hex = '';
  try { hex = localStorage.getItem(key(account)) ?? ''; } catch { /* storage blocked */ }
  let sk = hex.length === 64 ? fromHex(hex) : null;
  if (!sk) {
    sk = newSecretKey();
    try { localStorage.setItem(key(account), toHex(sk)); } catch { /* the key lives for this tab only */ }
  }
  return { sk, pkHex: toHex(publicKey(sk)) };
}

/** Make a fresh key (after a lost one); register it with rotate_view_pk. */
export function rotateViewKey(account: string) {
  try { localStorage.removeItem(key(account)); } catch { /* ignore */ }
  return viewKey(account);
}

/** Terrain the player has seen before, per match: the client-side fog memory. */
export function loadMemory(matchId: number, account: string, size: number): Int8Array {
  const mem = new Int8Array(size).fill(-1);
  try {
    const raw = localStorage.getItem(`veil:mem:${matchId}:${account}`);
    if (raw) JSON.parse(raw).forEach((v: number, i: number) => { if (i < size) mem[i] = v; });
  } catch { /* fresh memory */ }
  return mem;
}

export function saveMemory(matchId: number, account: string, mem: Int8Array) {
  try { localStorage.setItem(`veil:mem:${matchId}:${account}`, JSON.stringify(Array.from(mem))); } catch { /* ignore */ }
}
