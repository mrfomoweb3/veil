import { artifactProver, circuitArtifactUrls, type PoolCircuit, type Prover, type ProveResult } from '@gloamtrade/sdk';
import type { ProveRequest } from './prover.worker';

let worker: Worker | null = null;
let next = 1;
const waiting = new Map<number, { res: (r: ProveResult) => void; rej: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./prover.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: ProveResult; error?: string }>) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.ok) w.res(e.data.result!);
    else w.rej(new Error(`Proof failed: ${e.data.error}`));
  };
  return worker;
}

/** A Prover that runs in a Web Worker (falls back to this thread where workers don't exist). */
export function workerProver(circuit: PoolCircuit, chainId: number): Prover {
  if (typeof Worker === 'undefined') return artifactProver(circuitArtifactUrls(circuit, chainId));
  return (input) =>
    new Promise((res, rej) => {
      const id = next++;
      waiting.set(id, { res, rej });
      getWorker().postMessage({ id, circuit, chainId, input } satisfies ProveRequest);
    });
}

/** Warm the HTTP cache with the circuit files, so the first seal doesn't wait on a 2–5 MB download. */
export function prefetchCircuits(chainId: number) {
  for (const c of ['shield', 'unshield'] as PoolCircuit[]) {
    const { wasm, zkey } = circuitArtifactUrls(c, chainId);
    for (const u of [wasm, zkey]) fetch(u, { priority: 'low' } as RequestInit).catch(() => {});
  }
}
