import { createAppKit } from '@reown/appkit/react';
import { mainnet, sepolia } from '@reown/appkit/networks';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';

export const projectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '').trim();
export const hasReownWalletModal = projectId.length > 0;
const runtimeOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;
const appUrl = (import.meta.env.VITE_FRONTEND_URL || runtimeOrigin || 'https://merit.science-dao.org').trim();

const networks = [mainnet, sepolia] as const;
const metadata = {
  name: 'Meritocracy DAO',
  description: 'Meritocracy funds scientists and open-source developers through transparent governance.',
  url: appUrl,
  icons: ['https://merit.science-dao.org/logo.png'],
};

let config = createConfig({
  chains: networks,
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});

if (hasReownWalletModal) {
  const wagmiAdapter = new WagmiAdapter({
    projectId,
    networks,
  });

  createAppKit({
    adapters: [wagmiAdapter],
    metadata,
    networks,
    projectId,
    enableNetworkSwitch: false,
    debug: true,
    enableReconnect: false,
    features: {
      analytics: true,
    },
  });

  config = wagmiAdapter.wagmiConfig;
}

export { config };
