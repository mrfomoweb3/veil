// Shapes returned by veil.near (and the devnet, which mirrors it exactly).
export type Mode = 'Practice' | { Stakes: { buy_in: string } };
export type Status = 'Lobby' | 'Starting' | 'Running' | 'Resolving' | 'Finished' | 'Revealing' | 'Revealed' | 'Cancelled';

export interface Seat { account: string; view_pk: string; ai: boolean; autopilot: boolean; missed: number; alive: boolean; paid: string }
export interface Match {
  id: number; host: string; mode: Mode; status: Status; seats: Seat[]; max_seats: number; ai_seats: number;
  max_turns: number; turn: number; turn_len_ms: number; deadline_ms: number; game_pk: string | null;
  state_commit: string | null; engine_project: string; engine_version: string | null; pot: string;
  ranking: number[] | null; payouts: [string, string][]; reveal_hash: string | null; reveal_key: string | null;
  created_ms: number; failures: number;
}
export interface Vrf { output_hex: string; signature_hex: string; alpha: string }
export interface PublicTurnRaw { turn: number; public: string; state_commit: string; vrf: Vrf; resolved_ms: number }
export interface PublicFacts {
  turn: number; battles: [number, number][]; skirmishes: [[number, number], [number, number]][];
  eliminated: number[]; tiles: number[]; game_over: boolean; ranking: number[] | null;
}
export interface ViewOut { turn: number; ciphertext: string }
export interface Config { owner: string; outlayer: string; engine_project: string; engine_version: string | null; vrf_pubkey: string; usdc: string; rake_bps: number; rake: string; network?: string }
export interface VeilEvent { standard: 'veil'; version: string; event: string; data: Record<string, unknown>[] }

export interface Chain {
  readonly network: 'devnet' | 'testnet' | 'mainnet';
  readonly account: string;
  view<T>(method: string, args?: Record<string, unknown>): Promise<T>;
  call<T = unknown>(method: string, args?: Record<string, unknown>, opts?: { deposit?: string; gas?: string }): Promise<T>;
  onEvent(cb: (e: VeilEvent) => void): () => void;
  /** OutLayer public storage (The Reveal). */
  publicStorage(key: string): Promise<Uint8Array | null>;
  /** NEP-413 signature over the fixed vault message; the private-vault key is derived from it. */
  signVaultMessage?(): Promise<Uint8Array>;
  /** NEAR Chain Signatures: the MPC network signs a 32-byte hash for this account's derived key. */
  mpcSign?(hash: `0x${string}`, path: string): Promise<import('../privacy/chainSig').MpcSignature>;
}
