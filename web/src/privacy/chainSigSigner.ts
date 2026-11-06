// Default Base signer: the player's NEAR account, through NEAR Chain Signatures. No second
// wallet, no popup: the browser builds the Base transaction, the MPC network signs its hash for
// the address derived from the NEAR account, and the browser broadcasts it. The relayer pays the
// NEAR gas for `sign` like any other player call.
//
// Before anything is broadcast, the signature is recovered and must match the derived address,
// so a wrong derivation or a garbled signature can only fail here, never send a bad transaction.
import { keccak256, recoverAddress, serializeTransaction, formatEther, type Address, type Hex, type TransactionSerializableEIP1559 } from 'viem';
import type { Chain } from '../chain/types';
import type { BaseSigner, BaseTx } from './baseSigner';
import { BASE_PATH, derivedAddress, toEvmSignature } from './chainSig';
import { gloamNetwork, publicClient } from './gloamNetwork';

/** Thrown when the derived address has too little ETH for gas; the UI offers the faucet / bridge. */
export class NeedsGasError extends Error {
  constructor(readonly address: Address, readonly needWei: bigint, readonly haveWei: bigint) {
    super(`Your Base address needs about ${formatEther(needWei - haveWei)} more ETH for gas.`);
  }
}

export function chainSigSigner(chain: Chain): BaseSigner {
  if (chain.network === 'devnet' || !chain.mpcSign) throw new Error('Chain Signatures need a NEAR testnet or mainnet account.');
  const address = derivedAddress(chain.network, chain.account, BASE_PATH);
  const mpcSign = chain.mpcSign.bind(chain);
  let queue: Promise<unknown> = Promise.resolve();

  async function send(tx: BaseTx): Promise<Hex> {
    const net = gloamNetwork();
    const client = publicClient(net);
    const value = tx.value ?? 0n;
    const [nonce, fees, balance] = await Promise.all([
      client.getTransactionCount({ address, blockTag: 'pending' }),
      client.estimateFeesPerGas(),
      client.getBalance({ address }),
    ]);
    const gas = ((await client.estimateGas({ account: address, to: tx.to, data: tx.data, value })) * 12n) / 10n;
    const need = gas * fees.maxFeePerGas + value;
    if (balance < need) throw new NeedsGasError(address, need, balance);

    const unsigned: TransactionSerializableEIP1559 = {
      type: 'eip1559', chainId: net.chainId, nonce, to: tx.to, data: tx.data, value, gas,
      maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
    const hash = keccak256(serializeTransaction(unsigned));
    const signature = toEvmSignature(await mpcSign(hash, BASE_PATH));
    const signer = await recoverAddress({ hash, signature });
    if (signer !== address) throw new Error(`Chain Signatures answered for ${signer}, not your address ${address}. Nothing was sent.`);
    return client.sendRawTransaction({ serializedTransaction: serializeTransaction(unsigned, signature) });
  }

  return {
    kind: 'chain-signatures',
    address: async () => address,
    // One at a time, so each transaction reads the nonce the previous one used.
    sendTx(tx) {
      const next = queue.catch(() => {}).then(() => send(tx));
      queue = next.then((h) => publicClient().waitForTransactionReceipt({ hash: h, timeout: 180_000 }).catch(() => {}));
      return next;
    },
  };
}
