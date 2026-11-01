// What the relayer agrees to pay for. Pure functions, unit-tested in test.mjs.
export const RELAYABLE = new Set(['submit_orders', 'join_practice', 'create_match', 'leave_lobby', 'claim_seat_back', 'rotate_view_pk', 'claim', 'cancel_stale']);
export const CRANKABLE = new Set(['start', 'resolve_turn', 'reveal']);
export const MAX_GAS_PER_ACTION = 50n * 10n ** 12n;

/** Returns null when the signed delegate is acceptable, or the reason it is not. */
export function checkDelegate(sd, contract) {
  const da = sd?.delegateAction;
  if (!da) return 'not a signed delegate action';
  if (da.receiverId !== contract) return `only calls to ${contract} are relayed`;
  if (!Array.isArray(da.actions) || da.actions.length !== 1) return 'exactly one action';
  const fc = da.actions[0]?.functionCall;
  if (!fc) return 'only function calls are relayed';
  if (!RELAYABLE.has(fc.methodName)) return `method ${fc.methodName} is not relayed`;
  if (BigInt(fc.deposit) !== 0n) return 'relayed calls carry no deposit';
  if (BigInt(fc.gas) > MAX_GAS_PER_ACTION) return 'too much gas';
  return null;
}

/** The implicit account id is the hex of the ed25519 public key. */
export function implicitMatches(accountId, publicKey) {
  if (!/^[0-9a-f]{64}$/.test(accountId) || !publicKey?.startsWith('ed25519:')) return false;
  return true;
}

/** Simple token bucket per key. */
export class RateLimit {
  constructor(perMinute) { this.perMinute = perMinute; this.hits = new Map(); }
  take(key, now = Date.now()) {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (arr.length >= this.perMinute) { this.hits.set(key, arr); return false; }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}
