// NEP-413 off-chain message signing: the payload a NEAR wallet hashes and signs for
// `signMessage`. The vault key is derived from this signature. ed25519 is deterministic,
// so the same account signing the same fixed message always gets the same key back.
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

export const VAULT_MESSAGE = 'VEIL private vault key v1. Signing this costs nothing and sends nothing.';
export const VAULT_RECIPIENT = 'veil.vault';
export const VAULT_NONCE = sha256(utf8ToBytes('veil-vault-nonce-v1'));

const TAG = 2 ** 31 + 413;

const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const str = (s: string) => { const b = utf8ToBytes(s); return [u32(b.length), b]; };

/** sha256(borsh(tag) ‖ borsh({message, nonce, recipient, callbackUrl: None})) */
export function nep413Hash(message: string, nonce: Uint8Array, recipient: string): Uint8Array {
  if (nonce.length !== 32) throw new Error('NEP-413 nonce must be 32 bytes');
  const parts = [u32(TAG), ...str(message), nonce, ...str(recipient), new Uint8Array([0])];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return sha256(out);
}

export const vaultMessageHash = () => nep413Hash(VAULT_MESSAGE, VAULT_NONCE, VAULT_RECIPIENT);
