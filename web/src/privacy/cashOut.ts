// Cash a note out of Gloam to any Base address. By default the proof goes through Gloam's
// relay, so the player's own Base address (public, and derivable from their NEAR account)
// never appears next to the cash-out. The recipient is bound inside the proof, so the relay
// can only submit or refuse, never redirect.
import type { Address, Hex } from 'viem';
import { buildUnshieldIntent, cashOutFeeLive, cashOutTargetProblem, GloamRelayError, relayIntent, RELAY_MAYBE_SENT } from '@gloamtrade/sdk';
import { execTx, waitForReceipt, type BaseSigner } from './baseSigner';
import { gloamNetwork, publicClient } from './gloamNetwork';
import type { NoteVault, StoredNote } from './noteVault';
import { workerProver } from './prover';
import { syncPool } from './treeCache';

/** Same-origin route to Gloam's relay (which sends no CORS headers): the Vite proxy in dev, VEIL's relayer when deployed. */
const RELAY_URL = (import.meta.env?.VITE_GLOAM_RELAY_URL as string | undefined) ?? '/gloam-relay';

export type CashOutStep = 'syncing' | 'proving' | 'sending' | 'confirming' | 'done';

/** Why an address would lose the money, or null if it's fine. Run it as the player types. */
export function addressProblem(to: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return 'Enter a Base address (0x followed by 40 hex characters).';
  return cashOutTargetProblem(to, gloamNetwork());
}

/** The vault's live cash-out fee and what arrives. */
export async function cashOutQuote(amount: bigint) {
  const net = gloamNetwork();
  return cashOutFeeLive(publicClient(net), net.pool, amount);
}

export async function cashOut(opts: {
  vault: NoteVault;
  note: StoredNote;
  to: Address;
  /** Sends the unshield from this signer instead of the relay. Links the cash-out to that address. */
  selfSend?: BaseSigner;
  onStep?: (s: CashOutStep, tx?: Hex) => void;
}): Promise<Hex> {
  const { vault, note, to } = opts;
  const on = opts.onStep ?? (() => {});
  if (note.status !== 'confirmed') throw new Error(`This note is ${note.status}; only confirmed notes can be cashed out.`);
  const problem = addressProblem(to);
  if (problem) throw new Error(problem);

  const net = gloamNetwork();
  const client = publicClient(net);
  on('syncing');
  const synced = await syncPool();
  const path = await synced.pathForCommitment(note.commitment as Hex);
  if (!path) throw new Error('This note is not in the pool tree. If you just deposited, wait a minute and try again.');

  on('proving');
  const intent = await buildUnshieldIntent({
    chainId: net.chainId,
    poolAddress: net.pool,
    secretHex: note.secret as Hex,
    amountWei: BigInt(note.amountWei),
    asset: note.asset,
    to,
    path,
    prove: workerProver('unshield', net.chainId),
    client,
  });

  on('sending');
  let tx: Hex;
  try {
    tx = opts.selfSend ? await opts.selfSend.sendTx(execTx(intent.exec)) : await relayIntent(intent, { url: RELAY_URL });
  } catch (e) {
    if (e instanceof GloamRelayError && RELAY_MAYBE_SENT.has(e.code)) {
      throw new Error('The relay may have sent this cash-out. Check the vault before retrying; a retry is safe, since the pool refuses to spend a note twice.');
    }
    throw e;
  }
  on('confirming', tx);
  await waitForReceipt(tx);
  await vault.markSpent(note.commitment, tx);
  on('done', tx);
  return tx;
}
