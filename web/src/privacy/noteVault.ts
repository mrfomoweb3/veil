// Encrypted storage for Gloam notes. A note's secret is the only key to the money it holds,
// so it is never logged, sent to a server or put in a URL. Notes are sealed with AES-GCM
// under a key derived (HKDF-SHA256) from the player's NEP-413 signature over a fixed
// message, so signing again on any device recovers the key. The commitment is the AAD.

export type NoteStatus = 'pending' | 'confirmed' | 'spent';

export interface StoredNote {
  commitment: string;
  secret: string;
  amountWei: string;
  asset: `0x${string}`;
  chainId: number;
  status: NoteStatus;
  createdAt: number;
  txHash?: string;
  spentTx?: string;
  /** Anything else the SDK put on the note, kept so it can be handed back unchanged. */
  extra?: Record<string, unknown>;
}

export interface SealedNote { commitment: string; blob: string }

export interface NoteStore {
  all(): Promise<SealedNote[]>;
  put(n: SealedNote): Promise<void>;
}

export interface Backup { format: 'veil-vault-backup'; version: 1; account: string; notes: SealedNote[] }

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** AES-256-GCM key from the 64-byte NEP-413 signature. Non-extractable. */
export async function deriveVaultKey(signature: Uint8Array, account: string): Promise<CryptoKey> {
  if (signature.length !== 64) throw new Error('expected a 64-byte ed25519 signature');
  const ikm = await subtle().importKey('raw', signature, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('veil-vault-v1'), info: enc.encode(account) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealNote(key: CryptoKey, note: StoredNote): Promise<SealedNote> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(note.commitment) }, key, enc.encode(JSON.stringify(note))));
  const blob = new Uint8Array(12 + ct.length);
  blob.set(iv);
  blob.set(ct, 12);
  return { commitment: note.commitment, blob: b64(blob) };
}

export async function openNote(key: CryptoKey, sealed: SealedNote): Promise<StoredNote> {
  const blob = unb64(sealed.blob);
  let pt: ArrayBuffer;
  try {
    pt = await subtle().decrypt({ name: 'AES-GCM', iv: blob.slice(0, 12), additionalData: enc.encode(sealed.commitment) }, key, blob.slice(12));
  } catch {
    throw new Error('This vault was sealed by a different NEAR account (or the file is damaged).');
  }
  const note = JSON.parse(new TextDecoder().decode(pt)) as StoredNote;
  if (note.commitment !== sealed.commitment) throw new Error('note commitment mismatch');
  return note;
}

export class NoteVault {
  constructor(private key: CryptoKey, private store: NoteStore, readonly account: string) {}

  async list(): Promise<StoredNote[]> {
    const out = await Promise.all((await this.store.all()).map((s) => openNote(this.key, s)));
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  async get(commitment: string): Promise<StoredNote | undefined> {
    const s = (await this.store.all()).find((n) => n.commitment === commitment);
    return s && openNote(this.key, s);
  }

  /** Call BEFORE broadcasting the deposit: if the tab dies after broadcast, this is all that's left. */
  async save(note: StoredNote): Promise<void> {
    await this.store.put(await sealNote(this.key, note));
  }

  async update(commitment: string, patch: Partial<StoredNote>): Promise<StoredNote> {
    const n = await this.get(commitment);
    if (!n) throw new Error('unknown note');
    const next = { ...n, ...patch, commitment };
    await this.save(next);
    return next;
  }

  markConfirmed = (commitment: string, txHash: string) => this.update(commitment, { status: 'confirmed', txHash });
  markSpent = (commitment: string, spentTx: string) => this.update(commitment, { status: 'spent', spentTx });

  /** Private balance per asset, counting confirmed notes only. */
  async balance(): Promise<Map<string, bigint>> {
    const m = new Map<string, bigint>();
    for (const n of await this.list()) {
      if (n.status !== 'confirmed') continue;
      m.set(n.asset.toLowerCase(), (m.get(n.asset.toLowerCase()) ?? 0n) + BigInt(n.amountWei));
    }
    return m;
  }

  async exportBackup(): Promise<Backup> {
    return { format: 'veil-vault-backup', version: 1, account: this.account, notes: await this.store.all() };
  }

  /** Decrypts every note first, so a backup from another account adds nothing. Returns notes added. */
  async importBackup(b: Backup): Promise<StoredNote[]> {
    if (b?.format !== 'veil-vault-backup' || b.version !== 1) throw new Error('not a VEIL vault backup');
    const opened = await Promise.all(b.notes.map((s) => openNote(this.key, s)));
    const have = new Set((await this.store.all()).map((n) => n.commitment));
    const added = opened.filter((n) => !have.has(n.commitment));
    for (const s of b.notes) if (!have.has(s.commitment)) await this.store.put(s);
    return added;
  }
}

/** Split an amount into deposits no larger than the pool's per-deposit limit. */
export function splitDeposits(amount: bigint, limit: bigint): bigint[] {
  if (amount <= 0n) return [];
  if (limit <= 0n) throw new Error('deposit limit must be positive');
  const out: bigint[] = [];
  for (let left = amount; left > 0n; left -= left > limit ? limit : left) out.push(left > limit ? limit : left);
  return out;
}

export class MemoryStore implements NoteStore {
  private m = new Map<string, SealedNote>();
  async all() { return [...this.m.values()]; }
  async put(n: SealedNote) { this.m.set(n.commitment, n); }
}

/** IndexedDB store, one object store per NEAR account. */
export class IdbStore implements NoteStore {
  private db: Promise<IDBDatabase>;
  constructor(private account: string) {
    this.db = new Promise((res, rej) => {
      const r = indexedDB.open('veil-vault', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('notes', { keyPath: ['account', 'commitment'] });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  private async tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((res, rej) => {
      const r = f(db.transaction('notes', mode).objectStore('notes'));
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async all(): Promise<SealedNote[]> {
    const rows = await this.tx<{ account: string; commitment: string; blob: string }[]>('readonly', (s) => s.getAll());
    return rows.filter((r) => r.account === this.account).map(({ commitment, blob }) => ({ commitment, blob }));
  }
  async put(n: SealedNote): Promise<void> {
    await this.tx('readwrite', (s) => s.put({ account: this.account, ...n }));
  }
}
