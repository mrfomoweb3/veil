// Runs the Rust verifier (compiled to wasm) in the browser over a revealed match.
export interface ReplayFrame {
  turn: number; owners: number[]; troops: number[]; forts: boolean[]; alive: boolean[]; aether: number[];
  public: { battles: [number, number][]; eliminated: number[]; tiles: number[]; game_over: boolean } | null;
}
export interface ReplayResult {
  ok: boolean; errors: string[]; turns_checked: number; vrf_checked: boolean; match_id: number; accounts: string[];
  radius: number; terrain: number[]; frames: ReplayFrame[];
  orders: { moves: { from: [number, number]; to: [number, number]; count: number }[]; scout: [number, number][] | null; fort: [number, number] | null; recruit: number }[][];
  llm: boolean[][]; ranking: number[]; game_pk: string;
}

let wasm: Promise<WebAssembly.Instance> | null = null;

export async function replay(doc: Uint8Array, vrfPubkeyHex: string): Promise<ReplayResult> {
  wasm ??= WebAssembly.instantiateStreaming(fetch('/veil.wasm'), {}).then((r) => r.instance);
  const inst = await wasm;
  const ex = inst.exports as unknown as {
    memory: WebAssembly.Memory;
    alloc(n: number): number;
    dealloc(p: number, n: number): void;
    replay(d: number, dl: number, k: number, kl: number): number;
  };
  const pk = new TextEncoder().encode(vrfPubkeyHex);
  const dp = ex.alloc(doc.length), kp = ex.alloc(Math.max(1, pk.length));
  new Uint8Array(ex.memory.buffer, dp, doc.length).set(doc);
  new Uint8Array(ex.memory.buffer, kp, pk.length).set(pk);
  const out = ex.replay(dp, doc.length, kp, pk.length);
  const len = new DataView(ex.memory.buffer).getUint32(out, true);
  const json = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, out + 4, len));
  ex.dealloc(out, len + 4);
  ex.dealloc(dp, doc.length);
  ex.dealloc(kp, Math.max(1, pk.length));
  return JSON.parse(json);
}
