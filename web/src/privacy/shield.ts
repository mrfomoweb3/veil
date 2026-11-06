// Deposit USDC from the player's Base address into Gloam: approve, prove, save the note,
// then broadcast. The note is saved BEFORE the deposit is sent: its secret is the only key
// to the money, so a tab that closes after broadcast must still have it.
import { erc20Abi, type Address, type Hex } from 'viem';
import { approvalSteps, buildShieldBoundIntent, openNotePoseidon } from '@gloamtrade/sdk';
import { syncPool } from './treeCache';
import { approveTx, execTx, waitForReceipt, type BaseSigner } from './baseSigner';
import { depositPlan, gloamNetwork, publicClient, usdc } from './gloamNetwork';
import type { NoteVault, StoredNote } from './noteVault';
import { workerProver } from './prover';

export type ShieldStep =
  | { step: 'approving'; deposit: number; of: number; tx?: Hex }
  | { step: 'sealing'; deposit: number; of: number }
  | { step: 'sending'; deposit: number; of: number; tx?: Hex }
  | { step: 'checking' }
  | { step: 'private'; notes: StoredNote[]; leftover: bigint };

export async function shieldUsdc(opts: { signer: BaseSigner; vault: NoteVault; amount: bigint; onStep?: (s: ShieldStep) => void }): Promise<{ notes: StoredNote[]; leftover: bigint; unindexed: number }> {
  const { signer, vault, amount } = opts;
  const on = opts.onStep ?? (() => {});
  const net = gloamNetwork();
  const asset = usdc(net).address;
  const client = publicClient(net);
  const owner = await signer.address();

  const held = await client.readContract({ address: asset, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });
  if (held < amount) throw new Error(`Your Base address holds ${held} USDC base units, less than the ${amount} to deposit.`);

  const { chunks, leftover } = await depositPlan(asset, amount, net);
  if (chunks.length === 0) throw new Error('The vault has no room for deposits right now. Your USDC stays in your Base address.');

  const notes: StoredNote[] = [];
  for (const [i, chunk] of chunks.entries()) {
    const k = { deposit: i + 1, of: chunks.length };
    const allowance = await client.readContract({ address: asset, abi: erc20Abi, functionName: 'allowance', args: [owner, net.pool] });
    for (const value of approvalSteps(net.chainId, asset, allowance, chunk)) {
      on({ step: 'approving', ...k });
      const tx = await signer.sendTx(approveTx(asset, net.pool, value));
      on({ step: 'approving', ...k, tx });
      await waitForReceipt(tx);
    }

    on({ step: 'sealing', ...k });
    const intent = await buildShieldBoundIntent({
      chainId: net.chainId,
      poolAddress: net.pool,
      asset,
      amountWei: chunk,
      prover: workerProver('shield', net.chainId),
      client,
    });

    const note: StoredNote = {
      commitment: intent.note.commitment,
      secret: intent.note.secret,
      amountWei: chunk.toString(),
      asset: asset as Address,
      chainId: net.chainId,
      status: 'pending',
      createdAt: Date.now(),
    };
    await vault.save(note);

    on({ step: 'sending', ...k });
    const tx = await signer.sendTx(execTx(intent.exec));
    on({ step: 'sending', ...k, tx });
    await waitForReceipt(tx);
    notes.push(await vault.markConfirmed(note.commitment, tx));
  }

  // The deposit's receipt is final, but public RPCs serve the new tree leaf a few seconds late.
  // Wait for it (it is what a cash-out proves against); after a minute, report it, don't fail:
  // the money is in the pool and the note is saved either way.
  on({ step: 'checking' });
  let unindexed = notes.length;
  for (let i = 0; i < 12 && unindexed; i++) {
    if (i) await new Promise((r) => setTimeout(r, 5000));
    const synced = await syncPool().catch(() => null);
    if (synced) unindexed = notes.filter((n) => !synced.indexByCommitment.has(n.commitment.toLowerCase())).length;
  }
  on({ step: 'private', notes, leftover });
  return { notes, leftover, unindexed };
}

/**
 * Settle notes left `pending` by a closed tab: a commitment that is in the pool tree was
 * deposited; one that isn't was never sent, and nothing was spent on it.
 */
export async function reconcilePending(vault: NoteVault): Promise<{ confirmed: number; unsent: number }> {
  const pending = (await vault.list()).filter((n) => n.status === 'pending');
  if (!pending.length) return { confirmed: 0, unsent: 0 };
  const synced = await syncPool();
  let confirmed = 0;
  for (const n of pending) {
    const i = synced.indexByCommitment.get(n.commitment.toLowerCase());
    if (i == null) continue;
    await vault.markConfirmed(n.commitment, synced.leaves[i]?.txHash ?? '');
    confirmed++;
  }
  return { confirmed, unsent: pending.length - confirmed };
}

const IS_SPENT_ABI = [{ type: 'function', name: 'isSpent', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] }] as const;

/** Whether the pool has already spent this note (its nullifier is used). */
export async function noteIsSpent(n: StoredNote): Promise<boolean> {
  const { nullifier } = await openNotePoseidon(n.secret as Hex, BigInt(n.amountWei), n.asset);
  const net = gloamNetwork();
  return publicClient(net).readContract({ address: net.pool, abi: IS_SPENT_ABI, functionName: 'isSpent', args: [nullifier] });
}

/**
 * Settle notes the pool has already spent but this browser still holds as confirmed: a tab
 * that closed after Gloam's relay sent the cash-out, or a spend made from a restored backup
 * on another device. Keeps the shown balance true.
 */
export async function reconcileSpent(vault: NoteVault): Promise<number> {
  const live = (await vault.list()).filter((n) => n.status === 'confirmed');
  let spent = 0;
  for (const n of live) {
    if (await noteIsSpent(n).catch(() => false)) {
      await vault.markSpent(n.commitment, n.spentTx ?? '');
      spent++;
    }
  }
  return spent;
}
