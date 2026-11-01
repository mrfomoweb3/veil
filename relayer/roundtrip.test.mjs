// The client encodes a SignedDelegate; the relayer decodes it, checks policy and re-wraps it.
import { test } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { checkDelegate } from './policy.mjs';
const require = createRequire(import.meta.url);
const t = require('@near-js/transactions');
const { deserialize } = require('borsh');
const { KeyPair } = require('near-api-js');

test('signed delegate survives decode → policy → re-wrap byte for byte', () => {
  const kp = KeyPair.fromRandom('ed25519');
  const delegateAction = t.buildDelegateAction({
    actions: [t.actionCreators.functionCall('submit_orders', { match_id: 1 }, 30n * 10n ** 12n, 0n)],
    maxBlockHeight: 100n, nonce: 1n, publicKey: kp.getPublicKey(), receiverId: 'veil.testnet', senderId: 'a'.repeat(64),
  });
  const { signature } = kp.sign(t.encodeDelegateAction(delegateAction));
  const sd = new t.SignedDelegate({ delegateAction, signature: new t.Signature({ keyType: 0, data: signature }) });
  const bytes = t.encodeSignedDelegate(sd);
  const back = deserialize(t.SCHEMA.SignedDelegate, bytes);
  assert.equal(back.delegateAction.actions[0].functionCall.methodName, 'submit_orders');
  assert.equal(checkDelegate(back, 'veil.testnet'), null);
  const rewrapped = t.actionCreators.signedDelegate({ delegateAction: back.delegateAction, signature: back.signature });
  assert.deepEqual(Buffer.from(t.encodeSignedDelegate(rewrapped.signedDelegate)), Buffer.from(bytes));
});
