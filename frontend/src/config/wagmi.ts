import { createAppKit } from '@reown/appkit/react';
import { bitcoin, mainnet, sepolia } from '@reown/appkit/networks';
import { BitcoinAdapter } from '@reown/appkit-adapter-bitcoin';
// import { SolanaAdapter } from '@reown/appkit-adapter-solana';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { getFrontendOrigin } from './origins';

export const projectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '').trim();
export const hasReownWalletModal = projectId.length > 0;
const appUrl = getFrontendOrigin();

const evmNetworks = [mainnet, sepolia] as const;
const wagmiNetworks = [...evmNetworks];
const bitcoinNetworks = [bitcoin];
const networks = [...wagmiNetworks, ...bitcoinNetworks] as [typeof mainnet, typeof sepolia, typeof bitcoin];
const metadata = {
  name: 'Meritocracy DAO',
  description: 'Meritocracy funds scientists and open-source developers through transparent governance.',
  url: appUrl,
  icons: [new URL('/logo.png', appUrl).toString()],
};

let config: ReturnType<typeof createConfig> = createConfig({
  chains: evmNetworks,
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});

if (hasReownWalletModal) {
  const wagmiAdapter = new WagmiAdapter({
    projectId,
    networks: wagmiNetworks,
  });
  // const solanaAdapter = new SolanaAdapter({
  //   registerWalletStandard: true,
  // });
  const bitcoinAdapter = new BitcoinAdapter({ projectId });

  createAppKit({
    adapters: [wagmiAdapter, bitcoinAdapter],
    // adapters: [wagmiAdapter, solanaAdapter, bitcoinAdapter],
    metadata,
    networks,
    projectId,
    enableNetworkSwitch: false,
    // TODO@P3
    // Coinbase Wallet breaks the production app because its telemetry loader appends an inline UMD script.
    enableCoinbase: true,
    debug: true,
    enableReconnect: false,
    features: {
      analytics: true,
    },
  });

  config = wagmiAdapter.wagmiConfig as ReturnType<typeof createConfig>;
}

export { config };
