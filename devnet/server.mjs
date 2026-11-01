// VEIL devnet: a local stand-in for veil.near + OutLayer, for development and Practice play.
//
// It mirrors the contract's methods, return shapes and NEP-297 events exactly, and drives the
// REAL engine (target/release/veil-engine-local) through stdin/stdout, as OutLayer does.
// Every VRF proof the engine returns is verified here the same way the contract verifies it.
// It is not a blockchain and not a TEE: identities are not authenticated, and the engine's
// master key sits on disk. Never put money near it.
//
//   node devnet/server.mjs            (port 8787, data in devnet/data)
//
// HTTP:  POST /api/call  {signer, method, args}     → {result} | {error}
//        GET  /api/view?method=…&args=<json>        → result
//        GET  /api/events                           → SSE stream of EVENT_JSON payloads
//        GET  /api/public/storage/get?key=…         → OutLayer-style public storage

import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createPublicKey, verify as edVerify, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.VEIL_DEVNET_DATA || join(ROOT, 'devnet', 'data');
const ENGINE_DIR = join(DATA, 'engine');
const ENGINE_BIN = process.env.VEIL_ENGINE_BIN || join(ROOT, 'target', 'release', 'veil-engine-local');
const PORT = Number(process.env.PORT || 8787);
const CONTRACT = 'veil.local';

const MIN_SEATS = 2, MAX_SEATS = 6, MAX_ORDERS_B64 = 2800, RETRY_DELAY_MS = 30_000;
const STALE_LOBBY_MS = 30 * 60 * 1000, MAX_FAILURES = 5, AUTOPILOT_AFTER = 3, RAKE_BPS = 500;
const AI_VIEW_PK = '09' + '00'.repeat(31);

mkdirSync(ENGINE_DIR, { recursive: true });
if (!existsSync(ENGINE_BIN)) {
  console.error(`engine binary not found at ${ENGINE_BIN}\nbuild it: cargo build --release -p veil-engine --bin veil-engine-local`);
  process.exit(1);
}
const VRF_PUBKEY = execFileSync(ENGINE_BIN, ['vrf-pubkey'], { env: { ...process.env, VEIL_LOCAL_DIR: ENGINE_DIR } }).toString().trim();
const vrfKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(VRF_PUBKEY, 'hex')]), format: 'der', type: 'spki' });

// ------------------------------------------------------------------ state

const STATE_FILE = join(DATA, 'state.json');
const S = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  : { next_id: 1, request_id: 1, rake: '0', matches: {}, views: {}, orders: {}, history: {}, balances: {}, usdc: {} };
let dirty = false;
function save() { dirty = true; }
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  writeFileSync(STATE_FILE + '.tmp', JSON.stringify(S));
  renameSync(STATE_FILE + '.tmp', STATE_FILE);
}, 500);

const now = () => Date.now();
const k = (id, acc) => `${id}|${acc}`;
const clients = new Set();
function emit(event, data) {
  const payload = { standard: 'veil', version: '1.0.0', event, data: [data] };
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(line);
}
class Fail extends Error {}
const require_ = (cond, msg) => { if (!cond) throw new Fail(msg); };
const isHex32 = (h) => typeof h === 'string' && /^[0-9a-f]{64}$/i.test(h);
const getMatch = (id) => { const m = S.matches[id]; require_(m, 'no such match'); return m; };

function shares(paying) {
  if (paying <= 2) return [10000n];
  if (paying <= 4) return [7000n, 3000n];
  return [6000n, 2500n, 1500n];
}
function credit(acc, amount) {
  S.balances[acc] = (BigInt(S.balances[acc] || '0') + BigInt(amount)).toString();
}

// ------------------------------------------------------------------ engine

let engineQueue = Promise.resolve();
function runEngine(input) {
  // One run at a time, like a single worker; OutLayer's CAS makes concurrency safe anyway.
  const job = engineQueue.then(() => new Promise((resolveRun) => {
    const reqId = String(S.request_id++);
    save();
    const child = spawn(ENGINE_BIN, ['run'], {
      env: { ...process.env, VEIL_LOCAL_DIR: ENGINE_DIR, NEAR_PREDECESSOR_ID: CONTRACT, NEAR_SENDER_ID: CONTRACT, NEAR_REQUEST_ID: reqId },
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', () => {
      try { resolveRun(JSON.parse(out)); } catch { resolveRun({ ok: false, error: `engine crashed: ${err.slice(0, 300)}` }); }
    });
    child.stdin.end(JSON.stringify(input));
  }));
  engineQueue = job.catch(() => {});
  return job;
}

function verifyVrf(vrf, seed) {
  if (!vrf || typeof vrf.alpha !== 'string') return null;
  if (!vrf.alpha.startsWith('vrf:') || !vrf.alpha.endsWith(`:${seed}`)) return null;
  const sig = Buffer.from(vrf.signature_hex || '', 'hex');
  if (sig.length !== 64) return null;
  if (createHash('sha256').update(sig).digest('hex') !== vrf.output_hex) return null;
  return edVerify(null, Buffer.from(vrf.alpha), vrfKey, sig) ? { output_hex: vrf.output_hex, signature_hex: vrf.signature_hex, alpha: vrf.alpha } : null;
}

async function engineCall(id, op, turn, input) {
  const t0 = now();
  const out = await runEngine(input);
  if (!out.ok) console.warn(`[engine] ${op} #${id} t${turn} failed: ${out.error}`);
  else console.log(`[engine] ${op} #${id} t${turn} ok in ${now() - t0} ms`);
  applyEngineOutput(id, op, turn, out.ok ? out : null);
}

function applyEngineOutput(id, op, turn, out) {
  const m = S.matches[id];
  const seed = op === 'init' ? `init-${id}` : op === 'resolve' ? `turn-${turn}` : '';
  const vrf = out && (op === 'init' || op === 'resolve') ? verifyVrf(out.vrf, seed) : null;
  const ok = op === 'reveal' ? !!(out && typeof out.hash === 'string')
    : !!(out && vrf && out.turn === turn && typeof out.state_commit === 'string');
  const expected = { init: 'Starting', resolve: 'Resolving', reveal: 'Revealing' }[op];
  if (m.status !== expected || (op === 'resolve' && m.turn !== turn)) return;
  if (!ok) {
    m.failures += 1;
    if (op === 'init') { m.seats = m.seats.filter((s) => !s.ai); m.status = 'Lobby'; }
    else if (op === 'resolve') { m.status = 'Running'; m.deadline_ms = now() + RETRY_DELAY_MS; }
    else m.status = 'Finished';
    emit('veil_engine_retry', { match: id, op, turn, failures: m.failures });
    return save();
  }
  if (op === 'reveal') {
    m.reveal_hash = out.hash; m.reveal_key = out.key; m.status = 'Revealed';
    emit('veil_revealed', { match: id, hash: out.hash, key: out.key, chunks: out.chunks });
    return save();
  }
  for (const s of m.seats.filter((s) => !s.ai)) {
    if (out.views?.[s.account]) S.views[k(id, s.account)] = { turn, ciphertext: out.views[s.account] };
  }
  (S.history[id] ||= [])[turn] = { turn, public: JSON.stringify(out.public), state_commit: out.state_commit, vrf, resolved_ms: now() };
  for (const s of m.seats) delete S.orders[k(id, s.account)];
  const pub = out.public;
  m.failures = 0;
  m.state_commit = out.state_commit;
  for (const e of pub.eliminated || []) if (m.seats[e]) m.seats[e].alive = false;
  if (op === 'init') {
    m.game_pk = out.game_pk; m.status = 'Running'; m.turn = 1; m.deadline_ms = now() + m.turn_len_ms;
    emit('veil_match_started', { match: id, game_pk: m.game_pk, deadline_ms: m.deadline_ms });
    return save();
  }
  emit('veil_turn_resolved', { match: id, turn, battles: pub.battles, eliminated: pub.eliminated });
  if (!pub.game_over) {
    m.turn += 1; m.status = 'Running'; m.deadline_ms = now() + m.turn_len_ms;
    return save();
  }
  m.status = 'Finished';
  m.ranking = pub.ranking;
  m.payouts = [];
  if (m.mode.Stakes && pub.ranking) {
    const pot = BigInt(m.pot);
    const rake = (pot * BigInt(RAKE_BPS)) / 10000n;
    const prize = pot - rake;
    const paying = pub.ranking.map((i) => m.seats[i]).filter((s) => s && BigInt(s.paid) > 0n).map((s) => s.account);
    const split = shares(paying.length);
    const winners = Math.min(split.length, paying.length);
    let paid = 0n;
    for (let i = 0; i < winners; i++) {
      const amt = i + 1 === winners ? prize - paid : (prize * split[i]) / 10000n;
      paid += amt;
      m.payouts.push([paying[i], amt.toString()]);
      credit(paying[i], amt);
    }
    S.rake = (BigInt(S.rake) + rake).toString();
  }
  emit('veil_match_finished', { match: id, ranking: m.ranking, payouts: m.payouts });
  save();
  // Devnet convenience: reveal straight away (on chain, anyone cranks `reveal`).
  setTimeout(() => call('devnet-cranker.local', 'reveal', { match_id: id }).catch(() => {}), 500);
}

// ------------------------------------------------------------------ methods

const methods = {
  create_match(signer, { mode, max_seats, turn_len_ms, ai_seats, max_turns }) {
    require_(max_seats >= MIN_SEATS && max_seats <= MAX_SEATS, '2–6 seats');
    require_(ai_seats < max_seats, 'leave room for a human');
    require_(turn_len_ms >= 15_000 && turn_len_ms <= 86_400_000, 'turn length 15 s – 24 h');
    max_turns = max_turns ?? 20;
    require_(max_turns >= 1 && max_turns <= 50, '1–50 turns');
    if (mode !== 'Practice') require_(mode?.Stakes && BigInt(mode.Stakes.buy_in) > 0n, 'bad mode');
    const id = S.next_id++;
    S.matches[id] = {
      id, host: signer, mode, status: 'Lobby', seats: [], max_seats, ai_seats, max_turns, turn: 0, turn_len_ms,
      deadline_ms: 0, game_pk: null, state_commit: null, engine_project: 'devnet/veil-engine-local', engine_version: null,
      pot: '0', ranking: null, payouts: [], reveal_hash: null, reveal_key: null, created_ms: now(), failures: 0,
    };
    emit('veil_match_created', { match: id, host: signer, mode, max_seats, ai_seats });
    save();
    return id;
  },

  join_practice(signer, { match_id, view_pk }) {
    const m = getMatch(match_id);
    require_(m.mode === 'Practice', 'this is a stakes match: join with ft_transfer_call');
    seatHuman(m, signer, view_pk, '0');
    emit('veil_seat_joined', { match: match_id, account: signer });
    save();
  },

  // Devnet stand-in for usdc.ft_transfer_call(veil, amount, msg): debits the signer's fake USDC.
  ft_transfer_call(signer, { amount, msg }) {
    const bal = BigInt(S.usdc[signer] || '0');
    require_(bal >= BigInt(amount), 'not enough devnet USDC (call faucet)');
    S.usdc[signer] = (bal - BigInt(amount)).toString();
    const refund = ftOnTransfer(signer, amount, msg);
    S.usdc[signer] = (BigInt(S.usdc[signer]) + BigInt(refund)).toString();
    save();
    return refund;
  },

  faucet(signer) {
    S.usdc[signer] = (BigInt(S.usdc[signer] || '0') + 10_000_000n).toString();
    save();
    return S.usdc[signer];
  },

  leave_lobby(signer, { match_id }) {
    const m = getMatch(match_id);
    require_(m.status === 'Lobby', 'match already started');
    const i = m.seats.findIndex((s) => s.account === signer);
    require_(i >= 0, 'not seated');
    const [seat] = m.seats.splice(i, 1);
    m.pot = (BigInt(m.pot) - BigInt(seat.paid)).toString();
    if (BigInt(seat.paid) > 0n) credit(signer, seat.paid);
    emit('veil_seat_left', { match: match_id, account: signer });
    save();
  },

  start(signer, { match_id }) {
    const m = getMatch(match_id);
    require_(m.status === 'Lobby', 'not in lobby');
    require_(m.seats.length >= 1, 'nobody is seated');
    const full = m.seats.length + m.ai_seats >= m.max_seats;
    require_(full || signer === m.host, 'only the host can start before the lobby is full');
    const ai = Math.max(m.ai_seats, MIN_SEATS - m.seats.length);
    for (let i = 0; i < ai; i++) {
      m.seats.push({ account: `warlord-${i + 1}.veil`, view_pk: AI_VIEW_PK, ai: true, autopilot: false, missed: 0, alive: true, paid: '0' });
    }
    m.status = 'Starting';
    save();
    engineCall(match_id, 'init', 0, {
      op: 'init', match_id,
      seats: m.seats.map((s) => ({ account: s.account, view_pk: s.view_pk, ai: s.ai })),
      config: { max_turns: m.max_turns },
    });
  },

  submit_orders(signer, { match_id, turn, ct_b64 }) {
    require_(typeof ct_b64 === 'string' && ct_b64.length <= MAX_ORDERS_B64, 'ciphertext too large');
    const m = getMatch(match_id);
    require_(m.status === 'Running', 'not accepting orders');
    require_(turn === m.turn, 'wrong turn');
    require_(now() < m.deadline_ms, 'turn deadline passed');
    const seat = m.seats.find((s) => s.account === signer);
    require_(seat, 'not seated');
    require_(!seat.ai && seat.alive, 'seat cannot submit');
    emit('veil_orders_submitted', { match: match_id, turn, seat: signer, ct: ct_b64 });
    S.orders[k(match_id, signer)] = ct_b64;
    (S.orderLog ||= []).push({ match: match_id, turn, account: signer, ciphertext_b64: ct_b64 });
    save();
  },

  resolve_turn(signer, { match_id }) {
    const m = getMatch(match_id);
    require_(m.status === 'Running', 'not running');
    const waiting = m.seats.filter((s) => s.alive && !s.ai && !s.autopilot);
    const allIn = waiting.every((s) => S.orders[k(match_id, s.account)]);
    require_(now() >= m.deadline_ms || allIn, 'turn still open');
    const seats = m.seats.map((s) => {
      const ct = S.orders[k(match_id, s.account)] ?? null;
      if (s.alive && !s.ai && !s.autopilot) {
        if (ct) s.missed = 0;
        else if (++s.missed >= AUTOPILOT_AFTER) { s.autopilot = true; emit('veil_autopilot', { match: match_id, account: s.account }); }
      }
      const ai = s.ai || s.autopilot;
      return { account: s.account, view_pk: s.view_pk, ai, orders_ct: ai ? null : ct };
    });
    m.status = 'Resolving';
    save();
    engineCall(match_id, 'resolve', m.turn, { op: 'resolve', match_id, turn: m.turn, seats });
  },

  reveal(signer, { match_id }) {
    const m = getMatch(match_id);
    require_(m.status === 'Finished', 'match not finished (or already revealed)');
    m.status = 'Revealing';
    save();
    engineCall(match_id, 'reveal', 0, { op: 'reveal', match_id });
  },

  claim_seat_back(signer, { match_id }) {
    const s = getMatch(match_id).seats.find((s) => s.account === signer && !s.ai);
    require_(s, 'not seated');
    require_(s.autopilot, 'seat is not on autopilot');
    s.autopilot = false; s.missed = 0;
    emit('veil_seat_reclaimed', { match: match_id, account: signer });
    save();
  },

  rotate_view_pk(signer, { match_id, view_pk }) {
    require_(isHex32(view_pk), 'view_pk must be 32 bytes of hex');
    const s = getMatch(match_id).seats.find((s) => s.account === signer && !s.ai);
    require_(s, 'not seated');
    s.view_pk = view_pk;
    save();
  },

  cancel_stale(signer, { match_id }) {
    const m = getMatch(match_id);
    const staleLobby = m.status === 'Lobby' && now() >= m.created_ms + STALE_LOBBY_MS;
    const broken = ['Running', 'Resolving', 'Starting'].includes(m.status) && m.failures >= MAX_FAILURES;
    require_(staleLobby || broken, 'match is not stale');
    for (const s of m.seats) if (BigInt(s.paid) > 0n) credit(s.account, s.paid);
    m.status = 'Cancelled'; m.pot = '0';
    emit('veil_match_cancelled', { match: match_id });
    save();
  },

  claim(signer) {
    const amt = BigInt(S.balances[signer] || '0');
    require_(amt > 0n, 'nothing to claim');
    delete S.balances[signer];
    S.usdc[signer] = (BigInt(S.usdc[signer] || '0') + amt).toString();
    save();
  },
};

function seatHuman(m, account, view_pk, paid) {
  require_(m.status === 'Lobby', 'lobby closed');
  require_(isHex32(view_pk), 'view_pk must be 32 bytes of hex');
  require_(!m.seats.some((s) => s.account === account), 'already seated');
  require_(m.seats.length + m.ai_seats < m.max_seats, 'match is full');
  m.seats.push({ account, view_pk, ai: false, autopilot: false, missed: 0, alive: true, paid });
}

function ftOnTransfer(sender, amount, msg) {
  let v; try { v = JSON.parse(msg); } catch { return amount; }
  const m = S.matches[v.join];
  if (!m || !m.mode.Stakes) return amount;
  const buyIn = BigInt(m.mode.Stakes.buy_in);
  if (BigInt(amount) < buyIn) return amount;
  try { seatHuman(m, sender, v.view_pk, buyIn.toString()); } catch { return amount; }
  m.pot = (BigInt(m.pot) + buyIn).toString();
  emit('veil_seat_joined', { match: m.id, account: sender, paid: buyIn.toString() });
  return (BigInt(amount) - buyIn).toString();
}

const views = {
  get_config: () => ({ owner: 'devnet', outlayer: 'devnet', engine_project: 'devnet/veil-engine-local', engine_version: null, vrf_pubkey: VRF_PUBKEY, usdc: 'usdc.devnet', rake_bps: RAKE_BPS, rake: S.rake, network: 'devnet' }),
  get_match: ({ match_id }) => S.matches[match_id] ?? null,
  get_matches: ({ from_id = 1, limit = 50 }) => Object.values(S.matches).filter((m) => m.id >= from_id).slice(0, Math.min(limit, 100)),
  get_open_lobbies: () => Object.values(S.matches).filter((m) => m.status === 'Lobby'),
  get_view: ({ match_id, account }) => S.views[k(match_id, account)] ?? null,
  get_history: ({ match_id, from, limit }) => {
    const h = S.history[match_id] || [];
    const out = [];
    for (let t = from; t < from + Math.min(limit, 60) && h[t]; t++) out.push(h[t]);
    return out;
  },
  get_submitted: ({ match_id }) => (S.matches[match_id]?.seats || []).filter((s) => S.orders[k(match_id, s.account)]).map((s) => s.account),
  get_balance: ({ account }) => S.balances[account] || '0',
  // Devnet extras.
  usdc_balance: ({ account }) => S.usdc[account] || '0',
  get_order_log: ({ match_id }) => (S.orderLog || []).filter((o) => o.match === match_id),
};

async function call(signer, method, args) {
  const f = methods[method];
  require_(f, `unknown method ${method}`);
  require_(typeof signer === 'string' && /^[a-z0-9._-]{2,64}$/.test(signer), 'bad signer');
  return f(signer, args || {});
}

// The relayer's cranking job: resolve turns whose deadline passed or everyone submitted.
setInterval(() => {
  for (const m of Object.values(S.matches)) {
    if (m.status !== 'Running') continue;
    try { methods.resolve_turn('devnet-cranker.local', { match_id: m.id }); } catch (e) { if (!(e instanceof Fail)) console.error(e); }
  }
}, 1000);

// ------------------------------------------------------------------ http

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.end();
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  try {
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': veil devnet\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/api/view') {
      const f = views[url.searchParams.get('method')];
      if (!f) return send(404, { error: 'unknown view' });
      return send(200, f(JSON.parse(url.searchParams.get('args') || '{}')));
    }
    if (url.pathname === '/api/public/storage/get') {
      const key = url.searchParams.get('key') || '';
      if (!/^[a-z0-9:]+$/.test(key)) return send(400, { error: 'bad key' });
      const p = join(ENGINE_DIR, 'public', key);
      if (!existsSync(p)) return send(404, { error: 'not found' });
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(readFileSync(p));
    }
    if (url.pathname === '/api/call' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 64_000) return send(413, { error: 'too large' }); }
      const { signer, method, args } = JSON.parse(body);
      const result = await call(signer, method, args);
      return send(200, { result: result ?? null });
    }
    send(404, { error: 'not found' });
  } catch (e) {
    if (e instanceof Fail) return send(400, { error: e.message });
    console.error(e);
    send(500, { error: 'internal error' });
  }
});
server.listen(PORT, () => console.log(`VEIL devnet on http://localhost:${PORT}  (engine ${ENGINE_BIN}, VRF key ${VRF_PUBKEY.slice(0, 16)}…)`));
