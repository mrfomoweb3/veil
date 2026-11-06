// Live check of the Chain Signatures path, as the browser runs it, from a fresh implicit account:
//   onboard (relayer) → derive the Base address → build an unsigned Base Sepolia tx →
//   `sign` on the MPC contract as a gasless delegate (relayer) → recover → must be our address.
// Broadcasts nothing unless BROADCAST=1 and the derived address holds Base Sepolia ETH.
//   cd web && RELAYER=http://localhost:8790 npx vite-node scripts/chainsig-check.ts
import { Account, Connection, InMemorySigner, KeyPair, keyStores, providers } from 'near-api-js';
import { createRequire } from 'node:module';
import { createPublicClient, http, keccak256, recoverAddress, serializeTransaction, type TransactionSerializableEIP1559 } from 'viem';
import { baseSepolia } from 'viem/chains';
import { BASE_PATH, derivedAddress, MPC, signArgs, toEvmSignature, type MpcSignature } from '../src/privacy/chainSig';

// @near-js/transactions' ESM build uses extensionless imports Node can't resolve; use its CJS build.
const { actionCreators, encodeSignedDelegate } = createRequire(import.meta.url)('@near-js/transactions');
const RELAYER = process.env.RELAYER ?? 'http://localhost:8790';
const RPC = process.env.NEAR_RPC ?? 'https://test.rpc.fastnear.com';
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const post = async (path: string, body: unknown) => {
  const r = await fetch(RELAYER + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5174' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`${path}: ${j.error ?? r.status}`);
  return j.result;
};

const kp = process.env.NEAR_KEY ? KeyPair.fromString(process.env.NEAR_KEY as never) : KeyPair.fromRandom('ed25519');
const account = Buffer.from(kp.getPublicKey().data).toString('hex');
const store = new keyStores.InMemoryKeyStore();
await store.setKey('testnet', account, kp);
const provider = new providers.JsonRpcProvider({ url: RPC });
const acct = new Account(new Connection('testnet', provider, new InMemorySigner(store), ''), account);

log('NEAR account', account);
log('onboard', await post('/onboard', { account_id: account, public_key: kp.getPublicKey().toString() }));
for (let i = 0; i < 15; i++) {
  try { await provider.query({ request_type: 'view_account', finality: 'final', account_id: account }); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
}

const address = derivedAddress('testnet', account, BASE_PATH);
log('derived Base address', address);
const base = createPublicClient({ chain: baseSepolia, transport: http() });
const [nonce, fees, balance] = await Promise.all([base.getTransactionCount({ address }), base.estimateFeesPerGas(), base.getBalance({ address })]);
const tx: TransactionSerializableEIP1559 = {
  type: 'eip1559', chainId: baseSepolia.id, nonce, to: address, value: 0n, gas: 21000n,
  maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
};
const hash = keccak256(serializeTransaction(tx));
log('tx hash to sign', hash);

const d = await acct.signedDelegate({
  receiverId: MPC.testnet.contract,
  actions: [actionCreators.functionCall('sign', signArgs(hash, BASE_PATH), 300n * 10n ** 12n, 1n)],
  blockHeightTtl: 120,
});
const mpc = (await post('/relay', { signed_delegate: Buffer.from(encodeSignedDelegate(d)).toString('base64') })) as MpcSignature;
log('MPC answer', JSON.stringify(mpc));
const signature = toEvmSignature(mpc);
const who = await recoverAddress({ hash, signature });
log('recovered', who, who === address ? '✔ matches the derived address' : '✘ MISMATCH');
if (who !== address) process.exit(1);

const raw = serializeTransaction(tx, signature);
if (process.env.BROADCAST === '1') {
  if (balance < 21000n * fees.maxFeePerGas) throw new Error(`fund ${address} with Base Sepolia ETH first`);
  const h = await base.sendRawTransaction({ serializedTransaction: raw });
  log('broadcast', `https://sepolia.basescan.org/tx/${h}`);
  log('status', (await base.waitForTransactionReceipt({ hash: h })).status);
} else {
  log('signed raw tx ready (not broadcast)', raw.slice(0, 42) + '…');
}
