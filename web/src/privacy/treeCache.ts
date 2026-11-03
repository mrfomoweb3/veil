// The pool's Merkle tree, synced incrementally. A full syncTree scans every block since the
// pool's deploy (~100 getLogs pages on Base Sepolia), so the leaves (public data) are cached
// and only new blocks are fetched. A rebuilt tree is trusted only if its root equals the
// pool's currentRoot(); otherwise it falls back to a full scan.
import type { Hex, PublicClient } from 'viem';
import { assertTreeMatchesChain, fieldToHex, hexToField, IncrementalMerkleTreePoseidon, syncTree, type ChainLeaf, type SyncedTree } from '@gloamtrade/sdk';
import { gloamNetwork, publicClient } from './gloamNetwork';

interface Cached { pool: string; toBlock: string; leaves: { c: Hex; tx?: Hex }[] }

export interface LeafStore {
  load(pool: string): Promise<Cached | null>;
  save(c: Cached): Promise<void>;
}

const key = (pool: string) => `veil:gloam-tree:${pool.toLowerCase()}`;
export const localLeafStore: LeafStore = {
  async load(pool) {
    try { return JSON.parse(localStorage.getItem(key(pool)) ?? 'null'); } catch { return null; }
  },
  async save(c) {
    try { localStorage.setItem(key(c.pool), JSON.stringify(c)); } catch { /* full or blocked: next sync is a full scan */ }
  },
};

/** Rebuild a SyncedTree from ordered commitments. */
export async function treeFrom(leaves: Cached['leaves']): Promise<SyncedTree> {
  const tree = new IncrementalMerkleTreePoseidon();
  await tree.init();
  const out: ChainLeaf[] = [];
  const indexByCommitment = new Map<string, number>();
  for (const l of leaves) {
    const leafIndex = await tree.insert(hexToField(l.c));
    out.push({ leafIndex, commitment: l.c, kind: 'shield', txHash: l.tx });
    indexByCommitment.set(l.c.toLowerCase(), leafIndex);
  }
  const pathForLeaf = async (i: number) => { try { return await tree.path(i); } catch { return null; } };
  return {
    tree,
    leaves: out,
    root: fieldToHex(tree.currentRoot),
    leafCount: tree.nextIndex,
    indexByCommitment,
    pathForLeaf,
    pathForCommitment: async (c: Hex) => {
      const i = indexByCommitment.get(c.toLowerCase());
      return i === undefined ? null : pathForLeaf(i);
    },
  };
}

/** Append new leaves to cached ones; a leaf seen twice (overlapping scans) is kept once. */
export function mergeLeaves(have: Cached['leaves'], add: Cached['leaves']): Cached['leaves'] {
  const seen = new Set(have.map((l) => l.c.toLowerCase()));
  return [...have, ...add.filter((l) => !seen.has(l.c.toLowerCase()) && seen.add(l.c.toLowerCase()))];
}

let inflight: Promise<SyncedTree> | null = null;

export function syncPool(store: LeafStore = localLeafStore): Promise<SyncedTree> {
  return (inflight ??= run(store).finally(() => { inflight = null; }));
}

async function run(store: LeafStore): Promise<SyncedTree> {
  const net = gloamNetwork();
  const client: PublicClient = publicClient(net);
  const cached = await store.load(net.pool);
  for (let attempt = 0; attempt < 2 && cached?.pool.toLowerCase() === net.pool.toLowerCase(); attempt++) {
    const head = await client.getBlockNumber({ cacheTime: 0 });
    const from = BigInt(cached.toBlock) + 1n;
    const delta = from <= head ? await syncTree(client, { pool: net.pool, fromBlock: from }) : null;
    const leaves = mergeLeaves(cached.leaves, delta?.leaves.map((l) => ({ c: l.commitment, tx: l.txHash })) ?? []);
    const synced = await treeFrom(leaves);
    if (await assertTreeMatchesChain(client, net.pool, synced)) {
      await store.save({ pool: net.pool, toBlock: head.toString(), leaves });
      return synced;
    }
    // A leaf may have landed between the scan and the root read; one more pass catches it.
    cached.leaves = leaves;
    cached.toBlock = head.toString();
  }
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const full = await syncTree(client, { pool: net.pool, fromBlock: net.deployBlock });
  await store.save({ pool: net.pool, toBlock: head.toString(), leaves: full.leaves.map((l) => ({ c: l.commitment, tx: l.txHash })) });
  return full;
}
