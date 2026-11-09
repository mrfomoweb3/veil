import { test } from 'node:test';
import assert from 'node:assert';
import { checkDelegate, endpointRefused, hostOf, implicitMatches, RateLimit } from './policy.mjs';

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

test('an RPC that refuses moves on; an answer from the chain does not', () => {
  const err = (message, cause) => Object.assign(new Error(message), cause ? { cause } : {});
  assert.ok(endpointRefused(err('{"error":"UNAUTHORIZED","instance":"x"}', 401)));
  assert.ok(endpointRefused(err('{"error":"UNAUTHORIZED"}')));
  assert.ok(endpointRefused(err('{"code":-429,"message":"Rate limits exceeded"}')));
  assert.ok(endpointRefused(err('bad gateway', 502)));
  assert.ok(endpointRefused(err('request to https://x failed, reason: getaddrinfo ENOTFOUND x')));
  assert.ok(!endpointRefused(err('InvalidNonce: tx nonce 5 must be larger than 7')));
  assert.ok(!endpointRefused(err('Smart contract panicked: turn still open')));
  // dRPC's free plan cuts off waits for execution; the same signed bytes go to the next endpoint.
  assert.ok(endpointRefused(err('{"error":{"message":"Request timeout on the free plan, please upgrade to paid plan","code":30}}')));
});

test('logs name the host only', () => {
  assert.equal(hostOf('https://abc.near-testnet.quiknode.pro/SECRETTOKEN/?apiKey=K'), 'https://abc.near-testnet.quiknode.pro');
  // A missing slash glues the token onto the host: it must still not be logged.
  const glued = hostOf('https://abc.near-testnet.quiknode.pro' + 'f'.repeat(40));
  assert.ok(!glued.includes('f'.repeat(20)), glued);
});
