import type { Chain, VeilEvent } from './types';

export class DevnetChain implements Chain {
  readonly network = 'devnet' as const;
  constructor(readonly api: string, readonly account: string) {}

  async view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const r = await fetch(`${this.api}/api/view?method=${method}&args=${encodeURIComponent(JSON.stringify(args))}`);
    if (!r.ok) throw new Error(`${method}: HTTP ${r.status}`);
    return r.json();
  }

  async call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const r = await fetch(`${this.api}/api/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signer: this.account, method, args }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result as T;
  }

  onEvent(cb: (e: VeilEvent) => void) {
    const es = new EventSource(`${this.api}/api/events`);
    es.onmessage = (m) => { try { cb(JSON.parse(m.data)); } catch { /* ignore */ } };
    return () => es.close();
  }

  /** Devnet accounts have no NEAR key, so a local ed25519 key stands in for the wallet. */
  async signVaultMessage() {
    const [{ ed25519 }, { vaultMessageHash }] = await Promise.all([import('@noble/curves/ed25519'), import('../privacy/nep413')]);
    const k = `veil:devnet:vault-sk:${this.account}`;
    let hex = '';
    try { hex = localStorage.getItem(k) ?? ''; } catch { /* storage blocked */ }
    if (!hex) {
      hex = Array.from(ed25519.utils.randomPrivateKey(), (b) => b.toString(16).padStart(2, '0')).join('');
      try { localStorage.setItem(k, hex); } catch { /* ignore */ }
    }
    const sk = Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));
    return ed25519.sign(vaultMessageHash(), sk);
  }

  async publicStorage(key: string) {
    const r = await fetch(`${this.api}/api/public/storage/get?key=${encodeURIComponent(key)}`);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  }
}
