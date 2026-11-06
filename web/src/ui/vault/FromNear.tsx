// Winnings → Base: claim from the VEIL contract, then NEAR Intents (1Click) moves the USDC to the
// player's Chain Signatures address on Base, where it can be sealed into the vault.
import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { useStore } from '../../store';
import { ASSETS, bridgePlan, bridgeToBase, quote, type BridgeStep } from '../../privacy/bridge';
import { fmtUsdc } from '../../privacy/useVault';

const STATUS: Record<string, string> = {
  PENDING_DEPOSIT: 'waiting for the deposit', KNOWN_DEPOSIT_TX: 'deposit seen', INCOMPLETE_DEPOSIT: 'deposit incomplete',
  PROCESSING: 'settling on Base', SUCCESS: 'arrived',
};

export function FromNear({ recipient, baseEthWei, onArrived }: { recipient: Address; baseEthWei: bigint; onArrived: (usdc: bigint) => void }) {
  const chain = useStore((s) => s.chain)!;
  const [claimable, setClaimable] = useState<bigint | null>(null);
  const [wallet, setWallet] = useState<bigint | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [step, setStep] = useState<BridgeStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const live = chain.network === 'mainnet';

  const load = async () => {
    const cfg = await chain.view<{ usdc: string }>('get_config');
    const [c, w] = await Promise.all([
      chain.view<string>('get_balance', { account: chain.account }).then(BigInt).catch(() => 0n),
      chain.ftBalance ? chain.ftBalance(cfg.usdc).catch(() => 0n) : Promise.resolve(0n),
    ]);
    setClaimable(c);
    setWallet(w);
  };
  useEffect(() => { load().catch(() => {}); }, [chain]);

  // What the route pays right now (a dry quote on mainnet: nothing is opened or sent).
  const total = (claimable ?? 0n) + (wallet ?? 0n);
  const sample = total > 1_000_000n ? total : 5_000_000n;
  useEffect(() => {
    let off = false;
    (async () => {
      const plan = bridgePlan(sample, baseEthWei);
      const q = await quote({ destinationAsset: ASSETS.baseUsdc, amount: plan.usdc, nearAccount: live ? chain.account : 'veil.near', recipient, dry: true });
      if (!off) setPreview(`${fmtUsdc(sample)} on NEAR → ${fmtUsdc(BigInt(q.quote.amountOut))} USDC on Base${plan.gas ? ` + gas (${fmtUsdc(plan.gas)} of it buys Base ETH)` : ''}, about ${q.quote.timeEstimate} s`);
    })().catch(() => !off && setPreview(null));
    return () => { off = true; };
  }, [sample, baseEthWei, recipient]);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (!chain.ftTransfer) throw new Error('This account cannot send tokens.');
      if (claimable && claimable > 0n) await chain.call('claim');
      const cfg = await chain.view<{ usdc: string }>('get_config');
      const amount = await chain.ftBalance!(cfg.usdc);
      const r = await bridgeToBase({
        near: { account: chain.account, ftTransfer: chain.ftTransfer.bind(chain) },
        recipient, amount, baseEthWei, onStep: setStep,
      });
      onArrived(r.usdcOut);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>Bring winnings from NEAR</h2>
      <p className="small">
        Claimable {claimable == null ? '…' : fmtUsdc(claimable)} · in your NEAR account {wallet == null ? '…' : fmtUsdc(wallet)} USDC
      </p>
      <p className="muted small">NEAR Intents moves your USDC to your Base address above, which your NEAR account controls. It also buys a little Base ETH for gas when the address has none. If a swap fails, the USDC is refunded to your NEAR account.</p>
      {preview && <p className="small">Live route price: {preview}</p>}
      {live ? (
        <button className="primary" disabled={busy || total === 0n} onClick={run}>Claim &amp; bring to Base</button>
      ) : (
        <p className="warn small">NEAR Intents runs on mainnet only, so on testnet this step is replaced: fund your Base Sepolia address from faucets (test USDC at faucet.circle.com, gas from any Base Sepolia ETH faucet). The price above is a live mainnet quote; nothing is sent.</p>
      )}
      {step && (
        <p className="small">
          {step.step === 'quoting' && 'Getting a quote…'}
          {step.step === 'depositing' && `Sending ${step.leg === 'gas' ? 'the gas leg' : 'your USDC'} from NEAR…`}
          {step.step === 'swapping' && `${step.leg === 'gas' ? 'Gas' : 'USDC'}: ${STATUS[step.status] ?? step.status}…`}
          {step.step === 'arrived' && <span className="ok">Arrived on Base. Seal it into the fog below.</span>}
        </p>
      )}
      {err && <div className="err">{err}</div>}
    </section>
  );
}
