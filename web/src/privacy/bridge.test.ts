import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSETS, bridgePlan, bridgeToBase, GAS_LEG_USDC, MIN_GAS_WEI, NEAR_USDC, quoteRequest, type BridgeStep } from './bridge';

const ADDR = '0xb76795D6eCe15D10EbDc968a1e31335dbba44519' as const;

describe('bridge (1Click)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('buys gas only when the Base address lacks it', () => {
    expect(bridgePlan(5_000_000n, 0n)).toEqual({ gas: GAS_LEG_USDC, usdc: 5_000_000n - GAS_LEG_USDC });
    expect(bridgePlan(5_000_000n, MIN_GAS_WEI)).toEqual({ gas: 0n, usdc: 5_000_000n });
    expect(() => bridgePlan(GAS_LEG_USDC, 0n)).toThrow(/at least/);
  });

  it('asks for an exact-input NEAR USDC quote, refunds to the NEAR account', () => {
    const r = quoteRequest({ destinationAsset: ASSETS.baseUsdc, amount: 1_000_000n, nearAccount: 'p.near', recipient: ADDR, dry: true }, 0);
    expect(r).toMatchObject({
      dry: true, swapType: 'EXACT_INPUT', originAsset: ASSETS.nearUsdc, depositType: 'ORIGIN_CHAIN', amount: '1000000',
      refundTo: 'p.near', refundType: 'ORIGIN_CHAIN', recipient: ADDR, recipientType: 'DESTINATION_CHAIN', deadline: '1970-01-01T00:30:00.000Z',
    });
  });

  it('runs the gas leg, then the USDC leg, each to its own deposit address', async () => {
    const calls: string[] = [];
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url.replace(/^https:\/\/[^/]+/, '')}`);
      if (url.endsWith('/v0/quote')) {
        const body = JSON.parse(String(init!.body));
        n++;
        return new Response(JSON.stringify({ correlationId: 'c', timestamp: '', signature: 's', quoteRequest: body, quote: { amountIn: body.amount, amountOut: '1', amountOutFormatted: '', minAmountOut: body.destinationAsset === ASSETS.baseUsdc ? '4650000' : '1', timeEstimate: 20, depositAddress: `dep${n}` } }));
      }
      if (url.includes('/v0/status')) return new Response(JSON.stringify({ status: 'SUCCESS' }));
      return new Response('{}');
    }));
    const sent: [string, string, bigint][] = [];
    const steps: BridgeStep['step'][] = [];
    const r = await bridgeToBase({
      near: { account: 'p.near', ftTransfer: async (t, to, a) => { sent.push([t, to, a]); return 'tx'; } },
      recipient: ADDR, amount: 5_000_000n, baseEthWei: 0n, onStep: (s) => steps.push(s.step),
    });
    expect(sent).toEqual([[NEAR_USDC, 'dep1', GAS_LEG_USDC], [NEAR_USDC, 'dep2', 5_000_000n - GAS_LEG_USDC]]);
    expect(r.usdcOut).toBe(4_650_000n);
    expect(steps.at(-1)).toBe('arrived');
    expect(calls.filter((c) => c.includes('quote'))).toHaveLength(2);
  });

  it('reports a refunded swap and stops', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/v0/quote')
      ? new Response(JSON.stringify({ quote: { depositAddress: 'd', minAmountOut: '1' } }))
      : new Response(JSON.stringify({ status: 'REFUNDED' }))));
    const ft = vi.fn(async () => 'tx');
    await expect(bridgeToBase({ near: { account: 'p.near', ftTransfer: ft }, recipient: ADDR, amount: 2_000_000n, baseEthWei: MIN_GAS_WEI }))
      .rejects.toThrow(/refunded/);
    expect(ft).toHaveBeenCalledTimes(1);
  });
});
