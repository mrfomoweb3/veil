// Groth16 proving off the main thread, so the 3D scene keeps drawing while a balance is sealed.
import './polyfill';
import { artifactProver, circuitArtifactUrls, type PoolCircuit } from '@gloamtrade/sdk';

export interface ProveRequest { id: number; circuit: PoolCircuit; chainId: number; input: Record<string, string | string[]> }

// The circuit files (2–5 MB) come from Gloam's server. A connection that drops mid-download
// shouldn't fail a cash-out, so a failed download is retried; a real proving error is not.
const DOWNLOAD_FAILED = /Failed to fetch|NetworkError|network|fetch failed|Load failed|ECONNRESET|503|502|504/i;

self.onmessage = async (e: MessageEvent<ProveRequest>) => {
  const { id, circuit, chainId, input } = e.data;
  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const result = await artifactProver(circuitArtifactUrls(circuit, chainId))(input);
      self.postMessage({ id, ok: true, result });
      return;
    } catch (err) {
      last = err;
      if (!DOWNLOAD_FAILED.test(err instanceof Error ? err.message : String(err))) break;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  self.postMessage({ id, ok: false, error: last instanceof Error ? last.message : String(last) });
};
