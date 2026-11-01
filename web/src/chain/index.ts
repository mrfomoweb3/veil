import { DevnetChain } from './devnet';
import type { Chain } from './types';

export const NETWORK = (import.meta.env.VITE_NETWORK as string | undefined) ?? 'devnet';
export const DEVNET_API = (import.meta.env.VITE_DEVNET_API as string | undefined) ?? 'http://localhost:8787';

function guestName() {
  const k = 'veil:guest';
  let n = '';
  try { n = localStorage.getItem(k) ?? ''; } catch { /* storage blocked */ }
  if (!n) {
    n = `guest-${Math.random().toString(36).slice(2, 8)}.local`;
    try { localStorage.setItem(k, n); } catch { /* ignore */ }
  }
  return n;
}

export async function connect(): Promise<Chain> {
  if (NETWORK === 'devnet') return new DevnetChain(DEVNET_API, guestName());
  const { NearChain } = await import('./near');
  return NearChain.connect(NETWORK as 'testnet' | 'mainnet');
}
