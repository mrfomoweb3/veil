// Which Gloam pool VEIL talks to. Testnet (Base Sepolia) runs the mainnet pool code and the
// ceremony's final keys with test funds; mainnet is opt-in via VITE_GLOAM_ENV=mainnet.
import './polyfill';
import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { isNoLimit, mainnetNetwork, readDepositLimit, testnetNetwork, type GloamAsset, type GloamNetwork, type LiveDepositLimit } from '@gloamtrade/sdk';
import { splitDeposits } from './noteVault';

export const GLOAM_ENV = ((import.meta.env?.VITE_GLOAM_ENV as string | undefined) ?? 'testnet') as 'testnet' | 'mainnet';

let cached: GloamNetwork | null = null;

export function gloamNetwork(): GloamNetwork {
  if (cached) return cached;
  const net = GLOAM_ENV === 'mainnet' ? mainnetNetwork('base') : testnetNetwork('base');
  if (!net) throw new Error(`Gloam has no published pool on Base ${GLOAM_ENV} in this SDK version.`);
  return (cached = net);
}

export function usdc(net = gloamNetwork()): GloamAsset {
  const a = net.assets.find((x) => x.symbol === 'USDC');
  if (!a) throw new Error(`Gloam's ${net.label} pool does not list USDC.`);
  return a;
}

let client: PublicClient | null = null;
export function publicClient(net = gloamNetwork()): PublicClient {
  return (client ??= createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) }) as PublicClient);
}

export interface DepositPlan {
  /** Deposits to make, each within the per-deposit limit. */
  chunks: bigint[];
  /** What the vault has no room for right now; stays in the player's Base address. */
  leftover: bigint;
}

/** Split `amount` by the vault's live limits (limits off, or unread, means one deposit; the vault enforces its own). */
export async function depositPlan(asset: Address, amount: bigint, net = gloamNetwork()): Promise<DepositPlan> {
  let live: LiveDepositLimit | null = null;
  try { live = await readDepositLimit(publicClient(net), net.pool, asset); } catch { /* fall back to launch values */ }
  if (live?.unlimited) return { chunks: splitDeposits(amount, amount || 1n), leftover: 0n };
  const known = net.assets.find((a) => a.address.toLowerCase() === asset.toLowerCase())?.depositLimit ?? null;
  const per = live ? live.perDeposit : known?.perDeposit;
  if (per == null) return { chunks: splitDeposits(amount, amount || 1n), leftover: 0n };
  if (per === 0n) throw new Error(`The ${net.label} vault takes no deposits of this asset.`);
  const room = live && !isNoLimit(live.total) ? live.room : amount;
  const fits = amount < room ? amount : room;
  return { chunks: splitDeposits(fits, isNoLimit(per) ? fits || 1n : per), leftover: amount - fits };
}

export const explorerTx = (hash: string, net = gloamNetwork()) => `${net.explorerUrl.replace(/\/$/, '')}/tx/${hash}`;
