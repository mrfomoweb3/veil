import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, recoverAddress, toHex } from 'viem';
import { secp256k1 } from '@noble/curves/secp256k1';
import { derivedAddress, derivedPublicKey, signArgs, toEvmSignature } from './chainSig';

// Answers of v1.signer-prod.testnet's `derived_public_key` view (domain 0), 2026-11-06.
const LIVE: [string, string, string][] = [
  ['veil-clouds-relay.testnet', 'veil-base-1', '04cbac695596146372560d1c21f014c386aa0c25dcdb63f3438d7be61d895dca12ab9042520ba2e8937fdee23e9364301c41c5c5593b4b28838b68b180d945a3d3'],
  ['ab'.repeat(32), 'veil-base-1', '041c1927cccdbe1cabedfc601f29c22201c530189c83c935dea7b46420bd9a42c4294878b02021c5449f4c3808185e6cab071ba69c9457f13860ba7ec405803449'],
  ['alice.testnet', 'veil-base-2', '04ce6e3e68631ef36f84a300570c1bdc10983e5ff8d397432f0e1f1f19d94cfb1d098cdbe6d8e886d80b3df2476ef2f9dbb13455f0edc704c12c66b3811899f190'],
];

describe('Chain Signatures', () => {
  it('derives the same key as the MPC contract', () => {
    for (const [acct, path, want] of LIVE) expect(derivedPublicKey('testnet', acct, path)).toBe(want);
  });

  it('turns the key into a checksummed EVM address', () => {
    const a = derivedAddress('testnet', 'ab'.repeat(32));
    expect(a).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(derivedAddress('testnet', 'ab'.repeat(32), 'veil-base-2')).not.toBe(a);
    expect(derivedAddress('mainnet', 'ab'.repeat(32))).not.toBe(a);
  });

  it('converts an MPC answer into a signature that recovers to the signer', async () => {
    const pk = secp256k1.utils.randomPrivateKey();
    const hash = keccak256(toHex('veil'));
    const sig = secp256k1.sign(hash.slice(2), pk);
    const mpc = {
      big_r: { affine_point: (sig.recovery ? '03' : '02') + sig.r.toString(16).padStart(64, '0') },
      s: { scalar: sig.s.toString(16).padStart(64, '0') },
      recovery_id: sig.recovery,
    };
    const who = await recoverAddress({ hash, signature: toEvmSignature(mpc) });
    expect(who).toBe(privateKeyToAccount(toHex(pk)).address);
  });

  it('refuses malformed answers and arguments', () => {
    expect(() => toEvmSignature({ big_r: { affine_point: '02' }, s: { scalar: '00' }, recovery_id: 0 })).toThrow();
    expect(() => toEvmSignature({ big_r: { affine_point: '02' + '1'.repeat(64) }, s: { scalar: '1'.repeat(64) }, recovery_id: 2 })).toThrow();
    expect(() => signArgs('0x1234')).toThrow();
    expect(signArgs(`0x${'AB'.repeat(32)}`).request).toEqual({ payload_v2: { Ecdsa: 'ab'.repeat(32) }, path: 'veil-base-1', domain_id: 0 });
  });
});
