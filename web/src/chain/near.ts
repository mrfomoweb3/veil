// NEAR adapter (testnet / mainnet).
//
// Players get a browser-held ed25519 key and the matching implicit account. They never pay
// gas and never see a popup: every zero-deposit call is signed as a NEP-366 delegate action
// and posted to the VEIL relayer, which wraps it and pays. Calls that need NEAR attached for
// the OutLayer run (start / resolve_turn / reveal) are cranked by the relayer itself.
// The only transaction a player signs and pays for directly is a Stakes buy-in
// (`usdc.ft_transfer_call`), which moves their own USDC.
import { Account, Connection, InMemorySigner, KeyPair, keyStores, providers } from 'near-api-js';
import { actionCreators, encodeSignedDelegate } from '@near-js/transactions';
import type { Chain, VeilEvent } from './types';

const env = import.meta.env;
const RPC: Record<string, string> = {
  testnet: (env.VITE_NEAR_RPC as string) || 'https://rpc.testnet.fastnear.com',
  mainnet: (env.VITE_NEAR_RPC as string) || 'https://rpc.mainnet.fastnear.com',
};
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
    const provider = new providers.JsonRpcProvider({ url: RPC[network] });
    const connection = new Connection(network, provider, new InMemorySigner(store), '');
    const acct = new Account(connection, accountId);
    const chain = new NearChain(network, accountId, acct, provider, keyPair);
    await chain.onboard(pk.toString());
    return chain;
  }

  async signVaultMessage() {
    const { vaultMessageHash } = await import('../privacy/nep413');
    return this.keyPair.sign(vaultMessageHash()).signature;
  }

  /** Ask the relayer to create (fund) our implicit account if it doesn't exist yet. */
  private async onboard(publicKey: string) {
    try {
      await this.provider.query({ request_type: 'view_account', finality: 'final', account_id: this.account });
      return;
    } catch { /* not created yet */ }
    const r = await fetch(`${RELAYER}/onboard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: this.account, public_key: publicKey }),
    });
    if (!r.ok) throw new Error(`relayer could not create your account: ${await r.text()}`);
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
    const signed = await this.acct.signedDelegate({
      receiverId: CONTRACT,
      actions: [actionCreators.functionCall(method, args, BigInt(opts.gas ?? String(30n * TGAS)), 0n)],
      blockHeightTtl: 120,
    });
    return this.relayer<T>('/relay', { signed_delegate: b64(encodeSignedDelegate(signed)) });
  }

  private async relayer<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${RELAYER}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ error: `relayer HTTP ${r.status}` }));
    if (!r.ok || j.error) throw new Error(j.error ?? `relayer HTTP ${r.status}`);
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
