// Node globals that some dependencies touch when they load: near-api-js's (`global`) and
// circomlibjs's, via the Gloam SDK (`Buffer`). Import this before either.
import { Buffer } from 'buffer';

const g = globalThis as { global?: typeof globalThis; Buffer?: typeof Buffer };
g.global ??= globalThis;
g.Buffer ??= Buffer;
