import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { INFO_ORDERS, INFO_VIEW, open, ordersAad, publicKey, seal, toHex, viewAad } from './crypto';
import { encodeOrders } from './orders';
import { Board, inferCapitals } from './hex';

describe('crypto', () => {
  it('matches the Rust implementation byte for byte', () => {
    const sk = new Uint8Array(32).fill(0x11);
    const ct = seal(publicKey(sk), new TextEncoder().encode('veil'), new TextEncoder().encode('veil|1|1|a.near'), INFO_ORDERS, new Uint8Array(56).fill(0x22));
    const rust = readFileSync(new URL('../../../crates/veil-crypto/vector.hex', import.meta.url), 'utf8').trim();
    expect(toHex(ct)).toBe(rust);
  });

  it('binds ciphertexts to match, turn and seat', () => {
    const sk = new Uint8Array(32).fill(7);
    const ct = seal(publicKey(sk), new Uint8Array([1, 2, 3]), viewAad(1, 2, 'a.near'), INFO_VIEW);
    expect(Array.from(open(sk, ct, viewAad(1, 2, 'a.near'), INFO_VIEW))).toEqual([1, 2, 3]);
    expect(() => open(sk, ct, viewAad(1, 3, 'a.near'), INFO_VIEW)).toThrow();
    expect(() => open(sk, ct, ordersAad(1, 2, 'a.near'), INFO_VIEW)).toThrow();
  });

  it('pads orders to a fixed size', () => {
    expect(encodeOrders({ moves: [], scout: null, fort: null, recruit: 3 }).length).toBe(1024);
  });
});

describe('board', () => {
  it('has the Rust tile order', () => {
    const b = new Board(4);
    expect(b.size).toBe(61);
    expect(b.hex(0)).toEqual([-4, 0]);
    expect(b.index([0, 0])).toBe(30);
    expect(new Board(5).size).toBe(91);
  });
  it('infers capitals from one known capital', () => {
    const caps = inferCapitals(4, 4, 2, [3, -3]);
    expect(caps.length).toBe(4);
    expect(caps[2]).toEqual([3, -3]);
  });
});
