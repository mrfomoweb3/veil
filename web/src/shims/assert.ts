// Browser stand-in for Node's `assert`, which circomlibjs (Poseidon, via the Gloam SDK) calls at runtime.
export default function assert(ok: unknown, msg?: string): asserts ok {
  if (!ok) throw new Error(msg ?? 'assertion failed');
}
