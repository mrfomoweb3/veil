// NEAR → Base through NEAR Intents (1Click), for winnings on their way into the Gloam vault.
//   Leg A: NEAR USDC → Base USDC at the player's Chain Signatures address (what gets sealed).
//   Leg B: a little NEAR USDC → Base ETH at the same address, only when it lacks gas.
// The player's NEAR account sends USDC to each quote's one-time deposit address; 1Click
// settles and pays out on Base. It never holds keys: if a swap fails, the USDC is refunded
// to the player's NEAR account.
//
// 1Click has no testnet. On testnet the UI says so and the Base address is funded from faucets.
import type { Address } from 'viem';

const API = ((import.meta.env?.VITE_ONECLICK_URL as string | undefined) ?? 'https://1click.chaindefuser.com').replace(/\/$/, '');

/** 1Click asset ids (mainnet; checked against /v0/tokens on 2026-11-06). */
export const ASSETS = {
  nearUsdc: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
  baseUsdc: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
  baseEth: 'nep141:base.omft.near',
} as const;
/** The NEAR USDC token contract the deposit goes to. */
export const NEAR_USDC = ASSETS.nearUsdc.slice('nep141:'.length);

/** About $0.30 of Base ETH covers an approve, a shield and a spare. */
export const GAS_LEG_USDC = 300_000n;
/** Below this, Leg B is needed (enough for roughly two shield transactions on Base). */
export const MIN_GAS_WEI = 40_000_000_000_000n; // 0.00004 ETH
export const SLIPPAGE_BPS = 100;

export interface Quote {
  amountIn: string; amountOut: string; amountOutFormatted: string; minAmountOut: string;
  timeEstimate: number; refundFee?: string; depositAddress?: string; deadline?: string;
}
export interface QuoteResponse { correlationId: string; timestamp: string; signature: string; quote: Quote; quoteRequest: Record<string, unknown> }
export type SwapStatus = 'KNOWN_DEPOSIT_TX' | 'PENDING_DEPOSIT' | 'INCOMPLETE_DEPOSIT' | 'PROCESSING' | 'SUCCESS' | 'REFUNDED' | 'FAILED';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`NEAR Intents: ${(j as { message?: string }).message ?? `HTTP ${r.status}`}`);
  return j as T;
}

export interface QuoteArgs {
  destinationAsset: string;
  /** NEAR USDC in base units (6 decimals). */
  amount: bigint;
  /** The player's NEAR account: refunds go back here. */
  nearAccount: string;
  /** The Base address that receives. */
  recipient: Address;
  /** A dry quote shows the price without opening a deposit address. */
  dry: boolean;
}

export function quoteRequest(a: QuoteArgs, now = Date.now()) {
  return {
    dry: a.dry,
    swapType: 'EXACT_INPUT',
    slippageTolerance: SLIPPAGE_BPS,
    originAsset: ASSETS.nearUsdc,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: a.destinationAsset,
    amount: a.amount.toString(),
    refundTo: a.nearAccount,
    refundType: 'ORIGIN_CHAIN',
    recipient: a.recipient,
    recipientType: 'DESTINATION_CHAIN',
    // Refunds start if the swap hasn't settled by then; NEAR deposits land in seconds.
    deadline: new Date(now + 30 * 60_000).toISOString(),
    referral: 'veil',
  };
}

export const quote = (a: QuoteArgs) => api<QuoteResponse>('/v0/quote', { method: 'POST', body: JSON.stringify(quoteRequest(a)) });

/** Optional, speeds 1Click up: tells it which NEAR transaction carried the deposit. */
export const submitDeposit = (txHash: string, depositAddress: string) =>
  api('/v0/deposit/submit', { method: 'POST', body: JSON.stringify({ txHash, depositAddress }) }).catch(() => {});

export const swapStatus = (depositAddress: string) =>
  api<{ status: SwapStatus; swapDetails?: { destinationChainTxHashes?: { hash: string; explorerUrl?: string }[] } }>(`/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`);

/** Waits for a terminal state. */
export async function waitForSwap(depositAddress: string, onStatus?: (s: SwapStatus) => void, timeoutMs = 15 * 60_000) {
  const end = Date.now() + timeoutMs;
  let delay = 3000;
  while (Date.now() < end) {
    const s = await swapStatus(depositAddress).catch(() => null);
    if (s) {
      onStatus?.(s.status);
      if (s.status === 'SUCCESS') return s;
      if (s.status === 'REFUNDED' || s.status === 'FAILED') throw new Error(`The swap was ${s.status.toLowerCase()}; your USDC goes back to your NEAR account.`);
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 15_000);
  }
  throw new Error('The swap is taking longer than expected. It continues on its own; check back in a few minutes.');
}

export interface BridgePlan {
  /** Leg B (gas), when the Base address needs ETH. */
  gas: bigint;
  /** Leg A, what arrives as USDC to be sealed. */
  usdc: bigint;
}

/** How much of `amount` goes to gas and how much to USDC. */
export function bridgePlan(amount: bigint, baseEthWei: bigint): BridgePlan {
  const gas = baseEthWei < MIN_GAS_WEI ? GAS_LEG_USDC : 0n;
  if (amount <= gas) throw new Error(`Bridge at least ${Number(gas + 500_000n) / 1e6} USDC: part of it buys the Base gas.`);
  return { gas, usdc: amount - gas };
}

export type BridgeStep =
  | { step: 'quoting' }
  | { step: 'depositing'; leg: 'gas' | 'usdc' }
  | { step: 'swapping'; leg: 'gas' | 'usdc'; status: SwapStatus }
  | { step: 'arrived'; usdcOut: bigint };

/** What the bridge needs from the NEAR side: a USDC transfer from the player's account. */
export interface NearSender {
  account: string;
  /** Sends NEAR USDC (registering the receiver's storage if needed); returns the tx hash. */
  ftTransfer(token: string, to: string, amount: bigint): Promise<string>;
}

/** Runs both legs (gas first, so the address can act as soon as the USDC lands). */
export async function bridgeToBase(o: { near: NearSender; recipient: Address; amount: bigint; baseEthWei: bigint; onStep?: (s: BridgeStep) => void }) {
  const plan = bridgePlan(o.amount, o.baseEthWei);
  const legs: ['gas' | 'usdc', string, bigint][] = [];
  if (plan.gas) legs.push(['gas', ASSETS.baseEth, plan.gas]);
  legs.push(['usdc', ASSETS.baseUsdc, plan.usdc]);
  let usdcOut = 0n;
  for (const [leg, asset, amount] of legs) {
    o.onStep?.({ step: 'quoting' });
    const q = await quote({ destinationAsset: asset, amount, nearAccount: o.near.account, recipient: o.recipient, dry: false });
    const dep = q.quote.depositAddress;
    if (!dep) throw new Error('NEAR Intents gave no deposit address.');
    o.onStep?.({ step: 'depositing', leg });
    const tx = await o.near.ftTransfer(NEAR_USDC, dep, amount);
    submitDeposit(tx, dep);
    await waitForSwap(dep, (status) => o.onStep?.({ step: 'swapping', leg, status }));
    if (leg === 'usdc') usdcOut = BigInt(q.quote.minAmountOut);
  }
  o.onStep?.({ step: 'arrived', usdcOut });
  return { plan, usdcOut };
}
