// The Reveal: the whole match with the fog removed, re-run and verified in your browser.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { replay, type ReplayResult } from '../game/replay';
import { sha256Hex } from '../protocol/crypto';
import { Board } from '../protocol/hex';
import { World } from '../scene/World';
import { Islands } from '../scene/Islands';
import { BattleMarks, OrderArcs, TroopChips } from '../scene/Overlay';
import { tilesFromState } from '../scene/tiles';
import { seatColor } from '../scene/palette';
import { seatName } from '../game/sync';

async function loadReveal(): Promise<{ doc: Uint8Array; hashOk: boolean }> {
  const { chain, match } = useStore.getState();
  if (!chain || !match?.reveal_key) throw new Error('not revealed yet');
  const idx = await chain.publicStorage(match.reveal_key);
  if (!idx) throw new Error('reveal index not found in public storage');
  const index = JSON.parse(new TextDecoder().decode(idx)) as { chunks: number; hash: string };
  const parts: Uint8Array[] = [];
  for (let k = 0; k < index.chunks; k++) {
    const c = await chain.publicStorage(`${match.reveal_key}:${k}`);
    if (!c) throw new Error(`reveal chunk ${k} missing`);
    parts.push(c);
  }
  const doc = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { doc.set(p, o); o += p.length; }
  return { doc, hashOk: sha256Hex(doc) === match.reveal_hash };
}

export function Reveal() {
  const { match, config, chain, set } = useStore();
  const [res, setRes] = useState<ReplayResult | null>(null);
  const [hashOk, setHashOk] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [showOrders, setShowOrders] = useState(true);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    loadReveal()
      .then(async ({ doc, hashOk }) => {
        setHashOk(hashOk);
        const r = await replay(doc, config?.vrf_pubkey ?? '');
        setRes(r);
        setT(r.frames.length - 1);
      })
      .catch((e) => setErr(e.message));
  }, [config]);

  useEffect(() => {
    if (!playing || !res) return;
    const id = setInterval(() => setT((x) => { if (x + 1 >= res.frames.length) { setPlaying(false); return x; } return x + 1; }), 1200);
    return () => clearInterval(id);
  }, [playing, res]);

  const frame = res?.frames[t];
  const tiles = useMemo(() => {
    if (!res || !frame) return [];
    return tilesFromState(res.radius, res.terrain.map((terrain, i) => ({ terrain, owner: frame.owners[i] < 0 ? null : frame.owners[i], troops: frame.troops[i], fort: frame.forts[i] })));
  }, [res, frame]);
  const board = useMemo(() => (res ? new Board(res.radius) : null), [res]);
  // Orders shown are the ones that produced this frame.
  const orders = res && t > 0 ? res.orders[t - 1] : null;

  return (
    <div className="screen reveal">
      {res && board && (
        <World focus={[0, 0, 0]} distance={22}>
          <Islands tiles={tiles} />
          <TroopChips tiles={tiles} me={null} />
          {frame?.public && <BattleMarks tiles={tiles} board={board} battles={frame.public.battles} />}
          {showOrders && orders?.map((o, p) => <OrderArcs key={p} tiles={tiles} board={board} orders={o} color={seatColor(p)} solid />)}
        </World>
      )}
      <header className="topbar hud">
        <button className="ghost" onClick={() => set({ screen: 'match' })}>←</button>
        <div className="title"><b>The Reveal · match #{match?.id}</b><span className="muted">fog removed — every army, every order</span></div>
      </header>
      <div className="panel reveal-panel">
        {err && <div className="err">{err}</div>}
        {!res && !err && <p>Downloading the history from public storage and re-running it in your browser…</p>}
        {res && (
          <>
            <div className={res.ok && hashOk ? 'verdict ok' : 'verdict bad'}>
              {res.ok && hashOk ? `✔ Verified: all ${res.turns_checked} turns re-run from the revealed orders` : '✘ Verification failed'}
            </div>
            <ul className="checks small">
              <li className={hashOk ? 'ok' : 'bad'}>{hashOk ? '✔' : '✘'} History hash matches the one posted on chain</li>
              <li className={res.ok ? 'ok' : 'bad'}>{res.ok ? '✔' : '✘'} Map regenerated from the opening VRF output</li>
              <li className={res.ok ? 'ok' : 'bad'}>{res.ok ? '✔' : '✘'} Every turn’s VRF proof{res.vrf_checked ? ' and signature' : ''} and state commitment check out</li>
              {res.errors.map((e, i) => <li key={i} className="bad">✘ {e}</li>)}
            </ul>
            <div className="scrub">
              <button className="small" onClick={() => setPlaying(!playing)}>{playing ? '❚❚' : '▶'}</button>
              <input type="range" min={0} max={res.frames.length - 1} value={t} onChange={(e) => { setPlaying(false); setT(+e.target.value); }} />
              <b>{t === 0 ? 'Opening' : `Turn ${t}`}</b>
            </div>
            <label className="row small"><input type="checkbox" checked={showOrders} onChange={(e) => setShowOrders(e.target.checked)} /> Show the orders that led here</label>
            <div className="score col">
              {res.accounts.map((a, i) => (
                <div key={a} className={`seat ${frame?.alive[i] ? '' : 'dead'}`} style={{ ['--c' as string]: seatColor(i) }}>
                  <i />{seatName(match, i, chain?.account)} <b>{frame?.owners.filter((o) => o === i).length}</b>
                  <span className="muted small"> {frame?.aether[i]} aether{orders && res.llm[t - 1]?.[i] ? ' · LLM' : ''}</span>
                </div>
              ))}
            </div>
            <p className="muted small">
              Check it yourself: <code>veil-verify --match {res.match_id} …</code> runs the same Rust code natively. The revealed game key
              (<code>{res.game_pk.slice(0, 12)}…</code> public half) also opens every order ciphertext that sat on chain.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
