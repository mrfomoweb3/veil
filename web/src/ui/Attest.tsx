// The shield sheet: everything that makes one turn checkable, checked in the browser.
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { useMemo } from 'react';
import { useStore } from '../store';
import { fromHex, toHex } from '../protocol/crypto';

export function AttestSheet() {
  const { history, attestTurn, config, match, set, chain } = useStore();
  const h = history.find((x) => x.turn === attestTurn);
  const checks = useMemo(() => {
    if (!h || !config || !match) return null;
    const sig = fromHex(h.vrf.signature_hex);
    const seed = h.turn === 0 ? `init-${match.id}` : `turn-${h.turn}`;
    let sigOk = false;
    try { sigOk = ed25519.verify(sig, new TextEncoder().encode(h.vrf.alpha), fromHex(config.vrf_pubkey)); } catch { sigOk = false; }
    return {
      sigOk,
      outOk: toHex(sha256(sig)) === h.vrf.output_hex,
      alphaOk: h.vrf.alpha.startsWith('vrf:') && h.vrf.alpha.endsWith(`:${seed}`),
      requestId: h.vrf.alpha.split(':')[1],
      seed,
    };
  }, [h, config, match]);
  if (!h || !checks || !match || !config) return null;
  const all = checks.sigOk && checks.outOk && checks.alphaOk;
  const devnet = chain?.network === 'devnet';
  return (
    <div className="modal" onClick={() => set({ attestTurn: null })}>
      <div className="panel sheet" onClick={(e) => e.stopPropagation()}>
        <button className="ghost close" onClick={() => set({ attestTurn: null })}>×</button>
        <h2>⛨ Turn {h.turn} {h.turn === 0 ? '(map generation)' : ''}</h2>
        <p className={all ? 'ok' : 'bad'}>{all ? 'All checks passed in your browser.' : 'A check failed — this turn should not be trusted.'}</p>
        <ul className="checks">
          <li className={checks.sigOk ? 'ok' : 'bad'}>{checks.sigOk ? '✔' : '✘'} Randomness signed by the VRF key <code>{config.vrf_pubkey.slice(0, 16)}…</code> (ed25519)</li>
          <li className={checks.outOk ? 'ok' : 'bad'}>{checks.outOk ? '✔' : '✘'} Dice seed = SHA-256(signature)</li>
          <li className={checks.alphaOk ? 'ok' : 'bad'}>{checks.alphaOk ? '✔' : '✘'} The proof names this step (<code>{checks.seed}</code>) — it can’t be reused or re-rolled</li>
          <li>◆ Resolved by engine <code>{match.engine_project}</code>{match.engine_version ? <> version <code>{match.engine_version.slice(0, 16)}…</code>, pinned when the match was created</> : ''}</li>
          <li>◆ State commitment <code>{h.state_commit.slice(0, 24)}…</code> — checked against the replay after The Reveal</li>
        </ul>
        <dl className="raw">
          <dt>alpha</dt><dd><code>{h.vrf.alpha}</code></dd>
          <dt>signature</dt><dd><code>{h.vrf.signature_hex}</code></dd>
          <dt>output</dt><dd><code>{h.vrf.output_hex}</code></dd>
          <dt>request</dt><dd><code>{checks.requestId}</code></dd>
        </dl>
        <p className="muted small">
          {devnet
            ? 'Devnet: the engine runs locally, not in a TEE. The proofs are real; the enclave guarantee only applies on testnet/mainnet.'
            : `On ${chain?.network}, this turn ran inside an Intel TDX worker of OutLayer. The execution attestation for request ${checks.requestId} is on the OutLayer dashboard; the contract verified this VRF proof before accepting the turn.`}
        </p>
      </div>
    </div>
  );
}
