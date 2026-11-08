// VEIL relayer: players never pay gas and never see a wallet popup.
//
//   POST /onboard {account_id, public_key}  create the player's implicit account (tiny transfer)
//   POST /relay   {signed_delegate}         wrap a NEP-366 delegate action to veil.near and pay gas
//   POST /crank   {method, args}            start / resolve_turn / reveal, with NEAR for OutLayer
//
// It also cranks turns on its own: every few seconds it resolves turns that are due and
// reveals finished matches. It talks to VEIL_CONTRACT, and relays one kind of call to the
// Chain Signatures contract (MPC_CONTRACT): a player's `sign` for their Base cash-out.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Account, Connection, InMemorySigner, KeyPair, keyStores, providers, utils } from 'near-api-js';
import { createRequire } from 'node:module';
// @near-js/transactions' ESM build uses extensionless imports Node can't resolve; use its CJS build.
const require = createRequire(import.meta.url);
const { actionCreators, SCHEMA } = require('@near-js/transactions');
const { deserialize } = require('borsh');
import { checkDelegate, CRANKABLE, implicitMatches, RateLimit } from './policy.mjs';

const env = (k, d) => process.env[k] ?? d ?? (() => { throw new Error(`${k} is required`); })();
const NETWORK = env('NEAR_NETWORK', 'testnet');
const CONTRACT = env('VEIL_CONTRACT');
const RELAYER = env('RELAYER_ACCOUNT');
const DEPOSIT = BigInt(utils.format.parseNearAmount(env('ENGINE_DEPOSIT_NEAR', '0.05')));
const ONBOARD = BigInt(utils.format.parseNearAmount(env('ONBOARD_NEAR', '0.01')));
const MPC = env('MPC_CONTRACT', NETWORK === 'mainnet' ? 'v1.signer' : 'v1.signer-prod.testnet');
const ORIGINS = env('ALLOWED_ORIGINS', 'http://localhost:5173').split(',');
const TGAS = 10n ** 12n;

const store = new keyStores.InMemoryKeyStore();
// The key comes from RELAYER_PRIVATE_KEY, or else from near-cli's credentials file, so it
// never has to be copied into this repo.
function relayerKey() {
  if (process.env.RELAYER_PRIVATE_KEY) return process.env.RELAYER_PRIVATE_KEY;
  const file = join(homedir(), '.near-credentials', NETWORK, `${RELAYER}.json`);
  try { return JSON.parse(readFileSync(file, 'utf8')).private_key; } catch { throw new Error(`No RELAYER_PRIVATE_KEY and no key in ${file}`); }
}
await store.setKey(NETWORK, RELAYER, KeyPair.fromString(relayerKey()));
// NEAR_RPC may list several endpoints (comma-separated); free testnet RPCs rate-limit hard.
// Requests stay on one endpoint and move to the next only when it answers 429 (rate limited):
// a 429 means the request was refused, not run, so even a transaction is safe to send again
// elsewhere. Any other error is passed on unchanged (moving a send after a timeout could
// double it, and near-api-js's own nonce retry must see InvalidNonce).
const RATE_LIMITED = /-429|\b429\b|Rate limits exceeded|Too Many Requests/i;
class RotatingProvider extends providers.JsonRpcProvider {
  constructor(urls) {
    super({ url: urls[0] });
    this.all = urls.map((url) => new providers.JsonRpcProvider({ url }));
    this.at = 0;
  }
  async sendJsonRpc(method, params) {
    let last;
    for (let k = 0; k < this.all.length; k++) {
      const i = (this.at + k) % this.all.length;
      try {
        const r = await this.all[i].sendJsonRpc(method, params);
        if (i !== this.at) { console.log(`RPC: rate-limited, now on ${this.all[i].connection.url}`); this.at = i; }
        return r;
      } catch (e) {
        if (!RATE_LIMITED.test(e?.message ?? '')) throw e;
        last = e;
      }
    }
    throw last;
  }
}
const rpcUrls = env('NEAR_RPC', `https://rpc.${NETWORK}.fastnear.com`).split(',').map((u) => u.trim()).filter(Boolean);
const provider = new RotatingProvider(rpcUrls);
const sendProvider = provider;
const relayer = new Account(new Connection(NETWORK, sendProvider, new InMemorySigner(store), ''), RELAYER);

const perAccount = new RateLimit(30);
// A cash-out needs at most an approve, a shield and a retry or two; signs cost 300 Tgas each.
const perSign = new RateLimit(4);
const perIp = new RateLimit(5);

async function view(method, args = {}) {
  const r = await provider.query({
    request_type: 'call_function', finality: 'optimistic', account_id: CONTRACT, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  return JSON.parse(Buffer.from(r.result).toString());
}

const decode = (v) => { try { return JSON.parse(Buffer.from(v, 'base64').toString()); } catch { return null; } };

function outcomeResult(o) {
  const st = o?.status;
  if (st?.Failure) throw new Error(JSON.stringify(st.Failure).slice(0, 300));
  if (st?.SuccessValue) return decode(st.SuccessValue);
  return null;
}

// A meta-transaction's own status is the delegate wrapper's (empty) one: the contract's
// answer, or its panic, is in the receipt the contract itself executed.
function delegateResult(o, receiver) {
  for (const r of o?.receipts_outcome ?? []) {
    if (r.outcome.status?.Failure) throw new Error(JSON.stringify(r.outcome.status.Failure).slice(0, 300));
  }
  // The last value the receiver returned: the MPC contract answers from its resumed receipt.
  const mine = (o?.receipts_outcome ?? []).filter((r) => r.outcome.executor_id === receiver && r.outcome.status?.SuccessValue);
  return mine.length ? decode(mine[mine.length - 1].outcome.status.SuccessValue) : null;
}

// One crank per match and method at a time. A browser cranks resolve_turn the moment every
// human has sealed, and so does the loop below; both arrive here, and the second would only
// burn gas on a call the contract then refuses. It waits for the first instead.
const cranking = new Map();
function crank(method, args) {
  if (!CRANKABLE.has(method)) return Promise.reject(new Error('not crankable'));
  const key = `${method}:${args?.match_id}`;
  const running = cranking.get(key);
  if (running) return running.then(() => ({ pending: true, joined: true }), () => ({ pending: true, joined: true }));
  // Keep the slot a few seconds after it lands, until RPC reads show the new match state.
  const p = crankOnce(method, args).finally(() => setTimeout(() => cranking.delete(key), 6000));
  cranking.set(key, p);
  return p;
}

async function crankOnce(method, args) {
  let o;
  try {
    o = await relayer.functionCall({ contractId: CONTRACT, methodName: method, args, gas: 300n * TGAS, attachedDeposit: DEPOSIT });
  } catch (e) {
    // An enclave run spans more blocks than the RPC waits for; the transaction carries on.
    if (/"PENDING"|TIMEOUT_ERROR|Request timeout|timed out/i.test(e.message ?? '')) return { pending: true };
    throw e;
  }
  for (const r of o?.receipts_outcome ?? []) {
    if (r.outcome.executor_id === CONTRACT && r.outcome.status?.Failure) throw new Error(JSON.stringify(r.outcome.status.Failure).slice(0, 300));
  }
  return outcomeResult(o);
}

const handlers = {
  async '/onboard'(body, ip) {
    if (!perIp.take(`onboard:${ip}`)) throw new Error('slow down');
    const { account_id, public_key } = body;
    const pk = utils.PublicKey.fromString(public_key);
    if (!implicitMatches(account_id, public_key) || Buffer.from(pk.data).toString('hex') !== account_id) throw new Error('account must be the implicit account of the key');
    try { await provider.query({ request_type: 'view_account', finality: 'final', account_id }); return { created: false }; } catch { /* create */ }
    await relayer.sendMoney(account_id, ONBOARD);
    return { created: true };
  },
  async '/relay'(body) {
    const bytes = Buffer.from(body.signed_delegate ?? '', 'base64');
    let sd;
    try { sd = deserialize(SCHEMA.SignedDelegate, bytes); } catch { throw new Error('undecodable signed delegate'); }
    const why = checkDelegate(sd, CONTRACT, MPC);
    if (why) throw new Error(why);
    const isSign = sd.delegateAction.receiverId === MPC;
    if (!perAccount.take(sd.delegateAction.senderId)) throw new Error('slow down');
    if (isSign && !perSign.take(sd.delegateAction.senderId)) throw new Error('too many signatures, wait a minute');
    console.log(new Date().toISOString(), '/relay', sd.delegateAction.senderId.slice(0, 10), sd.delegateAction.actions.map((a) => a.functionCall?.methodName ?? Object.keys(a)[0]).join(','));
    const o = await relayer.signAndSendTransaction({
      receiverId: sd.delegateAction.senderId,
      actions: [actionCreators.signedDelegate({ delegateAction: sd.delegateAction, signature: sd.signature })],
    });
    return delegateResult(o, sd.delegateAction.receiverId);
  },
  async '/crank'(body, ip) {
    if (!perIp.take(`crank:${ip}`)) throw new Error('slow down');
    return crank(body.method, body.args ?? {});
  },
};

// Gloam's relay sends no CORS headers, so browsers reach it through here. Only already-proven
// cash-outs and private sends pass, verbatim: the proof fixes the recipient, so neither hop
// can redirect money, and the answer goes back unchanged in the SDK's own shape.
const GLOAM_RELAY = env('GLOAM_RELAY_URL', 'https://www.gloam.trade/api/relay');
const GLOAM_CHAINS = new Set(env('GLOAM_CHAINS', NETWORK === 'mainnet' ? '8453' : '84532').split(',').map(Number));
async function gloamRelay(raw, ip, res) {
  const reply = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  let body;
  try { body = JSON.parse(raw); } catch { return reply(400, { ok: false, error: 'bad json', code: 'bad_request' }); }
  if (!['unshield', 'transfer'].includes(body?.action) || !GLOAM_CHAINS.has(body?.chainId)) return reply(400, { ok: false, error: 'only cash-outs and private sends on this network', code: 'unsupported' });
  if (!perIp.take(`gloam:${ip}`)) return reply(429, { ok: false, error: 'slow down', code: 'rate_limited' });
  try {
    const r = await fetch(GLOAM_RELAY, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
    reply(r.status, await r.text());
  } catch (e) {
    reply(502, { ok: false, error: `No answer from the Gloam relay: ${e.message}`, code: 'maybe_sent' });
  }
}

createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.end();
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const path = new URL(req.url, 'http://x').pathname;
  // Liveness for the host (Fly.io checks it); says which network and contract this relayer serves.
  if (path === '/health' && req.method === 'GET') return send(200, { ok: true, network: NETWORK, contract: CONTRACT, relayer: RELAYER });
  const h = handlers[path];
  if ((!h && path !== '/gloam-relay') || req.method !== 'POST') return send(404, { error: 'not found' });
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 16_000) return send(413, { error: 'too large' }); }
  if (path === '/gloam-relay') return gloamRelay(raw, req.socket.remoteAddress, res);
  const body = JSON.parse(raw || '{}');
  const what = path === '/crank' ? `crank ${body.method}` : path;
  try {
    const result = await h(body, req.socket.remoteAddress);
    console.log(new Date().toISOString(), what, 'ok', JSON.stringify(result)?.slice(0, 120));
    send(200, { result });
  } catch (e) {
    console.log(new Date().toISOString(), what, 'error', e.message.slice(0, 2000));
    send(400, { error: e.message });
  }
}).listen(Number(env('PORT', '8790')), () => console.log(`VEIL relayer for ${CONTRACT} on ${NETWORK}, as ${RELAYER}`));

// The cranker: resolve due turns, reveal finished matches.
const inflight = new Set();
// A crank that fails (rate limit, a lobby someone left) waits before the next try: 15 s, then
// doubling up to 5 min. Retrying every tick would only feed the RPC's rate limiter.
const backoff = new Map();
const LOBBY_FRESH_MS = 30 * 60 * 1000; // the contract's STALE_LOBBY_MS: older lobbies are left for cancel_stale
setInterval(async () => {
  let matches;
  try { matches = await view('get_matches', { from_id: 1, limit: 100 }); } catch { return; }
  const now = Date.now();
  for (const m of matches) {
    const key = `${m.id}:${m.status}:${m.turn}`;
    if (inflight.has(key)) continue;
    let method = null;
    if (m.status === 'Finished') method = 'reveal';
    // A lobby that filled up (friends joining by invite link) starts on its own; the contract
    // lets anyone start a full lobby.
    if (m.status === 'Lobby' && now - m.created_ms < LOBBY_FRESH_MS && m.seats.length >= 1 && m.seats.length + m.ai_seats >= m.max_seats) method = 'start';
    if (m.status === 'Running') {
      const humans = m.seats.filter((s) => s.alive && !s.ai && !s.autopilot).map((s) => s.account);
      const submitted = now >= m.deadline_ms ? [] : await view('get_submitted', { match_id: m.id }).catch(() => []);
      if (now >= m.deadline_ms || humans.every((a) => submitted.includes(a))) method = 'resolve_turn';
    }
    if (!method) continue;
    const bkey = `${method}:${m.id}`;
    const b = backoff.get(bkey);
    if (b && now < b.until) continue;
    inflight.add(key);
    crank(method, { match_id: m.id })
      .then(() => { backoff.delete(bkey); console.log(`cranked ${method} #${m.id} t${m.turn}`); })
      .catch((e) => {
        const n = (backoff.get(bkey)?.n ?? 0) + 1;
        backoff.set(bkey, { n, until: Date.now() + Math.min(300_000, 15_000 * 2 ** (n - 1)) });
        console.warn(`crank ${method} #${m.id} (retry in ${Math.min(300, 15 * 2 ** (n - 1))}s): ${e.message.slice(0, 160)}`);
      })
      .finally(() => setTimeout(() => inflight.delete(key), 15_000));
  }
}, Number(env('CRANK_EVERY_MS', '5000')));
