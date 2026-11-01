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
