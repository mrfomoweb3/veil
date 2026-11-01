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

  async publicStorage(key: string) {
    const r = await fetch(`${this.api}/api/public/storage/get?key=${encodeURIComponent(key)}`);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  }
}
