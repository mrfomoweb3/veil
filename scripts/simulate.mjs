// Headless end-to-end run against the devnet (or any server speaking the devnet API):
// one human seat played by this script (encrypted orders, decrypted views) + AI warlords,
// to the end, then The Reveal, then `veil-verify` against what was posted.
//
//   node scripts/simulate.mjs [--api http://localhost:8787] [--seats 4] [--turns 8]
import { x25519 } from '../web/node_modules/@noble/curves/ed25519.js';
import { hkdf } from '../web/node_modules/@noble/hashes/hkdf.js';
import { sha256 } from '../web/node_modules/@noble/hashes/sha256.js';
import { xchacha20poly1305 } from '../web/node_modules/@noble/ciphers/chacha.js';
import { randomBytes } from '../web/node_modules/@noble/hashes/utils.js';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--api', 'http://localhost:8787');
const SEATS = Number(arg('--seats', 4));
const TURNS = Number(arg('--turns', 8));
const me = `sim-${Date.now() % 100000}.local`;
const enc = new TextEncoder();
const hex = (b) => Buffer.from(b).toString('hex');

async function view(method, args) {
  const r = await fetch(`${API}/api/view?method=${method}&args=${encodeURIComponent(JSON.stringify(args))}`);
  return r.json();
}
async function call(method, args) {
  const r = await fetch(`${API}/api/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signer: me, method, args }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error}`);
  return j.result;
}
function seal(pk, pt, aad, info) {
  const e = randomBytes(56), eph = e.slice(0, 32), nonce = e.slice(32);
  const ephPk = x25519.getPublicKey(eph);
  const salt = new Uint8Array(64); salt.set(ephPk); salt.set(pk, 32);
  const key = hkdf(sha256, x25519.getSharedSecret(eph, pk), salt, info, 32);
  const ct = xchacha20poly1305(key, nonce, aad).encrypt(pt);
  return Buffer.concat([Buffer.from([1]), ephPk, nonce, ct]);
}
function open(sk, payload, aad, info) {
  const ephPk = payload.subarray(1, 33), nonce = payload.subarray(33, 57);
  const salt = new Uint8Array(64); salt.set(ephPk); salt.set(x25519.getPublicKey(sk), 32);
  const key = hkdf(sha256, x25519.getSharedSecret(sk, ephPk), salt, info, 32);
  return xchacha20poly1305(key, nonce, aad).decrypt(payload.subarray(57));
}
function decodeView(bytes) {
  const n = (bytes[0] << 8) | bytes[1]; const b = bytes.subarray(2, 2 + n); let i = 0;
  const u8 = () => b[i++], u16 = () => { const v = (b[i] << 8) | b[i + 1]; i += 2; return v; }, u32 = () => { const v = b.readUInt32BE(i); i += 4; return v; };
  u8(); const me = u8(), radius = u8(), capital = u8(); u8();
  const turn = u32(), aether = u32(), income = u32();
  const seats = Array.from({ length: u8() }, () => ({ alive: !!u8(), tiles: u16() })); u8();
  const tiles = Array.from({ length: u8() }, () => { const index = u8(), p = u8(), o = u8(); return { index, terrain: p & 7, owner: o === 255 ? null : o, troops: u16() }; });
  return { me, radius, capital, turn, aether, income, seats, tiles };
}
function boardHexes(R) { const h = []; for (let q = -R; q <= R; q++) for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) h.push([q, r]); return h; }
const dist = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[0] + a[1] - b[0] - b[1])) / 2;

// Greedy: recruit everything, push every stack to its best visible non-void neighbour.
function planOrders(v) {
  const hs = boardHexes(v.radius);
  const known = new Map(v.tiles.map((t) => [t.index, t]));
  const moves = [];
  for (const t of v.tiles.filter((t) => t.owner === v.me).sort((a, b) => b.troops - a.troops)) {
    const troops = t.troops + (t.index === v.capital ? Math.min(10, v.aether) : 0);
    if (troops < 3 || moves.length >= 6) continue;
    const h = hs[t.index];
    const options = v.tiles.filter((n) => n.terrain !== 4 && n.owner !== v.me && dist(hs[n.index], h) === 1);
    const target = options.sort((a, b) => a.troops - b.troops)[0];
    if (target && troops - 1 > target.troops * 1.6) moves.push({ from: h, to: hs[target.index], count: troops - 1 });
  }
  return { moves, scout: null, fort: null, recruit: Math.min(10, v.aether) };
}

const sk = x25519.utils.randomPrivateKey();
const viewPk = hex(x25519.getPublicKey(sk));
const id = await call('create_match', { mode: 'Practice', max_seats: SEATS, turn_len_ms: 15000, ai_seats: SEATS - 1, max_turns: TURNS });
await call('join_practice', { match_id: id, view_pk: viewPk });
await call('start', { match_id: id });
console.log(`match ${id}: ${me} vs ${SEATS - 1} warlords, ${TURNS} turns`);

let seen = -1;
for (;;) {
  const m = await view('get_match', { match_id: id });
  if (m.status === 'Revealed') break;
  if (['Lobby', 'Cancelled'].includes(m.status)) throw new Error(`match went to ${m.status}`);
  const v = await view('get_view', { match_id: id, account: me });
  if (v && v.turn > seen) {
    seen = v.turn;
    const pt = open(sk, Buffer.from(v.ciphertext, 'base64'), enc.encode(`veil-view|${id}|${v.turn}|${me}`), enc.encode('veil-view-v1'));
    const pv = decodeView(Buffer.from(pt));
    const mine = pv.tiles.filter((t) => t.owner === pv.me);
    console.log(`  turn ${pv.turn}: I see ${pv.tiles.length} tiles, hold ${mine.length}, troops ${mine.reduce((s, t) => s + t.troops, 0)}, aether ${pv.aether}; scoreboard ${pv.seats.map((s) => (s.alive ? s.tiles : 'x')).join('/')}`);
    if (m.status === 'Running') {
      const json = enc.encode(JSON.stringify(planOrders(pv)));
      const padded = new Uint8Array(1024); padded[0] = json.length >> 8; padded[1] = json.length & 255; padded.set(json, 2);
      const ct = seal(Buffer.from(m.game_pk, 'hex'), padded, enc.encode(`veil|${id}|${m.turn}|${me}`), enc.encode('veil-orders-v1'));
      await call('submit_orders', { match_id: id, turn: m.turn, ct_b64: ct.toString('base64') });
    }
  }
  await new Promise((r) => setTimeout(r, 300));
}

const m = await view('get_match', { match_id: id });
const cfg = await view('get_config', {});
const history = await view('get_history', { match_id: id, from: 0, limit: 60 });
const orders = await view('get_order_log', { match_id: id });
const chain = {
  turns: history.map((h) => ({ public: JSON.parse(h.public), state_commit: h.state_commit, vrf: h.vrf })),
  orders: orders.map((o) => ({ turn: o.turn, account: o.account, ciphertext_b64: o.ciphertext_b64 })),
};
const chainFile = `/tmp/veil-chain-${id}.json`;
writeFileSync(chainFile, JSON.stringify(chain));
console.log(`finished: ranking ${JSON.stringify(m.ranking)}, reveal ${m.reveal_hash}`);
const out = execFileSync(fileURLToPath(new URL('../target/release/veil-verify', import.meta.url)), [
  '--api', API + '/api', '--project', 'devnet', '--match', String(id), '--hash', m.reveal_hash, '--vrf-pubkey', cfg.vrf_pubkey, '--chain', chainFile,
]).toString();
process.stdout.write(out);
