// NEAR Chain Signatures, the pure parts: which Base address a NEAR account controls, and how
// the MPC network's answer becomes an EVM signature. Mirrors near/mpc's `derive_key_secp256k1`
// (and chainsig.js, the reference client, which is too heavy to ship in the game bundle).
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha3_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';
import { getAddress, keccak256, type Address, type Hex } from 'viem';

/** The MPC contract and its secp256k1 root key (x‖y, from its `public_key` view). */
export const MPC = {
  testnet: {
    contract: 'v1.signer-prod.testnet',
    root: 'a8bb8176747682aab5c681d4ef375ca537023b2b287d8b5f9d89505277a5a291538ef3680882d8fb793a62a5fdb4c6974c7cd8f9eb0b9cbbf659314c30347000',
  },
  mainnet: {
    contract: 'v1.signer',
    root: '903a9a9933ed92bdda3fcf30ac999060a5a0fa51c2b6c74838d3029a5aadefe038f7e4a91714f42bb5a2459a0d294be0cd047b4a999d6fd912702470f843271d',
  },
} as const;

/** One path for VEIL's Base address. Changing it changes every player's address. */
export const BASE_PATH = 'veil-base-1';

const TWEAK_PREFIX = 'near-mpc-recovery v0.1.0 epsilon derivation:';

/** The derived child public key, uncompressed (04‖x‖y), hex. */
export function derivedPublicKey(network: keyof typeof MPC, account: string, path = BASE_PATH): string {
  const root = secp256k1.ProjectivePoint.fromHex('04' + MPC[network].root);
  const tweak = BigInt('0x' + bytesToHex(sha3_256(`${TWEAK_PREFIX}${account},${path}`)));
  return root.add(secp256k1.ProjectivePoint.BASE.multiply(tweak)).toHex(false);
}

export function derivedAddress(network: keyof typeof MPC, account: string, path = BASE_PATH): Address {
  const pub = derivedPublicKey(network, account, path);
  return getAddress(`0x${keccak256(`0x${pub.slice(2)}`).slice(-40)}`);
}

/** What the MPC contract's `sign` returns for an ECDSA request. */
export interface MpcSignature { big_r: { affine_point: string }; s: { scalar: string }; recovery_id: number }

export function toEvmSignature(sig: MpcSignature): { r: Hex; s: Hex; yParity: number } {
  const bigR = sig?.big_r?.affine_point;
  const s = sig?.s?.scalar;
  if (typeof bigR !== 'string' || bigR.length !== 66 || typeof s !== 'string' || s.length !== 64 || ![0, 1].includes(sig.recovery_id)) {
    throw new Error('The signer returned an unexpected signature');
  }
  return { r: `0x${bigR.slice(2)}`, s: `0x${s}`, yParity: sig.recovery_id };
}

/** The `sign` call's arguments for a 32-byte hash. */
export const signArgs = (hash: Hex, path = BASE_PATH) => {
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('sign takes a 32-byte hash');
  return { request: { payload_v2: { Ecdsa: hash.slice(2).toLowerCase() }, path, domain_id: 0 } };
};
