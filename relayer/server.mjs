// VEIL relayer: players never pay gas and never see a wallet popup.
//
//   POST /onboard {account_id, public_key}  create the player's implicit account (tiny transfer)
//   POST /relay   {signed_delegate}         wrap a NEP-366 delegate action to veil.near and pay gas
//   POST /crank   {method, args}            start / resolve_turn / reveal, with NEAR for OutLayer
//
// It also cranks turns on its own: every few seconds it resolves turns that are due and
// reveals finished matches. It only ever talks to VEIL_CONTRACT.
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
const provider = new providers.JsonRpcProvider({ url: env('NEAR_RPC', `https://rpc.${NETWORK}.fastnear.com`) });
const relayer = new Account(new Connection(NETWORK, provider, new InMemorySigner(store), ''), RELAYER);

const perAccount = new RateLimit(30);
const perIp = new RateLimit(5);

async function view(method, args = {}) {
  const r = await provider.query({
    request_type: 'call_function', finality: 'optimistic', account_id: CONTRACT, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  return JSON.parse(Buffer.from(r.result).toString());
}

function outcomeResult(o) {
  const st = o?.status;
  if (st?.Failure) throw new Error(JSON.stringify(st.Failure).slice(0, 300));
  if (st?.SuccessValue) { try { return JSON.parse(Buffer.from(st.SuccessValue, 'base64').toString()); } catch { return null; } }
  return null;
}

async function crank(method, args) {
  if (!CRANKABLE.has(method)) throw new Error('not crankable');
  const o = await relayer.functionCall({ contractId: CONTRACT, methodName: method, args, gas: 300n * TGAS, attachedDeposit: DEPOSIT });
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
    const why = checkDelegate(sd, CONTRACT);
    if (why) throw new Error(why);
    if (!perAccount.take(sd.delegateAction.senderId)) throw new Error('slow down');
    const o = await relayer.signAndSendTransaction({
      receiverId: sd.delegateAction.senderId,
      actions: [actionCreators.signedDelegate({ delegateAction: sd.delegateAction, signature: sd.signature })],
    });
    return outcomeResult(o);
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
  const h = handlers[path];
  if ((!h && path !== '/gloam-relay') || req.method !== 'POST') return send(404, { error: 'not found' });
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 16_000) return send(413, { error: 'too large' }); }
  if (path === '/gloam-relay') return gloamRelay(raw, req.socket.remoteAddress, res);
  try {
    send(200, { result: await h(JSON.parse(raw || '{}'), req.socket.remoteAddress) });
  } catch (e) {
    send(400, { error: e.message });
  }
}).listen(Number(env('PORT', '8790')), () => console.log(`VEIL relayer for ${CONTRACT} on ${NETWORK}, as ${RELAYER}`));

// The cranker: resolve due turns, reveal finished matches.
const inflight = new Set();
setInterval(async () => {
  let matches;
  try { matches = await view('get_matches', { from_id: 1, limit: 100 }); } catch { return; }
  const now = Date.now();
  for (const m of matches) {
    const key = `${m.id}:${m.status}:${m.turn}`;
    if (inflight.has(key)) continue;
    let method = null;
    if (m.status === 'Finished') method = 'reveal';
    if (m.status === 'Running') {
      const humans = m.seats.filter((s) => s.alive && !s.ai && !s.autopilot).map((s) => s.account);
      const submitted = now >= m.deadline_ms ? [] : await view('get_submitted', { match_id: m.id }).catch(() => []);
      if (now >= m.deadline_ms || humans.every((a) => submitted.includes(a))) method = 'resolve_turn';
    }
    if (!method) continue;
    inflight.add(key);
    crank(method, { match_id: m.id })
      .then(() => console.log(`cranked ${method} #${m.id} t${m.turn}`))
      .catch((e) => console.warn(`crank ${method} #${m.id}: ${e.message}`))
      .finally(() => setTimeout(() => inflight.delete(key), 15_000));
  }
}, 3000);
