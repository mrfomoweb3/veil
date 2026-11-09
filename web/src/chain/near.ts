// NEAR adapter (testnet / mainnet).
//
// Players get a browser-held ed25519 key and the matching implicit account. They never pay
// gas and never see a popup: every zero-deposit call is signed as a NEP-366 delegate action
// and posted to the VEIL relayer, which wraps it and pays. Calls that need NEAR attached for
// the OutLayer run (start / resolve_turn / reveal) are cranked by the relayer itself.
// The only transaction a player signs and pays for directly is a Stakes buy-in
// (`usdc.ft_transfer_call`), which moves their own USDC.
import '../shims/node';
import { Account, Connection, InMemorySigner, KeyPair, keyStores, providers } from 'near-api-js';
import { actionCreators, encodeSignedDelegate } from '@near-js/transactions';
import type { Chain, VeilEvent } from './types';
import { RotatingProvider, rpcUrls } from './rpc';
import { friendlyError } from './errors';

const env = import.meta.env;

const CONTRACT = (env.VITE_VEIL_CONTRACT as string) || 'veil.testnet';
const RELAYER = (env.VITE_RELAYER_URL as string) || 'http://localhost:8790';
const OUTLAYER_API = (env.VITE_OUTLAYER_API as string) || 'https://testnet-api.outlayer.ai';
const CRANKED = new Set(['start', 'resolve_turn', 'reveal']);
const TGAS = 1_000_000_000_000n;

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

export class NearChain implements Chain {
  private constructor(
    readonly network: 'testnet' | 'mainnet',
    readonly account: string,
    private readonly acct: Account,
    private readonly provider: providers.JsonRpcProvider,
    private readonly keyPair: KeyPair,
  ) {}

  private signing: Promise<unknown> = Promise.resolve();

  static async connect(network: 'testnet' | 'mainnet'): Promise<NearChain> {
    const storageKey = `veil:near:${network}:key`;
    let secret = '';
    try { secret = localStorage.getItem(storageKey) ?? ''; } catch { /* storage blocked */ }
    const keyPair = secret ? KeyPair.fromString(secret as `ed25519:${string}`) : KeyPair.fromRandom('ed25519');
    if (!secret) {
      try { localStorage.setItem(storageKey, keyPair.toString()); } catch { /* ignore */ }
    }
    // Implicit account: the hex of the public key.
    const pk = keyPair.getPublicKey();
    const accountId = Array.from(pk.data, (x) => x.toString(16).padStart(2, '0')).join('');
    const store = new keyStores.InMemoryKeyStore();
    await store.setKey(network, accountId, keyPair);
    const provider = new RotatingProvider(rpcUrls(network, env.VITE_NEAR_RPC as string | undefined));
    const connection = new Connection(network, provider, new InMemorySigner(store), '');
    const acct = new Account(connection, accountId);
    const chain = new NearChain(network, accountId, acct, provider, keyPair);
    await chain.onboard(pk.toString());
    return chain;
  }

  watchUrl(matchId: number) {
    return `${RELAYER}/watch?match=${matchId}&account=${encodeURIComponent(this.account)}`;
  }

  async signVaultMessage() {
    const { vaultMessageHash } = await import('../privacy/nep413');
    return this.keyPair.sign(vaultMessageHash()).signature;
  }

  /** Ask the relayer to create (fund) our implicit account if it doesn't exist yet. */
  private async exists() {
    try {
      await this.provider.query({ request_type: 'view_account', finality: 'final', account_id: this.account });
      return true;
    } catch {
      return false;
    }
  }

  /** Creates the account through the relayer (idempotent, so retried on a flaky network) and
   *  waits until it is final, so the first call doesn't meet "account does not exist". */
  private async onboard(publicKey: string) {
    if (await this.exists()) return;
    let last = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      try {
        const r = await fetch(`${RELAYER}/onboard`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ account_id: this.account, public_key: publicKey }),
        });
        if (r.ok) break;
        last = await r.text();
      } catch (e) {
        last = (e as Error).message;
      }
    }
    for (let i = 0; i < 15; i++) {
      if (await this.exists()) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`The relayer could not create your account${last ? `: ${last}` : ''}. Check your connection and reload.`);
  }

  async view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = (await this.provider.query({
      request_type: 'call_function',
      finality: 'optimistic',
      account_id: CONTRACT,
      method_name: method,
      args_base64: b64(new TextEncoder().encode(JSON.stringify(args))),
    })) as unknown as { result: number[] };
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(res.result)));
  }

  async call<T>(method: string, args: Record<string, unknown> = {}, opts: { deposit?: string; gas?: string } = {}): Promise<T> {
    if (CRANKED.has(method)) {
      return this.relayer<T>('/crank', { method, args });
    }
    if (method === 'ft_transfer_call') {
      // Stakes buy-in: the player's own USDC, signed directly.
      const cfg = await this.view<{ usdc: string }>('get_config');
      const out = await this.acct.functionCall({
        contractId: cfg.usdc,
        methodName: 'ft_transfer_call',
        args: { receiver_id: CONTRACT, amount: args.amount, msg: args.msg },
        gas: 100n * TGAS,
        attachedDeposit: 1n,
      });
      return out as T;
    }
    const deposit = BigInt(opts.deposit ?? '0');
    if (deposit > 0n) throw new Error('payable calls go through the relayer');
    const signed = await this.delegate(CONTRACT, method, args, BigInt(opts.gas ?? String(30n * TGAS)), 0n);
    return this.relayer<T>('/relay', { signed_delegate: b64(encodeSignedDelegate(signed)) });
  }

  async ftBalance(token: string) {
    const res = (await this.provider.query({
      request_type: 'call_function', finality: 'final', account_id: token, method_name: 'ft_balance_of',
      args_base64: b64(new TextEncoder().encode(JSON.stringify({ account_id: this.account }))),
    })) as unknown as { result: number[] };
    return BigInt(JSON.parse(new TextDecoder().decode(Uint8Array.from(res.result))));
  }

  async ftTransfer(token: string, to: string, amount: bigint) {
    const run = this.signing.catch(() => {}).then(() =>
      this.acct.signAndSendTransaction({
        receiverId: token,
        actions: [
          // NEP-145: a no-op refund if `to` is already registered.
          actionCreators.functionCall('storage_deposit', { account_id: to, registration_only: true }, 30n * TGAS, 1_250_000_000_000_000_000_000n),
          actionCreators.functionCall('ft_transfer', { receiver_id: to, amount: amount.toString(), memo: 'veil cash-out' }, 30n * TGAS, 1n),
        ],
      }),
    );
    this.signing = run;
    const o = await run;
    const failed = o.receipts_outcome.find((r) => typeof r.outcome.status === 'object' && 'Failure' in r.outcome.status);
    if (failed) throw new Error(`The USDC transfer failed: ${JSON.stringify((failed.outcome.status as { Failure: unknown }).Failure).slice(0, 200)}`);
    return o.transaction.hash as string;
  }

  /** A Chain Signatures `sign`, sent as a delegate action so the relayer pays the gas. The
   *  predecessor is still this account, so the key is the one derived from it. */
  async mpcSign(hash: `0x${string}`, path: string) {
    const { MPC, signArgs } = await import('../privacy/chainSig');
    const contract = (env.VITE_MPC_CONTRACT as string) || MPC[this.network].contract;
    const signed = await this.delegate(contract, 'sign', signArgs(hash, path), 300n * TGAS, 1n);
    const out = await this.relayer<import('../privacy/chainSig').MpcSignature | null>('/relay', { signed_delegate: b64(encodeSignedDelegate(signed)) });
    if (!out) throw new Error('The signer network gave no signature; try again.');
    return out;
  }

  // near-api-js takes the nonce from a cached access key and never advances it after a
  // delegate, so two calls in a row would share one. Sign one at a time and advance it here.
  private delegate(receiverId: string, method: string, args: object, gas: bigint, deposit: bigint) {
    const next = this.signing.catch(() => {}).then(async () => {
      const d = await this.acct.signedDelegate({
        receiverId,
        actions: [actionCreators.functionCall(method, args, gas, deposit)],
        blockHeightTtl: 120,
      });
      const { accessKey } = await this.acct.findAccessKey(null as never, null as never);
      accessKey.nonce = d.delegateAction.nonce;
      return d;
    });
    this.signing = next;
    return next;
  }

  private async relayer<T>(path: string, body: unknown): Promise<T> {
    let r: Response;
    try {
      r = await fetch(`${RELAYER}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) {
      throw friendlyError((e as Error).message ?? 'Failed to fetch');
    }
    const j = await r.json().catch(() => ({ error: `relayer HTTP ${r.status}` }));
    if (!r.ok || j.error) {
      const raw = String(j.error ?? `relayer HTTP ${r.status}`);
      console.warn('relayer', path, raw);
      throw friendlyError(raw);
    }
    return j.result as T;
  }

  /** No indexer: the game polls `get_match` / `get_view` instead. */
  onEvent(_cb: (e: VeilEvent) => void) {
    return () => {};
  }

  async publicStorage(key: string) {
    const cfg = await this.view<{ engine_project: string }>('get_config');
    const r = await fetch(`${OUTLAYER_API}/public/storage/get?project=${encodeURIComponent(cfg.engine_project)}&key=${encodeURIComponent(key)}`);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    // Accept a raw value or a JSON wrapper `{ "value": base64 }`.
    try {
      const j = JSON.parse(new TextDecoder().decode(bytes));
      if (typeof j?.value === 'string') return Uint8Array.from(atob(j.value), (c) => c.charCodeAt(0));
    } catch { /* raw */ }
    return bytes;
  }
}
