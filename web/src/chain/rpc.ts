// Free NEAR RPCs rate-limit (429) per IP, and any endpoint can be down or misconfigured. A player
// polls the match every few seconds, so one bad endpoint would freeze their game. This provider
// stays on one endpoint and moves to the next only when it refuses a request (never run).
import { providers } from 'near-api-js';

/** "This endpoint refused or couldn't take the request": safe to send the same request elsewhere
 *  (it never ran; a re-sent signed transaction is deduped by hash). Answers from the chain itself,
 *  like InvalidNonce or a contract panic, are not refusals. Mirrors relayer/policy.mjs. */
export function endpointRefused(e: unknown): boolean {
  const err = e as { cause?: unknown; message?: string } | null;
  const status = typeof err?.cause === 'number' ? err.cause : null;
  if (status != null && [401, 402, 403, 404, 405, 429, 500, 502, 503, 504].includes(status)) return true;
  return /-429|\b429\b|Rate limits exceeded|Too Many Requests|UNAUTHORIZED|Unauthorized|Forbidden|invalid api key|FetchError|Failed to fetch|fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|Exceeded \d+ attempts|Request timeout on the free plan|upgrade to paid plan/i.test(err?.message ?? '');
}

const DEFAULTS: Record<'testnet' | 'mainnet', string[]> = {
  testnet: ['https://rpc.testnet.fastnear.com', 'https://near-testnet.drpc.org', 'https://testnet-rpc.intea.rs', 'https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org'],
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
        if (!endpointRefused(e)) throw e;
        last = e;
      }
    }
    throw last;
  }
}
