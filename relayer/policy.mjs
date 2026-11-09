// What the relayer agrees to pay for. Pure functions, unit-tested in test.mjs.
export const RELAYABLE = new Set(['submit_orders', 'join_practice', 'create_match', 'leave_lobby', 'claim_seat_back', 'rotate_view_pk', 'claim', 'cancel_stale']);
export const CRANKABLE = new Set(['start', 'resolve_turn', 'reveal']);
export const MAX_GAS_PER_ACTION = 50n * 10n ** 12n;

export const MPC_GAS = 300n * 10n ** 12n;
export const MPC_PATH = /^veil-[a-z0-9-]{1,32}$/;

/** Returns null when the signed delegate is acceptable, or the reason it is not.
 *  Besides calls to the game contract, it pays for one more thing: a Chain Signatures `sign`
 *  on the MPC contract (secp256k1, a `veil-` path, the 1 yoctoNEAR the MPC contract requires),
 *  so a player's NEAR account can sign its Base cash-out without holding NEAR for gas. */
export function checkDelegate(sd, contract, mpc = null) {
  const da = sd?.delegateAction;
  if (!da) return 'not a signed delegate action';
  if (mpc && da.receiverId === mpc) return checkMpcSign(da);
  if (da.receiverId !== contract) return `only calls to ${contract} are relayed`;
  if (!Array.isArray(da.actions) || da.actions.length !== 1) return 'exactly one action';
  const fc = da.actions[0]?.functionCall;
  if (!fc) return 'only function calls are relayed';
  if (!RELAYABLE.has(fc.methodName)) return `method ${fc.methodName} is not relayed`;
  if (BigInt(fc.deposit) !== 0n) return 'relayed calls carry no deposit';
  if (BigInt(fc.gas) > MAX_GAS_PER_ACTION) return 'too much gas';
  return null;
}

function checkMpcSign(da) {
  if (!Array.isArray(da.actions) || da.actions.length !== 1) return 'exactly one action';
  const fc = da.actions[0]?.functionCall;
  if (!fc || fc.methodName !== 'sign') return 'only sign is relayed to the signer';
  if (BigInt(fc.deposit) !== 1n) return 'sign carries exactly 1 yoctoNEAR';
  if (BigInt(fc.gas) > MPC_GAS) return 'too much gas';
  let req;
  try { req = JSON.parse(new TextDecoder().decode(Uint8Array.from(fc.args))).request; } catch { return 'unreadable sign args'; }
  if (req?.domain_id !== 0 || typeof req?.payload_v2?.Ecdsa !== 'string' || !/^[0-9a-f]{64}$/.test(req.payload_v2.Ecdsa)) return 'only secp256k1 hashes are signed';
  if (!MPC_PATH.test(req.path ?? '')) return 'only veil- derivation paths';
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

/**
 * Whether an RPC error means "this endpoint refused or could not take the request", so the same
 * request may go to the next endpoint. A refused request never ran, and re-sending the same
 * signed transaction elsewhere is harmless (the chain dedupes it by hash). Anything the chain
 * itself answered (InvalidNonce, a contract panic) is not a refusal and must not move.
 */
export function endpointRefused(e) {
  const status = typeof e?.cause === 'number' ? e.cause : null;
  if (status != null && [401, 402, 403, 404, 405, 429, 500, 502, 503, 504].includes(status)) return true;
  return /-429|\b429\b|Rate limits exceeded|Too Many Requests|UNAUTHORIZED|Unauthorized|Forbidden|invalid api key|FetchError|Failed to fetch|fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|Exceeded \d+ attempts/i.test(e?.message ?? '');
}

/** An endpoint for logs: scheme and host only, so a key in the path or query never lands in a log. */
export function hostOf(url) {
  try { const u = new URL(url); return `${u.protocol}//${u.host}`; } catch { return '(bad url)'; }
}
