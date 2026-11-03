// One interface for whoever signs on Base, so the shield and cash-out code don't care.
// Default (day 8): NEAR Chain Signatures. Fallback: the player's own wallet (injectedSigner).
import { encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem';
import { GLOAM_VAULT_AGENT_ABI, type IntentExec } from '@gloamtrade/sdk';
import { publicClient } from './gloamNetwork';

export interface BaseTx { to: Address; data: Hex; value?: bigint }

export interface BaseSigner {
  readonly kind: 'chain-signatures' | 'injected';
  address(): Promise<Address>;
  /** Signs and broadcasts; returns the tx hash. */
  sendTx(tx: BaseTx): Promise<Hex>;
}

export const approveTx = (token: Address, spender: Address, amount: bigint): BaseTx => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }),
});

/** Calldata for a builder's resolved call (shieldBound / unshield) on the vault. */
export const execTx = (exec: IntentExec): BaseTx => ({
  to: exec.poolAddress,
  data: encodeFunctionData({ abi: GLOAM_VAULT_AGENT_ABI, functionName: exec.fn as 'shieldBound' | 'unshield', args: exec.args as never }),
  value: exec.valueWei,
});

/** Waits for the receipt and throws if the tx reverted. */
export async function waitForReceipt(hash: Hex) {
  const r = await publicClient().waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== 'success') throw new Error(`Base transaction reverted: ${hash}`);
  return r;
}
