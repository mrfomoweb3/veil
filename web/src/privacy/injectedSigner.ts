// Fallback signer: the player's own EVM wallet through window.ethereum.
import { createWalletClient, custom, type Address, type EIP1193Provider } from 'viem';
import type { BaseSigner, BaseTx } from './baseSigner';
import { gloamNetwork } from './gloamNetwork';

declare global { interface Window { ethereum?: EIP1193Provider } }

export async function injectedSigner(): Promise<BaseSigner> {
  const eth = window.ethereum;
  if (!eth) throw new Error('No browser wallet found. Install one, or use your NEAR account (Chain Signatures).');
  const net = gloamNetwork();
  const wallet = createWalletClient({ chain: net.chain, transport: custom(eth) });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new Error('The wallet shared no address.');
  const ensureChain = async () => {
    if ((await wallet.getChainId()) === net.chainId) return;
    try {
      await wallet.switchChain({ id: net.chainId });
    } catch {
      await wallet.addChain({ chain: net.chain });
      await wallet.switchChain({ id: net.chainId });
    }
  };
  return {
    kind: 'injected',
    address: async () => account as Address,
    async sendTx(tx: BaseTx) {
      await ensureChain();
      return wallet.sendTransaction({ account, chain: net.chain, to: tx.to, data: tx.data, value: tx.value ?? 0n });
    },
  };
}
