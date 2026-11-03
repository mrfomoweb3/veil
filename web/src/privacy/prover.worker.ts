// Groth16 proving off the main thread, so the 3D scene keeps drawing while a balance is sealed.
import './polyfill';
import { artifactProver, circuitArtifactUrls, type PoolCircuit } from '@gloamtrade/sdk';

export interface ProveRequest { id: number; circuit: PoolCircuit; chainId: number; input: Record<string, string | string[]> }

self.onmessage = async (e: MessageEvent<ProveRequest>) => {
  const { id, circuit, chainId, input } = e.data;
  try {
    const result = await artifactProver(circuitArtifactUrls(circuit, chainId))(input);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
