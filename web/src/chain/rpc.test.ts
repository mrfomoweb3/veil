import { describe, expect, it } from 'vitest';
import type { providers } from 'near-api-js';
import { endpointRefused, RotatingProvider, rpcUrls } from './rpc';

type Answer = 'ok' | 'limited' | 'nonce' | 'unauthorized';
function fake(hits: string[], answers: Record<string, Answer>) {
  return (url: string) => ({
    sendJsonRpc: async () => {
      hits.push(url);
      const a = answers[url];
      if (a === 'limited') throw new Error('{"jsonrpc":"2.0","error":{"code":-429,"message":"Rate limits exceeded."}}');
      if (a === 'nonce') throw new Error('InvalidNonce');
      if (a === 'unauthorized') throw Object.assign(new Error('{"error":"UNAUTHORIZED","instance":"x"}'), { cause: 401 });
      return { from: url };
    },
  }) as unknown as providers.JsonRpcProvider;
}

describe('RotatingProvider', () => {
  it('moves to the next endpoint on 429 and stays there', async () => {
    const hits: string[] = [];
    const p = new RotatingProvider(['a', 'b'], fake(hits, { a: 'limited', b: 'ok' }));
    expect(await p.sendJsonRpc('status', [])).toEqual({ from: 'b' });
    expect(await p.sendJsonRpc('status', [])).toEqual({ from: 'b' });
    expect(hits).toEqual(['a', 'b', 'b']);
  });

  it('passes any other error on without trying elsewhere', async () => {
    const hits: string[] = [];
    const p = new RotatingProvider(['a', 'b'], fake(hits, { a: 'nonce', b: 'ok' }));
    await expect(p.sendJsonRpc('broadcast_tx_commit', [])).rejects.toThrow('InvalidNonce');
    expect(hits).toEqual(['a']);
  });

  it('moves past an endpoint that rejects its key', async () => {
    const hits: string[] = [];
    const p = new RotatingProvider(['a', 'b'], fake(hits, { a: 'unauthorized', b: 'ok' }));
    expect(await p.sendJsonRpc('query', {})).toEqual({ from: 'b' });
  });

  it('tells refusals from answers', () => {
    expect(endpointRefused(Object.assign(new Error('bad gateway'), { cause: 502 }))).toBe(true);
    expect(endpointRefused(new Error('Smart contract panicked: turn still open'))).toBe(false);
    expect(endpointRefused(new Error('Request timeout on the free plan, please upgrade to paid plan'))).toBe(true);
  });

  it('gives up with the last 429 when every endpoint is limited', async () => {
    const p = new RotatingProvider(['a', 'b'], fake([], { a: 'limited', b: 'limited' }));
    await expect(p.sendJsonRpc('status', [])).rejects.toThrow(/429/);
  });

  it('puts configured endpoints first, then the defaults, without repeats', () => {
    const l = rpcUrls('testnet', 'https://mine.test, https://near-testnet.drpc.org');
    expect(l[0]).toBe('https://mine.test');
    expect(l.filter((u) => u === 'https://near-testnet.drpc.org')).toHaveLength(1);
  });
});
