import { test } from 'node:test';
import assert from 'node:assert';
import { checkDelegate, implicitMatches, RateLimit } from './policy.mjs';

const fc = (methodName, deposit = 0n, gas = 30n * 10n ** 12n) => ({ functionCall: { methodName, args: new Uint8Array(), gas, deposit } });
const sd = (receiverId, actions) => ({ delegateAction: { senderId: 'a'.repeat(64), receiverId, actions } });

test('relays only zero-deposit allowlisted calls to the contract', () => {
  assert.equal(checkDelegate(sd('veil.testnet', [fc('submit_orders')]), 'veil.testnet'), null);
  assert.match(checkDelegate(sd('usdc.testnet', [fc('ft_transfer')]), 'veil.testnet'), /only calls/);
  assert.match(checkDelegate(sd('veil.testnet', [fc('withdraw_rake')]), 'veil.testnet'), /not relayed/);
  assert.match(checkDelegate(sd('veil.testnet', [fc('submit_orders', 1n)]), 'veil.testnet'), /no deposit/);
  assert.match(checkDelegate(sd('veil.testnet', [fc('submit_orders', 0n, 10n ** 15n)]), 'veil.testnet'), /gas/);
  assert.match(checkDelegate(sd('veil.testnet', [fc('submit_orders'), fc('claim')]), 'veil.testnet'), /exactly one/);
  assert.match(checkDelegate(sd('veil.testnet', [{ transfer: { deposit: 1n } }]), 'veil.testnet'), /function calls/);
});

test('relays a Chain Signatures sign, and nothing else, to the MPC contract', () => {
  const MPC = 'v1.signer-prod.testnet';
  const args = (o) => new TextEncoder().encode(JSON.stringify({ request: { payload_v2: { Ecdsa: 'ab'.repeat(32) }, path: 'veil-base-1', domain_id: 0, ...o } }));
  const sign = (o = {}, deposit = 1n, gas = 300n * 10n ** 12n, methodName = 'sign') => ({ functionCall: { methodName, args: args(o), gas, deposit } });
  assert.equal(checkDelegate(sd(MPC, [sign()]), 'veil.testnet', MPC), null);
  assert.match(checkDelegate(sd(MPC, [sign()]), 'veil.testnet'), /only calls/);
  assert.match(checkDelegate(sd(MPC, [sign({}, 0n)]), 'veil.testnet', MPC), /1 yocto/);
  assert.match(checkDelegate(sd(MPC, [sign({}, 10n ** 24n)]), 'veil.testnet', MPC), /1 yocto/);
  assert.match(checkDelegate(sd(MPC, [sign({}, 1n, 301n * 10n ** 12n)]), 'veil.testnet', MPC), /gas/);
  assert.match(checkDelegate(sd(MPC, [sign({}, 1n, 300n * 10n ** 12n, 'vote_join')]), 'veil.testnet', MPC), /only sign/);
  assert.match(checkDelegate(sd(MPC, [sign({ path: 'someone-else' })]), 'veil.testnet', MPC), /veil- derivation/);
  assert.match(checkDelegate(sd(MPC, [sign({ domain_id: 1 })]), 'veil.testnet', MPC), /secp256k1/);
  assert.match(checkDelegate(sd(MPC, [sign(), sign()]), 'veil.testnet', MPC), /exactly one/);
  // borsh hands the args over as a plain number array
  const plain = sign(); plain.functionCall.args = Array.from(plain.functionCall.args);
  assert.equal(checkDelegate(sd(MPC, [plain]), 'veil.testnet', MPC), null);
});

test('implicit account shape', () => {
  assert.ok(implicitMatches('ab'.repeat(32), 'ed25519:xyz'));
  assert.ok(!implicitMatches('alice.near', 'ed25519:xyz'));
});

test('rate limit', () => {
  const r = new RateLimit(2);
  assert.ok(r.take('x', 0) && r.take('x', 1));
  assert.ok(!r.take('x', 2));
  assert.ok(r.take('x', 61_000));
});
