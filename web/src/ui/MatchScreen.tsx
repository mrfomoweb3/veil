import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useMatchSync, seatName } from '../game/sync';
import { addTrade, available, clickTile, fmtHex, moveTargets, removeMove, removeTrade, sendOrders, setMoveCount, setRecruit, spent, tradeCost } from '../game/actions';
import { World } from '../scene/World';
import { Islands } from '../scene/Islands';
import { FogClouds } from '../scene/Sky';
import { BattleMarks, OrderArcs, Ring, RumoredCapitals, TroopChips } from '../scene/Overlay';
import { tilesFromView } from '../scene/tiles';
import { seatColor } from '../scene/palette';
import { Board, inferCapitals } from '../protocol/hex';
import { DEFENSE, INCOME, TERRAIN_NAMES } from '../protocol/view';
import { FORT_COST, MAX_RECRUIT, SCOUT_COST } from '../protocol/orders';
import { rotateViewKey } from '../session';
import { AttestSheet } from './Attest';
import { useBoardCursor } from '../game/boardCursor';
import { PadCamera } from '../scene/PadCamera';
import { ThreatMarks } from '../scene/Threat';
import { onAction } from '../input/actions';
import { useInput } from '../input/inputMode';
import { focusInto, uiHasFocus } from '../input/focus';
import { Glyph } from '../input/glyphs';
import { closeRadial, openRadial, RadialMenu } from './RadialMenu';
import { inviteUrl } from '../game/route';
import { isMuted, onMute, setMuted } from '../audio/sound';

function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function MatchScreen() {
  useMatchSync();
  const s = useStore();
  const { chain, match, view, memory, draft, selected, facts } = s;
  const [hover, setHover] = useState<number | null>(null);
  const tiles = useMemo(() => (view ? tilesFromView(view, memory) : []), [view, memory]);
  const board = useMemo(() => (view ? new Board(view.radius) : null), [view]);
  const me = view?.me ?? null;
  const capPos = view && tiles[view.capital] ? tiles[view.capital].pos : ([0, 0, 0] as [number, number, number]);
  const capitals = useMemo(() => (view && board ? inferCapitals(view.radius, view.seats.length, view.me, board.hex(view.capital)) : []), [view, board]);
  const lastBattles = facts.length ? facts[facts.length - 1].battles : [];
  const targets = selected != null ? moveTargets(selected) : [];
  const mode = useInput((st) => st.mode);
  const padLike = mode === 'gamepad' || mode === 'keyboard';
  const [overlay, setOverlay] = useState<'none' | 'threat'>('none');
  const [cursor, setCursor] = useBoardCursor({ tiles, start: view ? view.capital : null, enabled: !!view, onSelect: clickTile });
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  useEffect(() => () => useInput.getState().set({ radial: null }), []);
  const tap = (i: number) => { if (useInput.getState().radial != null) closeRadial(); setCursor(i); clickTile(i); };
  const menuAt = (i: number) => { setCursor(i); openRadial(i); };

  // Match-wide actions (the cursor and select are handled by useBoardCursor).
  useEffect(
    () =>
      onAction((a) => {
        const st = useStore.getState();
        if (useInput.getState().paused || useInput.getState().radial != null) return;
        if (a.type === 'cycleUnit' && st.view) {
          const mine = st.view.tiles.filter((t) => t.owner === st.view!.me && t.troops > 0).map((t) => t.index).sort((x, y) => x - y);
          if (!mine.length) return;
          setCursor((c) => {
            const k = c == null ? -1 : mine.indexOf(c);
            return mine[(k + a.dir + mine.length) % mine.length] ?? mine[0];
          });
        } else if (a.type === 'back' && !uiHasFocus()) {
          st.set({ selected: null });
        } else if (a.type === 'orderMenu' && !uiHasFocus()) {
          // Only pads and keyboards send orderMenu, so the cursor is where the player is looking.
          const at = cursorRef.current ?? st.selected;
          if (at != null) openRadial(at);
          else focusInto('.orders');
        } else if (a.type === 'cycleOverlay') {
          setOverlay((o) => (o === 'none' ? 'threat' : 'none'));
        } else if (a.type === 'endTurnHold') {
          useInput.getState().set({ endHold: a.progress });
        } else if (a.type === 'endTurn' && st.match?.status === 'Running' && st.view?.alive) {
          sendOrders().catch((e) => st.push((e as Error).message, 'bad'));
        }
      }),
    [setCursor],
  );

  if (!chain) return null;
  const seated = match?.seats.find((x) => x.account === chain.account);

  return (
    <div className={`screen match ${padLike ? 'padlike' : ''}`}>
      {view && board ? (
        <World focus={capPos} distance={15} onMiss={() => { s.set({ selected: null }); closeRadial(); }}>
          <Islands tiles={tiles} onTile={tap} onHover={setHover} onTileMenu={menuAt} />
          <FogClouds tiles={tiles} onTile={tap} onTileMenu={menuAt} />
          <RadialMenu tiles={tiles} />
          <PadCamera follow={cursor != null && tiles[cursor] ? tiles[cursor].pos : null} />
          {overlay === 'threat' && <ThreatMarks tiles={tiles} me={me} />}
          {padLike && cursor != null && tiles[cursor] && <Ring pos={tiles[cursor].pos} color="#ffe08a" pulse radius={1.02} />}
          <TroopChips tiles={tiles} me={me} />
          {s.planning && s.sealedOrders && <OrderArcs tiles={tiles} board={board} orders={s.sealedOrders} color={seatColor(me)} solid />}
          <OrderArcs tiles={tiles} board={board} orders={draft} color={seatColor(me)} solid={!s.planning && s.submittedTurn === match?.turn} />
          <BattleMarks tiles={tiles} board={board} battles={lastBattles} />
          <RumoredCapitals tiles={tiles} board={board} capitals={capitals} alive={view.seats.map((x) => x.alive)} me={view.me} />
          {selected != null && <Ring pos={tiles[selected].pos} color="#ffffff" pulse />}
          {targets.map((i) => <Ring key={i} pos={tiles[i].pos} color={seatColor(me)} radius={0.8} />)}
          {hover != null && hover !== selected && <Ring pos={tiles[hover].pos} color="#ffffff" radius={0.9} />}
        </World>
      ) : (
        <div className="veil-wait">
          <div className="spinner" />
          <p>{match?.status === 'Lobby' ? 'Waiting in the lobby…' : seated || !match ? 'Raising the islands… The map is made inside a sealed machine: nobody sees it, not even us.' : 'This match is underway and you have no seat in it.'}</p>
        </div>
      )}

      <TopBar />
      {match?.status === 'Lobby' && <LobbyPanel />}
      {view && match && ['Running', 'Resolving'].includes(match.status) && view.alive && seated && <OrdersPanel />}
      {view && <TileInfo index={(padLike ? cursor : hover) ?? selected} tiles={tiles} board={board} />}
      {view && <ControlsBar overlay={overlay} />}
      <Feed />
      {match?.status === 'Resolving' && seated && <ResolvingCard />}
      <RecapCard />
      {match && ['Finished', 'Revealing', 'Revealed'].includes(match.status) && <EndPanel />}
      {view && !view.alive && match?.status === 'Running' && <div className="banner bad">Your capital has fallen. Watch the war unfold — The Reveal will show you everything.</div>}
      {seated?.autopilot && (match?.status === 'Running' || match?.status === 'Resolving') && <div className="banner">You missed 3 turns, so a warlord is holding your seat. <button className="small" onClick={() => chain.call('claim_seat_back', { match_id: match!.id })}>Take it back</button></div>}
      {s.error && (
        <div className="banner bad">
          {s.error}{' '}
          <button className="small" onClick={async () => { const { pkHex } = rotateViewKey(chain.account); await chain.call('rotate_view_pk', { match_id: match!.id, view_pk: pkHex }); s.set({ error: 'New key registered. Your next view will open with it.' }); }}>Re-key</button>
        </div>
      )}
      {s.attestTurn != null && <AttestSheet />}
    </div>
  );
}

function TopBar() {
  const { match, view, chain, history, set, sealedBy } = useStore();
  const now = useNow();
  if (!match || !chain) return null;
  const left = Math.max(0, match.deadline_ms - now);
  const frac = match.turn_len_ms ? left / match.turn_len_ms : 0;
  return (
    <header className="topbar hud">
      <button className="ghost" onClick={() => { useStore.getState().resetMatch(); set({ screen: 'lobby', matchId: null }); }}>←</button>
      <div className="title">
        <b>Match #{match.id}</b>
        <span className="muted">{match.status === 'Running' || match.status === 'Resolving' ? `Turn ${match.turn} / ${match.max_turns}` : match.status}</span>
      </div>
      {match.status === 'Running' && (
        <div className="timer" title="Time left this turn">
          <svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" className="track" /><circle cx="18" cy="18" r="15" className="bar" style={{ strokeDasharray: `${94.2 * frac} 94.2` }} /></svg>
          <span>{Math.ceil(left / 1000)}s</span>
        </div>
      )}
      {match.status === 'Resolving' && <div className="resolving">resolving…</div>}
      <div className="score">
        {match.seats.map((seat, i) => {
          const human = !seat.ai && !seat.autopilot && seat.alive;
          const done = match.status === 'Running' && human && sealedBy.includes(seat.account);
          return (
            <div key={i} className={`seat ${seat.alive ? '' : 'dead'} ${seat.account === chain.account ? 'me' : ''} ${done ? 'sealed' : ''}`} style={{ ['--c' as string]: seatColor(i) }}
              title={`${seat.account}${match.status === 'Running' && human ? (done ? ' · sealed' : ' · still deciding') : ''}`}>
              <i />{seatName(match, i, chain.account)} <b>{view?.seats[i]?.tiles ?? '–'}</b>
              {match.status === 'Running' && human && <span className="seal-mark">{done ? '🔒' : '…'}</span>}
            </div>
          );
        })}
      </div>
      <MuteButton />
      <div className="shields" title="Every turn's proof. Click to inspect.">
        {history.map((h) => (
          <button key={h.turn} className="shield" onClick={() => set({ attestTurn: h.turn })}>⛨<sub>{h.turn}</sub></button>
        ))}
      </div>
    </header>
  );
}

function LobbyPanel() {
  const { match, chain } = useStore();
  if (!match || !chain) return null;
  const host = match.host === chain.account;
  const open = Math.max(0, match.max_seats - match.seats.length - match.ai_seats);
  return (
    <div className="panel float-center lobby-panel">
      <h2>Lobby #{match.id}</h2>
      <ul className="invite-seats">
        {match.seats.map((x, i) => (
          <li key={x.account}><i className="dot" style={{ background: seatColor(i) }} /> {seatName(match, i, chain.account)}{x.account === match.host ? <span className="muted"> · host</span> : null}</li>
        ))}
        {Array.from({ length: match.ai_seats }, (_, k) => <li key={`ai${k}`} className="muted"><i className="dot" /> AI warlord</li>)}
        {Array.from({ length: open }, (_, k) => <li key={`e${k}`} className="empty">open seat</li>)}
      </ul>
      {open > 0 && <InviteBox id={match.id} />}
      {host
        ? <button className="primary" onClick={() => chain.call('start', { match_id: match.id }).catch((e) => useStore.getState().push((e as Error).message, 'bad'))}>Start now{open ? ' (open seats become warlords)' : ''}</button>
        : <p className="muted">{open ? `Starts when the host says so, or by itself when the last ${open === 1 ? 'seat is' : `${open} seats are`} taken.` : 'Every seat is taken: starting…'}</p>}
      <button className="link" onClick={() => chain.call('leave_lobby', { match_id: match.id }).then(() => { useStore.getState().resetMatch(); useStore.getState().set({ screen: 'lobby', matchId: null }); })}>Leave</button>
    </div>
  );
}

function InviteBox({ id }: { id: number }) {
  const url = inviteUrl(id);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); } catch {
      // Clipboard blocked (http, old Safari): select the text so the player can copy it.
      (document.querySelector('.invite-url') as HTMLInputElement | null)?.select();
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const share = typeof navigator.share === 'function'
    ? () => navigator.share({ title: 'VEIL', text: 'Join my war in the fog', url }).catch(() => {})
    : null;
  return (
    <div className="invite-box">
      <p className="small">Invite friends: whoever opens this link takes a seat.</p>
      <div className="row">
        <input className="invite-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button className="small" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
        {share && <button className="small" onClick={share}>Share</button>}
      </div>
    </div>
  );
}

function OrdersPanel() {
  const { view, draft, tool, set, match, submittedTurn, selected } = useStore();
  const endHold = useInput((st) => st.endHold);
  const inputMode = useInput((st) => st.mode);
  const padLike = inputMode === 'gamepad' || inputMode === 'keyboard';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!view || !match) return null;
  const used = spent();
  const locked = match.status !== 'Running';
  const planning = useStore.getState().planning && match.status === 'Resolving';
  const send = async () => {
    setBusy(true); setErr(null);
    try { await sendOrders(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <aside className={`panel orders ${planning ? 'planning' : ''}`}>
      {planning && <p className="plan-note"><b>Plan turn {match.turn + 1}</b> while this one resolves. Your plan carries over; anything the new board no longer allows is trimmed.</p>}
      <div className="aether">
        <span>Aether</span>
        <div className="bar"><i style={{ width: `${view.aether ? (100 * used) / view.aether : 0}%` }} /></div>
        <b>{view.aether - used}</b><span className="muted">/ {view.aether} · +{view.income}/turn</span>
      </div>
      <div className="tools">
        {(['move', 'scout', 'fort'] as const).map((t) => (
          <button key={t} className={tool === t ? 'on' : ''} onClick={() => set({ tool: t, selected: null })}>
            {t === 'move' ? 'Move' : t === 'scout' ? `Scout · ${SCOUT_COST}` : `Fort · ${FORT_COST}`}
          </button>
        ))}
      </div>
      <p className="hint">
        {tool === 'move' && (selected == null
          ? (padLike ? 'Select one of your islands, then a neighbouring island.' : 'Click one of your islands, then a neighbouring island.')
          : `Moving from ${fmtHex(new Board(view.radius).hex(selected))} — ${available(selected)} available. ${padLike ? 'Select' : 'Click'} a highlighted island.`)}
        {tool === 'scout' && `${padLike ? 'Select' : 'Click'} up to 3 islands in a row, starting next to your land. The scout reveals 2 tiles around where it ends.`}
        {tool === 'fort' && `${padLike ? 'Select' : 'Click'} one of your islands: ×1.5 defence.`}
        {' '}<span className="muted">{padLike ? <>Or press <Glyph h="orderMenu" /> on an island for the order menu.</> : 'Or right-click an island (long-press on touch) for the order menu.'}</span>
      </p>
      <label className="recruit">
        Recruit at capital
        <input type="range" min={0} max={Math.min(MAX_RECRUIT, view.aether)} value={draft.recruit} onChange={(e) => setRecruit(+e.target.value)} />
        <b>{draft.recruit}</b>
      </label>
      <ul className="moves">
        {draft.moves.map((m, k) => (
          <li key={k}>
            <span>{fmtHex(m.from)} → {fmtHex(m.to)}</span>
            <button className="small" onClick={() => setMoveCount(k, m.count - 1)}>−</button>
            <b>{m.count}</b>
            <button className="small" onClick={() => setMoveCount(k, m.count + 1)}>+</button>
            <button className="small x" onClick={() => removeMove(k)}>×</button>
          </li>
        ))}
        {draft.scout && <li><span>Scout: {draft.scout.map(fmtHex).join(' → ')}</span><button className="small x" onClick={() => set({ draft: { ...draft, scout: null } })}>×</button></li>}
        {draft.fort && <li><span>Fort at {fmtHex(draft.fort)}</span><button className="small x" onClick={() => set({ draft: { ...draft, fort: null } })}>×</button></li>}
      </ul>
      <Market />
      <button className="primary seal" disabled={busy || locked} onClick={send} style={{ ['--hold' as string]: `${Math.round(endHold * 100)}%` }}>
        {planning ? `Sealing opens at turn ${match.turn + 1}` : locked ? 'Resolving…' : submittedTurn === match.turn ? '🔒 Sealed — update orders' : '🔒 Seal & send orders'} <Glyph h="endTurn" />
      </button>
      <p className="muted small" title="Your orders are encrypted in this browser to a key that exists only inside the sealed machine running the game. The blockchain stores the encrypted bytes; other players and we see nothing until The Reveal.">Only the game’s sealed machine can read your orders. Not other players, not us.</p>
      {err && <div className="err">{err}</div>}
    </aside>
  );
}

function Market() {
  const { view, match, chain, draft, set, tool, intelFrom } = useStore();
  if (!view || !match) return null;
  const lords = view.seats.map((s, i) => ({ s, i })).filter((x) => x.s.warlord && x.s.alive && x.i !== view.me);
  if (!lords.length) return null;
  return (
    <div className="market">
      <h3>Warlord market</h3>
      {lords.map(({ s, i }) => (
        <div className="lord" key={i}>
          <div className="lord-name">
            <i className="dot" style={{ background: seatColor(i) }} /> <b>{seatName(match, i, chain?.account)}</b>
            {s.truceUntil >= match.turn && <span className="truce">🤝 truce through turn {s.truceUntil}</span>}
          </div>
          <div className="deals">
            <button className={`small ${tool === 'intel' && intelFrom === i ? 'on' : ''}`} onClick={() => set({ tool: 'intel', intelFrom: i, selected: null })} title="Reveal an island this warlord can see, and its neighbours">
              👁 Intel · {s.intelPrice}
            </button>
            {[1, 3].map((t) => (
              <button key={t} className="small" onClick={() => addTrade({ with: i, kind: { truce: { turns: t } } })} title="It won't move into your islands. Attack it and the truce ends.">
                🤝 {t} turn{t > 1 ? 's' : ''} · {s.trucePrice * t}
              </button>
            ))}
          </div>
        </div>
      ))}
      {tool === 'intel' && <p className="hint">Pick an island under the clouds. You only pay if the warlord can actually see it.</p>}
      {draft.trades.length > 0 && (
        <ul className="moves">
          {draft.trades.map((t, k) => (
            <li key={k}>
              <span>{'intel' in t.kind ? `Intel on ${fmtHex(t.kind.intel.at)}` : `Truce, ${t.kind.truce.turns} turn${t.kind.truce.turns > 1 ? 's' : ''}`} · {seatName(match, t.with, chain?.account)} · {tradeCost(t)}</span>
              <button className="small x" onClick={() => removeTrade(k)}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ControlsBar({ overlay }: { overlay: 'none' | 'threat' }) {
  const mode = useInput((st) => st.mode);
  if (mode !== 'gamepad' && mode !== 'keyboard') return null;
  return (
    <div className="controls-bar">
      <span><Glyph h="move" /> cursor</span>
      <span><Glyph h="select" /> select</span>
      <span><Glyph h="back" /> cancel</span>
      <span><Glyph h="orderMenu" /> order menu</span>
      <span><Glyph h="cyclePrev" /><Glyph h="cycleNext" /> armies</span>
      <span><Glyph h="overlay" /> threat {overlay === 'threat' ? 'on' : 'off'}</span>
      <span><Glyph h="camera" /> camera</span>
      <span><Glyph h="endTurn" /> {mode === 'gamepad' ? 'hold to seal' : 'seal'}</span>
      <span><Glyph h="pause" /> menu</span>
    </div>
  );
}

function TileInfo({ index, tiles, board }: { index: number | null; tiles: ReturnType<typeof tilesFromView>; board: Board | null }) {
  const { match, chain } = useStore();
  if (index == null || !board || !tiles[index]) return null;
  const t = tiles[index];
  const h = board.hex(index);
  return (
    <div className="tileinfo panel">
      <b>{fmtHex(h)}</b>{' '}
      {t.terrain == null ? <span className="muted">Veiled — never seen</span> : (
        <>
          <span>{TERRAIN_NAMES[t.terrain]}</span>
          {t.terrain !== 4 && <span className="muted"> · def ×{DEFENSE[t.terrain]}{t.fort ? ' ×1.5 fort' : ''} · +{INCOME[t.terrain]} aether</span>}
          {t.sight === 'visible' ? (
            t.owner != null ? <span> · <i className="dot" style={{ background: seatColor(t.owner) }} /> {seatName(match, t.owner, chain?.account)} · {t.troops} troops</span> : <span className="muted"> · unclaimed</span>
          ) : <span className="muted"> · remembered (out of sight)</span>}
        </>
      )}
    </div>
  );
}

function MuteButton() {
  const [m, setM] = useState(isMuted());
  useEffect(() => onMute(setM), []);
  return <button className="ghost mute" title={m ? 'Sound off' : 'Sound on'} aria-label={m ? 'Unmute' : 'Mute'} onClick={() => setMuted(!m)}>{m ? '🔇' : '🔊'}</button>;
}

/** While the turn resolves: honest about what is happening and how long it usually takes. */
function ResolvingCard() {
  const { match, resolvingSince, resolveMs, sealedOrders } = useStore();
  const now = useNow(500);
  if (!match) return null;
  const avg = resolveMs.length ? Math.round(resolveMs.reduce((a, b) => a + b, 0) / resolveMs.length / 1000) : null;
  const el = resolvingSince ? Math.round((now - resolvingSince) / 1000) : null;
  return (
    <div className="resolving-card panel">
      <div className="rc-row"><span className="rc-ok">✓</span> Orders sealed{sealedOrders ? ' (yours shown solid on the map)' : ''}</div>
      <div className="rc-row live"><span className="rc-spin" /> The sealed machine is rolling the dice and fighting the battles{el != null ? ` · ${el}s` : ''}</div>
      <div className="rc-row muted"><span className="rc-dot" /> The chain checks its proof, then the clouds move</div>
      <p className="muted small">{avg ? `Recent turns took about ${avg}s.` : 'Usually 20–40 seconds on testnet.'} Plan your next move meanwhile.</p>
    </div>
  );
}

/** What just happened, for a few seconds after each turn. */
function RecapCard() {
  const recap = useStore((st) => st.recap);
  const now = useNow(1000);
  const [hidden, setHidden] = useState<number | null>(null);
  if (!recap || hidden === recap.at || now - recap.at > 9000) return null;
  const lines: string[] = [];
  if (recap.won) lines.push(`⚔ Won ${recap.won} battle${recap.won > 1 ? 's' : ''}`);
  if (recap.lost) lines.push(`☠ Lost ${recap.lost} battle${recap.lost > 1 ? 's' : ''}`);
  if (recap.clashes) lines.push(`${recap.clashes} clash${recap.clashes > 1 ? 'es' : ''} in the open sky`);
  if (!recap.won && !recap.lost && !recap.clashes) lines.push('No battles this turn');
  lines.push(`${recap.tiles} island${recap.tiles === 1 ? '' : 's'}${recap.tilesDelta ? ` (${recap.tilesDelta > 0 ? '+' : ''}${recap.tilesDelta})` : ''}`);
  lines.push(`${recap.aether} aether (+${recap.income}/turn)`);
  return (
    <div className={`recap panel ${recap.lost && !recap.won ? 'bad' : recap.won ? 'good' : ''}`} onClick={() => setHidden(recap.at)} role="status">
      <h3>Turn {recap.turn}</h3>
      <div className="recap-lines">{lines.map((l) => <span key={l}>{l}</span>)}</div>
      {recap.fallen.map((f) => <p key={f} className="fallen">{f} {f === 'You' ? 'have' : 'has'} fallen</p>)}
      {recap.plan && <p className="muted small">Your plan carried over{recap.plan.trimmed ? `, ${recap.plan.trimmed} order${recap.plan.trimmed > 1 ? 's' : ''} trimmed` : ''}. Check it, then seal.</p>}
    </div>
  );
}

function Feed() {
  const feed = useStore((s) => s.feed);
  return (
    <div className="feed">
      {feed.slice(0, 8).map((f) => (
        <div key={f.id} className={`item ${f.tone}`}><span className="t">T{f.turn}</span>{f.text}</div>
      ))}
    </div>
  );
}

function EndPanel() {
  const { match, chain, set } = useStore();
  if (!match || !chain) return null;
  return (
    <div className="panel float-center end">
      <h2>{match.status === 'Finished' ? 'The war is over' : match.status === 'Revealing' ? 'Revealing…' : 'Revealed'}</h2>
      <ol>
        {(match.ranking ?? []).map((i) => (
          <li key={i} style={{ ['--c' as string]: seatColor(i) }}><i className="dot" style={{ background: seatColor(i) }} /> {seatName(match, i, chain.account)}</li>
        ))}
      </ol>
      {match.payouts.length > 0 && (
        <p>Payouts: {match.payouts.map(([a, v]) => `${a === chain.account ? 'you' : a} $${(Number(v) / 1e6).toFixed(2)}`).join(', ')}. Winnings are claimable from the lobby.</p>
      )}
      {chain.network !== 'devnet' && match.payouts.some(([a, v]) => a === chain.account && v !== '0') && (
        <button className="ghost" onClick={() => set({ screen: 'vault' })}>Cash out privately ›</button>
      )}
      {match.status === 'Revealed' ? (
        <button className="primary" onClick={() => set({ screen: 'reveal' })}>Open The Reveal</button>
      ) : (
        <p className="muted">The enclave is publishing the full hidden history…</p>
      )}
    </div>
  );
}
