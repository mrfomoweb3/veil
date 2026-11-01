// ECIES: X25519 + HKDF-SHA256 + XChaCha20-Poly1305. Byte-for-byte the scheme of
// crates/veil-crypto (and of OutLayer's own secret encryption).
import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from '@noble/hashes/utils';

export const FORMAT = 0x01;
export const OVERHEAD = 1 + 32 + 24 + 16;
const enc = new TextEncoder();
export const INFO_ORDERS = enc.encode('veil-orders-v1');
export const INFO_VIEW = enc.encode('veil-view-v1');

export const ordersAad = (matchId: number, turn: number, account: string) => enc.encode(`veil|${matchId}|${turn}|${account}`);
export const viewAad = (matchId: number, turn: number, account: string) => enc.encode(`veil-view|${matchId}|${turn}|${account}`);

export function newSecretKey(): Uint8Array {
  return x25519.utils.randomPrivateKey();
}

export function publicKey(sk: Uint8Array): Uint8Array {
  return x25519.getPublicKey(sk);
}

function deriveKey(shared: Uint8Array, ephPk: Uint8Array, recipientPk: Uint8Array, info: Uint8Array) {
  const salt = new Uint8Array(64);
  salt.set(ephPk, 0);
  salt.set(recipientPk, 32);
  return hkdf(sha256, shared, salt, info, 32);
}

/** `entropy` (56 bytes) is for tests; normally fresh randomness is used. */
export function seal(recipientPk: Uint8Array, plaintext: Uint8Array, aad: Uint8Array, info: Uint8Array, entropy?: Uint8Array): Uint8Array {
  const ent = entropy ?? randomBytes(56);
  const ephSk = ent.slice(0, 32);
  const nonce = ent.slice(32, 56);
  const ephPk = x25519.getPublicKey(ephSk);
  const shared = x25519.getSharedSecret(ephSk, recipientPk);
  const key = deriveKey(shared, ephPk, recipientPk, info);
  const ct = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
  const out = new Uint8Array(1 + 32 + 24 + ct.length);
  out[0] = FORMAT;
  out.set(ephPk, 1);
  out.set(nonce, 33);
  out.set(ct, 57);
  return out;
}

export function open(sk: Uint8Array, payload: Uint8Array, aad: Uint8Array, info: Uint8Array): Uint8Array {
  if (payload.length < OVERHEAD || payload[0] !== FORMAT) throw new Error('malformed ciphertext');
  const ephPk = payload.slice(1, 33);
  const nonce = payload.slice(33, 57);
  const myPk = x25519.getPublicKey(sk);
  const shared = x25519.getSharedSecret(sk, ephPk);
  const key = deriveKey(shared, ephPk, myPk, info);
  return xchacha20poly1305(key, nonce, aad).decrypt(payload.slice(57));
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string) => Uint8Array.from(h.match(/.{2}/g) ?? [], (x) => parseInt(x, 16));
export const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const sha256Hex = (b: Uint8Array) => toHex(sha256(b));
