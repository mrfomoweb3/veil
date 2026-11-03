// circomlibjs (the Gloam SDK's Poseidon) touches Node's Buffer global when it loads.
import { Buffer } from 'buffer';

(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;
