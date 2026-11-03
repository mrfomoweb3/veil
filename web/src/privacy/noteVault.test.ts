import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { deriveVaultKey, MemoryStore, NoteVault, splitDeposits, type StoredNote } from './noteVault';
import { nep413Hash, vaultMessageHash, VAULT_NONCE } from './nep413';

const sk = new Uint8Array(32).fill(7);
const sign = (k = sk) => ed25519.sign(vaultMessageHash(), k);
const note = (c: string, amount = '1500000'): StoredNote => ({
  commitment: c, secret: '0x' + 'ab'.repeat(31), amountWei: amount,
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', chainId: 84532, status: 'pending', createdAt: Date.now(),
});

describe('noteVault', () => {
  it('round-trips notes through encryption', async () => {
    const v = new NoteVault(await deriveVaultKey(sign(), 'alice.testnet'), new MemoryStore(), 'alice.testnet');
    await v.save(note('0x01'));
    await v.markConfirmed('0x01', '0xhash');
    const [n] = await v.list();
    expect(n.secret).toBe(note('0x01').secret);
    expect(n.status).toBe('confirmed');
    expect((await v.balance()).get('0x036cbd53842c5426634e7929541ec2318f3dcf7e')).toBe(1_500_000n);
  });

  it('derives the same key from the same signature twice', async () => {
    expect(sign()).toEqual(sign());
    const store = new MemoryStore();
    const a = new NoteVault(await deriveVaultKey(sign(), 'alice.testnet'), store, 'alice.testnet');
    await a.save(note('0x02'));
    const b = new NoteVault(await deriveVaultKey(sign(), 'alice.testnet'), store, 'alice.testnet');
    expect((await b.list())[0].commitment).toBe('0x02');
  });

  it('refuses a backup sealed by another account', async () => {
    const a = new NoteVault(await deriveVaultKey(sign(), 'alice.testnet'), new MemoryStore(), 'alice.testnet');
    await a.save(note('0x03'));
    const backup = JSON.parse(JSON.stringify(await a.exportBackup()));
    const mallory = new NoteVault(await deriveVaultKey(sign(new Uint8Array(32).fill(9)), 'alice.testnet'), new MemoryStore(), 'alice.testnet');
    await expect(mallory.importBackup(backup)).rejects.toThrow(/different NEAR account/);
    const fresh = new NoteVault(await deriveVaultKey(sign(), 'alice.testnet'), new MemoryStore(), 'alice.testnet');
    expect(await fresh.importBackup(backup)).toHaveLength(1);
    expect(await fresh.importBackup(backup)).toHaveLength(0);
  });

  it('splits winnings at the deposit limit', () => {
    const lim = 500_000_000n;
    expect(splitDeposits(1_200_000_000n, lim)).toEqual([lim, lim, 200_000_000n]);
    expect(splitDeposits(lim, lim)).toEqual([lim]);
    expect(splitDeposits(3n, lim)).toEqual([3n]);
    expect(splitDeposits(0n, lim)).toEqual([]);
  });

  it('builds the NEP-413 payload hash deterministically', () => {
    expect(nep413Hash('m', VAULT_NONCE, 'r')).toEqual(nep413Hash('m', VAULT_NONCE, 'r'));
    expect(nep413Hash('m', VAULT_NONCE, 'r')).not.toEqual(nep413Hash('m', VAULT_NONCE, 's'));
  });
});
