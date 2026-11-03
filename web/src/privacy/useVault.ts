// The unlocked vault for this session, shared by every screen that shows the private balance.
import { useCallback, useEffect, useState } from 'react';
import type { Chain } from '../chain/types';
import { gloamNetwork } from './gloamNetwork';
import { prefetchCircuits } from './prover';
import { syncPool } from './treeCache';
import { deriveVaultKey, IdbStore, NoteVault, type StoredNote } from './noteVault';

let current: NoteVault | null = null;
const listeners = new Set<() => void>();
export const vaultChanged = () => listeners.forEach((f) => f());

export async function unlockVault(chain: Chain): Promise<NoteVault> {
  if (current?.account === chain.account) return current;
  if (!chain.signVaultMessage) throw new Error('This account cannot sign messages yet.');
  const key = await deriveVaultKey(await chain.signVaultMessage(), chain.account);
  current = new NoteVault(key, new IdbStore(chain.account), chain.account);
  prefetchCircuits(gloamNetwork().chainId);
  syncPool().catch(() => {});
  vaultChanged();
  return current;
}

export function useVault(account: string | undefined) {
  const [vault, setVault] = useState<NoteVault | null>(current?.account === account ? current : null);
  const [notes, setNotes] = useState<StoredNote[]>([]);
  const refresh = useCallback(async () => {
    const v = current?.account === account ? current : null;
    setVault(v);
    setNotes(v ? await v.list() : []);
  }, [account]);
  useEffect(() => {
    listeners.add(refresh);
    refresh();
    return () => { listeners.delete(refresh); };
  }, [refresh]);
  const balance = notes.filter((n) => n.status === 'confirmed').reduce((s, n) => s + BigInt(n.amountWei), 0n);
  return { vault, notes, balance, refresh };
}

export const fmtUsdc = (base: bigint | string) => {
  const v = BigInt(base);
  return `$${(v / 1_000_000n).toLocaleString('en-US')}.${(v % 1_000_000n).toString().padStart(6, '0').slice(0, 2)}`;
};
