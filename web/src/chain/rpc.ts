// Free NEAR RPCs rate-limit (429) per IP. A player polls the match every few seconds, so a
// throttled endpoint would freeze their game. This provider stays on one endpoint and moves to
// the next only on a 429, which means the request was refused, never run.
import { providers } from 'near-api-js';

const RATE_LIMITED = /-429|\b429\b|Rate limits exceeded|Too Many Requests/i;

const DEFAULTS: Record<'testnet' | 'mainnet', string[]> = {
  testnet: ['https://rpc.testnet.fastnear.com', 'https://near-testnet.drpc.org', 'https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org'],
  mainnet: ['https://rpc.mainnet.fastnear.com', 'https://near.drpc.org', 'https://rpc.mainnet.near.org'],
};

export function rpcUrls(network: 'testnet' | 'mainnet', configured?: string): string[] {
  const list = (configured ?? '').split(',').map((u) => u.trim()).filter(Boolean);
  return [...new Set([...list, ...DEFAULTS[network]])];
}

export class RotatingProvider extends providers.JsonRpcProvider {
  private readonly all: providers.JsonRpcProvider[];
  private at = 0;

  constructor(urls: string[], make: (url: string) => providers.JsonRpcProvider = (url) => new providers.JsonRpcProvider({ url })) {
    super({ url: urls[0] });
    this.all = urls.map(make);
  }

  async sendJsonRpc<T>(method: string, params: object): Promise<T> {
    let last: unknown;
    for (let k = 0; k < this.all.length; k++) {
      const i = (this.at + k) % this.all.length;
      try {
        const r = await this.all[i].sendJsonRpc<T>(method, params);
        this.at = i;
        return r;
      } catch (e) {
        if (!RATE_LIMITED.test((e as Error)?.message ?? '')) throw e;
        last = e;
      }
    }
    throw last;
  }
}
