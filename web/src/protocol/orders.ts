// Orders as the enclave reads them (crates/veil-rules/src/orders.rs): JSON, length-prefixed,
// zero-padded to 1024 bytes so the ciphertext length says nothing.
import type { Hex } from './hex';

export const ORDERS_PLAINTEXT_LEN = 1024;
export const MAX_MOVES = 6, MAX_RECRUIT = 10, FORT_COST = 6, SCOUT_COST = 2, SCOUT_STEPS = 3;

export interface Move { from: Hex; to: Hex; count: number }
export interface Orders { moves: Move[]; scout: Hex[] | null; fort: Hex | null; recruit: number }

export const emptyOrders = (): Orders => ({ moves: [], scout: null, fort: null, recruit: 0 });

export function encodeOrders(o: Orders): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(o));
  if (json.length + 2 > ORDERS_PLAINTEXT_LEN) throw new Error('orders too long');
  const out = new Uint8Array(ORDERS_PLAINTEXT_LEN);
  out[0] = json.length >> 8;
  out[1] = json.length & 0xff;
  out.set(json, 2);
  return out;
}
