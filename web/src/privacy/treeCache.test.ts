import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { mergeLeaves, treeFrom } from './treeCache';

const leaf = (n: number) => ({ c: `0x${n.toString(16).padStart(64, '0')}` as Hex });

describe('treeCache', () => {
  it('dedupes overlapping scans and keeps on-chain order', () => {
    expect(mergeLeaves([leaf(1), leaf(2)], [leaf(2), leaf(3)]).map((l) => l.c)).toEqual([leaf(1), leaf(2), leaf(3)].map((l) => l.c));
  });

  it('rebuilds the same root from cached + new leaves as from one scan', async () => {
    const whole = await treeFrom([leaf(1), leaf(2), leaf(3)]);
    const pieced = await treeFrom(mergeLeaves([leaf(1), leaf(2)], [leaf(2), leaf(3)]));
    expect(pieced.root).toBe(whole.root);
    expect(pieced.indexByCommitment.get(leaf(3).c)).toBe(2);
    const p = await pieced.pathForCommitment(leaf(2).c);
    expect(p?.pathElements).toHaveLength(20);
    expect(p?.root).toBe(whole.tree.currentRoot);
  }, 30_000);
});
