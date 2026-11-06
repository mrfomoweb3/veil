// Dry 1Click quotes for the cash-out legs (read-only: no deposit address is opened).
//   cd web && npx vite-node scripts/bridge-quote.ts [usdc] [base-address]
import { ASSETS, bridgePlan, quote } from '../src/privacy/bridge';
const amount = BigInt(Math.round(Number(process.argv[2] ?? '1') * 1e6));
const recipient = (process.argv[3] ?? '0xb76795D6eCe15D10EbDc968a1e31335dbba44519') as `0x${string}`;
const plan = bridgePlan(amount, 0n);
for (const [leg, asset, a] of [['gas', ASSETS.baseEth, plan.gas], ['usdc', ASSETS.baseUsdc, plan.usdc]] as const) {
  const t = Date.now();
  const q = await quote({ destinationAsset: asset, amount: a, nearAccount: 'veil.near', recipient, dry: true });
  console.log(leg, `${Number(a) / 1e6} USDC →`, q.quote.amountOutFormatted, `(min ${q.quote.minAmountOut}, ~${q.quote.timeEstimate}s, quote ${Date.now() - t}ms)`);
}
