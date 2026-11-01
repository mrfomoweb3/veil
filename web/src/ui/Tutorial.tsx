// "How to play" as a short playable campaign: move, recruit, seal, resolve, fight with
// verifiable dice, then lift the veil — with the why and the tech explained along the way.
import { useMemo, useState } from 'react';
import { World } from '../scene/World';
import { Islands } from '../scene/Islands';
import { FogClouds } from '../scene/Sky';
import { BattleMarks, OrderArcs, Ring, TroopChips } from '../scene/Overlay';
import { seatColor } from '../scene/palette';
import { useStore } from '../store';
import { INFO_ORDERS, ordersAad, publicKey, seal, toHex } from '../protocol/crypto';
import { encodeOrders } from '../protocol/orders';
import { hexDistance as hexDist, type Hex } from '../protocol/hex';
import * as T from '../game/tutorial';
import { quickPractice } from './lobbyActions';

type Step = 'welcome' | 'capital' | 'march' | 'recruit' | 'seal' | 'enclave' | 'battle' | 'dice' | 'reveal' | 'tech' | 'ready';
const STEPS: Step[] = ['welcome', 'capital', 'march', 'recruit', 'seal', 'enclave', 'battle', 'dice', 'reveal', 'tech', 'ready'];

export function markTutorialDone() {
  try { localStorage.setItem('veil:tutorial', 'done'); } catch { /* ignore */ }
}

export function Tutorial() {
  const set = useStore((s) => s.set);
  const chain = useStore((s) => s.chain);
  const [step, setStep] = useState<Step>('welcome');
  const [world, setWorld] = useState(T.initialWorld);
  const [seen, setSeen] = useState<Set<number>>(() => new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [move, setMove] = useState<{ from: Hex; to: Hex; count: number } | null>(null);
  const [recruit, setRecruit] = useState(0);
  const [cipher, setCipher] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [battle, setBattle] = useState<Hex[]>([]);
  const [vrf, setVrf] = useState<ReturnType<typeof T.demoVrf> | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  const tiles = useMemo(() => T.toVis(world, seen, reveal), [world, seen, reveal]);
  const capIdx = T.board.index(T.CAPITAL)!;
  const [landIdx, setLandIdx] = useState(T.board.index(T.MARCH)!);
  const [raidIdx, setRaidIdx] = useState(T.board.index(T.RAIDERS)!);
  const go = (s: Step) => {
    // Remember what we have seen, like the real client's terrain memory.
    const vis = T.vision(world);
    setSeen((old) => new Set([...old, ...vis.flatMap((v, i) => (v ? [i] : []))]));
    setStep(s);
  };
  const at = STEPS.indexOf(step);

  const targets = selected != null ? T.neighboursOf(T.board.hex(selected)).filter((i) => tiles[i].terrain != null && tiles[i].terrain !== 4) : [];

  function onTile(i: number) {
    if (step === 'capital' && i === capIdx) {
      setSelected(i);
      go('march');
    } else if (step === 'march') {
      if (i === capIdx) return setSelected(i);
      if (selected === capIdx && targets.includes(i)) {
        setMove({ from: T.CAPITAL, to: T.board.hex(i), count: 5 });
        setSelected(null);
        go('recruit');
      }
    } else if (step === 'battle') {
      const myStack = world.findIndex((t, k) => t.owner === T.ME && t.troops > 0 && k !== capIdx);
      if (i === myStack) return setSelected(i);
      if (selected === myStack && i === raidIdx) {
        setMove({ from: T.board.hex(myStack), to: T.board.hex(raidIdx), count: world[myStack].troops });
        setSelected(null);
        const v = T.demoVrf(2);
        setVrf(v);
        go('dice');
      }
    }
  }

  function sealOrders() {
    const gameSk = new Uint8Array(32).fill(7); // the tutorial's stand-in for the enclave's key
    const orders = { moves: move ? [move] : [], scout: null, fort: null, recruit };
    const ct = seal(publicKey(gameSk), encodeOrders(orders), ordersAad(1, 1, 'you.near'), INFO_ORDERS);
    setCipher(toHex(ct));
  }

  async function resolveFirstTurn() {
    setResolving(true);
    await new Promise((r) => setTimeout(r, 1600));
    setWorld((w) => {
      const n = w.map((t) => ({ ...t }));
      n[capIdx].troops += recruit;
      let land = landIdx;
      if (move) {
        land = T.board.index(move.to)!;
        n[capIdx].troops -= move.count;
        n[land] = { ...n[land], owner: T.ME, troops: move.count };
      }
      // Raiders slip out of the clouds next to wherever you landed, away from home.
      const capital = T.board.hex(capIdx);
      const raid = T.neighboursOf(T.board.hex(land))
        .filter((k) => k !== capIdx && n[k].owner == null && n[k].terrain !== 4)
        .sort((a, b) => hexDist(T.board.hex(b), capital) - hexDist(T.board.hex(a), capital))[0];
      n[raid] = { ...n[raid], owner: T.ENEMY, troops: 3 };
      setLandIdx(land);
      setRaidIdx(raid);
      return n;
    });
    setMove(null);
    setResolving(false);
    setCipher(null);
    go('battle');
  }

  async function resolveBattle() {
    if (!vrf || !move) return;
    setResolving(true);
    setBattle([T.board.hex(raidIdx)]);
    await new Promise((r) => setTimeout(r, 1800));
    setWorld((w) => {
      const n = w.map((t) => ({ ...t }));
      const from = T.board.index(move.from)!;
      const atk = n[from].troops, def = n[raidIdx].troops;
      const loss = Math.max(1, Math.min(atk - 1, def));
      n[from].troops = 0;
      n[raidIdx] = { ...n[raidIdx], owner: T.ME, troops: atk - loss };
      return n;
    });
    setMove(null);
    setResolving(false);
    go('reveal');
  }

  const capPos = tiles[capIdx].pos;
  const focus: [number, number, number] = step === 'reveal' && reveal ? [0, 0, 0] : step === 'battle' || step === 'dice' ? tiles[landIdx].pos : capPos;
  const finish = async () => {
    markTutorialDone();
    setBusy(true);
    try { await quickPractice(); } catch (e) { useStore.getState().set({ error: (e as Error).message }); } finally { setBusy(false); }
  };

  const nextable: Partial<Record<Step, boolean>> = { welcome: true, enclave: false, reveal, tech: true };

  return (
    <div className="screen tutorial">
      <World focus={focus} distance={reveal ? 14 : 9} onMiss={() => setSelected(null)}>
        <Islands tiles={tiles} onTile={onTile} />
        <FogClouds tiles={tiles} onTile={onTile} />
        <TroopChips tiles={tiles} me={T.ME} />
        {move && <OrderArcs tiles={tiles} board={T.board} orders={{ moves: [move], scout: null, fort: null, recruit: 0 }} color={seatColor(T.ME)} solid={!!cipher} />}
        <BattleMarks tiles={tiles} board={T.board} battles={battle} />
        {selected != null && <Ring pos={tiles[selected].pos} color="#ffffff" pulse />}
        {step === 'capital' && <Ring pos={capPos} color="#ffd36b" pulse radius={1.05} />}
        {step === 'march' && selected === capIdx && targets.map((i) => <Ring key={i} pos={tiles[i].pos} color={seatColor(T.ME)} radius={0.8} />)}
        {step === 'battle' && selected == null && world.map((t, k) => (t.owner === T.ME && t.troops > 0 && k !== capIdx ? <Ring key={k} pos={tiles[k].pos} color="#ffd36b" pulse radius={1.05} /> : null))}
        {step === 'battle' && selected != null && <Ring pos={tiles[raidIdx].pos} color="#ff5c5c" pulse radius={1.05} />}
      </World>

      <header className="topbar hud">
        <button className="ghost" onClick={() => set({ screen: 'landing' })}>←</button>
        <div className="title"><b>How to play</b><span className="muted">Step {at + 1} of {STEPS.length}</span></div>
        <div className="steps">{STEPS.map((s, k) => <i key={s} className={k < at ? 'done' : k === at ? 'on' : ''} />)}</div>
        <button className="ghost" onClick={() => { markTutorialDone(); set({ screen: 'lobby' }); }}>Skip tutorial</button>
      </header>

      <div className={`coach panel ${step === 'tech' || step === 'enclave' ? 'wide' : ''}`}>
        {step === 'welcome' && (
          <>
            <h2>Welcome, warlord.</h2>
            <p>Your kingdom is a handful of islands drifting above a sea of cloud. <b>The clouds are the fog of war</b>: you only see what your troops can see.</p>
            <p>The twist: on VEIL, <b>nobody</b> can see the whole map — not your rivals, not the blockchain, not even the people who made the game. Let’s play a turn and you’ll see how.</p>
          </>
        )}
        {step === 'capital' && (
          <>
            <h2>1 · Your capital</h2>
            <p>This keep flying your banner is your capital. Lose it and you are out. Each turn it can recruit troops with <b>aether</b>, the currency your islands produce.</p>
            <p className="do">👉 Click your capital (the glowing island).</p>
          </>
        )}
        {step === 'march' && (
          <>
            <h2>2 · March</h2>
            <p>Troops move one island per turn. Islands next to your army light up.</p>
            <p className="do">👉 Click a highlighted neighbour to send 5 troops.</p>
          </>
        )}
        {step === 'recruit' && (
          <>
            <h2>3 · Recruit</h2>
            <p>You have <b>4 aether</b>. One aether buys one soldier at your capital (up to 10 a turn). Forts (6) and scouts (2) also cost aether.</p>
            <label className="recruit">Recruit <input type="range" min={0} max={4} value={recruit} onChange={(e) => setRecruit(+e.target.value)} /> <b>{recruit}</b></label>
            <button className="primary" disabled={recruit === 0} onClick={() => go('seal')}>Done</button>
          </>
        )}
        {step === 'seal' && (
          <>
            <h2>4 · Seal your orders</h2>
            <p>Everyone gives orders at the same time. Yours are <b>encrypted in your browser</b> to a key that only exists inside a secure enclave.</p>
            {!cipher ? (
              <button className="primary" onClick={sealOrders}>🔒 Seal orders</button>
            ) : (
              <>
                <div className="cipher"><code>{cipher.slice(0, 260)}…</code></div>
                <p className="muted small">That’s your march and your recruits, really encrypted (X25519 + XChaCha20-Poly1305, padded to 1 KB). It is all the blockchain ever stores.</p>
                <button className="primary" onClick={() => go('enclave')}>Send →</button>
              </>
            )}
          </>
        )}
        {step === 'enclave' && (
          <>
            <h2>5 · Inside the enclave</h2>
            <div className="flow">
              <div><b>Your browser</b><span>seals orders</span></div><em>→</em>
              <div><b>NEAR contract</b><span>keeps the clock, stores only ciphertext</span></div><em>→</em>
              <div className="tee"><b>OutLayer enclave</b><span>Intel TDX: encrypted memory nobody can read</span></div><em>→</em>
              <div><b>Your view</b><span>sealed to you alone</span></div>
            </div>
            <p>On a public blockchain everything is visible, so hidden-army games were impossible. VEIL runs the game inside a <b>trusted execution environment</b>: the map, every army and every order live in encrypted memory. The enclave resolves the turn and hands each player back only what <i>they</i> can see.</p>
            <button className="primary" disabled={resolving} onClick={resolveFirstTurn}>{resolving ? 'The enclave is resolving…' : 'Resolve the turn'}</button>
          </>
        )}
        {step === 'battle' && (
          <>
            <h2>6 · Contact!</h2>
            <p>Your march pushed back the clouds — and revealed <b style={{ color: seatColor(T.ENEMY) }}>Raiders</b> camped next door. Nobody told you they were there; nobody could.</p>
            <p className="do">👉 Click your army, then the enemy island to attack.</p>
          </>
        )}
        {step === 'dice' && vrf && (
          <>
            <h2>7 · Fair dice</h2>
            <p>Battles are strength × terrain × a random roll. That roll comes from a <b>verifiable random function</b>: one signed value per turn, which the contract checks before it accepts the result. Nobody can re-roll.</p>
            <div className="dice">
              <div><span>Your roll</span><b>×{vrf.attack.toFixed(2)}</b></div>
              <div><span>Their roll</span><b>×{vrf.defend.toFixed(2)}</b></div>
            </div>
            <dl className="raw small">
              <dt>alpha</dt><dd><code>{vrf.alpha}</code></dd>
              <dt>signature</dt><dd><code>{toHex(vrf.sig).slice(0, 48)}…</code></dd>
              <dt>seed</dt><dd><code>sha256(signature) = {toHex(vrf.output).slice(0, 24)}…</code></dd>
            </dl>
            <div className="cta">
              <button className="ghost" onClick={() => setVerified(T.verifyDemo(vrf))}>{verified == null ? 'Verify the proof' : verified ? '✔ Signature valid' : '✘ Invalid'}</button>
              <button className="primary" disabled={resolving} onClick={resolveBattle}>{resolving ? 'Steel meets steel…' : '⚔ Attack'}</button>
            </div>
            <p className="muted small">This proof is signed in your browser with a throwaway key for the tutorial. In a match it comes from OutLayer’s VRF key and your shield icons re-check it.</p>
          </>
        )}
        {step === 'reveal' && (
          <>
            <h2>8 · The Reveal</h2>
            <p>You won the skirmish. In a real match this goes on for up to 20 turns. When it ends, the enclave <b>publishes the entire hidden history</b>: every order, every roll.</p>
            <button className="primary" onClick={() => setReveal(!reveal)}>{reveal ? '☁ Bring back the clouds' : '☀ Lift the veil'}</button>
            {reveal && <p>There it is: the enemy capital behind a <b>fort</b>, and a 7-strong army waiting in the forest. Anyone can re-run the whole match with the same Rust code and check it was fair.</p>}
          </>
        )}
        {step === 'tech' && (
          <>
            <h2>9 · What makes it work</h2>
            <div className="tech">
              <div><b>OutLayer TEE</b><span>Runs the game engine in Intel TDX. Sealed storage that only the game contract and this exact engine build can open.</span></div>
              <div><b>Verifiable dice</b><span>One VRF proof per turn, verified on chain with ed25519 before a turn is accepted.</span></div>
              <div><b>NEAR contract</b><span>Seats, turn clock, ciphertexts, public facts (battle locations, scores) and payouts.</span></div>
              <div><b>NEAR AI warlords</b><span>AI rivals that reason privately inside TEEs and see only their own fog.</span></div>
              <div><b>No wallet popups</b><span>Gasless meta-transactions: a relayer pays, you just play.</span></div>
              <div><b>The Reveal</b><span>Full history published at the end; your browser replays and verifies it.</span></div>
            </div>
          </>
        )}
        {step === 'ready' && (
          <>
            <h2>You’re ready.</h2>
            <p>Three AI warlords are waiting: the Cautious Admiral, the Raider and the Opportunist. Same fog, same rules, same dice as you.</p>
            <div className="cta">
              <button className="primary big" disabled={busy || !chain} onClick={finish}>{busy ? 'Raising the islands…' : '⚔ Play vs 3 warlords'}</button>
              <button className="ghost" onClick={() => { markTutorialDone(); set({ screen: 'lobby' }); }}>Lobbies</button>
            </div>
          </>
        )}

        <div className="coach-nav">
          {at > 0 && step !== 'ready' && <span className="muted small">{at + 1}/{STEPS.length}</span>}
          {(nextable[step] || step === 'reveal' && reveal) && step !== 'ready' && (
            <button className="primary" onClick={() => go(STEPS[at + 1])}>
              {step === 'welcome' ? 'Begin' : 'Next →'}
            </button>
          )}
        </div>
      </div>
      {step === 'capital' || step === 'march' || step === 'battle' ? <div className="tutorial-hint">Drag to orbit · scroll to zoom</div> : null}
    </div>
  );
}

