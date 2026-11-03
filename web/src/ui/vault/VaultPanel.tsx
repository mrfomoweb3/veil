// Private vault: the player's Gloam balance on Base. Deposit (seal) from a Base wallet,
// cash out to any address through Gloam's relay, back up and restore the encrypted notes.
import { useEffect, useState } from 'react';
import { erc20Abi, parseUnits, type Address, type Hex } from 'viem';
import { useStore } from '../../store';
import { gloamNetwork, explorerTx, publicClient, usdc, GLOAM_ENV } from '../../privacy/gloamNetwork';
import { addressProblem, cashOut, cashOutQuote, type CashOutStep } from '../../privacy/cashOut';
import { reconcilePending, shieldUsdc, type ShieldStep } from '../../privacy/shield';
import { injectedSigner } from '../../privacy/injectedSigner';
import type { BaseSigner } from '../../privacy/baseSigner';
import { fmtUsdc, unlockVault, useVault, vaultChanged } from '../../privacy/useVault';
import type { Backup, StoredNote } from '../../privacy/noteVault';
import { BackupGate, downloadBackup } from './BackupGate';
import { PrivacyModel } from './PrivacyModel';

export function VaultPanel() {
  const chain = useStore((s) => s.chain)!;
  const set = useStore((s) => s.set);
  const { vault, notes, balance } = useVault(chain.account);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signer, setSigner] = useState<BaseSigner | null>(null);
  const [baseAddr, setBaseAddr] = useState<Address | null>(null);
  const [baseUsdc, setBaseUsdc] = useState<bigint | null>(null);
  const [amount, setAmount] = useState('1');
  const [shieldStep, setShieldStep] = useState<ShieldStep | null>(null);
  const [fogging, setFogging] = useState<string | null>(null);
  const [gate, setGate] = useState(false);
  const [spending, setSpending] = useState<StoredNote | null>(null);
  const [explain, setExplain] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const net = gloamNetwork();

  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); vaultChanged(); }
  };

  useEffect(() => {
    if (!vault) return;
    reconcilePending(vault)
      .then((r) => { if (r.confirmed) { setInfo(`${r.confirmed} deposit${r.confirmed > 1 ? 's' : ''} from an earlier session confirmed.`); vaultChanged(); } })
      .catch(() => {});
  }, [vault]);

  const readBase = async (addr: Address) => {
    setBaseUsdc(await publicClient().readContract({ address: usdc().address, abi: erc20Abi, functionName: 'balanceOf', args: [addr] }));
  };

  const connectBase = () => act(async () => {
    const s = await injectedSigner();
    const a = await s.address();
    setSigner(s);
    setBaseAddr(a);
    await readBase(a);
  });

  const deposit = () => act(async () => {
    if (!vault || !signer || !baseAddr) return;
    const value = parseUnits(amount || '0', 6);
    if (value <= 0n) throw new Error('Enter an amount above zero.');
    const first = notes.length === 0;
    const r = await shieldUsdc({ signer, vault, amount: value, onStep: setShieldStep });
    setFogging(fmtUsdc(value - r.leftover));
    setTimeout(() => setFogging(null), 2600);
    if (r.leftover > 0n) setInfo(`${fmtUsdc(r.leftover)} did not fit under the vault's beta limit and stays in your Base address.`);
    await readBase(baseAddr);
    if (first) setGate(true);
  });

  const restore = (file: File) => act(async () => {
    if (!vault) return;
    const added = await vault.importBackup(JSON.parse(await file.text()) as Backup);
    await reconcilePending(vault);
    setInfo(added.length ? `Restored ${added.length} note${added.length > 1 ? 's' : ''}.` : 'Nothing new in that backup.');
  });

  return (
    <div className="screen vault-screen">
      <div className="vault-fog" aria-hidden />
      <header className="topbar">
        <button className="ghost" onClick={() => set({ screen: 'landing' })}>← VEIL</button>
        <div className="who">
          <span className="net">{GLOAM_ENV === 'mainnet' ? 'Base' : 'Base Sepolia · test funds'}</span> Gloam private vault
        </div>
      </header>

      <main className="vault-grid">
        <section className="panel vault-balance">
          <h2>Private balance</h2>
          {!vault ? (
            <>
              <p className="muted">Your vault is sealed with a key only your NEAR account can make. Signing is free and sends nothing.</p>
              <button className="primary" disabled={busy} onClick={() => act(() => unlockVault(chain))}>Unlock vault</button>
            </>
          ) : (
            <>
              <div className={`fog-amount ${fogging ? 'dissolving' : ''}`}>
                {fogging ? <span className="ghost-amt">{fogging}</span> : null}
                <b>{fmtUsdc(balance)}</b> <span className="muted">USDC</span>
              </div>
              <p className="muted small">Held in Gloam on {net.label}. Where it goes next is yours alone. <button className="link inline" onClick={() => setExplain(true)}>What stays private?</button></p>
              <div className="notes">
                {notes.length === 0 && <p className="muted small">No notes yet.</p>}
                {notes.map((n) => (
                  <div key={n.commitment} className={`note-row st-${n.status}`}>
                    <b>{fmtUsdc(n.amountWei)}</b>
                    <span className="muted small">{new Date(n.createdAt).toLocaleDateString()}</span>
                    <span className="status">{n.status}</span>
                    {n.status === 'confirmed' && <button className="small" disabled={busy} onClick={() => setSpending(n)}>Cash out</button>}
                    {n.status === 'spent' && n.spentTx && <a className="small" href={explorerTx(n.spentTx)} target="_blank" rel="noreferrer">tx ↗</a>}
                  </div>
                ))}
              </div>
              <div className="cta">
                <button className="ghost" disabled={busy || notes.length === 0} onClick={() => act(async () => downloadBackup(await vault.exportBackup()))}>Back up vault</button>
                <label className="ghost file-btn">Restore vault<input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} /></label>
              </div>
            </>
          )}
          {info && <p className="ok small">{info}</p>}
          {err && <div className="err">{err}</div>}
        </section>

        {vault && (
          <section className="panel">
            <h2>Seal USDC into the fog</h2>
            <p className="muted small">Deposits come from a Base address you control. Coming next: your winnings arrive there straight from NEAR, signed by your NEAR account.</p>
            {!signer ? (
              <button className="primary" disabled={busy} onClick={connectBase}>Connect a Base wallet</button>
            ) : (
              <>
                <p className="small">From <code>{baseAddr}</code><br />Holds {baseUsdc == null ? '…' : fmtUsdc(baseUsdc)} USDC</p>
                <label>Amount (USDC) <input className="num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
                <button className="primary" disabled={busy} onClick={deposit}>Seal into the fog</button>
                <ShieldTracker step={shieldStep} />
                {GLOAM_ENV !== 'mainnet' && <p className="muted small">Test USDC: faucet.circle.com (Base Sepolia). Gas: any Base Sepolia ETH faucet.</p>}
              </>
            )}
          </section>
        )}
      </main>

      {spending && vault && <CashOutSheet note={spending} onClose={() => setSpending(null)} onDone={() => { setSpending(null); vaultChanged(); }} />}
      {gate && vault && <BackupGate vault={vault} onClose={() => setGate(false)} />}
      {explain && <PrivacyModel onClose={() => setExplain(false)} />}
    </div>
  );
}

const SHIELD_LABELS: [ShieldStep['step'], string][] = [
  ['approving', 'Approving'],
  ['sealing', 'Sealing (making the proof)'],
  ['sending', 'Depositing'],
  ['checking', 'Checking the pool'],
  ['private', 'Private'],
];

function ShieldTracker({ step }: { step: ShieldStep | null }) {
  if (!step) return null;
  const at = SHIELD_LABELS.findIndex(([k]) => k === step.step);
  const of = 'of' in step && step.of > 1 ? ` (deposit ${step.deposit} of ${step.of})` : '';
  const tx = 'tx' in step ? step.tx : undefined;
  return (
    <ol className="tracker">
      {SHIELD_LABELS.map(([k, label], i) => (
        <li key={k} className={i < at || step.step === 'private' ? 'done' : i === at ? 'now' : ''}>
          {label}{i === at && step.step !== 'private' ? of : ''}
          {i === at && tx ? <> · <a href={explorerTx(tx)} target="_blank" rel="noreferrer">tx ↗</a></> : null}
        </li>
      ))}
    </ol>
  );
}

const CASH_LABELS: Record<CashOutStep, string> = {
  syncing: 'Reading the pool',
  proving: 'Making the proof',
  sending: 'Sending through the Gloam relay',
  confirming: 'Confirming on Base',
  done: 'Done',
};

function CashOutSheet({ note, onClose, onDone }: { note: StoredNote; onClose: () => void; onDone: () => void }) {
  const { vault } = useVault(useStore.getState().chain?.account);
  const [to, setTo] = useState('');
  const [quote, setQuote] = useState<{ feeBps: number; fee: bigint; receives: bigint } | null>(null);
  const [step, setStep] = useState<CashOutStep | null>(null);
  const [tx, setTx] = useState<Hex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const problem = to ? addressProblem(to) : null;

  useEffect(() => { cashOutQuote(BigInt(note.amountWei)).then(setQuote).catch(() => setQuote(null)); }, [note]);

  const go = async () => {
    if (!vault) return;
    setErr(null);
    try {
      await cashOut({ vault, note, to: to as Address, onStep: (s, h) => { setStep(s); if (h) setTx(h); } });
      onDone();
    } catch (e) { setErr((e as Error).message); setStep(null); }
  };

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && !step && onClose()}>
      <div className="panel sheet">
        <button className="ghost close" disabled={!!step} onClick={onClose}>×</button>
        <h2>Cash out {fmtUsdc(note.amountWei)}</h2>
        <label className="col">To Base address
          <input className="addr" autoFocus spellCheck={false} value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" />
        </label>
        {problem && <p className="bad small">{problem}</p>}
        {quote ? (
          <p className="small">Vault fee {quote.feeBps / 100}% ({fmtUsdc(quote.fee)}). Arrives: <b>{fmtUsdc(quote.receives)}</b></p>
        ) : <p className="muted small">Reading the vault's fee…</p>}
        <p className="muted small">For better privacy, cash out to a fresh address, and not straight after you deposit. Gloam's relay sends it, so your own address never appears next to it.</p>
        {step && <p className="small">{CASH_LABELS[step]}…{tx && <> · <a href={explorerTx(tx)} target="_blank" rel="noreferrer">tx ↗</a></>}</p>}
        {err && <div className="err">{err}</div>}
        <div className="cta">
          <button className="primary" disabled={!to || !!problem || !!step || !quote} onClick={go}>Cash out</button>
        </div>
      </div>
    </div>
  );
}
